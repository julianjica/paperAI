/** Which files count as the manuscript (snapshotted, diffed, listed). */
export const MANUSCRIPT_EXTENSIONS = new Set([".tex", ".bib", ".sty", ".cls", ".bst", ".txt", ".md"]);
/** Folders never walked. */
export const SKIP_DIRS = new Set([".researchai", ".git", "node_modules", ".research", "build", "out"]);

export function isManuscriptFile(relPath: string): boolean {
	const dot = relPath.lastIndexOf(".");
	if (dot < 0) return false;
	return MANUSCRIPT_EXTENSIONS.has(relPath.slice(dot).toLowerCase());
}

/** The LaTeX errors worth showing from a log: `! ...` lines plus the `l.N` line that follows. */
export function extractLatexErrors(log: string, max = 12): string[] {
	const lines = log.split(/\r?\n/);
	const out: string[] = [];
	for (let i = 0; i < lines.length && out.length < max; i++) {
		const line = lines[i];
		if (line.startsWith("! ")) {
			let msg = line.slice(2).trim();
			for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
				const m = /^l\.(\d+)(.*)$/.exec(lines[j]);
				if (m) {
					msg += ` (line ${m[1]}${m[2].trim() ? `: ${m[2].trim()}` : ""})`;
					break;
				}
			}
			out.push(msg);
		} else if (/^LaTeX Warning: (Reference|Citation) .* undefined/.test(line)) {
			out.push(line.replace(/^LaTeX Warning: /, "").trim());
		}
	}
	return out;
}
