import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { DATA_DIR, SIDECAR } from "../../config.ts";
import { isManuscriptFile, SKIP_DIRS } from "../core/manuscript.ts";
import type { Project, ProjectSettings } from "../core/types.ts";
import { readJson, writeJson } from "./fsjson.ts";

const FILE = () => path.join(DATA_DIR, "projects.json");

export function listProjects(): Project[] {
	return readJson<Project[]>(FILE(), []).sort((a, b) => b.openedAt - a.openedAt);
}

export function getProject(id: string): Project | undefined {
	return listProjects().find((p) => p.id === id);
}

/** Walk a folder for manuscript files (relative paths, sorted). */
export function listManuscriptFiles(folder: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, rel: string, depth: number) => {
		if (depth > 6) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith(".")) continue;
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) {
				if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), r, depth + 1);
			} else if (isManuscriptFile(r)) out.push(r);
		}
	};
	walk(folder, "", 0);
	return out.sort();
}

/** .tex files that contain \documentclass: the candidates for the main file. */
export function listMainCandidates(folder: string): string[] {
	return listManuscriptFiles(folder).filter((f) => {
		if (!f.endsWith(".tex")) return false;
		try {
			return /\\documentclass/.test(fs.readFileSync(path.join(folder, f), "utf8"));
		} catch {
			return false;
		}
	});
}

export function addProject(folder: string, mainTex: string): Project {
	const abs = path.resolve(folder);
	if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
	if (!fs.existsSync(path.join(abs, mainTex))) throw new Error(`Main file not found: ${mainTex}`);
	const projects = readJson<Project[]>(FILE(), []);
	const existing = projects.find((p) => p.folder === abs && p.mainTex === mainTex);
	const now = Date.now();
	if (existing) {
		existing.openedAt = now;
		writeJson(FILE(), projects);
		return existing;
	}
	const project: Project = { id: nanoid(10), folder: abs, mainTex, name: `${path.basename(abs)} / ${mainTex}`, createdAt: now, openedAt: now };
	projects.push(project);
	writeJson(FILE(), projects);
	ensureSidecar(project);
	return project;
}

export function touchProject(id: string): void {
	const projects = readJson<Project[]>(FILE(), []);
	const p = projects.find((x) => x.id === id);
	if (!p) return;
	p.openedAt = Date.now();
	writeJson(FILE(), projects);
}

const SETTING_KEYS = new Set<keyof ProjectSettings>(["engine", "model", "workerModel", "effort", "workerEffort", "styleNote"]);

/**
 * Merge per-project overrides. A key present with undefined/null removes that
 * override (the global default applies again); unknown keys are ignored so a
 * stray request field never lands in projects.json.
 */
export function updateProjectSettings(id: string, patch: ProjectSettings): Project {
	const projects = readJson<Project[]>(FILE(), []);
	const p = projects.find((x) => x.id === id);
	if (!p) throw new Error("No such project");
	const settings: Record<string, unknown> = { ...(p.settings ?? {}) };
	for (const [k, v] of Object.entries(patch)) {
		if (!SETTING_KEYS.has(k as keyof ProjectSettings)) continue;
		if (v == null || v === "") delete settings[k];
		else settings[k] = v;
	}
	if (Object.keys(settings).length) p.settings = settings as ProjectSettings;
	else delete p.settings;
	writeJson(FILE(), projects);
	return p;
}

export function removeProject(id: string): void {
	writeJson(FILE(), readJson<Project[]>(FILE(), []).filter((p) => p.id !== id));
}

export function sidecar(project: Project, ...parts: string[]): string {
	return path.join(project.folder, SIDECAR, ...parts);
}

const sidecarReady = new Set<string>();
/**
 * Create the sidecar and, on macOS, mark it ignored by Dropbox (and similar
 * clients honour the same attribute): build output, snapshots and chat
 * churn would otherwise sync continuously and files can be unavailable
 * mid-sync. Best effort, once per process per project.
 */
export function ensureSidecar(project: Project): void {
	const dir = sidecar(project);
	if (sidecarReady.has(dir)) return;
	sidecarReady.add(dir);
	fs.mkdirSync(dir, { recursive: true });
	if (process.platform === "darwin") execFile("xattr", ["-w", "com.dropbox.ignored", "1", dir], () => undefined);
	else if (process.platform === "linux") execFile("attr", ["-s", "com.dropbox.ignored", "-V", "1", dir], () => undefined);
}
