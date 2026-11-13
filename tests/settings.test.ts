import { test } from "node:test";
import assert from "node:assert/strict";
import { makePaper } from "./helpers.ts";
import fs from "node:fs";
import path from "node:path";
import { getProject, setMainTex, updateProjectSettings } from "../src/server/projects.ts";
import { settingsFor, writeSettings } from "../src/server/settings.ts";

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

test("setMainTex switches the root file in place, keeping the project id, and refuses files outside the folder", () => {
	const { folder, project } = makePaper();
	fs.writeFileSync(path.join(folder, "slides.tex"), "\\documentclass{beamer}\n\\begin{document}\\end{document}\n");
	const p = setMainTex(project.id, "./slides.tex");
	assert.equal(p.id, project.id);
	assert.equal(p.mainTex, "slides.tex");
	assert.equal(getProject(project.id)?.name, `${path.basename(folder)} / slides.tex`);
	assert.throws(() => setMainTex(project.id, "missing.tex"), /not found/);
	assert.throws(() => setMainTex(project.id, "../main.tex"), /inside the paper folder/);
	assert.throws(() => setMainTex(project.id, "refs.bib"), /\.tex file/);
});
