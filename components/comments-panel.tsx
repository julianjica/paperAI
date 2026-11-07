"use client";

import { useState } from "react";
import { Check, Loader2, RotateCcw, Send, Trash2 } from "lucide-react";
import type { Comment } from "@/src/core";
import { cn } from "@/lib/utils";

type Group = "active" | "resolved";

export function CommentsPanel({
	comments,
	activeId,
	running,
	onSelect,
	onDelete,
	onReopen,
	onReply,
	onClearResolved,
	onSendAll,
}: {
	comments: Comment[];
	activeId: string | null;
	running: boolean;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
	onReopen: (id: string) => void;
	/** Posts the reply; the server moves the comment back to pending and pushes the new list. */
	onReply: (id: string, text: string) => Promise<unknown> | void;
	onClearResolved: () => void;
	onSendAll: () => void;
}) {
	const [group, setGroup] = useState<Group>("active");
	const pending = comments.filter((c) => c.status === "pending");
	const sent = comments.filter((c) => c.status === "sent");
	const resolved = comments.filter((c) => c.status === "resolved").sort((a, b) => b.createdAt - a.createdAt);
	const activeCount = pending.length + sent.length;
	// A reply reopens the comment, so follow it into the Active group.
	const reply = async (id: string, text: string) => {
		await onReply(id, text);
		setGroup("active");
	};
	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center gap-2 border-b border-line px-3 py-2">
				<div className="flex rounded-md border border-line p-0.5 text-xs">
					<button className={cn("rounded px-2 py-0.5", group === "active" ? "bg-panel-2 font-medium" : "text-ink-muted hover:text-ink")} onClick={() => setGroup("active")}>
						Active{activeCount ? ` (${activeCount})` : ""}
					</button>
					<button className={cn("rounded px-2 py-0.5", group === "resolved" ? "bg-panel-2 font-medium" : "text-ink-muted hover:text-ink")} onClick={() => setGroup("resolved")}>
						Resolved{resolved.length ? ` (${resolved.length})` : ""}
					</button>
				</div>
				{group === "active" ? (
					<button className="ml-auto flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-accent-ink disabled:opacity-50" disabled={pending.length === 0 || running} onClick={onSendAll} title="Send every pending comment to the agent as one batch">
						<Send size={12} /> Send {pending.length > 0 ? pending.length : ""}
					</button>
				) : (
					<button className="ml-auto flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-ink-muted hover:text-danger disabled:opacity-50" disabled={resolved.length === 0} onClick={onClearResolved} title="Delete every resolved comment">
						<Trash2 size={12} /> Clear
					</button>
				)}
			</div>
			<div className="flex-1 overflow-y-auto">
				{group === "active" && (
					<>
						{activeCount === 0 && <p className="p-4 text-ink-muted">Highlight text in the PDF and write what should change. Then send the batch.</p>}
						{pending.length > 0 && <Header>Pending</Header>}
						{pending.map((c) => (
							<Row key={c.id} c={c} active={c.id === activeId} onSelect={onSelect} onDelete={onDelete} onReply={reply} />
						))}
						{sent.length > 0 && <Header>In progress</Header>}
						{sent.map((c) => (
							<Row key={c.id} c={c} active={c.id === activeId} onSelect={onSelect} />
						))}
					</>
				)}
				{group === "resolved" && (
					<>
						{resolved.length === 0 && <p className="p-4 text-ink-muted">Comments the agent has addressed will appear here with its note.</p>}
						{resolved.map((c) => (
							<Row key={c.id} c={c} active={c.id === activeId} onSelect={onSelect} onDelete={onDelete} onReopen={onReopen} onReply={reply} />
						))}
					</>
				)}
			</div>
		</div>
	);
}

function Header({ children }: { children: React.ReactNode }) {
	return <div className="bg-panel-2 px-3 py-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{children}</div>;
}

