import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makePaper } from "./helpers.ts";
import { DATA_DIR } from "../config.ts";
import { ensureSidecar, sidecar } from "../src/server/projects.ts";
import { diffSinceSnapshot, hasSnapshot, removeDuplicateCopies, revertToSnapshot, takeSnapshot } from "../src/server/snapshots.ts";

test("snapshot → edit/add/remove → diff → revert restores everything", () => {
	const { folder, project } = makePaper();
	takeSnapshot(project, "t1");
	assert.equal(hasSnapshot(project, "t1"), true);
	fs.writeFileSync(path.join(folder, "sections/intro.tex"), "\\section{Intro}\nHello, brave new world.\n");
	fs.writeFileSync(path.join(folder, "sections/new.tex"), "new\n");
	fs.writeFileSync(path.join(folder, "figure.png"), "binary");
	fs.rmSync(path.join(folder, "refs.bib"));
	const changes = diffSinceSnapshot(project, "t1");
	const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));
	assert.equal(byPath["sections/intro.tex"].kind, "modified");
	assert.match(byPath["sections/intro.tex"].diff, /\+Hello, brave new world\./);
	assert.equal(byPath["sections/new.tex"].kind, "added");
	assert.equal(byPath["figure.png"].kind, "added");
	assert.equal(byPath["figure.png"].diff, "");
	assert.equal(byPath["refs.bib"].kind, "removed");
	revertToSnapshot(project, "t1");
	assert.equal(fs.readFileSync(path.join(folder, "sections/intro.tex"), "utf8"), "\\section{Intro}\nHello world.\n");
	assert.equal(fs.existsSync(path.join(folder, "sections/new.tex")), false);
	assert.equal(fs.existsSync(path.join(folder, "figure.png")), false);
	assert.equal(fs.existsSync(path.join(folder, "refs.bib")), true);
	assert.deepEqual(diffSinceSnapshot(project, "t1"), []);
});

test("a file that cannot be read is skipped by the snapshot and left alone by revert", () => {
	const { folder, project } = makePaper();
	fs.writeFileSync(path.join(folder, "sections/locked.tex"), "secret\n");
	fs.chmodSync(path.join(folder, "sections/locked.tex"), 0o000);
	try {
		takeSnapshot(project, "t2");
		assert.equal(hasSnapshot(project, "t2"), true);
		fs.writeFileSync(path.join(folder, "sections/intro.tex"), "changed\n");
		const changes = diffSinceSnapshot(project, "t2");
		assert.deepEqual(changes.map((c) => c.path), ["sections/intro.tex"]);
		revertToSnapshot(project, "t2");
		assert.equal(fs.readFileSync(path.join(folder, "sections/intro.tex"), "utf8"), "\\section{Intro}\nHello world.\n");
	} finally {
		fs.chmodSync(path.join(folder, "sections/locked.tex"), 0o644);
	}
});

test("the exported PDF next to the main file is never reported as a change", () => {
	const { folder, project } = makePaper();
	takeSnapshot(project, "t3");
	fs.writeFileSync(path.join(folder, "main.pdf"), "%PDF-fake");
	assert.deepEqual(diffSinceSnapshot(project, "t3"), []);
});

test("backup copies the agent leaves behind are deleted; genuinely new files stay", () => {
	const { folder, project } = makePaper();
	takeSnapshot(project, "t4");
	// A copy of the pre-edit file, then the edit (the classic "cp before sed").
	fs.copyFileSync(path.join(folder, "sections/intro.tex"), path.join(folder, "sections/intro_backup_before_rewrite.tex"));
	fs.writeFileSync(path.join(folder, "sections/intro.tex"), "\\section{Intro}\nRewritten.\n");
	// A copy of the current (edited) file, under a name that does not look like a backup.
	fs.copyFileSync(path.join(folder, "sections/intro.tex"), path.join(folder, "intro2.tex"));
	// A genuinely new file.
	fs.writeFileSync(path.join(folder, "sections/new.tex"), "\\section{New}\n");
	const removed = removeDuplicateCopies(project, "t4").sort();
	assert.deepEqual(removed, ["intro2.tex", "sections/intro_backup_before_rewrite.tex"]);
	assert.ok(!fs.existsSync(path.join(folder, "sections/intro_backup_before_rewrite.tex")));
	assert.ok(fs.existsSync(path.join(folder, "sections/new.tex")));
	const changes = diffSinceSnapshot(project, "t4").map((c) => `${c.kind} ${c.path}`).sort();
	assert.deepEqual(changes, ["added sections/new.tex", "modified sections/intro.tex"]);
});

test("project state lives under the data dir, and a legacy in-folder .researchai is moved there", () => {
	const { folder, project } = makePaper();
	assert.ok(!sidecar(project).startsWith(folder));
	assert.ok(sidecar(project).startsWith(DATA_DIR));
	// Pretend an older version left state (and Dropbox left a conflicted copy) in the folder.
	const legacy = path.join(folder, ".researchai");
	fs.mkdirSync(path.join(legacy, "snapshots/old"), { recursive: true });
	fs.writeFileSync(path.join(legacy, "comments.json"), JSON.stringify([{ id: "c1" }]));
	fs.writeFileSync(path.join(legacy, "chat (conflicted copy).json"), "{}");
	fs.writeFileSync(path.join(legacy, "snapshots/old/manifest.json"), "{}");
	const again = project;
	fs.rmSync(sidecar(again), { recursive: true, force: true });
	ensureSidecar(again);
	assert.ok(!fs.existsSync(legacy), "legacy folder removed from the paper folder");
	assert.ok(fs.existsSync(path.join(sidecar(again), "comments.json")));
	assert.ok(fs.existsSync(path.join(sidecar(again), "snapshots/old/manifest.json")));
	assert.ok(!fs.existsSync(path.join(sidecar(again), "chat (conflicted copy).json")), "conflicted copies are not carried over");
});
