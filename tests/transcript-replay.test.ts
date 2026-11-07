import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "../src/core/types.ts";
import { createClaudeCodeEngine, type QueryFn } from "../src/engine/claude-code.ts";
import { createCodexEngine } from "../src/engine/codex.ts";
import type { CodexTransport, RpcMessage } from "../src/engine/codex-rpc.ts";

/**
 * Replay of real recordings (scripts/record-transcript.mjs) through the real
 * adapters: one short turn per engine, "Reply with the single word OK".
 * The expected counts come from the fixture itself, so a dropped event shows
 * up as a mismatch when a CLI/SDK format change breaks the adapter.
 */
const fixture = <T>(name: string): T => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;
const run = async (engine: ReturnType<typeof createCodexEngine>, prompt: string) => {
	const events: AgentEvent[] = [];
	for await (const e of engine.run({ cwd: "/tmp/paper", systemPrompt: "sys", model: "m", effort: "low", input: prompt, tools: [], signal: new AbortController().signal })) events.push(e);
	return events;
};

test("Claude Code adapter replays a recorded turn without dropping events", async () => {
	const rec = fixture<{ prompt: string; messages: SDKMessage[] }>("claude-code-ok.json");
	const q: QueryFn = ({ prompt }) => {
		assert.equal(prompt, rec.prompt);
		return (async function* () {
			for (const m of rec.messages) yield m;
		})();
	};
	const events = await run(createClaudeCodeEngine(q), rec.prompt);
	const types = events.map((e) => e.type);
	assert.equal(types[0], "session");
	assert.equal(types.at(-1), "done");
	assert.ok(!types.includes("error"));
	const init = rec.messages.find((m) => m.type === "system" && m.subtype === "init") as { session_id: string };
	assert.deepEqual(events[0], { type: "session", id: init.session_id });

	// Every text delta of the main thread, every usage report, nothing else lost.
	const stream = rec.messages.filter((m) => m.type === "stream_event" && !m.parent_tool_use_id).map((m) => (m as { event: { type: string; delta?: { type: string }; usage?: unknown } }).event);
	const textDeltas = stream.filter((e) => e.type === "content_block_delta" && e.delta?.type === "text_delta").length;
	const usageReports = stream.filter((e) => e.type === "message_delta" && e.usage).length + rec.messages.filter((m) => m.type === "result" && (m as { usage?: unknown }).usage).length;
	assert.ok(textDeltas > 0);
	assert.equal(types.filter((t) => t === "text_delta").length, textDeltas);
	assert.equal(types.filter((t) => t === "usage").length, usageReports);
	assert.equal(events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text).join(""), "OK");
	const done = events.at(-1) as { type: "done"; text: string };
	assert.equal(done.text, "OK");
	const usage = events.find((e) => e.type === "usage") as { input: number; output: number; cacheRead: number };
	assert.ok(usage.output > 0);
	assert.ok(types.indexOf("usage") < types.indexOf("done"));
});

interface Recorded { dir: "in" | "out"; message: RpcMessage }

/**
 * A transport that replays the recorded app-server lines in wire order. The
 * adapter's request ids may differ from the recording's, so each response
 * is paired with the recorded request of the same method, in order, and
 * held until the adapter has sent it.
 */
function replayTransport(lines: Recorded[]) {
	const listeners = new Set<(m: RpcMessage) => void>();
	const closers = new Set<(r?: string) => void>();
	const sent: RpcMessage[] = [];
	const recordedRequests = lines.filter((l) => l.dir === "out" && l.message.id !== undefined).map((l) => l.message);
	const incoming = lines.filter((l) => l.dir === "in").map((l) => l.message);
	const ids = new Map<number | string, number | string>(); // recorded id → adapter id
	let cursor = 0;
	let closed = false;
	const flush = () => {
		while (!closed && cursor < incoming.length) {
			const m = incoming[cursor];
			if (m.id !== undefined && m.method === undefined) {
				const mapped = ids.get(m.id);
				if (mapped === undefined) return; // the adapter has not asked yet
				cursor++;
				for (const l of listeners) l({ ...m, id: mapped });
			} else {
				cursor++;
				for (const l of listeners) l(m);
			}
		}
	};
	const transport: CodexTransport = {
		send(m) {
			sent.push(m);
			if (m.id !== undefined && m.method !== undefined) {
				const rec = recordedRequests.shift();
				assert.ok(rec, `unexpected request ${m.method}: the recording has no more requests`);
				assert.equal(m.method, rec.method, "the adapter's requests must follow the recorded order");
				ids.set(rec.id!, m.id);
			}
			setTimeout(flush, 0);
		},
		onMessage(l) { listeners.add(l); },
		onClose(l) { closers.add(l); },
		close() {
			closed = true;
			for (const c of closers) c();
		},
	};
	return { transport, sent, replayed: () => cursor, total: incoming.length };
}

test("Codex adapter replays a recorded turn without dropping events", async () => {
	const rec = fixture<{ prompt: string; lines: Recorded[] }>("codex-ok.json");
	const server = replayTransport(rec.lines);
	const events = await run(createCodexEngine(() => server.transport), rec.prompt);
	const types = events.map((e) => e.type);
	assert.equal(types[0], "session");
	assert.equal(types.at(-1), "done");
	assert.ok(!types.includes("error"));
	assert.equal(server.replayed(), server.total, "every recorded line was consumed");
	assert.deepEqual(server.sent.filter((m) => m.method).map((m) => m.method), rec.lines.filter((l) => l.dir === "out").map((l) => l.message.method));

	const notes = rec.lines.filter((l) => l.dir === "in" && l.message.method).map((l) => ({ method: l.message.method!, params: (l.message.params ?? {}) as Record<string, unknown> }));
	const threadId = (notes.find((n) => n.method === "thread/started")!.params.thread as { id: string }).id;
	assert.deepEqual(events[0], { type: "session", id: threadId });
	const started = notes.filter((n) => n.method === "item/started" && (n.params.item as { type: string; text?: string }).type === "agentMessage" && (n.params.item as { text?: string }).text).length;
	const textDeltas = notes.filter((n) => n.method === "item/agentMessage/delta").length + started;
	const thinking = notes.filter((n) => n.method === "item/reasoning/summaryTextDelta" || n.method === "item/reasoning/textDelta").length;
	const usageReports = notes.filter((n) => n.method === "thread/tokenUsage/updated").length;
	assert.ok(textDeltas > 0);
	assert.equal(types.filter((t) => t === "text_delta").length, textDeltas);
	assert.equal(types.filter((t) => t === "thinking_delta").length, thinking);
	assert.equal(types.filter((t) => t === "usage").length, usageReports);
	assert.equal(events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text).join(""), "OK");
	assert.deepEqual(events.at(-1), { type: "done", text: "OK" });
	const usage = events.find((e) => e.type === "usage") as { input: number; output: number; cacheRead: number };
	assert.ok(usage.input > 0 && usage.output > 0);
	assert.ok(types.indexOf("usage") < types.indexOf("done"));
	// The turn's native tools were off in the recording: no tool events.
	assert.ok(!types.includes("tool_start"));
});
