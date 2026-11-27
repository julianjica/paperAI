import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makePaper } from "./helpers.ts";
import { setEngine } from "../src/engine/index.ts";
import { EventChannel, type Engine, type RunOptions } from "../src/engine/engine.ts";
import { renderAttachmentBlock, ATTACHMENT_INLINE_CAP } from "../src/core/attachments.ts";
import { addAttachment, attachmentPdfPath, attachmentTextPath, deleteAllAttachments, deleteAttachment, getAttachment, listAttachments, unsentAttachments } from "../src/server/attachments.ts";
import { compileRuntime } from "../src/server/compile.ts";
import { listQueued, startTurn, submit } from "../src/server/turn.ts";
import { readChat } from "../src/server/chat.ts";
import { writeSettings } from "../src/server/settings.ts";

compileRuntime.run = async () => ({ ok: true, errors: [] });
writeSettings({ engine: "claude-code", model: "m", workerModel: "w", effort: "low", workerEffort: "low" });

/** A one-page PDF with the given text in Helvetica (offsets computed, so the xref is valid). */
function tinyPdf(text: string): Uint8Array {
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		(() => {
			const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`;
			return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
		})(),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let body = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((o, i) => {
		offsets.push(body.length);
		body += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new Uint8Array(Buffer.from(body, "latin1"));
}

function scripted(script: (o: RunOptions) => Promise<void>, calls: RunOptions[]): Engine {
	return {
		id: "claude-code",
		run(o) {
			calls.push(o);
			const ch = new EventChannel<import("../src/core/types.ts").AgentEvent>();
			void script(o)
				.then(() => ch.push({ type: "done", text: "" }))
				.finally(() => ch.close());
			return ch;
		},
	};
}

test("a dropped PDF is stored under the project's state dir with its text", async () => {
	const { folder, project } = makePaper();
	const a = await addAttachment(project, "../Referee Report.pdf", tinyPdf("Report on the manuscript. The authors should prove Lemma 2 in full before the numerical section."));
	assert.equal(a.name, "Referee Report.pdf");
	assert.equal(a.pages, 1);
	assert.equal(a.scanned, false);
	assert.ok(a.chars > 20);
	assert.ok(a.size > 100);
	assert.equal(fs.statSync(attachmentPdfPath(project, a.id)).size, a.size, "the stored PDF is the whole file");
	assert.match(fs.readFileSync(attachmentTextPath(project, a.id), "utf8"), /prove Lemma 2 in full/);
	assert.ok(!attachmentPdfPath(project, a.id).startsWith(folder), "never inside the paper folder");
	assert.deepEqual(listAttachments(project).map((x) => x.id), [a.id]);
	assert.deepEqual(getAttachment(project, a.id), a);
	assert.equal(getAttachment(project, "../../etc"), undefined);
	assert.ok(deleteAttachment(project, a.id));
	assert.equal(getAttachment(project, a.id), undefined);
	assert.ok(!fs.existsSync(attachmentTextPath(project, a.id)));
});

test("only PDFs are accepted; a PDF with no text layer is marked scanned", async () => {
	const { project } = makePaper();
	await assert.rejects(addAttachment(project, "notes.txt", new Uint8Array(Buffer.from("hello"))), /Only PDF/);
	await assert.rejects(addAttachment(project, "empty.pdf", new Uint8Array()), /empty/);
	await assert.rejects(addAttachment(project, "broken.pdf", new Uint8Array(Buffer.from("%PDF-1.4 garbage"))), /Cannot read the PDF/);
	const blank = await addAttachment(project, "scan.pdf", tinyPdf(""));
	assert.equal(blank.scanned, true);
});

test("the prompt block inlines short documents, truncates long ones and labels scans", () => {
	const base = { id: "a1", name: "report.pdf", size: 10, pages: 2, chars: 50, scanned: false, createdAt: 0 };
	const short = renderAttachmentBlock([{ attachment: base, pdfPath: "/s/a1.pdf", textPath: "/s/a1.txt", text: "Major comment: the proof of Lemma 2 skips a case." }]);
	assert.match(short, /reference material/);
	assert.match(short, /Attached document: report\.pdf \(2 pages\)/);
	assert.match(short, /PDF: \/s\/a1\.pdf/);
	assert.match(short, /skips a case\.\n--- end of report\.pdf ---/);
	const long = renderAttachmentBlock([{ attachment: base, pdfPath: "/s/a1.pdf", textPath: "/s/a1.txt", text: "x".repeat(ATTACHMENT_INLINE_CAP + 10) }]);
	assert.match(long, /truncated; the full text is in \/s\/a1\.txt/);
	assert.ok(long.length < ATTACHMENT_INLINE_CAP + 600);
	const scan = renderAttachmentBlock([{ attachment: { ...base, scanned: true }, pdfPath: "/s/a1.pdf", textPath: "/s/a1.txt", text: "" }]);
	assert.match(scan, /scanned document/);
	assert.doesNotMatch(scan, /Text: /);
	assert.equal(renderAttachmentBlock([]), "");
});

test("attachments ride with the message, alone or queued, and the system prompt lists them", async () => {
	const { project } = makePaper();
	const a = await addAttachment(project, "report.pdf", tinyPdf("Reviewer 2: the model needs a participation constraint."));
	const calls: RunOptions[] = [];
	let release: () => void = () => undefined;
	const gate = new Promise<void>((r) => (release = r));
	setEngine("claude-code", scripted(async () => gate, calls));
	// Uploaded but never sent: not the agent's business, but offered again above the composer.
	const stray = await addAttachment(project, "stray.pdf", tinyPdf("A document the author dropped and then reloaded the page."));
	assert.deepEqual(unsentAttachments(project, readChat(project).messages, listQueued(project)).map((x) => x.id), [a.id, stray.id]);
	// An attachment with no text is enough to start a turn.
	const first = startTurn(project, { text: "", sendComments: false, attachments: [a.id] });
	assert.match(calls[0].input, /participation constraint/);
	assert.match(calls[0].input, /Attached document: report\.pdf/);
	assert.match(calls[0].systemPrompt, /Documents the author attached in this chat/);
	assert.match(calls[0].systemPrompt, new RegExp(attachmentPdfPath(project, a.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.doesNotMatch(calls[0].systemPrompt, /stray\.pdf/);
	assert.deepEqual(unsentAttachments(project, readChat(project).messages, listQueued(project)).map((x) => x.id), [stray.id]);
	// Queued while running: the record keeps the attachment and the next turn carries it.
	const b = await addAttachment(project, "letter.pdf", tinyPdf("Editor: please address both reports point by point in a response letter."));
	const r = submit(project, { text: "", sendComments: false, attachments: [b.id] });
	assert.ok("queued" in r);
	assert.deepEqual(listQueued(project)[0].attachments?.map((x) => x.id), [b.id]);
	assert.throws(() => submit(project, { text: "", sendComments: false, attachments: ["nope"] }), /not found/);
	assert.throws(() => submit(project, { text: "", sendComments: false }), /Nothing to send/);
	release();
	await first.done;
	// The queued turn starts on its own; wait for it to reach the engine.
	for (let i = 0; i < 50 && calls.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
	assert.equal(calls.length, 2);
	assert.match(calls[1].input, /address both reports/);
	await new Promise((r) => setTimeout(r, 50));
	const chat = readChat(project);
	const users = chat.messages.filter((m) => m.role === "user");
	assert.deepEqual(users.map((m) => (m.role === "user" ? m.attachments?.map((x) => x.name) : [])), [["report.pdf"], ["letter.pdf"]]);
	deleteAllAttachments(project);
	assert.deepEqual(listAttachments(project), []);
});
