"use client";

import { useEffect, useState } from "react";
import type { Draft } from "@/components/pdf-viewer";

/** The Overleaf-style box that appears after a highlight. */
export function CommentPopover({ draft, anchorFile, onSubmit, onCancel }: { draft: Draft; anchorFile: { file: string; line: number } | null | undefined; onSubmit: (text: string) => Promise<void>; onCancel: () => void }) {
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onCancel]);
	const width = 320;
	const left = Math.min(Math.max(8, draft.anchor.left - width / 2), window.innerWidth - width - 8);
	const top = Math.min(draft.anchor.top + 8, window.innerHeight - 220);
	return (
		<div className="fixed z-40 rounded-lg border border-line bg-panel p-3 shadow-xl" style={{ left, top, width }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
			<div className="mb-1 line-clamp-2 text-xs text-ink-muted">“{draft.quote}”</div>
			<div className="mb-2 text-xs text-ink-muted">
				{anchorFile === undefined ? "Locating in source…" : anchorFile ? <span className="font-mono">{anchorFile.file}:{anchorFile.line}</span> : <span className="text-warn">Could not map to source; the agent gets the quote and page.</span>}
			</div>
			<textarea
				autoFocus
				className="h-20 w-full resize-none rounded-md border border-line bg-panel-2 px-2 py-1"
				placeholder="What should change here?"
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						if (text.trim()) void submit();
					}
				}}
			/>
			<div className="mt-2 flex justify-end gap-2">
				<button className="rounded-md px-2 py-1 text-ink-muted hover:text-ink" onClick={onCancel}>
					Cancel
				</button>
				<button className="rounded-md bg-accent px-3 py-1 text-accent-ink disabled:opacity-50" disabled={!text.trim() || busy} onClick={() => void submit()}>
					Add comment
				</button>
			</div>
		</div>
	);
	async function submit() {
		setBusy(true);
		try {
			await onSubmit(text.trim());
		} finally {
			setBusy(false);
		}
	}
}
