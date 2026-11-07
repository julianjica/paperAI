import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makePaper } from "./helpers.ts";
import { setEngine } from "../src/engine/index.ts";
import { EventChannel, type Engine, type RunOptions } from "../src/engine/engine.ts";
import type { AgentEvent, ProjectEvent } from "../src/core/types.ts";
import { compileRuntime } from "../src/server/compile.ts";
import { startTurn } from "../src/server/turn.ts";
import { readChat } from "../src/server/chat.ts";
import { addComment, listComments } from "../src/server/comments.ts";
import { subscribe } from "../src/server/bus.ts";
import { writeSettings } from "../src/server/settings.ts";
import { listWorkers } from "../src/server/workers.ts";

compileRuntime.run = async () => ({ ok: true, errors: [] });
writeSettings({ engine: "claude-code", model: "m", workerModel: "w", effort: "low", workerEffort: "low" });

/** A scripted engine: each run gets a script that may call app tools. */
function scripted(script: (o: RunOptions, emit: (e: AgentEvent) => void) => Promise<void>, calls: RunOptions[]): Engine {
	return {
		id: "claude-code",
		run(o) {
			calls.push(o);
			const ch = new EventChannel<AgentEvent>();
			void script(o, (e) => ch.push(e))
				.catch((error) => ch.push({ type: "error", message: `script failed: ${error instanceof Error ? error.stack : String(error)}` }))
				.finally(() => ch.close());
			return ch;
		},
	};
}

test("a turn snapshots, streams, records tool calls, diffs and resumes the session", async () => {
	const { folder, project } = makePaper();
	const calls: RunOptions[] = [];
	setEngine(
		"claude-code",
		scripted(async (o, emit) => {
			emit({ type: "session", id: "sess-1" });
			emit({ type: "text_delta", text: "Editing. " });
			fs.writeFileSync(path.join(folder, "sections/intro.tex"), "\\section{Intro}\nHello agents.\n");
			const compile = o.tools.find((t) => t.name === "compile")!;
			emit({ type: "tool_start", id: "c1", name: "compile", input: {} });
			const r = await compile.handler({});
			emit({ type: "tool_end", id: "c1", name: "compile", output: r.text, isError: false });
			emit({ type: "text_delta", text: "Done." });
			emit({ type: "usage", input: 10, output: 5, cacheRead: 0 });
			emit({ type: "done", text: "Editing. Done." });
		}, calls),
	);
	const events: ProjectEvent[] = [];
	const unsub = subscribe(project.id, (e) => events.push(e));
	const { turnId, done } = startTurn(project, { text: "Change the greeting", sendComments: false });
	const turn = await done;
	unsub();
	assert.equal(turn.id, turnId);
	assert.equal(turn.changes.length, 1);
	assert.equal(turn.changes[0].path, "sections/intro.tex");
	assert.equal(turn.compile?.ok, true);
	const chat = readChat(project);
	assert.equal(chat.messages.length, 2);
	const assistant = chat.messages[1];
	assert.equal(assistant.role, "assistant");
	if (assistant.role !== "assistant") return;
	assert.deepEqual(assistant.parts.map((p) => p.kind), ["text", "tool", "text"]);
	assert.equal(assistant.usage?.input, 10);
	assert.deepEqual(chat.session, { engine: "claude-code", id: "sess-1" });
	assert.equal(calls[0].resume, undefined);
	assert.ok(calls[0].systemPrompt.includes("sections/intro.tex"));
	assert.ok(calls[0].systemPrompt.includes("How a good formal theory paper is written"));
	assert.deepEqual(calls[0].tools.map((t) => t.name), ["compile", "resolve_comment", "ask_author", "delegate"]);
	const ask = await calls[0].tools.find((t) => t.name === "ask_author")!.handler({ question: "Which section?", options: ["Intro", "Model"] });
	assert.match(ask.text, /End your turn/);
	// The agent's own compile call plus the post-turn compile.
	assert.deepEqual(events.map((e) => e.type).filter((t) => t !== "agent"), ["turn_start", "compiled", "compiled", "turn_end"]);

	// Second turn resumes the session.
	const { done: done2 } = startTurn(project, { text: "Again", sendComments: false });
	await done2;
	assert.equal(calls[1].resume, "sess-1");
	assert.equal(calls[1].input, "Again");
});

