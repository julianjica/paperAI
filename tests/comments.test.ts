import { test } from "node:test";
import assert from "node:assert/strict";
import { makePaper } from "./helpers.ts";
import { writeChat } from "../src/server/chat.ts";
import { addComment, closeStaleSent, listComments, resolveComment, sendPending, deleteComment } from "../src/server/comments.ts";

test("comments: add → send batch → resolve", () => {
	const { project } = makePaper();
	const a = addComment(project, { rects: [], page: 1, quote: "q", file: "main.tex", line: 2, text: "fix" });
	const b = addComment(project, { rects: [], page: 1, quote: "r", file: null, line: null, text: "also" });
	assert.equal(listComments(project).length, 2);
	assert.equal(a.status, "pending");
	const sent = sendPending(project, "turn1");
	assert.deepEqual(sent.map((c) => c.id), [a.id, b.id]);
	assert.ok(listComments(project).every((c) => c.status === "sent" && c.turnId === "turn1"));
	assert.equal(sendPending(project, "turn2").length, 0);
	assert.equal(resolveComment(project, a.id, "done"), true);
	assert.equal(resolveComment(project, "nope", "x"), false);
	const after = listComments(project);
	assert.equal(after.find((c) => c.id === a.id)?.resolution, "done");
	deleteComment(project, b.id);
	assert.equal(listComments(project).length, 1);
});

test("stale sent comments are closed; a turn still streaming keeps its comments", () => {
	const { project } = makePaper();
	// An ended turn and a turn with no end yet, as the chat record would hold them.
	writeChat(project, { messages: [], turns: [{ id: "old-turn", startedAt: Date.now() - 1000, endedAt: Date.now(), changes: [] }, { id: "live-turn", startedAt: Date.now(), changes: [] }] });
	addComment(project, { rects: [], page: 1, quote: "a", file: null, line: null, text: "old" });
	sendPending(project, "old-turn");
	addComment(project, { rects: [], page: 1, quote: "b", file: null, line: null, text: "live" });
	sendPending(project, "live-turn");
	// Even with no running turn known in memory (a module reload), the live turn's comments are kept.
	assert.equal(closeStaleSent(project, undefined), 1);
	const byText = Object.fromEntries(listComments(project).map((c) => [c.text, c]));
	assert.equal(byText.old.status, "resolved");
	assert.match(byText.old.resolution ?? "", /ended without a note/);
	assert.equal(byText.live.status, "sent");
	// A comment whose turn is unknown to the record is stale.
	addComment(project, { rects: [], page: 1, quote: "c", file: null, line: null, text: "orphan" });
	sendPending(project, "never-recorded");
	assert.equal(closeStaleSent(project, undefined), 1);
	assert.equal(listComments(project).find((c) => c.text === "orphan")?.status, "resolved");
});
