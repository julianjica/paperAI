import { nanoid } from "nanoid";
import { renderCommentBatch } from "../core/comments.ts";
import type { AssistantPart, ChatMessage, Comment, Project, Settings, TurnRecord } from "../core/types.ts";
import { engineFor } from "../engine/index.ts";
import { publish } from "./bus.ts";
import { readChat, writeChat, type ChatRecord } from "./chat.ts";
import { listComments, sendPending } from "./comments.ts";
import { compile } from "./compile.ts";
import { listManuscriptFiles } from "./projects.ts";
import { mainSystemPrompt } from "./prompt.ts";
import { readSettings } from "./settings.ts";
import { diffSinceSnapshot, pruneSnapshots, takeSnapshot } from "./snapshots.ts";
import { askAuthorTool, compileTool, delegateTool, resolveCommentTool } from "./tools.ts";

/**
 * The turn pipeline: snapshot → run the main agent → diff → compile → persist.
 * One turn per project at a time. Events go to the project bus; the SSE
 * route relays them to the workspace.
 */
const active = new Map<string, AbortController>();

export function turnRunning(projectId: string): boolean {
	return active.has(projectId);
}

export function abortTurn(projectId: string): boolean {
	const c = active.get(projectId);
	if (!c) return false;
	c.abort();
	return true;
}

export interface TurnInput { text: string; sendComments: boolean }

/** Validate and start a turn; the run continues in the background. Throws synchronously on bad input. */
export function startTurn(project: Project, input: TurnInput): { turnId: string; done: Promise<TurnRecord> } {
	if (active.has(project.id)) throw new Error("A turn is already running for this project.");
	const settings = readSettings();
	const turnId = nanoid(10);
	const record = readChat(project);
	const pending = input.sendComments ? listComments(project).filter((c) => c.status === "pending") : [];
	if (!input.text.trim() && pending.length === 0) throw new Error("Nothing to send.");
	const controller = new AbortController();
	active.set(project.id, controller);
	const comments = input.sendComments ? sendPending(project, turnId) : [];
	const userText = [input.text.trim(), renderCommentBatch(comments)].filter(Boolean).join("\n\n");
	const done = runTurn(project, input, { settings, turnId, record, comments, userText, controller }).finally(() => active.delete(project.id));
	return { turnId, done };
}

interface TurnContext { settings: Settings; turnId: string; record: ChatRecord; comments: Comment[]; userText: string; controller: AbortController }

async function runTurn(project: Project, input: TurnInput, cx: TurnContext): Promise<TurnRecord> {
	const { settings, turnId, record, comments, userText, controller } = cx;
	const userMessage: ChatMessage = { role: "user", id: nanoid(8), text: input.text.trim(), commentIds: comments.map((c) => c.id), timestamp: Date.now() };
	const parts: AssistantPart[] = [];
	const assistant: ChatMessage = { role: "assistant", id: nanoid(8), turnId, parts, timestamp: Date.now() };
	record.messages.push(userMessage, assistant);
	const turn: TurnRecord = { id: turnId, startedAt: Date.now(), changes: [] };
	record.turns.push(turn);
	writeChat(project, record);
	publish(project.id, { type: "turn_start", turnId });

	takeSnapshot(project, turnId);
	const files = listManuscriptFiles(project.folder);
	const engine = engineFor(settings.engine);
	const resume = record.session?.engine === settings.engine ? record.session.id : undefined;
	const tools = [compileTool(project), resolveCommentTool(project), askAuthorTool(), delegateTool(project, settings, turnId, controller.signal)];
	let usage = { input: 0, output: 0, cacheRead: 0 };
	let lastSave = 0;
	const save = (force = false) => {
		const now = Date.now();
		if (!force && now - lastSave < 1500) return;
		lastSave = now;
		writeChat(project, record);
	};
	try {
		for await (const e of engine.run({ cwd: project.folder, systemPrompt: mainSystemPrompt(project, files), model: settings.model, effort: settings.effort, input: userText, resume, tools, signal: controller.signal, label: `turn ${turnId}` })) {
			publish(project.id, { type: "agent", turnId, event: e });
			switch (e.type) {
				case "session":
					record.session = { engine: settings.engine, id: e.id };
					break;
				case "text_delta": {
					const last = parts[parts.length - 1];
					if (last?.kind === "text") last.text += e.text;
					else parts.push({ kind: "text", text: e.text });
					break;
				}
				case "thinking_delta": {
					const last = parts[parts.length - 1];
					if (last?.kind === "thinking") last.text += e.text;
					else parts.push({ kind: "thinking", text: e.text });
					break;
				}
				case "tool_start":
					parts.push({ kind: "tool", call: { id: e.id, name: e.name, input: e.input, startedAt: Date.now() } });
					break;
				case "tool_end": {
					const part = parts.find((p) => p.kind === "tool" && p.call.id === e.id);
					if (part?.kind === "tool") {
						part.call.output = e.output;
						part.call.isError = e.isError;
						if (part.call.startedAt) part.call.durationMs = Date.now() - part.call.startedAt;
					}
					break;
				}
				case "usage":
					usage = { input: usage.input + e.input, output: usage.output + e.output, cacheRead: usage.cacheRead + e.cacheRead };
					assistant.usage = usage;
					break;
				case "error":
					if (controller.signal.aborted) assistant.aborted = true;
					else assistant.error = e.message;
					// A failed run cannot be resumed safely: start fresh next time.
					if (!controller.signal.aborted) record.session = undefined;
					break;
				case "done":
					break;
			}
			save();
		}
	} catch (error) {
		assistant.error = error instanceof Error ? error.message : String(error);
	}
	assistant.usage = usage;
	turn.endedAt = Date.now();
	turn.changes = diffSinceSnapshot(project, turnId);
	save(true);
	if (turn.changes.length > 0 || !assistant.error) {
		turn.compile = await compile(project);
		save(true);
	}
	pruneSnapshots(project);
	publish(project.id, { type: "turn_end", turnId, turn });
	return turn;
}
