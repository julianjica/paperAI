import { test } from "node:test";
import assert from "node:assert/strict";
import { makePaper } from "./helpers.ts";
import fs from "node:fs";
import path from "node:path";
import { getProject, switchMainTex, updateProjectSettings } from "../src/server/projects.ts";
import { settingsFor, writeSettings } from "../src/server/settings.ts";
import { setEngine } from "../src/engine/index.ts";
import { EventChannel, type RunOptions } from "../src/engine/engine.ts";
import type { AgentEvent } from "../src/core/types.ts";
import { compileRuntime } from "../src/server/compile.ts";
import { startTurn } from "../src/server/turn.ts";
import { readChat } from "../src/server/chat.ts";
import { addComment, listComments, stampCommentRoots } from "../src/server/comments.ts";
import { appOwnedFile } from "../src/server/snapshots.ts";

compileRuntime.run = async () => ({ ok: true, errors: [] });

// Test files run in parallel against one data dir: keep these the same values turn.test.ts writes.
writeSettings({ engine: "claude-code", model: "m", workerModel: "w", effort: "low", workerEffort: "low" });

test("settingsFor: a project's defined fields override the global ones, undefined ones fall back", () => {
	const { project } = makePaper();
	assert.deepEqual(settingsFor(project), { engine: "claude-code", model: "m", workerModel: "w", effort: "low", workerEffort: "low" });
	const overridden = { ...project, settings: { model: "p-main", effort: "high" as const, workerModel: undefined, styleNote: "Use we, never I." } };
	const s = settingsFor(overridden);
	assert.equal(s.model, "p-main");
	assert.equal(s.effort, "high");
	assert.equal(s.workerModel, "w");
	assert.equal(s.workerEffort, "low");
	assert.equal(s.styleNote, "Use we, never I.");
});

test("updateProjectSettings merges, removes on undefined/null, persists, and ignores unknown keys", () => {
	const { project } = makePaper();
	let p = updateProjectSettings(project.id, { model: "p-main", styleNote: "Target: Management Science." });
	assert.deepEqual(p.settings, { model: "p-main", styleNote: "Target: Management Science." });
	p = updateProjectSettings(project.id, { effort: "max" });
	assert.deepEqual(p.settings, { model: "p-main", styleNote: "Target: Management Science.", effort: "max" });
	assert.deepEqual(getProject(project.id)?.settings, p.settings);
	p = updateProjectSettings(project.id, { model: undefined, styleNote: null as unknown as undefined, bogus: 1 } as never);
	assert.deepEqual(p.settings, { effort: "max" });
	assert.equal(settingsFor(p).model, "m");
	assert.equal(settingsFor(p).styleNote, undefined);
	p = updateProjectSettings(project.id, { effort: undefined });
	assert.equal(p.settings, undefined);
	assert.throws(() => updateProjectSettings("nope", {}), /No such project/);
});

test("switchMainTex switches the root in place (same project, chat, comments, settings) and reports the old root", () => {
	const { folder, project } = makePaper();
	fs.writeFileSync(path.join(folder, "slides.tex"), "\\documentclass{beamer}\n\\begin{document}\\end{document}\n");
	updateProjectSettings(project.id, { styleNote: "Use we." });
	const { project: p, previous } = switchMainTex(project.id, "./slides.tex");
	assert.equal(p.id, project.id);
	assert.equal(previous, "main.tex");
	assert.equal(p.mainTex, "slides.tex");
	assert.equal(p.name, `${path.basename(folder)} / slides.tex`);
	assert.equal(p.settings?.styleNote, "Use we.");
	assert.equal(getProject(project.id)?.mainTex, "slides.tex");
	assert.equal(switchMainTex(project.id, "main.tex").project.id, project.id, "switching back stays in the project");
	assert.throws(() => switchMainTex(project.id, "missing.tex"), /not found/);
	assert.throws(() => switchMainTex(project.id, "../main.tex"), /inside the paper folder/);
	assert.throws(() => switchMainTex(project.id, "refs.bib"), /\.tex file/);
});

test("a root switch is announced to the agent at the next turn; comments carry their root; every root's PDF is app-owned", async () => {
	const { folder, project } = makePaper();
	fs.writeFileSync(path.join(folder, "slides.tex"), "\\documentclass{beamer}\n\\begin{document}\\end{document}\n");
	const calls: RunOptions[] = [];
	setEngine("claude-code", {
		id: "claude-code",
		run(o) {
			calls.push(o);
			const ch = new EventChannel<AgentEvent>();
			ch.push({ type: "done", text: "" });
			ch.close();
			return ch;
		},
	});
	await startTurn(project, { text: "First", sendComments: false }).done;
	assert.doesNotMatch(calls[0].input, /switched the main file/);
	assert.equal(readChat(project).mainTex, "main.tex");
	// A comment made on main.tex's PDF remembers that root.
	const c = addComment(project, { rects: [], page: 1, quote: "Hello", file: "sections/intro.tex", line: 2, text: "Shorter." });
	assert.equal(c.root, "main.tex");
	const { project: switched, previous } = switchMainTex(project.id, "slides.tex");
	// Comments from before roots were recorded get the old root at switch time.
	const legacy = listComments(project).map((x) => ({ ...x, root: undefined }));
	fs.writeFileSync(path.join(process.env.RA_DATA_DIR ?? "data", "projects", project.id, "comments.json"), JSON.stringify(legacy));
	assert.equal(stampCommentRoots(switched, previous), 1);
	assert.equal(listComments(switched)[0].root, "main.tex");
	await startTurn(switched, { text: "Second", sendComments: false }).done;
	assert.match(calls[1].input, /switched the main file from main\.tex to slides\.tex/);
	assert.match(calls[1].systemPrompt, /Main file: slides\.tex/);
	await startTurn(switched, { text: "Third", sendComments: false }).done;
	assert.doesNotMatch(calls[2].input, /switched the main file/);
	// The old root's exported PDF is still the app's, so a revert never deletes it and it is never a change.
	assert.ok(appOwnedFile(switched, "main.pdf"));
	assert.ok(appOwnedFile(switched, "slides.pdf"));
	assert.ok(!appOwnedFile(switched, "figures/plot.pdf"));
});
