import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addProject } from "../src/server/projects.ts";
import type { Project } from "../src/core/types.ts";

/** A throwaway paper folder with a main file and one section. */
export function makePaper(): { folder: string; project: Project } {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ra-paper-"));
	fs.mkdirSync(path.join(folder, "sections"));
	fs.writeFileSync(path.join(folder, "main.tex"), "\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\end{document}\n");
	fs.writeFileSync(path.join(folder, "sections/intro.tex"), "\\section{Intro}\nHello world.\n");
	fs.writeFileSync(path.join(folder, "refs.bib"), "@article{x, title={T}}\n");
	const project = addProject(folder, "main.tex");
	return { folder, project };
}
