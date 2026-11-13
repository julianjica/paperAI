import { test } from "node:test";
import assert from "node:assert/strict";
import { makePaper } from "./helpers.ts";
import fs from "node:fs";
import path from "node:path";
import { getProject, switchMainTex, updateProjectSettings } from "../src/server/projects.ts";
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

test("switchMainTex opens the sibling project for that root file (own chat), copies settings, and finds it again", () => {
	const { folder, project } = makePaper();
	fs.writeFileSync(path.join(folder, "slides.tex"), "\\documentclass{beamer}\n\\begin{document}\\end{document}\n");
	updateProjectSettings(project.id, { styleNote: "Use we." });
	const slides = switchMainTex(project.id, "./slides.tex");
	assert.notEqual(slides.id, project.id);
	assert.equal(slides.mainTex, "slides.tex");
	assert.equal(slides.name, `${path.basename(folder)} / slides.tex`);
	assert.equal(slides.settings?.styleNote, "Use we.");
	assert.equal(getProject(project.id)?.mainTex, "main.tex", "the original project is untouched");
	assert.equal(switchMainTex(slides.id, "main.tex").id, project.id, "switching back finds the original");
	assert.equal(switchMainTex(project.id, "slides.tex").id, slides.id, "no duplicate sibling");
	assert.throws(() => switchMainTex(project.id, "missing.tex"), /not found/);
	assert.throws(() => switchMainTex(project.id, "../main.tex"), /inside the paper folder/);
	assert.throws(() => switchMainTex(project.id, "refs.bib"), /\.tex file/);
});
