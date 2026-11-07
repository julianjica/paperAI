import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "../core/types.ts";
import { clip, EventChannel, type Engine, type RunOptions } from "./engine.ts";
import { claudeExecutable } from "./exec.ts";

/**
 * Claude Code engine: one `query()` per turn with the CLI's NATIVE tools on
 * and the paper folder as cwd. App tools ride an in-process MCP server.
 * Native subagents (Agent/Task) are disallowed: delegation goes through the
 * app's `delegate` tool so every worker is visible in the activity panel.
 *
 * Env: ANTHROPIC_API_KEY is stripped so the CLI's own login decides billing,
 * unless RA_CLAUDE_CODE_USE_API_KEY=1.
 */

export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

type Sdk = typeof import("@anthropic-ai/claude-agent-sdk");
let loaded: Promise<{ query: QueryFn; createSdkMcpServer: Sdk["createSdkMcpServer"]; tool: Sdk["tool"] }> | undefined;
function sdk() {
	if (!loaded) loaded = import("@anthropic-ai/claude-agent-sdk").then((m) => ({ query: m.query as unknown as QueryFn, createSdkMcpServer: m.createSdkMcpServer, tool: m.tool }));
	return loaded;
}

function env(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k] = v;
	if (process.env.RA_CLAUDE_CODE_USE_API_KEY !== "1") {
		delete out.ANTHROPIC_API_KEY;
		delete out.ANTHROPIC_AUTH_TOKEN;
	}
	// The app runs inside Claude Code sometimes (development); a nested CLI must not inherit that.
	delete out.CLAUDECODE;
	delete out.CLAUDE_CODE_ENTRYPOINT;
	return out;
}

const MCP_SERVER = "researchai";
const mcpName = (tool: string) => `mcp__${MCP_SERVER}__${tool}`;
const bareName = (name: string) => (name.startsWith(`mcp__${MCP_SERVER}__`) ? name.slice(`mcp__${MCP_SERVER}__`.length) : name);

