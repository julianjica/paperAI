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
const g = globalThis as unknown as { __raCompile?: Map<string, State> };
g.__raCompile ??= new Map();
const states = g.__raCompile; // survives dev-server module reloads

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

/** latexmk's output; rewritten in place during every build (may be empty mid-build). */
export function pdfPath(project: Project): string {
	return path.join(buildDir(project), `${path.basename(project.mainTex, ".tex")}.pdf`);
}

/** The PDF the viewer loads: a copy of the last GOOD build, replaced atomically. */
export function servedPdfPath(project: Project): string {
	return path.join(buildDir(project), "current.pdf");
}

/**
 * The PDF the author sees in the folder: `<main>.pdf` next to the main .tex,
 * replaced atomically after every good build (what Overleaf and a local
 * latexmk would leave there). Best effort; the viewer uses the sidecar copy.
 */
export function exportedPdfPath(project: Project): string {
	return path.join(project.folder, project.mainTex.replace(/\.tex$/i, "") + ".pdf");
}
function exportPdf(project: Project): void {
	try {
		const dest = exportedPdfPath(project);
		const tmp = `${dest}.${process.pid}.tmp`;
		fs.copyFileSync(servedPdfPath(project), tmp);
		fs.renameSync(tmp, dest);
	} catch (error) {
		console.warn("[compile] could not write the PDF into the paper folder:", error instanceof Error ? error.message : error);
	}
}

/** Publish the build output as the served PDF (copy + rename, so readers never see a partial file). */
function publishPdf(project: Project): boolean {
	const src = pdfPath(project);
	try {
		if (!fs.existsSync(src) || fs.statSync(src).size === 0) return false;
		const dest = servedPdfPath(project);
		const tmp = `${dest}.${process.pid}.tmp`;
		fs.copyFileSync(src, tmp);
		fs.renameSync(tmp, dest);
		return true;
	} catch {
		return false;
	}
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
	// The build directory is outside the paper folder (the app's data dir): latexmk takes an absolute outdir.
	return new Promise((resolve) => {
		const child = spawn("latexmk", ["-pdf", "-synctex=1", "-interaction=nonstopmode", "-file-line-error", `-outdir=${outdir}`, project.mainTex], {
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
			// A failed build can still leave a usable PDF (latexmk keeps going past errors).
			if (publishPdf(project)) {
				s.version += 1;
				exportPdf(project);
			}
			const result: CompileResult = { ok, errors, durationMs: Date.now() - started, version: s.version };
			s.last = result;
			publish(project.id, { type: "compiled", result });
			resolve(result);
		};
		child.on("error", (e) => finish(false, e.message.includes("ENOENT") ? "latexmk not found. Install TeX Live (MacTeX) or add it to PATH." : e.message));
		child.on("exit", (code) => finish(code === 0));
	});
}
