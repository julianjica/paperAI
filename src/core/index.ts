export type * from "./types.ts";
export { renderCommentBatch } from "./comments.ts";
export { parseSynctexEdit } from "./synctex.ts";
export { isManuscriptFile, extractLatexErrors } from "./manuscript.ts";
export { prepareChatMarkdown } from "./chat-text.ts";
export { findTells, addedLines, formatTells, AI_VOCABULARY } from "./tells.ts";
export type { Tell, TellKind } from "./tells.ts";
export { renderAttachmentBlock, ATTACHMENT_INLINE_CAP, type AttachmentForPrompt } from "./attachments.ts";
