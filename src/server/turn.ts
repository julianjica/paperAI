import { nanoid } from "nanoid";
import { renderCommentBatch } from "../core/comments.ts";
import type { AssistantPart, ChatMessage, Comment, Project, QueuedMessage, TurnRecord } from "../core/types.ts";
import { engineFor } from "../engine/index.ts";
import { publish } from "./bus.ts";
import { readChat, writeChat, type ChatRecord } from "./chat.ts";
import { closeSentComments, closeStaleSent, listComments, sendPending } from "./comments.ts";
import { compile } from "./compile.ts";
import { readJson, writeJson } from "./fsjson.ts";
import { ensureSidecar, listManuscriptFiles, sidecar } from "./projects.ts";
import { mainSystemPrompt } from "./prompt.ts";
import { settingsFor, type EffectiveSettings } from "./settings.ts";
import { diffSinceSnapshot, hasSnapshot, pruneSnapshots, removeDuplicateCopies, takeSnapshot } from "./snapshots.ts";
import { askAuthorTool, compileTool, delegateTool, resolveCommentTool } from "./tools.ts";

/**
 * The turn pipeline: snapshot → run the main agent → diff → compile → persist.
 * One turn per project at a time. Events go to the project bus; the SSE
 * route relays them to the workspace.
 */
// Kept on globalThis so a dev-server module reload does not forget a running turn.
const g = globalThis as unknown as { __raTurns?: { active: Map<string, AbortController>; ids: Map<string, string> } };
g.__raTurns ??= { active: new Map(), ids: new Map() };
const active = g.__raTurns.active;

export function turnRunning(projectId: string): boolean {
	return active.has(projectId);
}

const activeTurnIds = g.__raTurns.ids;
/** The id of the turn running for this project, if any. */
export function activeTurnId(projectId: string): string | undefined {
	return activeTurnIds.get(projectId);
}

export function abortTurn(projectId: string): boolean {
	const c = active.get(projectId);
	if (!c) return false;
	c.abort();
	return true;
}

export const DEFAULT_TURN_TIMEOUT_MIN = 90;
/** The abort reason of a turn stopped by its time limit (a user Stop aborts with no reason). */
class TurnTimeout extends Error {
	constructor(minutes: number) {
		super(`The turn was stopped after ${minutes} minutes (the turn time limit). What was done so far is kept; send a new message to continue.`);
	}
}

export interface TurnInput { text: string; sendComments: boolean }

/**
 * A turn that was running when the server died left a turn without endedAt
 * and an assistant message without an error. Close such turns so the chat
 * is honest and Revert works (the snapshot was taken before the run). The
 * running turn, if any, is never touched: its startTurn already recovered
 * the record, and writing chat.json now would race the turn's own saves.
 */
export function recoverInterruptedTurns(project: Project): number {
	if (active.has(project.id)) return 0;
	const record = readChat(project);
	let n = 0;
	for (const turn of record.turns) {
		if (turn.endedAt !== undefined || turn.id === activeTurnIds.get(project.id)) continue;
		turn.endedAt = Date.now();
		if (hasSnapshot(project, turn.id)) turn.changes = diffSinceSnapshot(project, turn.id);
		const assistant = record.messages.find((m) => m.role === "assistant" && m.turnId === turn.id);
		if (assistant?.role === "assistant" && !assistant.error && !assistant.aborted) assistant.error = "The server restarted during this turn.";
		n++;
	}
	if (n) writeChat(project, record);
	return n;
}

/** Appended to every user input (not shown in the chat bubble). */
export const REPLY_FORMAT_REMINDER = "(Reply format: write every formula in your reply in LaTeX, inline as $...$ and displayed as $$...$$, exactly as in the paper. No Unicode math symbols or ASCII approximations.)";

/**
 * Send a message: starts a turn now, or, while one is running, queues it to
 * start when the turn ends. Queued messages run in order.
 */
export function submit(project: Project, input: TurnInput): { turnId: string } | { queued: QueuedMessage } {
	if (!active.has(project.id)) return { turnId: startTurn(project, input).turnId };
	if (!input.text.trim() && !(input.sendComments && listComments(project).some((c) => c.status === "pending"))) throw new Error("Nothing to send.");
	const queued: QueuedMessage = { id: nanoid(8), text: input.text.trim(), sendComments: input.sendComments, timestamp: Date.now() };
	writeQueue(project, [...listQueued(project), queued]);
	return { queued };
}

// The queue lives in its own file: the running turn rewrites chat.json as it streams.
const queueFile = (p: Project) => sidecar(p, "queue.json");
export function listQueued(project: Project): QueuedMessage[] {
	return readJson<QueuedMessage[]>(queueFile(project), []);
}
function writeQueue(project: Project, queued: QueuedMessage[]) {
	writeJson(queueFile(project), queued);
	publish(project.id, { type: "queue", queued });
}

export function removeQueued(project: Project, id: string): boolean {
	const queued = listQueued(project);
	const next = queued.filter((q) => q.id !== id);
	if (next.length === queued.length) return false;
	writeQueue(project, next);
	return true;
}

