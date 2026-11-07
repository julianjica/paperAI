import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSynctexEdit } from "../src/core/synctex.ts";
import { extractLatexErrors, isManuscriptFile } from "../src/core/manuscript.ts";
import { renderCommentBatch } from "../src/core/comments.ts";
import { validateTasks } from "../src/server/tools.ts";

test("parseSynctexEdit reads the first Input/Line pair", () => {
	const out = "This is SyncTeX\nSyncTeX result begin\nOutput:x.pdf\nInput:/a/b/sections/results.tex\nLine:13\nColumn:-1\nInput:/a/b/other.tex\nLine:99\nSyncTeX result end\n";
	assert.deepEqual(parseSynctexEdit(out), { file: "/a/b/sections/results.tex", line: 13 });
	assert.equal(parseSynctexEdit("nothing"), null);
});

test("extractLatexErrors picks ! lines with their l.N and undefined refs", () => {
	const log = "foo\n! Undefined control sequence.\nl.12 \\foo\n   bar\nLaTeX Warning: Reference `x' on page 1 undefined on input line 3.\n";
	assert.deepEqual(extractLatexErrors(log), ["Undefined control sequence. (line 12: \\foo)", "Reference `x' on page 1 undefined on input line 3."]);
});

test("isManuscriptFile", () => {
	assert.equal(isManuscriptFile("sections/a.tex"), true);
	assert.equal(isManuscriptFile("refs.bib"), true);
	assert.equal(isManuscriptFile("fig.png"), false);
});

test("renderCommentBatch numbers comments with anchors and quotes", () => {
	const text = renderCommentBatch([
		{ id: "a1", createdAt: 0, rects: [], page: 2, quote: "The  intuition\nis simple.", file: "sections/results.tex", line: 13, text: "Expand.", status: "sent" },
		{ id: "b2", createdAt: 0, rects: [], page: 3, quote: "x", file: null, line: null, text: "Fix.", status: "sent" },
	]);
	assert.match(text, /1\. \[comment a1\] at sections\/results\.tex:13/);
	assert.match(text, /Highlighted: "The intuition is simple\."/);
	assert.match(text, /2\. \[comment b2\] at page 3/);
	assert.equal(renderCommentBatch([]), "");
});

test("validateTasks rejects shared files, unknown files and empty batches", () => {
	const files = ["main.tex", "sections/a.tex", "sections/b.tex"];
	assert.equal(validateTasks([], files), "No tasks given.");
	assert.equal(validateTasks([{ title: "t", instructions: "i", files: ["sections/a.tex"] }], files), null);
	assert.match(validateTasks([{ title: "t", instructions: "i", files: ["nope.tex"] }], files)!, /not a manuscript file/);
	assert.match(validateTasks([{ title: "t1", instructions: "i", files: ["sections/a.tex"] }, { title: "t2", instructions: "i", files: ["./sections/a.tex"] }], files)!, /both edit/);
	assert.match(validateTasks([{ title: "t", instructions: "i", files: [] }], files)!, /names no files/);
});

test("prepareChatMarkdown guards < and converts backslash math delimiters, leaving code alone", async () => {
	const { prepareChatMarkdown } = await import("../src/core/chat-text.ts");
	assert.equal(prepareChatMarkdown("so $\\sum_{j<k} a_j$ and x<y hold"), "so $\\sum_{j< k} a_j$ and x< y hold");
	assert.equal(prepareChatMarkdown("a < b stays"), "a < b stays");
	assert.equal(prepareChatMarkdown("`a<b` and ```\nx<y\n``` then c<d"), "`a<b` and ```\nx<y\n``` then c< d");
	assert.equal(prepareChatMarkdown("inline \\(a_i<b\\) here"), "inline $a_i< b$ here");
	assert.equal(prepareChatMarkdown("display \\[\\Pi = \\sum v_i\\] end"), "display \n$$\n\\Pi = \\sum v_i\n$$\n end");
	assert.equal(prepareChatMarkdown("unclosed \\(a + b"), "unclosed \\(a + b");
	assert.equal(prepareChatMarkdown("literal \\\\(not math)"), "literal \\\\(not math)");
});
