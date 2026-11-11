import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { isManuscriptFile, SKIP_DIRS } from "../core/manuscript.ts";
import type { FileChange, Project } from "../core/types.ts";
import { sidecar } from "./projects.ts";

/**
 * A snapshot = copies of the manuscript files + a listing of every file in
 * the tree (minus skipped dirs), so a revert can also delete files the
 * agent created (figures, scripts) and restore the text files it changed.
 */
interface Manifest { files: string[]; manuscript: string[] }

/** Files the app itself writes into the folder; never part of a turn's changes. */
export function appOwnedFile(project: Project, rel: string): boolean {
	return rel === project.mainTex.replace(/\.tex$/i, "") + ".pdf";
}

function walkAll(folder: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, rel: string, depth: number) => {
		if (depth > 8) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) {
				if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), r, depth + 1);
			} else if (e.isFile()) out.push(r);
		}
	};
	walk(folder, "", 0);
	return out.sort();
}

export function snapshotDir(project: Project, turnId: string): string {
	return sidecar(project, "snapshots", turnId);
}

export function takeSnapshot(project: Project, turnId: string): void {
	const dir = snapshotDir(project, turnId);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(path.join(dir, "files"), { recursive: true });
	const files = walkAll(project.folder).filter((f) => !appOwnedFile(project, f));
	const manuscript: string[] = [];
	// A file that cannot be read right now (a cloud-synced placeholder, a lock)
	// is skipped rather than failing the turn; it simply cannot be reverted.
	for (const f of files.filter(isManuscriptFile)) {
		try {
			const dest = path.join(dir, "files", f);
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.copyFileSync(path.join(project.folder, f), dest);
			manuscript.push(f);
		} catch (error) {
			console.warn(`[snapshot ${turnId}] could not copy ${f}:`, error instanceof Error ? error.message : error);
		}
	}
	const manifest: Manifest = { files, manuscript };
	fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
}

function readOr(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return null;
	}
}

/** What changed since the snapshot. */
export function diffSinceSnapshot(project: Project, turnId: string): FileChange[] {
	const dir = snapshotDir(project, turnId);
	const manifest = JSON.parse(readOr(path.join(dir, "manifest.json")) ?? '{"files":[],"manuscript":[]}') as Manifest;
	const before = new Set(manifest.files);
	const now = walkAll(project.folder).filter((f) => !appOwnedFile(project, f));
	const changes: FileChange[] = [];
	for (const f of now) {
		if (!before.has(f)) {
			const text = isManuscriptFile(f) ? readOr(path.join(project.folder, f)) : null;
			changes.push({ path: f, kind: "added", diff: text !== null ? createTwoFilesPatch("/dev/null", f, "", text) : "" });
		} else if (isManuscriptFile(f)) {
			const old = readOr(path.join(dir, "files", f));
			const cur = readOr(path.join(project.folder, f));
			if (old !== null && cur !== null && old !== cur) changes.push({ path: f, kind: "modified", diff: createTwoFilesPatch(f, f, old, cur) });
		}
	}
	const nowSet = new Set(now);
	for (const f of manifest.files) {
		if (!nowSet.has(f)) {
			const old = isManuscriptFile(f) ? readOr(path.join(dir, "files", f)) : null;
			changes.push({ path: f, kind: "removed", diff: old !== null ? createTwoFilesPatch(f, "/dev/null", old, "") : "" });
		}
	}
	return changes;
}

/** Restore the manuscript files and delete files created since the snapshot. */
export function revertToSnapshot(project: Project, turnId: string): FileChange[] {
	const changes = diffSinceSnapshot(project, turnId);
	const dir = snapshotDir(project, turnId);
	for (const c of changes) {
		const target = path.join(project.folder, c.path);
		if (c.kind === "added") fs.rmSync(target, { force: true });
		else if (isManuscriptFile(c.path) && fs.existsSync(path.join(dir, "files", c.path))) {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.copyFileSync(path.join(dir, "files", c.path), target);
		}
	}
	return changes;
}

function sha1(buf: Buffer): string {
	return createHash("sha1").update(buf).digest("hex");
}

/**
 * Delete files the agent created during the turn that are byte-for-byte
 * copies of a file that already existed: its pre-turn version (kept in the
 * snapshot) or its current one. Those are the "backup before editing" copies
 * agents like to leave behind; nothing is lost by removing them, since the
 * snapshot holds the original and Revert restores it. Returns the deleted paths.
 */
export function removeDuplicateCopies(project: Project, turnId: string): string[] {
	const dir = snapshotDir(project, turnId);
	const manifest = JSON.parse(readOr(path.join(dir, "manifest.json")) ?? '{"files":[],"manuscript":[]}') as Manifest;
	if (manifest.files.length === 0) return [];
	const before = new Set(manifest.files);
	const added = walkAll(project.folder).filter((f) => !before.has(f) && !appOwnedFile(project, f));
	if (added.length === 0) return [];
	const known = new Set<string>();
	const hashOf = (file: string) => {
		try {
			return sha1(fs.readFileSync(file));
		} catch {
			return null;
		}
	};
	for (const f of manifest.manuscript) {
		for (const file of [path.join(dir, "files", f), path.join(project.folder, f)]) {
			const h = hashOf(file);
			if (h) known.add(h);
		}
	}
	const removed: string[] = [];
	for (const f of added) {
		const h = hashOf(path.join(project.folder, f));
		if (!h || !known.has(h)) continue;
		try {
			fs.rmSync(path.join(project.folder, f), { force: true });
			removed.push(f);
		} catch (error) {
			console.warn(`[snapshot ${turnId}] could not remove the copy ${f}:`, error instanceof Error ? error.message : error);
		}
	}
	return removed;
}

export function hasSnapshot(project: Project, turnId: string): boolean {
	return fs.existsSync(path.join(snapshotDir(project, turnId), "manifest.json"));
}

/** Keep only the newest N snapshots. */
export function pruneSnapshots(project: Project, keep = 20): void {
	const root = sidecar(project, "snapshots");
	let entries: string[];
	try {
		entries = fs.readdirSync(root);
	} catch {
		return;
	}
	const stamped = entries.map((e) => ({ e, t: fs.statSync(path.join(root, e)).mtimeMs })).sort((a, b) => b.t - a.t);
	for (const { e } of stamped.slice(keep)) fs.rmSync(path.join(root, e), { recursive: true, force: true });
}