/** After a turn: start the next queued message, if any. */
function startNextQueued(project: Project): void {
	const queued = listQueued(project);
	const next = queued[0];
	if (!next) return;
	writeQueue(project, queued.slice(1));
	try {
		startTurn(project, { text: next.text, sendComments: next.sendComments });
	} catch (error) {
		console.error("[queue] could not start the next message:", error);
		startNextQueued(project);
	}
}

/** Validate and start a turn; the run continues in the background. Throws synchronously on bad input. */
export function startTurn(project: Project, input: TurnInput): { turnId: string; done: Promise<TurnRecord> } {
	if (active.has(project.id)) throw new Error("A turn is already running for this project.");
	const settings = settingsFor(project);
	const turnId = nanoid(10);
	ensureSidecar(project);
	// Before reading the record, so the new turn builds on the recovered one.
	recoverInterruptedTurns(project);
	const record = readChat(project);
	const pending = input.sendComments ? listComments(project).filter((c) => c.status === "pending") : [];
	if (!input.text.trim() && pending.length === 0) throw new Error("Nothing to send.");
	const controller = new AbortController();
	active.set(project.id, controller);
	activeTurnIds.set(project.id, turnId);
	const comments = input.sendComments ? sendPending(project, turnId) : [];
	// The reply-format reminder rides on every input: a resumed session otherwise keeps the habits of its earlier turns.
	const userText = [input.text.trim(), renderCommentBatch(comments), REPLY_FORMAT_REMINDER].filter(Boolean).join("\n\n");
	const minutes = settings.turnTimeoutMin ?? DEFAULT_TURN_TIMEOUT_MIN;
	const ceiling = setTimeout(() => controller.abort(new TurnTimeout(minutes)), minutes * 60_000);
	ceiling.unref();
	const done = runTurn(project, input, { settings, turnId, record, comments, userText, controller }).finally(() => {
		clearTimeout(ceiling);
		active.delete(project.id);
		activeTurnIds.delete(project.id);
		closeStaleSent(project, undefined);
		startNextQueued(project);
	});
	return { turnId, done };
}

interface TurnContext { settings: EffectiveSettings; turnId: string; record: ChatRecord; comments: Comment[]; userText: string; controller: AbortController }

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

	let usage = { input: 0, output: 0, cacheRead: 0 };
	let lastSave = 0;
	const save = (force = false) => {
		const now = Date.now();
		if (!force && now - lastSave < 1500) return;
		lastSave = now;
		writeChat(project, record);
	};
	// Everything from here on is guarded: a failure anywhere (a snapshot copy
	// on a syncing Dropbox folder, a missing CLI, the engine itself) lands in
	// the assistant message as the real error, instead of leaving a turn with
	// no end that the next page load would report as a server restart.
	try {
		takeSnapshot(project, turnId);
		const files = listManuscriptFiles(project.folder);
		const engine = engineFor(settings.engine);
		const resume = record.session?.engine === settings.engine ? record.session.id : undefined;
		const tools = [compileTool(project), resolveCommentTool(project), askAuthorTool(), delegateTool(project, settings, turnId, controller.signal)];
		for await (const e of engine.run({ cwd: project.folder, systemPrompt: mainSystemPrompt(project, files, settings.styleNote), model: settings.model, effort: settings.effort, input: userText, resume, tools, signal: controller.signal, label: `turn ${turnId}` })) {
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
					if (controller.signal.reason instanceof TurnTimeout) assistant.error = controller.signal.reason.message;
					else if (controller.signal.aborted) assistant.aborted = true;
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
		assistant.error = controller.signal.reason instanceof TurnTimeout ? controller.signal.reason.message : error instanceof Error ? error.message : String(error);
	}
	// An engine that ends with "done" after the ceiling fired still reports the limit.
	if (controller.signal.reason instanceof TurnTimeout && !assistant.error) assistant.error = controller.signal.reason.message;
	assistant.usage = usage;
	try {
		if (comments.length) closeSentComments(project, turnId, assistant.error ? `The turn failed: ${assistant.error}` : assistant.aborted ? "The turn was stopped before this was addressed." : "Handled in this turn (the agent left no note).");
		if (hasSnapshot(project, turnId)) {
			// "Backup before editing" copies go first, so they never show up as added files.
			const removed = removeDuplicateCopies(project, turnId);
			if (removed.length) turn.removedCopies = removed;
			turn.changes = diffSinceSnapshot(project, turnId);
		} else turn.changes = [];
	} catch (error) {
		assistant.error ??= `After the run: ${error instanceof Error ? error.message : String(error)}`;
	}
	turn.endedAt = Date.now();
	save(true);
	try {
		if (turn.changes.length > 0 || !assistant.error) {
			turn.compile = await compile(project);
			save(true);
		}
		pruneSnapshots(project);
	} catch (error) {
		console.error(`[turn ${turnId}] after-run step failed:`, error);
	}
	publish(project.id, { type: "turn_end", turnId, turn });
	return turn;
}