test("comments ride along, resolve_comment works, and delegate runs workers with disjoint files", async () => {
	const { folder, project } = makePaper();
	const c = addComment(project, { rects: [], page: 1, quote: "Hello world.", file: "sections/intro.tex", line: 2, text: "Say hi twice" });
	const calls: RunOptions[] = [];
	setEngine(
		"claude-code",
		scripted(async (o, emit) => {
			if (o.label?.startsWith("worker")) {
				// A worker: edit its file and report.
				fs.appendFileSync(path.join(folder, o.input.includes("intro") ? "sections/intro.tex" : "main.tex"), "% worker was here\n");
				emit({ type: "done", text: `worker report for ${o.label}` });
				return;
			}
			assert.match(o.input, /\[comment /);
			assert.match(o.input, /Say hi twice/);
			const delegate = o.tools.find((t) => t.name === "delegate")!;
			const bad = await delegate.handler({ tasks: [{ title: "a", instructions: "x", files: ["main.tex"] }, { title: "b", instructions: "y", files: ["main.tex"] }] });
			assert.equal(bad.isError, true);
			assert.match(bad.text, /disjoint/);
			const ok = await delegate.handler({ tasks: [{ title: "intro", instructions: "edit intro", files: ["sections/intro.tex"] }, { title: "main", instructions: "edit main", files: ["main.tex"] }] });
			assert.ok(!ok.isError);
			assert.match(ok.text, /Worker 1: intro \[done\]/);
			assert.match(ok.text, /Worker 2: main \[done\]/);
			const resolve = o.tools.find((t) => t.name === "resolve_comment")!;
			const r = await resolve.handler({ id: c.id, note: "Done twice" });
			assert.equal(r.isError, undefined);
			emit({ type: "done", text: "ok" });
		}, calls),
	);
	const { done } = startTurn(project, { text: "", sendComments: true });
	const turn = await done;
	const a = readChat(project).messages[1];
	assert.equal(a.role === "assistant" ? a.error : "", undefined);
	assert.equal(listComments(project)[0].status, "resolved");
	assert.equal(listComments(project)[0].resolution, "Done twice");
	assert.equal(calls.length, 3); // main + 2 workers
	assert.ok(calls.slice(1).every((w) => w.model === "w" && w.tools.map((t) => t.name).join() === "compile" && w.systemPrompt.includes("How a good formal theory paper is written")));
	assert.equal(turn.changes.length, 2);
	const workers = listWorkers(project.id);
	assert.equal(workers.length, 2);
	assert.ok(workers.every((w) => w.status === "done"));
});

test("comments the agent did not resolve are closed when the turn ends", async () => {
	const { project } = makePaper();
	addComment(project, { rects: [], page: 1, quote: "q", file: "main.tex", line: 1, text: "please" });
	setEngine("claude-code", scripted(async (_o, emit) => emit({ type: "done", text: "forgot to resolve" }), []));
	await startTurn(project, { text: "", sendComments: true }).done;
	const [c] = listComments(project);
	assert.equal(c.status, "resolved");
	assert.match(c.resolution ?? "", /left no note/);
});

test("an engine error is recorded and the session is dropped", async () => {
	const { project } = makePaper();
	setEngine(
		"claude-code",
		scripted(async (_o, emit) => {
			emit({ type: "session", id: "s" });
			emit({ type: "error", message: "not signed in" });
		}, []),
	);
	const { done } = startTurn(project, { text: "hi", sendComments: false });
	await done;
	const chat = readChat(project);
	const a = chat.messages[1];
	assert.equal(a.role === "assistant" && a.error, "not signed in");
	assert.equal(chat.session, undefined);
	assert.throws(() => startTurn(project, { text: "", sendComments: false }), /Nothing to send/);
});
