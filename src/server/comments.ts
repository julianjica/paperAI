import { nanoid } from "nanoid";
import type { Comment, Project } from "../core/types.ts";
import { publish } from "./bus.ts";
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

export function resolveComment(project: Project, id: string, resolution: string): boolean {
	return !!updateComment(project, id, { status: "resolved", resolution });
}

/** At the end of a turn, comments it carried that the agent never resolved are closed with a note. */
export function closeSentComments(project: Project, turnId: string, note: string): number {
	const comments = listComments(project);
	let n = 0;
	for (const c of comments) {
		if (c.status === "sent" && c.turnId === turnId) {
			c.status = "resolved";
			c.resolution = note;
			n++;
		}
	}
	if (n) save(project, comments);
	return n;
}
