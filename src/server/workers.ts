import { nanoid } from "nanoid";
import type { Project, Settings, WorkerState } from "../core/types.ts";
import { engineFor } from "../engine/index.ts";
import type { AppTool } from "../engine/engine.ts";
import { publish } from "./bus.ts";
import { workerSystemPrompt } from "./prompt.ts";

const workers = new Map<string, WorkerState[]>(); // projectId → workers (newest last)

export function listWorkers(projectId: string): WorkerState[] {
	return workers.get(projectId) ?? [];
}

function remember(projectId: string, w: WorkerState) {
	let list = workers.get(projectId);
	if (!list) workers.set(projectId, (list = []));
	list.push(w);
	if (list.length > 50) list.splice(0, list.length - 50);
}

function line(w: WorkerState, text: string) {
	w.activity.push(text);
	if (w.activity.length > 40) w.activity.splice(0, w.activity.length - 40);
}

export interface WorkerTask { title: string; instructions: string; files: string[] }

/** Run one worker to completion; its state streams to the activity panel. */
export async function runWorker(project: Project, settings: Settings, turnId: string, task: WorkerTask, tools: AppTool[], signal: AbortSignal): Promise<WorkerState> {
	const w: WorkerState = { id: nanoid(8), turnId, title: task.title, files: task.files, status: "running", startedAt: Date.now(), activity: [] };
	remember(project.id, w);
	publish(project.id, { type: "worker", worker: w });
	let throttle = 0;
	const emit = (force = false) => {
		const now = Date.now();
		if (!force && now - throttle < 400) return;
		throttle = now;
		publish(project.id, { type: "worker", worker: { ...w, activity: [...w.activity] } });
	};
	let text = "";
	let textLine = "";
	const engine = engineFor(settings.engine);
	try {
		for await (const e of engine.run({
			cwd: project.folder,
			systemPrompt: workerSystemPrompt(project, task.files),
			model: settings.workerModel,
			effort: settings.workerEffort,
			input: `Task: ${task.title}\n\n${task.instructions}`,
			tools,
			signal,
			label: `worker ${w.id}`,
		})) {
			if (e.type === "text_delta") {
				text += e.text;
				textLine += e.text;
				if (textLine.includes("\n")) {
					const parts = textLine.split("\n");
					textLine = parts.pop() ?? "";
					for (const p of parts) if (p.trim()) line(w, p.trim());
					emit();
				}
			} else if (e.type === "tool_start") {
				const input = e.input as Record<string, unknown>;
				const hint = typeof input?.file_path === "string" ? input.file_path : typeof input?.command === "string" ? input.command : typeof input?.pattern === "string" ? input.pattern : "";
				line(w, `→ ${e.name}${hint ? ` ${String(hint).slice(0, 80)}` : ""}`);
				emit();
			} else if (e.type === "done") {
				w.result = e.text || text;
			} else if (e.type === "error") {
				w.status = "error";
				w.result = e.message;
			}
		}
		if (w.status === "running") w.status = "done";
	} catch (error) {
		w.status = "error";
		w.result = error instanceof Error ? error.message : String(error);
	}
	if (textLine.trim()) line(w, textLine.trim());
	w.endedAt = Date.now();
	emit(true);
	return w;
}
