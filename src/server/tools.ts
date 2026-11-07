import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isManuscriptFile } from "../core/manuscript.ts";
import type { Project, Settings } from "../core/types.ts";
import type { AppTool } from "../engine/engine.ts";
import { resolveComment } from "./comments.ts";
import { compile } from "./compile.ts";
import { listManuscriptFiles } from "./projects.ts";
import { runWorker, type WorkerTask } from "./workers.ts";

export function compileTool(project: Project): AppTool {
	return {
		name: "compile",
		description: "Compile the paper with latexmk (pdf + synctex) through the app's build queue and refresh the PDF. Returns ok or the LaTeX errors. Use this instead of running latexmk yourself.",
		schema: {},
		handler: async () => {
			const r = await compile(project);
			if (r.ok) return { text: `Compiled OK in ${(r.durationMs / 1000).toFixed(1)}s.` };
			return { text: `Compile FAILED:\n${r.errors.join("\n")}`, isError: true };
		},
	};
}

export function resolveCommentTool(project: Project): AppTool {
	return {
		name: "resolve_comment",
		description: "Mark one of the author's comments as handled, with a one-sentence note of what you did (or why you left it).",
		schema: { id: z.string().describe("The comment id, e.g. from '[comment ab12cd34]'"), note: z.string().describe("What you did about it") },
		handler: async (input) => {
			const ok = resolveComment(project, String(input.id ?? ""), String(input.note ?? ""));
			return ok ? { text: `Comment ${input.id} resolved.` } : { text: `No comment with id ${input.id}.`, isError: true };
		},
	};
}

/**
 * The agent asks the author something and ends its turn. The question is the
 * tool call itself (rendered as a card in the chat); the answer arrives as the
 * next user message, with the session resumed.
 */
export function askAuthorTool(): AppTool {
	return {
		name: "ask_author",
		description: "Ask the author a clarifying question when the request is ambiguous in a way that changes the work, or when you found that a result in the manuscript is false or a proof has a gap (explain what fails, with numbers, and offer the options). Ask only what you need, in one call (several questions in one message are fine). After calling this, END YOUR TURN with a one-line note; the answer arrives as the author's next message.",
		schema: {
			question: z.string().describe("The question(s), in plain language, with enough context for the author to answer quickly"),
			options: z.array(z.string()).max(6).optional().describe("Optional short answer choices shown as buttons; the author can always type a free answer"),
		},
		handler: async () => ({ text: "Question delivered to the author. End your turn now; do not continue working until the author answers." }),
	};
}

/**
 * Tasks must name disjoint files: existing manuscript files, or new files to
 * create inside the folder (figures, scripts, new sections). Paths that leave
 * the folder or enter the app's sidecar are refused.
 */
export function validateTasks(tasks: WorkerTask[], existing: string[], folder?: string): string | null {
	if (tasks.length === 0) return "No tasks given.";
	if (tasks.length > 8) return "At most 8 tasks per batch.";
	const seen = new Map<string, string>();
	const known = new Set(existing);
	for (const t of tasks) {
		if (!t.title?.trim() || !t.instructions?.trim()) return "Every task needs a title and instructions.";
		if (!t.files?.length) return `Task "${t.title}" names no files. Each task must list the files it may edit or create.`;
		for (const f of t.files) {
			const norm = f.replace(/^\.\//, "");
			if (norm.startsWith("/") || norm.split("/").includes("..") || norm.startsWith(".researchai")) return `Task "${t.title}": ${f} is outside the paper folder (or inside .researchai). Use paths relative to the folder.`;
			if (!known.has(norm) && folder && fs.existsSync(path.join(folder, norm)) && !isManuscriptFile(norm) && !/\.(pdf|png|jpg|jpeg|svg|eps|py|r|jl|csv|tikz)$/i.test(norm)) return `Task "${t.title}": ${f} exists but is not a file workers may edit.`;
			const other = seen.get(norm);
			if (other && other !== t.title) return `Tasks "${other}" and "${t.title}" both edit ${f}. Tasks in one batch must edit disjoint files; run them in separate batches instead.`;
			seen.set(norm, t.title);
		}
	}
	return null;
}

export function delegateTool(project: Project, settings: Settings, turnId: string, signal: AbortSignal): AppTool {
	let batches = 0;
	return {
		name: "delegate",
		description: "Run independent sub-tasks in parallel, each by its own worker agent with file and shell tools in the paper folder. Tasks in one batch must edit DISJOINT files. Blocks until every worker finishes and returns their reports. Workers have no memory of this chat: give complete instructions.",
		schema: {
			tasks: z
				.array(
					z.object({
						title: z.string().describe("Short label shown in the activity panel"),
						instructions: z.string().describe("Complete instructions for the worker: what to change, where, constraints, style"),
						files: z.array(z.string()).describe("Files (relative to the paper folder) this worker may edit; disjoint across tasks"),
					}),
				)
				.min(1)
				.max(8),
		},
		handler: async (input) => {
			const tasks = (input.tasks ?? []) as WorkerTask[];
			const existing = listManuscriptFiles(project.folder);
			const problem = validateTasks(tasks, existing, project.folder);
			if (problem) return { text: problem, isError: true };
			const batch = ++batches;
			const results = await Promise.all(tasks.map((t) => runWorker(project, settings, turnId, batch, { ...t, files: t.files.map((f) => f.replace(/^\.\//, "")) }, [compileTool(project)], signal)));
			const lines = results.map((w, i) => `## Worker ${i + 1}: ${w.title} [${w.status}]\n${w.result ?? "(no report)"}`);
			const failed = results.filter((w) => w.status === "error");
			// A stopped worker may have left its files half-edited: say so, the agent must check them.
			if (failed.length && failed.length < results.length) lines.push(`Note: ${failed.map((w) => `"${w.title}" (${w.result})`).join(", ")} did not finish; check its files before relying on them.`);
			return { text: lines.join("\n\n"), isError: failed.length === results.length && results.length > 0 };
		},
	};
}
