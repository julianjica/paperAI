import { execFile } from "node:child_process";
import path from "node:path";
import { parseSynctexEdit } from "../core/synctex.ts";
import type { Project } from "../core/types.ts";
import { texPath } from "../engine/exec.ts";
import { pdfPath } from "./compile.ts";

/**
 * PDF point → source line. `x`,`y` are in PDF points measured from the
 * TOP-LEFT of the page (synctex's convention; pdf.js's user space is
 * bottom-left, so the viewer converts before calling).
 */
export function locate(project: Project, page: number, x: number, y: number): Promise<{ file: string; line: number } | null> {
	// The PDF (and its .synctex.gz) live in the build directory outside the folder; input names in the
	// synctex file are as TeX saw them, relative to the paper folder, hence cwd = folder.
	const pdf = pdfPath(project);
	return new Promise((resolve) => {
		execFile("synctex", ["edit", "-o", `${page}:${x.toFixed(2)}:${y.toFixed(2)}:${pdf}`], { cwd: project.folder, env: { ...process.env, PATH: texPath() } }, (error, stdout) => {
			if (error && !stdout) return resolve(null);
			const hit = parseSynctexEdit(stdout);
			if (!hit) return resolve(null);
			const abs = path.resolve(project.folder, hit.file);
			resolve({ file: path.relative(project.folder, abs).split(path.sep).join("/"), line: hit.line });
		});
	});
}
