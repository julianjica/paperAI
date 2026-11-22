import { test } from "node:test";
import assert from "node:assert/strict";
import { addedLines, findTells } from "../src/core/tells.ts";

const kinds = (text: string, allow?: string[]) => findTells(text, { allow, noUniformity: true }).map((t) => `${t.line}:${t.kind}`);

test("findTells flags model vocabulary, signposts, copula avoidance and parallelisms, with line numbers", () => {
	const text = ["\\section{Results}", "The result underscores the pivotal role of $\\alpha$.", "", "Moreover, the firm serves as a focal point.", "This is not only a matter of cost but also of timing."].join("\n");
	const got = kinds(text);
	assert.ok(got.includes("2:vocabulary"), got.join());
	assert.ok(got.includes("4:signpost"), got.join());
	assert.ok(got.includes("4:copula"), got.join());
	assert.ok(got.includes("4:significance"), got.join());
	assert.ok(got.includes("5:parallelism"), got.join());
});

test("findTells flags trailing participial clauses, disclaimers, vague attributions without a citation, summaries and chat leftovers", () => {
	const text = [
		"Profit falls in $k$, highlighting the cost of delegation.",
		"It is important to note that the bound is tight.",
		"Scholars have long argued that attention is scarce.",
		"Scholars have long argued that attention is scarce \\citep{simon1947}.",
		"In summary, the model predicts delegation.",
		"Here is the revised paragraph.",
	].join("\n\n");
	const got = kinds(text);
	assert.ok(got.includes("1:participle"), got.join());
	assert.ok(got.includes("3:hedge"), got.join());
	assert.ok(got.includes("5:attribution"), got.join());
	assert.ok(!got.includes("7:attribution"), "a cited sentence is not a vague attribution: " + got.join());
	assert.ok(got.includes("9:summary"), got.join());
	assert.ok(got.includes("11:chat"), got.join());
});

test("findTells skips comments and math, honours the paper's own terms, and flags curly quotes and Unicode dashes", () => {
	assert.deepEqual(kinds("% a robust comment about the tapestry\nThe estimate is $\\text{robust}$."), []);
	assert.deepEqual(kinds("The robust estimator of \\citet{huber} is used.", ["robust"]), []);
	assert.deepEqual(kinds("The robust estimator is used."), ["1:vocabulary"]);
	const got = kinds("She said “no” — twice.");
	assert.ok(got.includes("1:quotes") && got.includes("1:dash"), got.join());
});

test("findTells reports a run of sentences of equal length", () => {
	const uniform = "The firm sets the price in the first period. The rival observes the price and then responds. The regulator then decides whether to intervene. The consumers buy from the cheaper seller. The outcome is the same in every period.";
	assert.deepEqual(findTells(uniform).map((t) => t.kind), ["uniform"]);
	const varied = "The firm sets the price. The rival, having observed it, responds in the second period with a price of its own, and only then does the regulator decide. Consumers buy from the cheaper seller. Nothing else happens. The outcome repeats.";
	assert.deepEqual(findTells(varied).map((t) => t.kind), []);
});

test("addedLines maps + lines of a unified diff to new-file line numbers", () => {
	const diff = ["--- a", "+++ b", "@@ -1,3 +1,4 @@", " keep", "-old", "+new one", "+new two", " keep", "@@ -10,1 +11,2 @@", " ctx", "+late"].join("\n");
	assert.deepEqual(addedLines(diff), [
		{ line: 2, text: "new one" },
		{ line: 3, text: "new two" },
		{ line: 12, text: "late" },
	]);
});

import { makePaper } from "./helpers.ts";
import fs from "node:fs";
import path from "node:path";
import { checkProseTool } from "../src/server/tools.ts";
import { scanChanges } from "../src/server/prose.ts";
import { diffSinceSnapshot, takeSnapshot } from "../src/server/snapshots.ts";

test("check_prose scans a file, does not flag words the author's text already used, and the turn-end scan maps hits to file lines", async () => {
	const { folder, project } = makePaper();
	// The author's own text uses "robust" as a term: it must not be flagged, before or after the edit.
	fs.writeFileSync(path.join(folder, "sections/intro.tex"), "\\section{Intro}\nThe robust estimator is standard.\n");
	takeSnapshot(project, "tp");
	fs.appendFileSync(path.join(folder, "sections/intro.tex"), "\nMoreover, the result underscores a robust and pivotal shift, highlighting the role of timing.\n");
	const tool = checkProseTool(project, "tp");
	const r = await tool.handler({ file: "sections/intro.tex" });
	assert.ok(!r.isError);
	assert.match(r.text, /signpost/);
	assert.match(r.text, /"underscores"/);
	assert.ok(!/"robust"/.test(r.text), r.text);
	assert.match(r.text, /participle/);
	const bad = await tool.handler({ file: "../x.tex" });
	assert.ok(bad.isError);
	const tells = scanChanges(project, "tp", diffSinceSnapshot(project, "tp"));
	assert.ok(tells.length >= 3, JSON.stringify(tells));
	assert.ok(tells.every((t) => t.file === "sections/intro.tex" && t.line === 4), JSON.stringify(tells));
	assert.ok(!tells.some((t) => t.match === "robust"));
});
