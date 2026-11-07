"use client";

import { useEffect, useState } from "react";
import { Clock, Send, Square } from "lucide-react";

export function Composer({ projectId, running, pendingComments, onSend, onAbort }: { projectId: string; running: boolean; pendingComments: number; onSend: (text: string, sendComments: boolean) => Promise<void>; onAbort: () => void }) {
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
		if (!t && !withComments) return;
		setText("");
		await onSend(t, withComments);
	};
	return (
		<div className="border-t border-line bg-panel p-3">
			<textarea
				className="h-24 w-full resize-none rounded-md border border-line bg-panel-2 px-3 py-2"
				placeholder={running ? "Type the next message; it starts when the current turn ends." : pendingComments > 0 ? "Notes for the agent (optional). Your pending comments go with this message." : "Tell the agent what to change… (Enter to send, Shift+Enter for a new line)"}
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
					<button className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-accent-ink disabled:opacity-50" disabled={!text.trim() && !(sendComments && pendingComments > 0)} onClick={() => void submit()} title={running ? "Queue for after the current turn" : "Send"}>
						{running ? <Clock size={14} /> : <Send size={14} />} {running ? "Queue" : "Send"}
					</button>
				</div>
			</div>
		</div>
	);
}
