import type { Comment } from "./types.ts";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** A comment the agent already answered once: its thread holds an agent note. */
const isFollowUp = (c: Comment) => !!c.thread?.some((e) => e.role === "agent");

/** Render a batch of comments as the block the agent receives. */
export function renderCommentBatch(comments: Comment[]): string {
	if (comments.length === 0) return "";
	const lines = ["The author left these comments on the rendered PDF. Address every one, then call resolve_comment for each with a short note of what you did."];
	// Only a batch with a follow-up gets the extra instruction, so plain batches read as before.
	if (comments.some(isFollowUp)) {
		lines.push("A comment with history is a follow-up on a passage you already edited: the highlight and line are from before your edit, so read the passage as it now stands, then act on the author's latest reply.");
	}
	lines.push("");
	comments.forEach((c, i) => {
		const where = c.file ? `${c.file}:${c.line}` : `page ${c.page}`;
		const thread = c.thread ?? [];
		const followUp = isFollowUp(c);
		lines.push(`${i + 1}. [comment ${c.id}] at ${where}${followUp ? " (follow-up)" : ""}`);
		lines.push(`   Highlighted: "${oneLine(c.quote)}"`);
		if (!followUp) {
			// Never answered yet: the original request, plus anything the author added before sending.
			lines.push(`   Request: ${c.text.trim()}`);
			for (const e of thread) lines.push(`   The author added: ${e.text.trim()}`);
			return;
		}
		lines.push(`   Original request: ${c.text.trim()}`);
		const last = thread[thread.length - 1];
		thread.forEach((e, j) => {
			if (e.role === "agent") lines.push(`   You replied: ${e.text.trim()}`);
			else if (j === thread.length - 1) lines.push(`   Request now (the author's reply): ${e.text.trim()}`);
			else lines.push(`   The author replied: ${e.text.trim()}`);
		});
		// Reopened without a new reply: the original request stands again.
		if (last.role === "agent") lines.push("   Request now: the author reopened this comment; address the original request again.");
	});
	return lines.join("\n");
}
