import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClaudeCodeEngine, type QueryFn } from "../src/engine/claude-code.ts";
import type { AgentEvent } from "../src/core/types.ts";

/** A scripted query(): streams the Anthropic events for one text block, one tool_use, a tool_result, then a result. */
const scripted: QueryFn = ({ options }) => {
	assert.equal(options.cwd, "/tmp/paper");
	assert.equal(options.permissionMode, "bypassPermissions");
	assert.ok((options.disallowedTools ?? []).includes("Agent"));
	assert.ok((options.allowedTools ?? []).includes("mcp__researchai__compile"));
	const sid = "sess-9";
	const msgs: unknown[] = [
		{ type: "system", subtype: "init", session_id: sid, tools: [] },
		{ type: "stream_event", session_id: sid, parent_tool_use_id: null, event: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
		{ type: "stream_event", session_id: sid, parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi " } } },
		{ type: "stream_event", session_id: sid, parent_tool_use_id: null, event: { type: "content_block_stop", index: 0 } },
		{ type: "stream_event", session_id: sid, parent_tool_use_id: null, event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu1", name: "mcp__researchai__compile" } } },
		{ type: "stream_event", session_id: sid, parent_tool_use_id: null, event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } } },
		{ type: "stream_event", session_id: sid, parent_tool_use_id: null, event: { type: "content_block_stop", index: 1 } },
		{ type: "stream_event", session_id: sid, parent_tool_use_id: null, event: { type: "message_delta", usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 1 } } },
		{ type: "user", session_id: sid, parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "Compiled OK" }] }] } },
		// Subagent noise is ignored.
		{ type: "stream_event", session_id: sid, parent_tool_use_id: "tu1", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "IGNORED" } } },
		{ type: "assistant", session_id: sid, parent_tool_use_id: null, message: { content: [{ type: "text", text: "Hi there" }] } },
		{ type: "result", subtype: "success", session_id: sid, result: "Hi there", usage: { input_tokens: 1, output_tokens: 1 } },
	];
	return (async function* () {
		for (const m of msgs) yield m as SDKMessage;
	})();
};

test("Claude Code adapter maps SDK messages to AgentEvents", async () => {
	const engine = createClaudeCodeEngine(scripted);
	const events: AgentEvent[] = [];
	for await (const e of engine.run({ cwd: "/tmp/paper", systemPrompt: "sys", model: "m", effort: "low", input: "x", tools: [{ name: "compile", description: "c", schema: { note: z.string().optional() }, handler: async () => ({ text: "ok" }) }], signal: new AbortController().signal })) events.push(e);
	assert.deepEqual(events.map((e) => e.type), ["session", "text_delta", "tool_start", "usage", "tool_end", "usage", "done"]);
	assert.deepEqual(events[2], { type: "tool_start", id: "tu1", name: "compile", input: {} });
	assert.deepEqual(events[4], { type: "tool_end", id: "tu1", name: "compile", output: "Compiled OK", isError: false });
	assert.deepEqual(events[6], { type: "done", text: "Hi there" });
});
