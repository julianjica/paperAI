import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makePaper } from "./helpers.ts";
import { diffSinceSnapshot, hasSnapshot, revertToSnapshot, takeSnapshot } from "../src/server/snapshots.ts";

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
