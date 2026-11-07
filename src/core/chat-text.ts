/**
 * Prepares an agent reply for the markdown renderer.
 *
 * 1. `<` followed by a non-space (`Σ_{j<k}`, `a<b`) would open an HTML tag
 *    and swallow the rest of the message; a space is inserted after it. KaTeX
 *    reads `j< k` exactly as `j<k`, so math is unaffected.
 * 2. `\(...\)` becomes `$...$` and `\[...\]` becomes `$$...$$`, the
 *    delimiters the math plugin understands.
 *
 * Fenced code blocks and inline code spans are left verbatim. The transform
 * is a single linear scan, safe to run on every streamed chunk (an unclosed
 * delimiter is left as is and completes on a later render).
 */
export function prepareChatMarkdown(text: string): string {
	const out: string[] = [];
	let i = 0;
	const n = text.length;
	while (i < n) {
		const ch = text[i];
		// Fenced code block at line start: copy to the closing fence.
		if ((i === 0 || text[i - 1] === "\n") && (text.startsWith("```", i) || text.startsWith("~~~", i))) {
			const fence = text.slice(i, i + 3);
			const close = text.indexOf(`\n${fence}`, i + 3);
			const end = close === -1 ? n : Math.min(n, text.indexOf("\n", close + 1) === -1 ? n : text.indexOf("\n", close + 1) + 1);
			out.push(text.slice(i, end));
			i = end;
			continue;
		}
		// Inline code: copy to the matching backtick run.
		if (ch === "`") {
			let run = 0;
			while (text[i + run] === "`") run++;
			const ticks = "`".repeat(run);
			const close = text.indexOf(ticks, i + run);
			const end = close === -1 ? n : close + run;
			out.push(text.slice(i, end));
			i = end;
			continue;
		}
		if (ch === "\\" && !escaped(text, i)) {
			const next = text[i + 1];
			if (next === "(" || next === "[") {
				const closer = next === "(" ? "\\)" : "\\]";
				const close = findClose(text, i + 2, closer);
				if (close !== -1) {
					const body = guardAngles(text.slice(i + 2, close).trim());
					out.push(next === "(" ? `$${body}$` : `\n$$\n${body}\n$$\n`);
					i = close + 2;
					continue;
				}
			}
		}
		if (ch === "<") {
			const next = text[i + 1];
			out.push(next !== undefined && next !== " " && next !== "\n" && next !== "<" ? "< " : "<");
			i++;
			continue;
		}
		out.push(ch);
		i++;
	}
	return out.join("");
}

function escaped(text: string, i: number): boolean {
	let count = 0;
	for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) count++;
	return count % 2 === 1;
}

function findClose(text: string, from: number, closer: string): number {
	for (let j = from; j < text.length - 1; j++) {
		if (text[j] === "`") return -1;
		if (text[j] === "\\" && text[j + 1] === closer[1] && !escaped(text, j)) return j;
	}
	return -1;
}

/** `<` followed by a non-space would open an HTML tag; a space keeps the meaning. */
function guardAngles(text: string): string {
	return text.replace(/<(?=[^\s<])/g, "< ");
}
