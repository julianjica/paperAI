import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makePaper } from "./helpers.ts";
import { setEngine } from "../src/engine/index.ts";
import { EventChannel, type Engine, type RunOptions } from "../src/engine/engine.ts";
import type { AgentEvent, ProjectEvent } from "../src/core/types.ts";
import { compileRuntime } from "../src/server/compile.ts";
import { abortTurn, listQueued, recoverInterruptedTurns, removeQueued, startTurn, submit } from "../src/server/turn.ts";
import { readChat, writeChat } from "../src/server/chat.ts";
import { takeSnapshot } from "../src/server/snapshots.ts";
import { addComment, listComments } from "../src/server/comments.ts";
import { subscribe } from "../src/server/bus.ts";
import { writeSettings } from "../src/server/settings.ts";
import { listWorkers } from "../src/server/workers.ts";
import { updateProjectSettings } from "../src/server/projects.ts";

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
	assert.ok(calls[0].systemPrompt.includes("Correctness is a MUST"));
	assert.ok(calls[0].systemPrompt.includes("The paper's words are fixed"));
	assert.ok(calls[0].systemPrompt.includes("Numerical checks come after the proof, never instead of it"));
	assert.ok(calls[0].systemPrompt.includes("Write in the author's hand"));
	assert.deepEqual(calls[0].tools.map((t) => t.name), ["compile", "resolve_comment", "ask_author", "delegate"]);
	const ask = await calls[0].tools.find((t) => t.name === "ask_author")!.handler({ question: "Which section?", options: ["Intro", "Model"] });
	assert.match(ask.text, /End your turn/);
	// The agent's own compile call plus the post-turn compile.
	assert.deepEqual(events.map((e) => e.type).filter((t) => t !== "agent"), ["turn_start", "compiled", "compiled", "turn_end"]);

	// Second turn resumes the session.
	const { done: done2 } = startTurn(project, { text: "Again", sendComments: false });
	await done2;
	assert.equal(calls[1].resume, "sess-1");
	assert.equal(calls[1].input.split("\n")[0], "Again");
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

