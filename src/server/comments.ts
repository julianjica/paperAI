import { nanoid } from "nanoid";
import type { Comment, Project } from "../core/types.ts";
import { publish } from "./bus.ts";
import { readChat } from "./chat.ts";
import { readJson, writeJson } from "./fsjson.ts";
import { sidecar } from "./projects.ts";

const file = (p: Project) => sidecar(p, "comments.json");

export function listComments(project: Project): Comment[] {
	return readJson<Comment[]>(file(project), []);
}

function save(project: Project, comments: Comment[]) {
	writeJson(file(project), comments);
	publish(project.id, { type: "comments", comments });
}

export function addComment(project: Project, input: Omit<Comment, "id" | "createdAt" | "status">): Comment {
	const comments = listComments(project);
	const c: Comment = { ...input, id: nanoid(8), createdAt: Date.now(), status: "pending" };
	comments.push(c);
	save(project, comments);
	return c;
}

export function updateComment(project: Project, id: string, patch: Partial<Comment>): Comment | undefined {
	const comments = listComments(project);
	const c = comments.find((x) => x.id === id);
	if (!c) return undefined;
	Object.assign(c, patch);
	save(project, comments);
	return c;
}

export function deleteComment(project: Project, id: string): void {
	save(project, listComments(project).filter((c) => c.id !== id));
}

/** Mark every pending comment as sent in `turnId` and return them. */
export function sendPending(project: Project, turnId: string): Comment[] {
	const comments = listComments(project);
	const sent = comments.filter((c) => c.status === "pending");
	for (const c of sent) {
		c.status = "sent";
		c.turnId = turnId;
	}
	if (sent.length) save(project, comments);
	return sent;
}

/**
 * Close a comment with a note. The note goes both into `resolution` (what old
 * clients read) and onto the thread as an agent entry, so a follow-up shows
 * the whole exchange in order, including notes left by the fallback closers.
 */
function close(c: Comment, note: string) {
	c.status = "resolved";
	c.resolution = note;
	(c.thread ??= []).push({ role: "agent", text: note, at: Date.now() });
}

export function resolveComment(project: Project, id: string, resolution: string): boolean {
	const comments = listComments(project);
	const c = comments.find((x) => x.id === id);
	if (!c) return false;
	close(c, resolution);
	save(project, comments);
	return true;
}

/**
 * The author answers the agent's note (or adds to the request). The comment
 * goes back to pending so it rides with the next batch as a follow-up.
 */
export function replyToComment(project: Project, id: string, text: string): Comment | undefined {
	const comments = listComments(project);
	const c = comments.find((x) => x.id === id);
	if (!c) return undefined;
	(c.thread ??= []).push({ role: "author", text, at: Date.now() });
	c.status = "pending";
	delete c.turnId;
	save(project, comments);
	return c;
}

/** At the end of a turn, comments it carried that the agent never resolved are closed with a note. */
export function closeSentComments(project: Project, turnId: string, note: string): number {
	const comments = listComments(project);
	let n = 0;
	for (const c of comments) {
		if (c.status === "sent" && c.turnId === turnId) {
			close(c, note);
			n++;
		}
	}
	if (n) save(project, comments);
	return n;
}

/**
 * Comments still marked "sent" whose turn is over are stale: their turn ended
 * without the agent resolving them. Close them with a note so they land in
 * Resolved instead of hanging between the groups. "Over" is read from the
 * chat record (the turn has endedAt), not only from memory, so a turn that is
 * still streaming is never closed under it; a turn with no end that is not
 * running and is hours old (a crashed server) counts as over too.
 */
export function closeStaleSent(project: Project, runningTurnId: string | undefined): number {
	const comments = listComments(project);
	if (!comments.some((c) => c.status === "sent")) return 0;
	const turns = new Map(readChat(project).turns.map((t) => [t.id, t]));
	const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
	let n = 0;
	for (const c of comments) {
		if (c.status !== "sent") continue;
		if (c.turnId === runningTurnId) continue;
		const turn = c.turnId ? turns.get(c.turnId) : undefined;
		const over = !turn || !!turn.endedAt || Date.now() - turn.startedAt > STALE_AFTER_MS;
		if (!over) continue;
		close(c, "The turn ended without a note from the agent.");
		n++;
	}
	if (n) save(project, comments);
	return n;
}
