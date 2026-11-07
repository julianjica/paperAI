import type { ChatMessage, Project, TurnRecord } from "../core/types.ts";
import { readJson, writeJson } from "./fsjson.ts";
import { sidecar } from "./projects.ts";

/** The chat record for one project: messages, turns and the engine session to resume. */
export interface ChatRecord {
	messages: ChatMessage[];
	turns: TurnRecord[];
	session?: { engine: string; id: string };
}

const file = (p: Project) => sidecar(p, "chat.json");

export function readChat(project: Project): ChatRecord {
	return readJson<ChatRecord>(file(project), { messages: [], turns: [] });
}

export function writeChat(project: Project, record: ChatRecord): void {
	writeJson(file(project), record);
}

export function resetChat(project: Project): void {
	writeChat(project, { messages: [], turns: [] });
}