test("a project's own model and style note reach the main agent and its workers", async () => {
	const { project: fresh } = makePaper();
	// startTurn uses the Project object it is handed, so take the updated record.
	const project = updateProjectSettings(fresh.id, { model: "pm", workerModel: "pw", styleNote: "Write as \"we\"; never touch Appendix B." });
	const calls: RunOptions[] = [];
	setEngine(
		"claude-code",
		scripted(async (o, emit) => {
			if (o.label?.startsWith("worker")) return emit({ type: "done", text: "worker done" });
			await o.tools.find((t) => t.name === "delegate")!.handler({ tasks: [{ title: "intro", instructions: "edit intro", files: ["sections/intro.tex"] }] });
			emit({ type: "done", text: "ok" });
		}, calls),
	);
	await startTurn(project, { text: "Polish", sendComments: false }).done;
	assert.equal(calls.length, 2);
	assert.equal(calls[0].model, "pm");
	assert.equal(calls[0].effort, "low"); // not overridden: the global value
	assert.equal(calls[1].model, "pw");
	for (const c of calls) {
		assert.ok(c.systemPrompt.includes("Author's notes for this paper"));
		assert.ok(c.systemPrompt.includes("never touch Appendix B."));
	}
	// Without a note there is no heading.
	setEngine("claude-code", scripted(async (_o, emit) => emit({ type: "done", text: "ok" }), calls));
	await startTurn(fresh, { text: "Again", sendComments: false }).done;
	assert.equal(calls[2].model, "m");
	assert.ok(!calls[2].systemPrompt.includes("Author's notes for this paper"));
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

test("messages sent during a turn queue up and run in order afterwards", async () => {
	const { project } = makePaper();
	const inputs: string[] = [];
	let release: () => void = () => {};
	setEngine(
		"claude-code",
		scripted(async (o, emit) => {
			inputs.push(o.input);
			if (inputs.length === 1) await new Promise<void>((r) => (release = r));
			emit({ type: "done", text: `answer to ${o.input}` });
		}, []),
	);
	const first = submit(project, { text: "one", sendComments: false });
	assert.ok("turnId" in first);
	const second = submit(project, { text: "two", sendComments: false });
	const third = submit(project, { text: "three", sendComments: false });
	const fourth = submit(project, { text: "four", sendComments: false });
	assert.ok("queued" in second && "queued" in third && "queued" in fourth);
	assert.deepEqual(listQueued(project).map((q) => q.text), ["two", "three", "four"]);
	assert.equal(removeQueued(project, (third as { queued: { id: string } }).queued.id), true);
	assert.throws(() => submit(project, { text: "  ", sendComments: false }), /Nothing to send/);
	release();
	for (let i = 0; i < 100 && (listQueued(project).length > 0 || inputs.length < 3); i++) await new Promise((r) => setTimeout(r, 10));
	await new Promise((r) => setTimeout(r, 30));
	assert.deepEqual(inputs.map((i) => i.split("\n")[0]), ["one", "two", "four"]);
	const chat = readChat(project);
	assert.deepEqual(chat.messages.filter((m) => m.role === "user").map((m) => (m.role === "user" ? m.text : "")), ["one", "two", "four"]);
	assert.equal(listQueued(project).length, 0);
});

test("a worker past its time limit fails alone while its batch mates finish", async () => {
	const { project } = makePaper();
	writeSettings({ workerTimeoutMin: 0.002 }); // 120 ms
	try {
		setEngine(
			"claude-code",
			scripted(async (o, emit) => {
				if (o.label?.startsWith("worker")) {
					if (o.input.includes("slow")) {
						// A real adapter ends with "Aborted" once its signal fires.
						await new Promise<void>((r) => o.signal.addEventListener("abort", () => r(), { once: true }));
						emit({ type: "error", message: "Aborted" });
					} else emit({ type: "done", text: "fast done" });
					return;
				}
				const delegate = o.tools.find((t) => t.name === "delegate")!;
				const r = await delegate.handler({ tasks: [{ title: "slow", instructions: "slow", files: ["main.tex"] }, { title: "fast", instructions: "fast", files: ["sections/intro.tex"] }] });
				assert.ok(!r.isError);
				assert.match(r.text, /Worker 1: slow \[error\]\nTimed out after 0\.002 minutes\./);
				assert.match(r.text, /Worker 2: fast \[done\]\nfast done/);
				assert.match(r.text, /did not finish/);
				emit({ type: "done", text: "ok" });
			}, []),
		);
		const { turnId, done } = startTurn(project, { text: "go", sendComments: false });
		await done;
		const workers = listWorkers(project.id).filter((w) => w.turnId === turnId);
		assert.deepEqual(workers.map((w) => w.status), ["error", "done"]);
		assert.ok(workers[0].activity.includes("Timed out after 0.002 minutes."));
		const a = readChat(project).messages[1];
		assert.equal(a.role === "assistant" ? a.error : "", undefined);
	} finally {
		writeSettings({ workerTimeoutMin: undefined });
	}
});

test("Stop aborts the running workers and the turn is recorded as stopped", async () => {
	const { project } = makePaper();
	setEngine(
		"claude-code",
		scripted(async (o, emit) => {
			if (o.label?.startsWith("worker")) {
				await new Promise<void>((r) => o.signal.addEventListener("abort", () => r(), { once: true }));
				emit({ type: "error", message: "Aborted" });
				return;
			}
			const delegate = o.tools.find((t) => t.name === "delegate")!;
			const r = await delegate.handler({ tasks: [{ title: "a", instructions: "wait", files: ["main.tex"] }, { title: "b", instructions: "wait", files: ["sections/intro.tex"] }] });
			assert.equal(r.isError, true);
			assert.match(r.text, /Worker 1: a \[error\]\nAborted/);
			emit({ type: "error", message: "Aborted" });
		}, []),
	);
	const { turnId, done } = startTurn(project, { text: "go", sendComments: false });
	for (let i = 0; i < 100 && listWorkers(project.id).filter((w) => w.turnId === turnId).length < 2; i++) await new Promise((r) => setTimeout(r, 5));
	assert.equal(abortTurn(project.id), true);
	await done;
	const workers = listWorkers(project.id).filter((w) => w.turnId === turnId);
	assert.deepEqual(workers.map((w) => [w.status, w.result]), [["error", "Aborted"], ["error", "Aborted"]]);
	const a = readChat(project).messages[1];
	assert.equal(a.role === "assistant" && a.aborted, true);
	assert.equal(a.role === "assistant" ? a.error : "x", undefined);
});

test("a turn past its time limit is stopped with a clear error", async () => {
	const { project } = makePaper();
	writeSettings({ turnTimeoutMin: 0.002 }); // 120 ms
	try {
		setEngine(
			"claude-code",
			scripted(async (o, emit) => {
				emit({ type: "session", id: "s-long" });
				await new Promise<void>((r) => o.signal.addEventListener("abort", () => r(), { once: true }));
				emit({ type: "error", message: "Aborted" });
			}, []),
		);
		const { done } = startTurn(project, { text: "take forever", sendComments: false });
		const turn = await done;
		assert.ok(turn.endedAt);
		const chat = readChat(project);
		const a = chat.messages[1];
		assert.match(a.role === "assistant" ? a.error ?? "" : "", /stopped after 0\.002 minutes \(the turn time limit\)/);
		assert.equal(a.role === "assistant" ? a.aborted : true, undefined);
		// The session survives: the author can continue where the agent was cut off.
		assert.deepEqual(chat.session, { engine: "claude-code", id: "s-long" });
	} finally {
		writeSettings({ turnTimeoutMin: undefined });
	}
});

test("turns interrupted by a server restart are closed on the next read; the running turn is untouched", async () => {
	const { folder, project } = makePaper();
	// A turn that died mid-run: its snapshot exists, a file changed, and the record never got endedAt.
	takeSnapshot(project, "dead1");
	fs.appendFileSync(path.join(folder, "main.tex"), "% edited during the dead turn\n");
	writeChat(project, {
		messages: [
			{ role: "user", id: "u1", text: "hi", timestamp: 1 },
			{ role: "assistant", id: "a1", turnId: "dead1", parts: [{ kind: "text", text: "working" }], timestamp: 2 },
			{ role: "user", id: "u2", text: "again", timestamp: 3 },
			{ role: "assistant", id: "a2", turnId: "dead2", parts: [], timestamp: 4 },
		],
		// dead2 has no snapshot (pruned): closed without inventing changes.
		turns: [{ id: "dead1", startedAt: 1, changes: [] }, { id: "dead2", startedAt: 3, changes: [] }],
		session: { engine: "claude-code", id: "keep" },
	});
	assert.equal(recoverInterruptedTurns(project), 2);
	const chat = readChat(project);
	const [dead1, dead2] = chat.turns;
	assert.ok(dead1.endedAt && dead2.endedAt);
	assert.deepEqual(dead1.changes.map((c) => [c.path, c.kind]), [["main.tex", "modified"]]);
	assert.deepEqual(dead2.changes, []);
	for (const m of chat.messages) if (m.role === "assistant") assert.equal(m.error, "The server restarted during this turn.");
	assert.deepEqual(chat.session, { engine: "claude-code", id: "keep" });
	assert.equal(recoverInterruptedTurns(project), 0);

	let release: () => void = () => {};
	setEngine(
		"claude-code",
		scripted(async (_o, emit) => {
			await new Promise<void>((r) => (release = r));
			emit({ type: "done", text: "fine" });
		}, []),
	);
	const { turnId, done } = startTurn(project, { text: "next", sendComments: false });
	assert.equal(recoverInterruptedTurns(project), 0);
	assert.equal(readChat(project).turns.find((t) => t.id === turnId)?.endedAt, undefined);
	release();
	await done;
	const after = readChat(project);
	assert.ok(after.turns.find((t) => t.id === turnId)?.endedAt);
	const last = after.messages.at(-1);
	assert.equal(last?.role === "assistant" ? last.error : "x", undefined);
	assert.equal(after.turns.length, 3);
});

test("a failure before the engine starts is recorded on the message, not left as an open turn", async () => {
	const { project } = makePaper();
	setEngine("claude-code", {
		id: "claude-code",
		run() {
			throw new Error("claude is not installed");
		},
	});
	const { done } = startTurn(project, { text: "hi", sendComments: false });
	const turn = await done;
	assert.ok(turn.endedAt);
	const a = readChat(project).messages[1];
	assert.equal(a.role === "assistant" ? a.error : "", "claude is not installed");
	// The next load has nothing to recover.
	const { recoverInterruptedTurns } = await import("../src/server/turn.ts");
	assert.equal(recoverInterruptedTurns(project), 0);
});

test("the reply-format reminder rides on every input", async () => {
	const { project } = makePaper();
	const calls: RunOptions[] = [];
	setEngine("claude-code", scripted(async (_o, emit) => emit({ type: "done", text: "ok" }), calls));
	await startTurn(project, { text: "hello", sendComments: false }).done;
	assert.ok(calls[0].input.startsWith("hello"));
	assert.match(calls[0].input, /Reply format: .*LaTeX/);
});
