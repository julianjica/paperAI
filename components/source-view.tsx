"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/** Read-only source pane: shows a manuscript file, optionally scrolled to a line. */
export function SourceView({ projectId, files, file, line, onPick }: { projectId: string; files: string[]; file: string | null; line: number | null; onPick: (file: string) => void }) {
	const [text, setText] = useState<string>("");
	const lineRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!file) return;
		api.get<{ text: string }>(`/api/projects/${projectId}/file?path=${encodeURIComponent(file)}`).then((r) => setText(r.text)).catch(() => setText(""));
	}, [projectId, file]);
	useEffect(() => {
		lineRef.current?.scrollIntoView({ block: "center" });
	}, [text, line]);
	const lines = text.split("\n");
	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-line bg-panel px-3 py-1.5">
				<select className="rounded border border-line bg-panel-2 px-2 py-0.5 font-mono text-xs" value={file ?? ""} onChange={(e) => onPick(e.target.value)}>
					<option value="">Choose a file…</option>
					{files.map((f) => (
						<option key={f} value={f}>
							{f}
						</option>
					))}
				</select>
			</div>
			<div className="flex-1 overflow-auto bg-panel font-mono text-xs leading-5">
				{lines.map((l, i) => (
					<div key={i} ref={i + 1 === line ? lineRef : undefined} className={i + 1 === line ? "bg-accent/15" : ""}>
						<span className="inline-block w-10 select-none pr-2 text-right text-ink-muted">{i + 1}</span>
						<span className="whitespace-pre-wrap">{l}</span>
					</div>
				))}
			</div>
		</div>
	);
}
