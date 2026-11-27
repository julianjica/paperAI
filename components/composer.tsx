"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, FileText, Loader2, Paperclip, Send, Square, X } from "lucide-react";
import type { Attachment } from "@/src/core";

export function Composer({
	projectId,
	running,
	pendingComments,
	attachments,
	uploading,
	onAttach,
	onRemoveAttachment,
	onSend,
	onAbort,
}: {
	projectId: string;
	running: boolean;
	pendingComments: number;
	/** Documents uploaded for the next message. */
	attachments: Attachment[];
	uploading: boolean;
	onAttach: (files: FileList) => void;
	onRemoveAttachment: (id: string) => void;
	onSend: (text: string, sendComments: boolean) => Promise<void>;
	onAbort: () => void;
}) {
	const picker = useRef<HTMLInputElement>(null);
	const [text, setText] = useState("");
	const [sendComments, setSendComments] = useState(true);
	// The unsent draft survives a reload (per project, per tab of the browser).
	const draftKey = `ra:draft:${projectId}`;
	useEffect(() => {
		try {
			const saved = sessionStorage.getItem(draftKey);
			if (saved) setText(saved);
		} catch {
			// storage unavailable
		}
	}, [draftKey]);
	useEffect(() => {
		try {
			if (text) sessionStorage.setItem(draftKey, text);
			else sessionStorage.removeItem(draftKey);
		} catch {
			// ignore
		}
	}, [draftKey, text]);
	const submit = async () => {
		const t = text.trim();
		const withComments = sendComments && pendingComments > 0;
		if (!t && !withComments && attachments.length === 0) return;
		if (uploading) return;
		setText("");
		await onSend(t, withComments);
	};
	const canSend = (text.trim() || (sendComments && pendingComments > 0) || attachments.length > 0) && !uploading;
	return (
		<div className="border-t border-line bg-panel p-3">
			{(attachments.length > 0 || uploading) && (
				<div className="mb-2 flex flex-wrap gap-1.5 text-xs">
					{attachments.map((a) => (
						<span key={a.id} className="flex items-center gap-1 rounded-md border border-line bg-panel-2 px-2 py-1" title={a.scanned ? `${a.name}: no text layer (scanned); the agent reads the pages as images` : `${a.name}: ${a.pages} page${a.pages === 1 ? "" : "s"}`}>
							<FileText size={12} className="shrink-0" />
							<span className="max-w-48 truncate">{a.name}</span>
							<span className="text-ink-muted">{a.scanned ? "scanned" : `${a.pages}p`}</span>
							<button className="opacity-60 hover:text-danger hover:opacity-100" onClick={() => onRemoveAttachment(a.id)} title="Remove">
								<X size={12} />
							</button>
						</span>
					))}
					{uploading && (
						<span className="flex items-center gap-1 px-1 py-1 text-ink-muted">
							<Loader2 size={12} className="animate-spin" /> Reading the PDF…
						</span>
					)}
				</div>
			)}
			<textarea
				className="h-24 w-full resize-none rounded-md border border-line bg-panel-2 px-3 py-2"
				placeholder={running ? "Type the next message; it starts when the current turn ends." : attachments.length > 0 ? "What should the agent do with the attached document? (optional)" : pendingComments > 0 ? "Notes for the agent (optional). Your pending comments go with this message." : "Tell the agent what to change… Drop a PDF here to attach it. (Enter to send, Shift+Enter for a new line)"}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault();
						void submit();
					}
				}}
			/>
			<div className="mt-2 flex items-center gap-3">
				<input
					ref={picker}
					type="file"
					accept="application/pdf,.pdf"
					multiple
					className="hidden"
					onChange={(e) => {
						if (e.target.files?.length) onAttach(e.target.files);
						e.target.value = "";
					}}
				/>
				<button className="flex items-center gap-1 text-ink-muted hover:text-ink" onClick={() => picker.current?.click()} title="Attach a PDF (or drop one on the window)">
					<Paperclip size={14} />
				</button>
				{pendingComments > 0 && (
					<label className="flex items-center gap-1.5 text-ink-muted">
						<input type="checkbox" checked={sendComments} onChange={(e) => setSendComments(e.target.checked)} />
						Include {pendingComments} pending comment{pendingComments === 1 ? "" : "s"}
					</label>
				)}
				<div className="ml-auto flex gap-2">
					{running && (
						<button className="flex items-center gap-1 rounded-md border border-line px-3 py-1.5 hover:bg-panel-2" onClick={onAbort} title="Stop the running turn">
							<Square size={14} /> Stop
						</button>
					)}
					<button className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-accent-ink disabled:opacity-50" disabled={!canSend} onClick={() => void submit()} title={running ? "Queue for after the current turn" : "Send"}>
						{running ? <Clock size={14} /> : <Send size={14} />} {running ? "Queue" : "Send"}
					</button>
				</div>
			</div>
		</div>
	);
}
