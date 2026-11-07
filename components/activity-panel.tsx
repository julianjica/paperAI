"use client";

import { Check, Loader2, X } from "lucide-react";
import type { WorkerState } from "@/src/core";

export function ActivityPanel({ workers }: { workers: WorkerState[] }) {
	const list = [...workers].reverse();
	return (
		<div className="h-full overflow-y-auto">
			{list.length === 0 && <p className="p-4 text-ink-muted">When the agent delegates, its workers show up here with what they are doing.</p>}
			{list.map((w) => (
				<div key={w.id} className="border-b border-line px-3 py-2">
					<div className="flex items-center gap-2">
						{w.status === "running" ? <Loader2 size={14} className="animate-spin text-accent" /> : w.status === "done" ? <Check size={14} className="text-accent" /> : <X size={14} className="text-danger" />}
						<span className="font-medium">{w.title}</span>
						<span className="ml-auto text-xs text-ink-muted">{w.endedAt ? `${Math.round((w.endedAt - w.startedAt) / 1000)}s` : ""}</span>
					</div>
					<div className="mt-0.5 font-mono text-xs text-ink-muted">{w.files.join(", ")}</div>
					{w.status === "running" && w.activity.length > 0 && (
						<div className="mt-1 max-h-24 overflow-hidden font-mono text-xs text-ink-muted">
							{w.activity.slice(-5).map((a, i) => (
								<div key={i} className="truncate">
									{a}
								</div>
							))}
						</div>
					)}
					{w.status !== "running" && w.result && <details className="mt-1 text-xs"><summary className="cursor-pointer text-ink-muted">Report</summary><div className="mt-1 whitespace-pre-wrap">{w.result}</div></details>}
				</div>
			))}
		</div>
	);
}
