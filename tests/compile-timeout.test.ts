import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePaper } from "./helpers.ts";
import { compile, compileRuntime } from "../src/server/compile.ts";

/** A fake latexmk on PATH: writes a log, starts a child that never ends (a looping pdflatex), and waits for it. */
function fakeLatexmk(): { bin: string; pidFile: string } {
	const bin = fs.mkdtempSync(path.join(os.tmpdir(), "ra-tex-"));
	const pidFile = path.join(bin, "child.pid");
	const script = path.join(bin, "latexmk");
	fs.writeFileSync(
		script,
		`#!/bin/sh
outdir=""
for a in "$@"; do case "$a" in -outdir=*) outdir="\${a#-outdir=}";; esac; done
printf 'This is pdfTeX\\n[1] [2] [3] [4]\\n' > "$outdir/main.log"
sleep 600 &
echo $! > "${pidFile}"
wait
`,
	);
	fs.chmodSync(script, 0o755);
	return { bin, pidFile };
}

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

test("a build that never finishes is killed with its children after the ceiling and reported with the log tail", async () => {
	const { project } = makePaper();
	const { bin, pidFile } = fakeLatexmk();
	const savedPath = process.env.PATH;
	const savedTimeout = compileRuntime.timeoutMs;
	process.env.PATH = `${bin}:${savedPath}`;
	compileRuntime.timeoutMs = 800;
	try {
		const r = await compile(project);
		assert.equal(r.ok, false);
		assert.match(r.errors[0], /stopped after/);
		assert.match(r.errors[0], /\[1\] \[2\] \[3\] \[4\]/, "the log tail is in the message");
		const child = Number(fs.readFileSync(pidFile, "utf8"));
		await new Promise((res) => setTimeout(res, 100));
		assert.ok(!alive(child), "the looping child under latexmk is gone too");
	} finally {
		process.env.PATH = savedPath;
		compileRuntime.timeoutMs = savedTimeout;
	}
});

test("stopping the turn stops the build in progress", async () => {
	const { project } = makePaper();
	const { bin, pidFile } = fakeLatexmk();
	const savedPath = process.env.PATH;
	process.env.PATH = `${bin}:${savedPath}`;
	try {
		const controller = new AbortController();
		const done = compile(project, controller.signal);
		await new Promise((res) => setTimeout(res, 300));
		controller.abort();
		const r = await done;
		assert.equal(r.ok, false);
		assert.match(r.errors[0], /stopped with the turn/);
		await new Promise((res) => setTimeout(res, 100));
		assert.ok(!alive(Number(fs.readFileSync(pidFile, "utf8"))));
	} finally {
		process.env.PATH = savedPath;
	}
});
