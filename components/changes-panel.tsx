"use client";

import { useState } from "react";
import { ChevronRight, RotateCcw } from "lucide-react";
import type { TurnRecord } from "@/src/core";
import { cn, timeAgo } from "@/lib/utils";

export function ChangesPanel({ turns, running, onRevert }: { turns: TurnRecord[]; running: boolean; onRevert: (turnId: string) => void }) {
	const list = [...turns].reverse().filter((t) => t.endedAt);
	return (
		<div className="h-full overflow-y-auto">
			{list.length === 0 && <p className="p-4 text-ink-muted">Each agent turn lists the files it changed here, with a diff and a revert button.</p>}
			{list.map((t) => (
				<Turn key={t.id} turn={t} running={running} onRevert={onRevert} />
			))}
		</div>
	);
}

function Turn({ turn, running, onRevert }: { turn: TurnRecord; running: boolean; onRevert: (id: string) => void }) {
	const [open, setOpen] = useState<string | null>(null);
	return (
		<div className="border-b border-line px-3 py-2">
			<div className="flex items-center gap-2">
				<span className="text-ink-muted">{timeAgo(turn.startedAt)}</span>
				<span className={cn("text-xs", turn.compile?.ok === false ? "text-danger" : "text-ink-muted")}>{turn.compile ? (turn.compile.ok ? "compiled" : "compile failed") : ""}</span>
				{turn.reverted ? (
					<span className="ml-auto text-xs text-ink-muted">reverted</span>
				) : (
					turn.changes.length > 0 && (
						<button className="ml-auto flex items-center gap-1 rounded border border-line px-2 py-0.5 text-xs hover:bg-panel-2 disabled:opacity-50" disabled={running} onClick={() => onRevert(turn.id)} title="Restore the files as they were before this turn">
							<RotateCcw size={12} /> Revert
						</button>
					)
				)}
			</div>
			{turn.removedCopies && turn.removedCopies.length > 0 && (
				<div className="text-xs text-ink-muted" title="The agent copied a file before editing it; the copy was deleted (the snapshot keeps the original).">
					Backup copies removed: <span className="font-mono">{turn.removedCopies.join(", ")}</span>
				</div>
			)}
			{turn.changes.length === 0 && <div className="text-xs text-ink-muted">No file changes.</div>}
			{turn.changes.map((c) => (
				<div key={c.path} className="mt-1">
					<button className="flex w-full items-center gap-1 text-left text-xs hover:text-accent" onClick={() => setOpen(open === c.path ? null : c.path)}>
						<ChevronRight size={12} className={cn("transition-transform", open === c.path && "rotate-90")} />
						<span className={cn("font-mono", c.kind === "added" && "text-accent", c.kind === "removed" && "text-danger")}>{c.path}</span>
						<span className="text-ink-muted">{c.kind}</span>
					</button>
					{open === c.path && <Diff text={c.diff} />}
				</div>
			))}
		</div>
	);
}

function Diff({ text }: { text: string }) {
	if (!text) return <div className="ml-4 text-xs text-ink-muted">(binary or non-text file)</div>;
	return (
		<div className="ra-diff ml-4 mt-1 max-h-80 overflow-auto rounded border border-line bg-panel-2 p-2">
			{text
				.split("\n")
				.slice(2)
				.map((line, i) => (
					<div key={i} className={line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : ""}>
						{line || " "}
					</div>
				))}
		</div>
	);
}