export function createClaudeCodeEngine(queryOverride?: QueryFn): Engine {
	return {
		id: "claude-code",
		run(o: RunOptions): AsyncIterable<AgentEvent> {
			const events = new EventChannel<AgentEvent>();
			void (async () => {
				let finalText = "";
				let sawResult = false;
				try {
					const { query, createSdkMcpServer, tool } = await sdk();
					const q = queryOverride ?? query;
					const server = createSdkMcpServer({
						name: MCP_SERVER,
						version: "1.0.0",
						alwaysLoad: true,
						tools: o.tools.map((t) =>
							tool(t.name, t.description, t.schema, async (args) => {
								const r = await t.handler((args ?? {}) as Record<string, unknown>);
								return { content: [{ type: "text" as const, text: r.text }], isError: r.isError === true };
							}),
						),
					});
					const abort = new AbortController();
					const onAbort = () => abort.abort();
					if (o.signal.aborted) abort.abort();
					else o.signal.addEventListener("abort", onAbort, { once: true });
					const options: Options = {
						cwd: o.cwd,
						model: o.model,
						effort: o.effort,
						systemPrompt: { type: "preset", preset: "claude_code", append: o.systemPrompt },
						settingSources: [],
						permissionMode: "bypassPermissions",
						allowDangerouslySkipPermissions: true,
						disallowedTools: ["Agent", "Task", "AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
						mcpServers: { [MCP_SERVER]: server },
						allowedTools: o.tools.map((t) => mcpName(t.name)),
						includePartialMessages: true,
						abortController: abort,
						env: env(),
						...(o.resume ? { resume: o.resume } : {}),
						...(claudeExecutable() ? { pathToClaudeCodeExecutable: claudeExecutable() } : {}),
					} as Options;
					const open = new Map<number, { kind: "text" | "thinking" | "tool"; id?: string; name?: string; json?: string }>();
					const toolNames = new Map<string, string>();
					let currentText = "";
					for await (const m of q({ prompt: o.input, options })) {
						if (m.type === "system" && m.subtype === "init") {
							events.push({ type: "session", id: m.session_id });
						} else if (m.type === "stream_event") {
							if (m.parent_tool_use_id) continue;
							const e = m.event as unknown as Record<string, unknown>;
							if (e.type === "content_block_start") {
								const block = e.content_block as { type: string; id?: string; name?: string };
								const index = e.index as number;
								if (block.type === "text") open.set(index, { kind: "text" });
								else if (block.type === "thinking") open.set(index, { kind: "thinking" });
								else if (block.type === "tool_use") open.set(index, { kind: "tool", id: block.id, name: block.name, json: "" });
							} else if (e.type === "content_block_delta") {
								const delta = e.delta as { type: string; text?: string; thinking?: string; partial_json?: string };
								const part = open.get(e.index as number);
								if (!part) continue;
								if (delta.type === "text_delta" && delta.text) {
									currentText += delta.text;
									events.push({ type: "text_delta", text: delta.text });
								} else if (delta.type === "thinking_delta" && delta.thinking) events.push({ type: "thinking_delta", text: delta.thinking });
								else if (delta.type === "input_json_delta" && part.kind === "tool") part.json = (part.json ?? "") + (delta.partial_json ?? "");
							} else if (e.type === "content_block_stop") {
								const part = open.get(e.index as number);
								open.delete(e.index as number);
								if (part?.kind === "tool" && part.id && part.name) {
									let input: unknown = {};
									try {
										input = part.json ? JSON.parse(part.json) : {};
									} catch {
										input = { raw: part.json };
									}
									const name = bareName(part.name);
									toolNames.set(part.id, name);
									events.push({ type: "tool_start", id: part.id, name, input });
								}
							} else if (e.type === "message_delta") {
								const usage = e.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined;
								if (usage) events.push({ type: "usage", input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0 });
							}
						} else if (m.type === "user" && !("parent_tool_use_id" in m && m.parent_tool_use_id)) {
							// Tool results come back as user messages with tool_result blocks.
							const content = (m.message as { content?: unknown }).content;
							if (!Array.isArray(content)) continue;
							for (const block of content as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
								if (block.type !== "tool_result" || !block.tool_use_id) continue;
								const text = typeof block.content === "string" ? block.content : Array.isArray(block.content) ? (block.content as { type: string; text?: string }[]).map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`)).join("\n") : "";
								events.push({ type: "tool_end", id: block.tool_use_id, name: toolNames.get(block.tool_use_id) ?? "tool", output: clip(text), isError: block.is_error === true });
							}
						} else if (m.type === "assistant") {
							// Final text per block arrives here too; stream events already carried it.
							if (m.parent_tool_use_id) continue;
							const blocks = (m.message as { content?: { type: string; text?: string }[] }).content ?? [];
							const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
							if (text) finalText = text;
						} else if (m.type === "result") {
							sawResult = true;
							const r = m as { subtype: string; result?: string; errors?: string[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
							if (r.usage) events.push({ type: "usage", input: r.usage.input_tokens ?? 0, output: r.usage.output_tokens ?? 0, cacheRead: r.usage.cache_read_input_tokens ?? 0 });
							if (r.subtype === "success") events.push({ type: "done", text: r.result ?? finalText ?? currentText });
							else events.push({ type: "error", message: r.errors?.join("\n") || r.result || `Claude Code ended with ${r.subtype}` });
						}
					}
					o.signal.removeEventListener("abort", onAbort);
					if (!sawResult) events.push(o.signal.aborted ? { type: "error", message: "Aborted" } : { type: "done", text: finalText || currentText });
				} catch (error) {
					events.push({ type: "error", message: o.signal.aborted ? "Aborted" : error instanceof Error ? error.message : String(error) });
				} finally {
					events.close();
				}
			})();
			return events;
		},
	};
}