function Row({
	c,
	active,
	onSelect,
	onDelete,
	onReopen,
	onReply,
}: {
	c: Comment;
	active: boolean;
	onSelect: (id: string) => void;
	onDelete?: (id: string) => void;
	onReopen?: (id: string) => void;
	onReply?: (id: string, text: string) => Promise<void>;
}) {
	const thread = c.thread ?? [];
	return (
		<div className={cn("group cursor-pointer border-b border-line px-3 py-2 hover:bg-panel-2", active && "bg-accent/10")} onClick={() => onSelect(c.id)}>
			<div className="flex items-center gap-2 text-xs text-ink-muted">
				{c.status === "sent" && <Loader2 size={12} className="animate-spin" />}
				{c.status === "resolved" && <Check size={12} className="text-accent" />}
				<span className="font-mono">{c.file ? `${c.file}:${c.line}` : `p. ${c.page}`}</span>
				<span className="ml-auto flex gap-2 opacity-0 group-hover:opacity-100">
					{onReopen && (
						<button
							className="hover:text-accent"
							onClick={(e) => {
								e.stopPropagation();
								onReopen(c.id);
							}}
							title="Reopen: send it again with the next batch"
						>
							<RotateCcw size={12} />
						</button>
					)}
					{onDelete && (
						<button
							className="hover:text-danger"
							onClick={(e) => {
								e.stopPropagation();
								onDelete(c.id);
							}}
							title="Delete"
						>
							<Trash2 size={12} />
						</button>
					)}
				</span>
			</div>
			<div className="mt-0.5 line-clamp-2 text-xs italic text-ink-muted">“{c.quote}”</div>
			<div className="mt-0.5 whitespace-pre-wrap">{c.text}</div>
			{thread.map((e, i) => (
				<div key={i} className={cn("mt-1 flex gap-1.5 whitespace-pre-wrap rounded px-2 py-1 text-xs", e.role === "agent" ? "bg-panel-2" : "ml-4 bg-accent/10")}>
					{e.role === "agent" ? <Check size={12} className="mt-0.5 shrink-0 text-accent" /> : <span className="shrink-0 font-medium text-ink-muted">You</span>}
					<span>{e.text}</span>
				</div>
			))}
			{/* Old comments have a note but no thread; once there is a thread the note is its last agent entry. */}
			{c.resolution && thread.length === 0 && <div className="mt-1 rounded bg-panel-2 px-2 py-1 text-xs">↳ {c.resolution}</div>}
			{onReply && <ReplyBox onSubmit={(text) => onReply(c.id, text)} />}
		</div>
	);
}

/** A "Reply" link that opens a small textarea; Cmd/Ctrl+Enter or Send submits. */
function ReplyBox({ onSubmit }: { onSubmit: (text: string) => Promise<void> }) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const submit = async () => {
		const t = text.trim();
		if (!t || busy) return;
		setBusy(true);
		try {
			await onSubmit(t);
			setText("");
			setOpen(false);
		} catch {
			// Keep the draft so the author can retry.
		} finally {
			setBusy(false);
		}
	};
	// Clicks and keys inside the box must not select the row or bubble to the viewer.
	const stop = (e: React.SyntheticEvent) => e.stopPropagation();
	if (!open) {
		return (
			<button
				className="mt-1 text-xs text-ink-muted hover:text-accent"
				onClick={(e) => {
					e.stopPropagation();
					setOpen(true);
				}}
			>
				Reply
			</button>
		);
	}
	return (
		<div className="mt-1.5 flex flex-col gap-1" onClick={stop} onKeyDown={stop}>
			<textarea
				autoFocus
				rows={2}
				className="w-full resize-y rounded border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent"
				placeholder="Reply to the agent… (⌘/Ctrl+Enter to send)"
				value={text}
				disabled={busy}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						void submit();
					} else if (e.key === "Escape") {
						setOpen(false);
					}
				}}
			/>
			<div className="flex items-center gap-2 text-xs">
				<button className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-accent-ink disabled:opacity-50" disabled={!text.trim() || busy} onClick={() => void submit()}>
					<Send size={11} /> Send
				</button>
				<button className="text-ink-muted hover:text-ink" onClick={() => setOpen(false)}>
					Cancel
				</button>
			</div>
		</div>
	);
}
