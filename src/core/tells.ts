/**
 * Signs of generated prose, as a referee or an automated detector would see
 * them: the regularities and the vocabulary that mark text written by a
 * language model rather than by the author. The inventory follows the
 * published field guides to AI writing (overused vocabulary by model era,
 * avoidance of plain copulas, negative parallelisms, trailing participial
 * "significance" clauses, hedging disclaimers, vague attributions, section
 * summaries, chat leftovers, uniform sentence length, formatting habits).
 *
 * Pure: takes text, returns findings. The server runs it on edited files
 * (the check_prose tool) and on each turn's added lines.
 */
export interface Tell {
	/** 1-based line in the text given. */
	line: number;
	kind: TellKind;
	/** The matched text. */
	match: string;
	/** What to do instead. */
	advice: string;
}

export type TellKind = "vocabulary" | "signpost" | "copula" | "parallelism" | "participle" | "hedge" | "significance" | "attribution" | "summary" | "chat" | "quotes" | "dash" | "uniform";

/** Words that language models overuse, across model generations. Case-insensitive, whole words. */
export const AI_VOCABULARY = [
	"delve", "delves", "delving", "tapestry", "testament", "underscore", "underscores", "underscored", "underscoring", "pivotal", "crucial", "crucially", "vibrant", "showcase", "showcases", "showcasing", "boasts", "bolster", "bolstered", "bolsters", "garner", "garnered", "garners", "meticulous", "meticulously", "intricate", "intricacies", "interplay", "landscape", "realm", "multifaceted", "holistic", "nuanced", "seamless", "seamlessly", "leverage", "leverages", "leveraging", "leveraged", "foster", "fosters", "fostering", "fostered", "enhance", "enhances", "enhancing", "enhanced", "enduring", "emphasizing", "emphasising", "highlighting", "valuable", "insightful", "navigate", "navigating", "unlock", "unlocks", "unlocking", "groundbreaking", "renowned", "profound", "robust", "dependable", "echoed", "echoes", "prioritize", "prioritizes", "prioritise", "quietly", "steady", "universally", "streamline", "streamlined", "deep dive", "align with", "aligns with", "resonate with", "resonates with", "diverse array", "rich set", "commitment to", "evolving landscape", "indelible", "deeply rooted", "beacon", "cornerstone", "game-changer", "paradigm shift", "synergy", "synergies", "comprehensive", "transformative", "myriad",
];

