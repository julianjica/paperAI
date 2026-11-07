"use client";

import { Check, Loader2, Send, Trash2 } from "lucide-react";
import type { Comment } from "@/src/core";
import { cn } from "@/lib/utils";

export function CommentsPanel({ comments, activeId, running, onSelect, onDelete, onSendAll }: { comments: Comment[]; activeId: string | null; running: boolean; onSelect: (id: string) => void; onDelete: (id: string) => void; onSendAll: () => void }) {
	const pending = comments.filter((c) => c.status === "pending");
	const sent = comments.filter((c) => c.status === "sent");
	const resolved = comments.filter((c) => c.status === "resolved").slice(-20).reverse();
	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center gap-2 border-b border-line px-3 py-2">
				<span className="text-ink-muted">
					{pending.length} pending · {sent.length} in progress
				</span>
				<button className="ml-auto flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-accent-ink disabled:opacity-50" disabled={pending.length === 0 || running} onClick={onSendAll} title="Send every pending comment to the agent as one batch">
					<Send size={12} /> Send {pending.length > 0 ? pending.length : ""}
				</button>
			</div>
			<div className="flex-1 overflow-y-auto">
				{comments.length === 0 && <p className="p-4 text-ink-muted">Highlight text in the PDF and write what should change. Then send the batch.</p>}
				{pending.map((c) => (
					<Row key={c.id} c={c} active={c.id === activeId} onSelect={onSelect} onDelete={onDelete} />
				))}
				{sent.length > 0 && <Header>In progress</Header>}
				{sent.map((c) => (
					<Row key={c.id} c={c} active={c.id === activeId} onSelect={onSelect} />
				))}
				{resolved.length > 0 && <Header>Resolved</Header>}
				{resolved.map((c) => (
					<Row key={c.id} c={c} active={c.id === activeId} onSelect={onSelect} onDelete={onDelete} />
				))}
			</div>
		</div>
	);
}

function Header({ children }: { children: React.ReactNode }) {
	return <div className="bg-panel-2 px-3 py-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{children}</div>;
}

function Row({ c, active, onSelect, onDelete }: { c: Comment; active: boolean; onSelect: (id: string) => void; onDelete?: (id: string) => void }) {
	return (
		<div className={cn("group cursor-pointer border-b border-line px-3 py-2 hover:bg-panel-2", active && "bg-accent/10")} onClick={() => onSelect(c.id)}>
			<div className="flex items-center gap-2 text-xs text-ink-muted">
				{c.status === "sent" && <Loader2 size={12} className="animate-spin" />}
				{c.status === "resolved" && <Check size={12} className="text-accent" />}
				<span className="font-mono">{c.file ? `${c.file}:${c.line}` : `p. ${c.page}`}</span>
				{onDelete && (
					<button
						className="ml-auto opacity-0 group-hover:opacity-100 hover:text-danger"
						onClick={(e) => {
							e.stopPropagation();
							onDelete(c.id);
						}}
						title="Delete"
					>
						<Trash2 size={12} />
					</button>
				)}
			</div>
			<div className="mt-0.5 line-clamp-2 text-xs italic text-ink-muted">“{c.quote}”</div>
			<div className="mt-0.5 whitespace-pre-wrap">{c.text}</div>
			{c.resolution && <div className="mt-1 rounded bg-panel-2 px-2 py-1 text-xs">↳ {c.resolution}</div>}
		</div>
	);
}
