import fs from "node:fs";
import path from "node:path";
import { isManuscriptFile } from "../core/manuscript.ts";
import { addedLines, AI_VOCABULARY, findTells, type Tell } from "../core/tells.ts";
import type { FileChange, Project, ProseTell } from "../core/types.ts";
import { listManuscriptFiles } from "./projects.ts";
import { hasSnapshot, snapshotDir } from "./snapshots.ts";

/**
 * Words from the model-vocabulary list that the author's own text already
 * uses are the paper's terms ("robust" in an econometrics paper), never
 * flagged. Judged on the manuscript as it was before the turn (the snapshot),
 * so that a word the agent introduces this turn does not whitelist itself.
 */
export function paperVocabulary(project: Project, turnId?: string): string[] {
	const root = turnId && hasSnapshot(project, turnId) ? path.join(snapshotDir(project, turnId), "files") : project.folder;
	const files = turnId && hasSnapshot(project, turnId) ? walk(root) : listManuscriptFiles(project.folder);
	const text = files
		.filter((f) => /\.tex$/i.test(f))
		.map((f) => {
			try {
				return fs.readFileSync(path.join(root, f), "utf8");
			} catch {
				return "";
			}
		})
		.join("\n")
		.toLowerCase();
	return AI_VOCABULARY.filter((w) => new RegExp(`\\b${w.replace(/[-\\/]/g, "\\$&")}\\b`).test(text));
}

function walk(root: string): string[] {
	const out: string[] = [];
	const rec = (dir: string, rel: string) => {
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) rec(path.join(dir, e.name), r);
			else if (isManuscriptFile(r)) out.push(r);
		}
	};
	rec(root, "");
	return out;
}

/** Scan one manuscript file (optionally a line range) as the check_prose tool does. */
export function scanFile(project: Project, rel: string, turnId?: string, from?: number, to?: number): Tell[] {
	const text = fs.readFileSync(path.join(project.folder, rel), "utf8");
	const tells = findTells(text, { allow: paperVocabulary(project, turnId) });
	return from || to ? tells.filter((t) => t.line >= (from ?? 1) && t.line <= (to ?? Number.MAX_SAFE_INTEGER)) : tells;
}

/** Scan the lines a turn added (from its diffs), mapped back to file lines. */
export function scanChanges(project: Project, turnId: string, changes: FileChange[], max = 80): ProseTell[] {
	const allow = paperVocabulary(project, turnId);
	const out: ProseTell[] = [];
	for (const c of changes) {
		if (c.kind === "removed" || !/\.tex$/i.test(c.path) || !c.diff) continue;
		const added = addedLines(c.diff);
		if (added.length === 0) continue;
		// Consecutive added lines form the paragraphs the scanner sees; a gap becomes a blank line.
		const text: string[] = [];
		const map: number[] = [];
		let prev = -2;
		for (const a of added) {
			if (a.line !== prev + 1 && text.length) {
				text.push("");
				map.push(-1);
			}
			text.push(a.text);
			map.push(a.line);
			prev = a.line;
		}
		for (const t of findTells(text.join("\n"), { allow })) out.push({ file: c.path, line: map[t.line - 1] ?? t.line, kind: t.kind, match: t.match, advice: t.advice });
	}
	return out.slice(0, max);
}