/** Patterns beyond single words. Each has the kind, a regex (global, case-insensitive) and the advice. */
const PATTERNS: { kind: TellKind; re: RegExp; advice: string }[] = [
	{ kind: "signpost", re: /(?:^|[.;:!?]\s+|\n)\s*(Additionally|Moreover|Furthermore|Importantly|Notably|Crucially|Interestingly|Ultimately|In essence|Overall|Essentially|Significantly)\b,?/g, advice: "Sentence-opening connective: start with the subject, or use the author's own connective." },
	{ kind: "summary", re: /(?:^|[.;:!?]\s+|\n)\s*(In summary|In conclusion|To summarize|To summarise|To sum up|Taken together|All in all|In short)\b,?/g, advice: "Paragraph or section summary: delete; the paragraph already said it." },
	{ kind: "copula", re: /\b(serves?|stands?|functions?|operates?|acts?) as (an?|the)\b/gi, advice: "Avoided copula: write 'is', 'has' or 'there is'." },
	{ kind: "copula", re: /\b(marks?|represents?) a (significant |major |key |pivotal |fundamental |notable )?(shift|turning point|departure|milestone)\b/gi, advice: "Significance phrasing in place of a plain statement: say what changed." },
	{ kind: "parallelism", re: /\bnot (only|just|merely|simply|solely)\b[^.;:]{0,100}\b(but|it is|it's|it)\b/gi, advice: "Negative parallelism ('not only X but also Y'): state X and Y as two plain claims, or drop one." },
	{ kind: "parallelism", re: /\b(is|are|was|were|isn't|aren't|wasn't|weren't)\s+not\s+(?:a|an|the|about|merely|simply)?\s*[^.;:,]{1,60},?\s+(but|rather)\b/gi, advice: "'Not X, but Y': say Y." },
	{ kind: "parallelism", re: /(?:^|[.;:!?]\s+|\n)\s*Rather than\b/g, advice: "Corrective framing ('Rather than X, Y'): state Y; mention X only if the paper needs the contrast." },
	{ kind: "participle", re: /,\s*(highlighting|underscoring|emphasizing|emphasising|reflecting|symbolizing|ensuring|contributing to|fostering|enhancing|showcasing|demonstrating|illustrating|reinforcing|shaping|signaling|signalling|cementing|solidifying|paving the way|setting the stage|offering (?:a |an |valuable )?(?:insight|glimpse|perspective)s?|providing (?:a |an |valuable )?(?:insight|perspective|framework)s?|making it (?:a |an )?[a-z]+)\b[^.\n]{0,160}[.?!](?=\s|$)/gi, advice: "Trailing participial clause that explains the significance of what was just said: cut it, or make the point its own sentence with its own evidence." },
	{ kind: "hedge", re: /\bit (is|'s) (important|worth|crucial|essential|vital|useful|helpful) to (note|remember|recognize|recognise|emphasize|emphasise|highlight|mention|point out|bear in mind|keep in mind)\b/gi, advice: "Didactic disclaimer: delete the frame and state the fact." },
	{ kind: "hedge", re: /\bshould (be|not be) (treated|understood|read|seen|interpreted|viewed|regarded|considered) as\b/gi, advice: "Corrective framing about how a claim should be read: state the claim with its condition." },
	{ kind: "hedge", re: /\b(does|do|did) not (by itself|on its own|in itself|alone) (establish|imply|prove|mean|show)\b/gi, advice: "Disclaimer about what the evidence does not establish: say what it does." },
	{ kind: "hedge", re: /\bshould not be confused with\b/gi, advice: "Disambiguation disclaimer: define the term and move on." },
	{ kind: "hedge", re: /\b(may|might|could) (potentially|possibly|perhaps|conceivably)\b/gi, advice: "Stacked hedge: one modal, or the condition under which the claim holds." },
	{ kind: "significance", re: /\bplays? (an? )?(crucial|pivotal|vital|significant|key|central|critical|essential|important|fundamental) role\b/gi, advice: "Role puffery: say what the thing does." },
	{ kind: "significance", re: /\b(sheds?|shedding) (new )?light on\b|\bpaves? the way\b|\bsets? the stage\b|\b(key|pivotal|major) turning point\b|\bevolving landscape\b|\bindelible mark\b|\bdeeply rooted\b|\bfocal point\b|\b(is|are|was|were) a testament to\b|\bbroader (implications|trends|context|narrative)\b|\bin today's\b/gi, advice: "Significance cliché: delete, or replace with the specific consequence." },
	{ kind: "significance", re: /\b(significantly|fundamentally|dramatically|greatly|substantially) (enhances?|transforms?|improves?|reshapes?|advances?|contributes?)\b/gi, advice: "Inflated verb phrase: state the magnitude or drop the adverb." },
	{ kind: "attribution", re: /\b(scholars|researchers|experts|observers|critics|economists|practitioners|the literature|many studies|several studies|a growing (body of )?literature|prior work|extant research) (have|has|had)? ?(long |often |widely |increasingly |repeatedly )?(argued|argues|noted|notes|shown|shows|suggested|suggests|recognized|recognised|emphasized|emphasised|documented|documents|observed|observes|found|finds|highlighted|highlights|established|pointed out)\b/gi, advice: "Vague attribution without a citation in the sentence: name the work (\\cite) or make the claim your own." },
	{ kind: "chat", re: /(?:^|\n)\s*(Here is|Here's|I hope this helps|Certainly|Of course|Would you like|Let me know|Feel free to|Note:|Note that I|As an AI|As a language model)\b/g, advice: "Chat leftover in the manuscript: delete." },
	{ kind: "quotes", re: /[“”‘’]/gi, advice: "Curly quote in LaTeX source: use `` '' and ` ' as the author does." },
	{ kind: "dash", re: /\s[—–]\s|—/gi, advice: "Unicode dash: LaTeX uses --- and --, and only where the author uses dashes." },
];

const vocabularyRe = new RegExp(`\\b(${AI_VOCABULARY.map((w) => w.replace(/[-\\/]/g, "\\$&")).join("|")})\\b`, "gi");

export interface FindTellsOptions {
	/** Words the paper itself uses as terms: never flagged (case-insensitive). */
	allow?: string[];
	/** Skip the uniform-sentence-length check (for fragments). */
	noUniformity?: boolean;
}

/**
 * Scan text (a .tex file or a set of added lines) and return every sign found,
 * in line order. Comments and the bodies of math are skipped.
 */
export function findTells(text: string, options: FindTellsOptions = {}): Tell[] {
	const allow = new Set((options.allow ?? []).map((w) => w.toLowerCase()));
	const lines = text.split("\n");
	const prose = lines.map(stripLatex);
	const tells: Tell[] = [];
	// Patterns can span a line break inside a paragraph, so match on paragraph text and map back to lines.
	for (const para of paragraphs(prose)) {
		const joined = para.lines.join("\n");
		const lineAt = (offset: number) => para.start + joined.slice(0, offset).split("\n").length;
		for (const m of joined.matchAll(vocabularyRe)) {
			if (allow.has(m[1].toLowerCase())) continue;
			tells.push({ line: lineAt(m.index), kind: "vocabulary", match: m[0], advice: "Model vocabulary: use the author's plain word (or keep it only if it is the paper's own term)." });
		}
		for (const p of PATTERNS) {
			for (const m of joined.matchAll(p.re)) {
				const match = m[0].replace(/^[.;:!?\s]+/, "").replace(/\s+/g, " ").trim();
				if (p.kind === "attribution" && /\\cite/.test(sentenceAround(joined, m.index))) continue;
				if (allow.has(match.toLowerCase())) continue;
				tells.push({ line: lineAt(m.index + (m[0].length - m[0].trimStart().length)), kind: p.kind, match: match.length > 90 ? `${match.slice(0, 87)}...` : match, advice: p.advice });
			}
		}
		if (!options.noUniformity) {
			const u = uniformity(joined);
			if (u) tells.push({ line: para.start, kind: "uniform", match: u, advice: "Sentences of nearly equal length in a row: vary them as the author does (a short one after two long ones, a subordinate clause first)." });
		}
	}
	return tells.sort((a, b) => a.line - b.line);
}

/** Remove what is not prose: comments, math, the arguments of structural commands. */
function stripLatex(line: string): string {
	let s = line.replace(/(^|[^\\])%.*$/, "$1");
	s = s.replace(/\$\$[^$]*\$\$/g, " ").replace(/\$[^$]*\$/g, " ").replace(/\\\[[\s\S]*?\\\]/g, " ").replace(/\\\([\s\S]*?\\\)/g, " ");
	s = s.replace(/\\(label|ref|eqref|cref|Cref|cite[pt]?|citeauthor|citeyear|input|include|includegraphics|usepackage|documentclass|begin|end|bibliography|bibliographystyle)\*?(\[[^\]]*\])?\{[^}]*\}/g, (m, cmd) => (/^cite/.test(cmd) ? "\\cite{}" : " "));
	return s;
}

function paragraphs(lines: string[]): { start: number; lines: string[] }[] {
	const out: { start: number; lines: string[] }[] = [];
	let cur: { start: number; lines: string[] } | null = null;
	lines.forEach((l, i) => {
		if (l.trim() === "") {
			if (cur) out.push(cur);
			cur = null;
		} else {
			if (!cur) cur = { start: i, lines: [] };
			cur.lines.push(l);
		}
	});
	if (cur) out.push(cur);
	return out;
}

function sentenceAround(text: string, index: number): string {
	const before = text.lastIndexOf(". ", index);
	const after = text.indexOf(". ", index);
	return text.slice(before < 0 ? 0 : before, after < 0 ? text.length : after);
}

/** Five or more consecutive sentences of nearly equal length (coefficient of variation under 0.2). */
function uniformity(para: string): string | null {
	const sentences = para
		.replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?/g, " ")
		.split(/(?<=[.?!])\s+(?=[A-Z])/)
		.map((s) => s.trim().split(/\s+/).filter(Boolean).length)
		.filter((n) => n >= 4);
	if (sentences.length < 5) return null;
	const mean = sentences.reduce((a, b) => a + b, 0) / sentences.length;
	const sd = Math.sqrt(sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / sentences.length);
	if (sd / mean >= 0.2) return null;
	return `${sentences.length} sentences of ${sentences.join(", ")} words`;
}

/** The added lines of a unified diff, with their line numbers in the new file. */
export function addedLines(diff: string): { line: number; text: string }[] {
	const out: { line: number; text: string }[] = [];
	let line = 0;
	for (const l of diff.split("\n")) {
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
		if (hunk) {
			line = Number(hunk[1]);
			continue;
		}
		if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("\\")) continue;
		if (l.startsWith("+")) out.push({ line, text: l.slice(1) });
		if (!l.startsWith("-")) line++;
	}
	return out;
}

/** Format tells for the agent or the author. */
export function formatTells(tells: Tell[], file?: string): string {
	return tells.map((t) => `${file ? `${file}:` : "line "}${t.line} [${t.kind}] "${t.match}" — ${t.advice}`).join("\n");
}
