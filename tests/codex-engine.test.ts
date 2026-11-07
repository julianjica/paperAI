import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createCodexEngine } from "../src/engine/codex.ts";
import type { CodexTransport, RpcMessage } from "../src/engine/codex-rpc.ts";
import type { AgentEvent } from "../src/core/types.ts";

/** A scripted app-server: answers requests and replays a turn. */
function fakeServer() {
	const listeners = new Set<(m: RpcMessage) => void>();
	const closers = new Set<(r?: string) => void>();
	const sent: RpcMessage[] = [];
	const emit = (m: RpcMessage) => { for (const l of listeners) l(m); };
	const transport: CodexTransport = {
		send(m) {
			sent.push(m);
			if (m.method === "initialize") emit({ id: m.id, result: {} });
			if (m.method === "thread/start") emit({ id: m.id, result: { thread: { id: "thr-1" } } });
			if (m.method === "thread/resume") emit({ id: m.id, error: { message: "gone" } });
			if (m.method === "turn/start") {
				emit({ id: m.id, result: { turn: { id: "turn-1" } } });
				setTimeout(() => {
					emit({ method: "turn/started", params: { threadId: "thr-1", turn: { id: "turn-1" } } });
					emit({ method: "item/started", params: { threadId: "thr-1", turnId: "turn-1", item: { id: "u", type: "userMessage" } } });
					emit({ method: "item/started", params: { threadId: "thr-1", turnId: "turn-1", item: { id: "r1", type: "reasoning" } } });
					emit({ method: "item/reasoning/summaryTextDelta", params: { threadId: "thr-1", turnId: "turn-1", itemId: "r1", delta: "hmm" } });
					emit({ method: "item/started", params: { threadId: "thr-1", turnId: "turn-1", item: { id: "cmd", type: "commandExecution", command: ["ls"] } } });
					emit({ method: "item/completed", params: { threadId: "thr-1", turnId: "turn-1", item: { id: "cmd", type: "commandExecution", command: ["ls"], aggregatedOutput: "a.tex", exitCode: 0 } } });
					// A dynamic tool call: server request we must answer.
					emit({ id: "srv-1", method: "item/tool/call", params: { callId: "call-1", tool: "echo", arguments: { text: "hi" } } });
				}, 0);
			}
			if (m.id === "srv-1" && m.result) {
				const r = m.result as { contentItems: { text: string }[]; success: boolean };
				setTimeout(() => {
					emit({ method: "item/started", params: { threadId: "thr-1", turnId: "turn-1", item: { id: "a1", type: "agentMessage", text: "" } } });
					emit({ method: "item/agentMessage/delta", params: { threadId: "thr-1", turnId: "turn-1", itemId: "a1", delta: `tool said ${r.contentItems[0].text}` } });
					emit({ method: "item/completed", params: { threadId: "thr-1", turnId: "turn-1", item: { id: "a1", type: "agentMessage", text: `tool said ${r.contentItems[0].text}` } } });
					emit({ method: "thread/tokenUsage/updated", params: { threadId: "thr-1", tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 7 } } } });
					emit({ method: "turn/completed", params: { threadId: "thr-1", turn: { id: "turn-1", status: "completed" } } });
				}, 0);
			}
		},
		onMessage(l) { listeners.add(l); },
		onClose(l) { closers.add(l); },
		close() { for (const c of closers) c(); },
	};
	return { transport, sent };
}

test("Codex adapter: resume fallback, native tool items, dynamic tool round-trip, usage, done", async () => {
	const { transport, sent } = fakeServer();
	const engine = createCodexEngine(() => transport);
	const events: AgentEvent[] = [];
	for await (const e of engine.run({
		cwd: "/tmp",
		systemPrompt: "sys",
		model: "gpt-x",
		effort: "low",
		input: "do it",
		resume: "old-thread",
		tools: [{ name: "echo", description: "echo", schema: { text: z.string() }, handler: async (i) => ({ text: String(i.text) }) }],
		signal: new AbortController().signal,
	})) events.push(e);
	const types = events.map((e) => e.type);
	assert.deepEqual(types, ["session", "thinking_delta", "tool_start", "tool_end", "tool_start", "tool_end", "text_delta", "usage", "done"]);
	assert.deepEqual(events[0], { type: "session", id: "thr-1" });
	assert.deepEqual(events[2], { type: "tool_start", id: "cmd", name: "Bash", input: { command: "ls" } });
	assert.deepEqual(events[4], { type: "tool_start", id: "call-1", name: "echo", input: { text: "hi" } });
	assert.deepEqual(events[7], { type: "usage", input: 60, output: 7, cacheRead: 40 });
	assert.deepEqual(events[8], { type: "done", text: "tool said hi" });
	const start = sent.find((m) => m.method === "thread/start")!.params as Record<string, unknown>;
	assert.equal(start.sandbox, "workspace-write");
	assert.equal(start.cwd, "/tmp");
	const tools = start.dynamicTools as { name: string; inputSchema: { properties: Record<string, unknown> } }[];
	assert.equal(tools[0].name, "echo");
	assert.ok(tools[0].inputSchema.properties.text);
	assert.ok(sent.some((m) => m.method === "thread/resume"));
});
