import { test } from "node:test";
import assert from "node:assert/strict";
import { makePaper } from "./helpers.ts";
import { writeChat } from "../src/server/chat.ts";
import { renderCommentBatch } from "../src/core/comments.ts";
import { addComment, closeStaleSent, listComments, replyToComment, resolveComment, sendPending, deleteComment, updateComment } from "../src/server/comments.ts";

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

test("comment threads: resolve notes, author replies reopen, the batch renders the history", () => {
	const { project } = makePaper();
	const a = addComment(project, { rects: [], page: 2, quote: "the  lemma", file: "main.tex", line: 5, text: "tighten this" });
	// A comment without a thread renders exactly as before.
	assert.equal(renderCommentBatch([a]).split("\n").slice(2).join("\n"), '1. [comment ' + a.id + '] at main.tex:5\n   Highlighted: "the lemma"\n   Request: tighten this');
	sendPending(project, "t1");
	resolveComment(project, a.id, "Shortened the proof.");
	let c = listComments(project)[0];
	assert.equal(c.status, "resolved");
	assert.equal(c.resolution, "Shortened the proof.");
	assert.deepEqual(c.thread?.map((e) => [e.role, e.text]), [["agent", "Shortened the proof."]]);
	// The author's reply reopens the comment for the next batch.
	const replied = replyToComment(project, a.id, "Still too long, cut the second case.");
	assert.equal(replied?.status, "pending");
	assert.equal(replied?.turnId, undefined);
	assert.equal(replyToComment(project, "nope", "x"), undefined);
	c = listComments(project)[0];
	assert.equal(c.status, "pending");
	assert.equal(c.text, "tighten this");
	assert.deepEqual(c.thread?.map((e) => e.role), ["agent", "author"]);
	assert.deepEqual(sendPending(project, "t2").map((x) => x.id), [a.id]);
	// The agent sees the whole exchange and the last reply as the thing to act on.
	const text = renderCommentBatch(listComments(project));
	assert.match(text, /follow-up on a passage you already edited/);
	assert.match(text, /\[comment [^\]]+\] at main\.tex:5 \(follow-up\)/);
	const idx = (s: string) => text.indexOf(s);
	assert.ok(idx("Original request: tighten this") > 0);
	assert.ok(idx("You replied: Shortened the proof.") > idx("Original request:"));
	assert.ok(idx("Request now (the author's reply): Still too long, cut the second case.") > idx("You replied:"));
	assert.doesNotMatch(text, /^ {3}Request: /m);
	// A second round appends in order and the fallback closer also notes on the thread.
	resolveComment(project, a.id, "Cut it.");
	replyToComment(project, a.id, "Thanks, one more pass.");
	assert.deepEqual(listComments(project)[0].thread?.map((e) => e.role), ["agent", "author", "agent", "author"]);
	const round = renderCommentBatch(listComments(project));
	assert.match(round, /The author replied: Still too long/);
	assert.match(round, /Request now \(the author's reply\): Thanks, one more pass\./);
	// Reopened without a new reply (the PATCH route): the original request stands again.
	resolveComment(project, a.id, "Done.");
	updateComment(project, a.id, { status: "pending", resolution: undefined, turnId: undefined });
	assert.match(renderCommentBatch(listComments(project)), /Request now: the author reopened this comment/);
	// An old comment without `thread` still reads and resolves.
	const b = addComment(project, { rects: [], page: 1, quote: "q", file: null, line: null, text: "old style" });
	assert.equal(listComments(project).find((x) => x.id === b.id)?.thread, undefined);
	assert.match(renderCommentBatch([{ ...b, resolution: "earlier note" }]), /Request: old style/);
	// A reply on a comment never sent is an addition, not a follow-up: the agent has edited nothing yet.
	replyToComment(project, b.id, "and fix the citation");
	const fresh = renderCommentBatch([listComments(project).find((x) => x.id === b.id)!]);
	assert.doesNotMatch(fresh, /follow-up|already edited/);
	assert.match(fresh, /Request: old style\n {3}The author added: and fix the citation/);
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
