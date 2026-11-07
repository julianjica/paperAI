import { test } from "node:test";
import assert from "node:assert/strict";
import { makePaper } from "./helpers.ts";
import { addComment, listComments, resolveComment, sendPending, deleteComment } from "../src/server/comments.ts";

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
