import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { renderAttachmentBlock, type AttachmentForPrompt } from "../core/attachments.ts";
import type { Attachment, ChatMessage, Project, QueuedMessage } from "../core/types.ts";
import { readJson, writeJson } from "./fsjson.ts";
import { sidecar } from "./projects.ts";

/**
 * Documents dropped on the chat. Each lives under
 * data/projects/<id>/attachments/<aid>.{pdf,txt,json}: the bytes, the text
 * pdfjs extracts once at upload, and the metadata. Nothing goes into the
 * paper folder.
 */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
/** Below this many characters per page the document is treated as scanned. */
const SCANNED_CHARS_PER_PAGE = 25;

const dir = (p: Project) => sidecar(p, "attachments");
export const attachmentPdfPath = (p: Project, id: string) => path.join(dir(p), `${id}.pdf`);
export const attachmentTextPath = (p: Project, id: string) => path.join(dir(p), `${id}.txt`);
const metaPath = (p: Project, id: string) => path.join(dir(p), `${id}.json`);

/** Text of every page, pages separated by form feeds. Lines follow the PDF's text runs. */
export async function extractPdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	// pdfjs takes ownership of the buffer it is given (it is transferred to the worker and detached); hand it a copy.
	const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true, verbosity: 0 });
	const doc = await task.promise;
	try {
		const out: string[] = [];
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			let line = "";
			let lastY: number | null = null;
			const lines: string[] = [];
			for (const item of content.items) {
				if (!("str" in item)) continue;
				const y = item.transform[5] as number;
				if (lastY !== null && Math.abs(y - lastY) > 2) {
					lines.push(line.trimEnd());
					line = "";
				}
				line += item.str;
				if (item.hasEOL) {
					lines.push(line.trimEnd());
					line = "";
					lastY = null;
					continue;
				}
				lastY = y;
			}
			if (line.trim()) lines.push(line.trimEnd());
			out.push(lines.join("\n").replace(/\n{3,}/g, "\n\n"));
			page.cleanup();
		}
		return { pages: doc.numPages, text: out.join("\n\f\n") };
	} finally {
		await task.destroy();
	}
}

/** Store a dropped PDF and extract its text. Throws on anything that is not a PDF. */
export async function addAttachment(project: Project, name: string, bytes: Uint8Array): Promise<Attachment> {
	const size = bytes.length;
	if (size === 0) throw new Error("The file is empty.");
	if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`The file is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
	if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new Error("Only PDF files can be attached.");
	const clean = path.basename(name).replace(/[\u0000-\u001f]/g, "").trim() || "document.pdf";
	let extracted: { pages: number; text: string };
	try {
		extracted = await extractPdfText(bytes);
	} catch (error) {
		throw new Error(`Cannot read the PDF: ${error instanceof Error ? error.message : String(error)}`);
	}
	const id = nanoid(10);
	fs.mkdirSync(dir(project), { recursive: true });
	fs.writeFileSync(attachmentPdfPath(project, id), bytes);
	fs.writeFileSync(attachmentTextPath(project, id), extracted.text);
	const chars = extracted.text.replace(/\s+/g, "").length;
	const attachment: Attachment = { id, name: clean, size, pages: extracted.pages, chars, scanned: chars < SCANNED_CHARS_PER_PAGE * Math.max(1, extracted.pages), createdAt: Date.now() };
	writeJson(metaPath(project, id), attachment);
	return attachment;
}

export function getAttachment(project: Project, id: string): Attachment | undefined {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
	const meta = readJson<Attachment | null>(metaPath(project, id), null);
	return meta && fs.existsSync(attachmentPdfPath(project, id)) ? meta : undefined;
}

/** Every document attached to the project, oldest first. */
export function listAttachments(project: Project): Attachment[] {
	if (!fs.existsSync(dir(project))) return [];
	return fs
		.readdirSync(dir(project))
		.filter((f) => f.endsWith(".json"))
		.map((f) => getAttachment(project, f.slice(0, -5)))
		.filter((a): a is Attachment => a !== undefined)
		.sort((a, b) => a.createdAt - b.createdAt);
}

export function deleteAttachment(project: Project, id: string): boolean {
	if (!getAttachment(project, id)) return false;
	for (const f of [attachmentPdfPath(project, id), attachmentTextPath(project, id), metaPath(project, id)]) fs.rmSync(f, { force: true });
	return true;
}

/** A chat reset forgets the documents too: the agent's session starts over. */
export function deleteAllAttachments(project: Project): void {
	fs.rmSync(dir(project), { recursive: true, force: true });
}

/** Resolve ids to records; unknown ids are an error (the author would believe the agent saw the file). */
export function resolveAttachments(project: Project, ids: string[]): Attachment[] {
	return ids.map((id) => {
		const a = getAttachment(project, id);
		if (!a) throw new Error(`Attachment ${id} not found.`);
		return a;
	});
}

/** The block appended to the message for these attachments. */
export function attachmentBlock(project: Project, attachments: Attachment[]): string {
	const items: AttachmentForPrompt[] = attachments.map((a) => ({
		attachment: a,
		pdfPath: attachmentPdfPath(project, a.id),
		textPath: attachmentTextPath(project, a.id),
		text: a.scanned ? "" : readText(attachmentTextPath(project, a.id)),
	}));
	return renderAttachmentBlock(items);
}

function readText(file: string): string {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return "";
	}
}

/** The ids of the documents these messages carry. */
function referencedIds(messages: ChatMessage[], queued: QueuedMessage[] = []): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) if (m.role === "user") for (const a of m.attachments ?? []) ids.add(a.id);
	for (const q of queued) for (const a of q.attachments ?? []) ids.add(a.id);
	return ids;
}

/** Uploaded but not sent with any message yet (a reload lost the chips): shown again above the composer. */
export function unsentAttachments(project: Project, messages: ChatMessage[], queued: QueuedMessage[]): Attachment[] {
	const sent = referencedIds(messages, queued);
	return listAttachments(project).filter((a) => !sent.has(a.id));
}

/**
 * One line per document the author sent in this chat, for the system prompt,
 * so a fresh engine session still knows what was shared. Built from the
 * messages, not from the disk: an upload that was never sent is not something
 * the author showed the agent.
 */
export function attachmentInventory(project: Project, messages: ChatMessage[]): string {
	const ids = referencedIds(messages);
	const all = listAttachments(project).filter((a) => ids.has(a.id));
	if (all.length === 0) return "";
	const lines = all.map((a) => `- ${a.name} (${a.pages} page${a.pages === 1 ? "" : "s"}${a.scanned ? ", scanned, no text layer" : ""}): PDF ${attachmentPdfPath(project, a.id)}${a.scanned ? "" : `, text ${attachmentTextPath(project, a.id)}`}`);
	return `Documents the author attached in this chat (reference material, outside the paper folder; read them with your file tools when a request refers to them):\n${lines.join("\n")}`;
}
