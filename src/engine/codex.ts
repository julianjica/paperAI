import type { AgentEvent } from "../core/types.ts";
import { clip, EventChannel, jsonSchemaOf, type Engine, type RunOptions } from "./engine.ts";
import { CodexClient, codexEnv, spawnCodex, type ConnectFn } from "./codex-rpc.ts";

/**
 * Codex engine: one `codex app-server` child per turn, native tools ON,
 * sandbox workspace-write in the paper folder, app tools as dynamicTools.
 * Threads are resumed across turns (`thread/resume`); a lost thread starts
 * a fresh one.
 */

interface CodexItem {
	id: string;
	type: string;
	text?: string;
	summary?: string[];
	tool?: string;
	arguments?: unknown;
	command?: string | string[];
	// commandExecution
	aggregatedOutput?: string;
	exitCode?: number;
	status?: string;
	// fileChange
	changes?: { path?: string; kind?: string }[];
	[key: string]: unknown;
}
/** Item types that are tool activity. Others (userMessage, dynamicToolCall — reported via item/tool/call — , contextCompaction …) are not shown as tools. */
const TOOL_ITEMS = new Set(["commandExecution", "fileChange", "mcpToolCall", "webSearch"]);
interface CodexTurn { id: string; status: "completed" | "interrupted" | "failed" | "inProgress"; error?: { message?: string } | null }

function describeItem(item: CodexItem): { name: string; input: unknown } {
	switch (item.type) {
		case "commandExecution":
			return { name: "Bash", input: { command: Array.isArray(item.command) ? item.command.join(" ") : item.command ?? "" } };
		case "fileChange":
			return { name: "Edit", input: { files: (item.changes ?? []).map((c) => `${c.kind ?? "edit"} ${c.path ?? ""}`.trim()) } };
		case "mcpToolCall":
			return { name: String(item.tool ?? "mcp"), input: item.arguments ?? {} };
		case "webSearch":
			return { name: "WebSearch", input: { query: item.query ?? "" } };
		default:
			return { name: item.type, input: {} };
	}
}

function itemOutput(item: CodexItem): { output: string; isError: boolean } {
	if (item.type === "commandExecution") {
		const out = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
		const code = typeof item.exitCode === "number" ? item.exitCode : undefined;
		return { output: clip(`${out}${code !== undefined && code !== 0 ? `\n(exit ${code})` : ""}`.trim()), isError: code !== undefined && code !== 0 };
	}
	if (item.type === "fileChange") return { output: (item.changes ?? []).map((c) => `${c.kind ?? "edit"} ${c.path ?? ""}`).join("\n"), isError: item.status === "failed" };
	if (typeof item.output === "string") return { output: clip(item.output), isError: item.status === "failed" };
	return { output: item.status ? String(item.status) : "", isError: item.status === "failed" };
}

