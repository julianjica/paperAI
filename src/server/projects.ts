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

/**
 * Switch to another main .tex of the same folder. A project is one root
 * document (folder + main file) with its own chat, comments and snapshots,
 * so switching means opening the sibling project for that file, created on
 * first use with this project's settings copied over. Switching back finds
 * the original again, chat intact.
 */
export function switchMainTex(id: string, mainTex: string): Project {
	const projects = readJson<Project[]>(FILE(), []);
	const p = projects.find((x) => x.id === id);
	if (!p) throw new Error("No such project");
	const rel = mainTex.replace(/^\.\//, "").split(path.sep).join("/");
	if (!rel.toLowerCase().endsWith(".tex") || rel.startsWith("/") || rel.split("/").includes("..")) throw new Error("The main file must be a .tex file inside the paper folder.");
	if (!fs.existsSync(path.join(p.folder, rel))) throw new Error(`Main file not found: ${rel}`);
	const now = Date.now();
	let sibling = projects.find((x) => x.folder === p.folder && x.mainTex === rel);
	if (!sibling) {
		sibling = { id: nanoid(10), folder: p.folder, mainTex: rel, name: `${path.basename(p.folder)} / ${rel}`, createdAt: now, openedAt: now };
		if (p.settings) sibling.settings = { ...p.settings };
		projects.push(sibling);
	}
	sibling.openedAt = now;
	writeJson(FILE(), projects);
	ensureSidecar(sibling);
	return sibling;
}

export function removeProject(id: string): void {
	const projects = readJson<Project[]>(FILE(), []);
	const p = projects.find((x) => x.id === id);
	writeJson(FILE(), projects.filter((x) => x.id !== id));
	if (p) fs.rmSync(sidecar(p), { recursive: true, force: true });
}

/**
 * Where the app keeps a project's state (chat, comments, queue, snapshots,
 * build output): under the app's data directory, never inside the paper
 * folder. A paper folder is often synced (Dropbox, Overleaf, git); app
 * state inside it produced "conflicted copy" duplicates and constant churn,
 * so the only file the app writes into the folder is the exported PDF.
 */
export function sidecar(project: Project, ...parts: string[]): string {
	return path.join(DATA_DIR, "projects", project.id, ...parts);
}

/** The legacy in-folder state directory, if this project still has one. */
export function legacySidecar(project: Project): string {
	return path.join(project.folder, SIDECAR);
}

const sidecarReady = new Set<string>();
/**
 * Create the state directory and move a legacy in-folder `.researchai`
 * into it. Only the app's own files are
 * carried over (a sync client's "conflicted copy" duplicates are dropped
 * with the folder); the project's state wins over the legacy copy if both
 * exist. Best effort: a failure leaves the legacy folder in place.
 */
export function ensureSidecar(project: Project): void {
	const dir = sidecar(project);
	if (!sidecarReady.has(dir)) {
		sidecarReady.add(dir);
		fs.mkdirSync(dir, { recursive: true });
	}
	// Checked every time (one stat): a legacy folder can reappear from a sync client's history.
	migrateLegacySidecar(project);
}

const LEGACY_ENTRIES = ["chat.json", "comments.json", "queue.json", "snapshots", "build"];
function migrateLegacySidecar(project: Project): void {
	const legacy = legacySidecar(project);
	if (!fs.existsSync(legacy)) return;
	const dir = sidecar(project);
	try {
		for (const name of LEGACY_ENTRIES) {
			const from = path.join(legacy, name);
			const to = path.join(dir, name);
			if (!fs.existsSync(from) || fs.existsSync(to)) continue;
			fs.cpSync(from, to, { recursive: true });
		}
		fs.rmSync(legacy, { recursive: true, force: true });
		console.log(`[projects] moved ${legacy} out of the paper folder`);
	} catch (error) {
		console.warn(`[projects] could not move ${legacy}:`, error instanceof Error ? error.message : error);
	}
}
