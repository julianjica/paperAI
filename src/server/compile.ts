import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { extractLatexErrors } from "../core/manuscript.ts";
import type { CompileResult, Project } from "../core/types.ts";
import { texPath } from "../engine/exec.ts";
import { publish } from "./bus.ts";
import { sidecar } from "./projects.ts";

/**
 * One latexmk per project at a time. A request that arrives while one runs
 * waits for the NEXT run; several such requests coalesce into one.
 */
interface State { running?: Promise<CompileResult>; pending?: Promise<CompileResult>; version: number; last?: CompileResult }
const states = new Map<string, State>();

/** Test seam: replace latexmk with a scripted run. */
export const compileRuntime: { run?: (project: Project) => Promise<{ ok: boolean; errors: string[] }> } = {};

function state(id: string): State {
	let s = states.get(id);
	if (!s) states.set(id, (s = { version: 0 }));
	return s;
}

export function buildDir(project: Project): string {
	return sidecar(project, "build");
}

export function pdfPath(project: Project): string {
	return path.join(buildDir(project), `${path.basename(project.mainTex, ".tex")}.pdf`);
}

export function lastCompile(project: Project): CompileResult | undefined {
	return state(project.id).last;
}

export function compile(project: Project): Promise<CompileResult> {
	const s = state(project.id);
	if (s.running) {
		if (!s.pending) {
			s.pending = s.running.then(() => {
				s.pending = undefined;
				return compile(project);
			});
		}
		return s.pending;
	}
	const run = compileRuntime.run
		? compileRuntime.run(project).then((r) => {
				s.version += 1;
				const result: CompileResult = { ...r, durationMs: 0, version: s.version };
				s.last = result;
				publish(project.id, { type: "compiled", result });
				return result;
			})
		: runLatexmk(project, s);
	s.running = run.finally(() => {
		s.running = undefined;
	});
	return s.running;
}

function runLatexmk(project: Project, s: State): Promise<CompileResult> {
	const started = Date.now();
	const outdir = buildDir(project);
	fs.mkdirSync(outdir, { recursive: true });
	const rel = path.relative(project.folder, outdir) || ".";
	return new Promise((resolve) => {
		const child = spawn("latexmk", ["-pdf", "-synctex=1", "-interaction=nonstopmode", "-file-line-error", `-outdir=${rel}`, project.mainTex], {
			cwd: project.folder,
			env: { ...process.env, PATH: texPath() },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		child.stdout.on("data", (d: Buffer) => (out += d.toString()));
		child.stderr.on("data", (d: Buffer) => (out += d.toString()));
		const finish = (ok: boolean, extra?: string) => {
			const logFile = path.join(outdir, `${path.basename(project.mainTex, ".tex")}.log`);
			let log = "";
			try {
				log = fs.readFileSync(logFile, "utf8");
			} catch {
				log = out;
			}
			let errors = ok ? [] : extractLatexErrors(log);
			if (!ok && errors.length === 0) errors = [extra ?? out.trim().split("\n").slice(-5).join("\n") ?? "latexmk failed"];
			const pdfExists = fs.existsSync(pdfPath(project));
			if (pdfExists) s.version += 1;
			const result: CompileResult = { ok, errors, durationMs: Date.now() - started, version: s.version };
			s.last = result;
			publish(project.id, { type: "compiled", result });
			resolve(result);
		};
		child.on("error", (e) => finish(false, e.message.includes("ENOENT") ? "latexmk not found. Install TeX Live (MacTeX) or add it to PATH." : e.message));
		child.on("exit", (code) => finish(code === 0));
	});
}