export function createCodexEngine(connectOverride?: ConnectFn): Engine {
	return {
		id: "codex",
		run(o: RunOptions): AsyncIterable<AgentEvent> {
			const events = new EventChannel<AgentEvent>();
			void (async () => {
				let client: CodexClient | undefined;
				let finished = false;
				let failure: string | undefined;
				let finalText = "";
				let currentText = "";
				const textItems = new Set<string>();
				const thinkingItems = new Set<string>();
				const toolItems = new Map<string, string>();
				let resolveDone: () => void = () => {};
				const done = new Promise<void>((r) => (resolveDone = r));
				const finish = () => {
					if (finished) return;
					finished = true;
					resolveDone();
				};
				const toolsByName = new Map(o.tools.map((t) => [t.name, t]));
				let threadId: string | undefined;
				let turnId: string | undefined;

				const onNotification = (method: string, params: Record<string, unknown>) => {
					if (finished) return;
					if (threadId && params.threadId !== undefined && params.threadId !== threadId) return;
					if (method === "turn/started") {
						turnId = (params.turn as CodexTurn).id;
						return;
					}
					if (method === "turn/completed") {
						const turn = params.turn as CodexTurn;
						if (turn.status === "failed") failure = turn.error?.message ?? "Codex turn failed";
						else if (turn.status === "interrupted") failure = "Aborted";
						finish();
						return;
					}
					if (method === "error") {
						if (params.willRetry !== true) failure ??= (params.error as { message?: string })?.message ?? "Codex reported an error";
						return;
					}
					if (turnId && params.turnId !== undefined && params.turnId !== turnId) return;
					switch (method) {
						case "item/started": {
							const item = params.item as CodexItem;
							if (item.type === "agentMessage") {
								textItems.add(item.id);
								if (item.text) {
									currentText += item.text;
									events.push({ type: "text_delta", text: item.text });
								}
							} else if (item.type === "reasoning") thinkingItems.add(item.id);
							else if (TOOL_ITEMS.has(item.type)) {
								const d = describeItem(item);
								toolItems.set(item.id, d.name);
								events.push({ type: "tool_start", id: item.id, name: d.name, input: d.input });
							}
							return;
						}
						case "item/agentMessage/delta": {
							const id = params.itemId as string;
							const delta = String(params.delta ?? "");
							if (textItems.has(id) && delta) {
								currentText += delta;
								events.push({ type: "text_delta", text: delta });
							}
							return;
						}
						case "item/reasoning/summaryTextDelta":
						case "item/reasoning/textDelta": {
							const delta = String(params.delta ?? "");
							if (thinkingItems.has(params.itemId as string) && delta) events.push({ type: "thinking_delta", text: delta });
							return;
						}
						case "item/reasoning/summaryPartAdded":
							if (thinkingItems.has(params.itemId as string)) events.push({ type: "thinking_delta", text: "\n\n" });
							return;
						case "item/completed": {
							const item = params.item as CodexItem;
							if (textItems.has(item.id)) {
								if (typeof item.text === "string") finalText = item.text;
							} else if (toolItems.has(item.id)) {
								const r = itemOutput(item);
								events.push({ type: "tool_end", id: item.id, name: toolItems.get(item.id)!, output: r.output, isError: r.isError });
							}
							return;
						}
						case "thread/tokenUsage/updated": {
							const last = (params.tokenUsage as { last?: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number } })?.last;
							if (last) events.push({ type: "usage", input: Math.max(0, (last.inputTokens ?? 0) - (last.cachedInputTokens ?? 0)), output: last.outputTokens ?? 0, cacheRead: last.cachedInputTokens ?? 0 });
							return;
						}
					}
				};

				const onToolCall = async (params: { callId: string; tool: string; arguments: unknown }) => {
					const tool = toolsByName.get(params.tool);
					events.push({ type: "tool_start", id: params.callId, name: params.tool, input: params.arguments ?? {} });
					if (!tool) {
						events.push({ type: "tool_end", id: params.callId, name: params.tool, output: "Unknown tool", isError: true });
						return { contentItems: [{ type: "inputText", text: `Unknown tool ${params.tool}` }], success: false };
					}
					try {
						const r = await tool.handler((params.arguments ?? {}) as Record<string, unknown>);
						events.push({ type: "tool_end", id: params.callId, name: params.tool, output: clip(r.text), isError: r.isError === true });
						return { contentItems: [{ type: "inputText", text: r.text }], success: r.isError !== true };
					} catch (error) {
						const text = error instanceof Error ? error.message : String(error);
						events.push({ type: "tool_end", id: params.callId, name: params.tool, output: text, isError: true });
						return { contentItems: [{ type: "inputText", text }], success: false };
					}
				};

				const onAbort = () => {
					if (client && threadId) client.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
					failure ??= "Aborted";
					finish();
				};
				o.signal.addEventListener("abort", onAbort, { once: true });
				// A setup request still outstanding when the run is aborted (or the server
				// closes) must not keep the run alive; `done` resolves in both cases.
				const guarded = <T,>(request: Promise<T>) => Promise.race([request, done.then(() => Promise.reject(new Error(failure ?? "Aborted")))]);
				if (o.signal.aborted) onAbort();

				try {
					const connect = connectOverride ?? spawnCodex;
					client = new CodexClient(connect({ cwd: o.cwd, env: codexEnv() }), {
						notification: (method, params) => onNotification(method, (params ?? {}) as Record<string, unknown>),
						request: (method, params) => {
							if (method === "item/tool/call") return onToolCall(params as never);
							return Promise.reject(new Error(`researchAI does not handle ${method}`));
						},
						closed: (reason) => {
							if (!finished && !o.signal.aborted) failure ??= reason ?? "Codex closed the connection";
							finish();
						},
					});
					await guarded(client.request("initialize", { clientInfo: { name: "researchai", title: "researchAI", version: "1" }, capabilities: { experimentalApi: true } }));
					client.notify("initialized");
					const dynamicTools = o.tools.map((t) => ({ type: "function", name: t.name, description: t.description, inputSchema: jsonSchemaOf(t) }));
					const common = { model: o.model, baseInstructions: o.systemPrompt, approvalPolicy: "never", sandbox: "workspace-write", cwd: o.cwd, dynamicTools };
					if (o.resume) {
						try {
							threadId = (await guarded(client.request<{ thread: { id: string } }>("thread/resume", { threadId: o.resume, ...common }))).thread.id;
						} catch {
							if (finished) throw new Error(failure ?? "Aborted");
							threadId = undefined;
						}
					}
					if (!threadId) threadId = (await guarded(client.request<{ thread: { id: string } }>("thread/start", { ...common, ephemeral: false }))).thread.id;
					events.push({ type: "session", id: threadId });
					await guarded(client.request("turn/start", { threadId, input: [{ type: "text", text: o.input }], model: o.model, effort: o.effort, summary: "auto" }));
					await done;
				} catch (error) {
					failure ??= error instanceof Error ? error.message : String(error);
				} finally {
					o.signal.removeEventListener("abort", onAbort);
					finished = true;
					client?.close();
				}
				if (failure) events.push({ type: "error", message: failure });
				else events.push({ type: "done", text: finalText || currentText });
				events.close();
			})();
			return events;
		},
	};
}
