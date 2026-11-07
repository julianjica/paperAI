import type { Comment } from "./types.ts";

/** Render a batch of comments as the block the agent receives. */
export function renderCommentBatch(comments: Comment[]): string {
	if (comments.length === 0) return "";
	const lines = ["The author left these comments on the rendered PDF. Address every one, then call resolve_comment for each with a short note of what you did.", ""];
	comments.forEach((c, i) => {
		const where = c.file ? `${c.file}:${c.line}` : `page ${c.page}`;
		lines.push(`${i + 1}. [comment ${c.id}] at ${where}`);
		lines.push(`   Highlighted: "${c.quote.replace(/\s+/g, " ").trim()}"`);
		lines.push(`   Request: ${c.text.trim()}`);
	});
	return lines.join("\n");
}
