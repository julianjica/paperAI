"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Streamdown, type PluginConfig } from "streamdown";
import { createMathPlugin } from "@streamdown/math";
import { Check, ChevronRight, Clock, HelpCircle, Loader2, Users, Wrench, X } from "lucide-react";
import type { AssistantPart, ChatMessage, QueuedMessage, ToolCallRecord, TurnRecord, WorkerState } from "@/src/core";
import { cn } from "@/lib/utils";

const plugins = { math: createMathPlugin({ singleDollarTextMath: true }) } as unknown as PluginConfig;

export function Chat({
	messages,
	running,
	workers,
	currentTurn,
	queued,
	onAnswer,
	onShowActivity,
	onRemoveQueued,
}: {
	messages: ChatMessage[];
	running: boolean;
	workers: WorkerState[];
	currentTurn?: TurnRecord;
	queued: QueuedMessage[];
	onAnswer: (text: string) => void;
	onShowActivity: () => void;
	onRemoveQueued: (id: string) => void;
}) {
	const bottom = useRef<HTMLDivElement>(null);
	const [stick, setStick] = useState(true);
	useEffect(() => {
		if (stick) bottom.current?.scrollIntoView({ block: "end" });
	}, [messages, workers, queued, stick]);
	const last = messages[messages.length - 1];
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div
				className="flex-1 overflow-y-auto px-3 py-3"
				onScroll={(e) => {
					const el = e.currentTarget;
					setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
				}}
			>
				{messages.length === 0 && (
					<div className="mt-10 text-center text-ink-muted">
						<p>Ask for changes here, or highlight text in the PDF to leave a comment.</p>
					</div>
				)}
				{messages.map((m, i) => (
					<Message key={m.id} message={m} streaming={running && i === messages.length - 1} last={i === messages.length - 1} workers={m.role === "assistant" ? workers.filter((w) => w.turnId === m.turnId) : []} onAnswer={onAnswer} />
				))}
				{queued.map((q, i) => (
					<div key={q.id} className="mb-2 flex justify-end">
						<div className="group max-w-[85%] rounded-lg border border-dashed border-line px-3 py-2 text-ink-muted">
							<div className="mb-0.5 flex items-center gap-2 text-xs">
								<Clock size={11} /> Queued{queued.length > 1 ? ` #${i + 1}` : ""}
								{q.sendComments && <span>· with pending comments</span>}
								<button className="ml-auto opacity-60 hover:text-danger hover:opacity-100" onClick={() => onRemoveQueued(q.id)} title="Remove from the queue">
									<X size={12} />
								</button>
							</div>
							<div className="whitespace-pre-wrap text-ink">{q.text || "(comments only)"}</div>
						</div>
					</div>
				))}
				<div ref={bottom} />
			</div>
			{running && last?.role === "assistant" && <StatusBar message={last} turn={currentTurn} workers={workers.filter((w) => w.turnId === last.turnId && w.status === "running")} onShowActivity={onShowActivity} />}
		</div>
	);
}

/** Live status while a turn runs: what the agent is doing now, elapsed time, tokens, workers. */
function StatusBar({ message, turn, workers, onShowActivity }: { message: ChatMessage & { role: "assistant" }; turn?: TurnRecord; workers: WorkerState[]; onShowActivity: () => void }) {
	const [, tick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(t);
	}, []);
	const parts = message.parts;
	const lastPart = parts[parts.length - 1];
	let phase = "Starting…";
	if (lastPart?.kind === "tool" && lastPart.call.output === undefined) phase = describeTool(lastPart.call, true);
	else if (lastPart?.kind === "thinking") phase = "Thinking…";
	else if (lastPart?.kind === "text") phase = "Writing…";
	else if (lastPart?.kind === "tool") phase = "Thinking…";
	if (workers.length > 0) phase = `${workers.length} worker${workers.length === 1 ? "" : "s"} running · ${phase}`;
	const elapsed = turn ? Math.max(0, Math.round((Date.now() - turn.startedAt) / 1000)) : 0;
	// Output tokens so far: input/cache counts repeat the whole context on every call.
	const tokens = message.usage?.output ?? 0;
	return (
		<div className="flex items-center gap-2 border-t border-line bg-panel-2 px-3 py-1.5 text-xs text-ink-muted">
			<Loader2 size={12} className="shrink-0 animate-spin text-accent" />
			<span className="min-w-0 flex-1 truncate">{phase}</span>
			{workers.length > 0 && (
				<button className="flex items-center gap-1 hover:text-ink" onClick={onShowActivity} title="Show workers">
					<Users size={12} />
				</button>
			)}
			<span className="tabular-nums">{fmtDuration(elapsed * 1000)}</span>
			{tokens > 0 && <span className="tabular-nums" title="Output tokens this turn">↓ {fmtTokens(tokens)}</span>}
		</div>
	);
}

function fmtDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
function fmtTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

const Message = memo(function Message({ message, streaming, last, workers, onAnswer }: { message: ChatMessage; streaming: boolean; last: boolean; workers: WorkerState[]; onAnswer: (text: string) => void }) {
	if (message.role === "user") {
		return (
			<div className="mb-3 flex justify-end">
				<div className="max-w-[85%] rounded-lg bg-accent/10 px-3 py-2 whitespace-pre-wrap">
					{message.text || <span className="text-ink-muted">(comments only)</span>}
					{message.commentIds && message.commentIds.length > 0 && (
						<div className="mt-1 text-xs text-ink-muted">
							{message.commentIds.length} comment{message.commentIds.length === 1 ? "" : "s"} attached
						</div>
					)}
				</div>
			</div>
		);
	}
	// The k-th delegate call shows the k-th batch of workers under it.
	let delegateIndex = 0;
	return (
		<div className="mb-4">
			{message.parts.map((p, i) => {
				const batch = p.kind === "tool" && p.call.name === "delegate" ? ++delegateIndex : 0;
				return <Part key={i} part={p} streaming={streaming && i === message.parts.length - 1} answerable={last && !streaming} workers={batch ? workers.filter((w) => w.batch === batch) : []} onAnswer={onAnswer} />;
			})}
			{streaming && message.parts.length === 0 && (
				<div className="flex items-center gap-2 text-ink-muted">
					<Loader2 size={14} className="animate-spin" /> Starting…
				</div>
			)}
			{message.error && <div className="mt-1 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-danger">{message.error}</div>}
			{message.aborted && <div className="mt-1 text-xs text-ink-muted">Stopped.</div>}
		</div>
	);
});

function Part({ part, streaming, answerable, workers, onAnswer }: { part: AssistantPart; streaming: boolean; answerable: boolean; workers: WorkerState[]; onAnswer: (text: string) => void }) {
	if (part.kind === "tool" && part.call.name === "ask_author") return <QuestionCard call={part.call} answerable={answerable} onAnswer={onAnswer} />;
	if (part.kind === "text") {
		return (
			<div className="ra-prose">
				<Streamdown plugins={plugins}>{part.text}</Streamdown>
			</div>
		);
	}
	if (part.kind === "thinking") return <Thinking text={part.text} live={streaming} />;
	return (
		<>
			<ToolRow call={part.call} />
			{workers.length > 0 && <WorkerList workers={workers} />}
		</>
	);
}

/** Workers of one delegate call, shown live under it. */
function WorkerList({ workers }: { workers: WorkerState[] }) {
	const [, tick] = useState(0);
	const anyRunning = workers.some((w) => w.status === "running");
	useEffect(() => {
		if (!anyRunning) return;
		const t = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(t);
	}, [anyRunning]);
	return (
		<div className="my-1 ml-4 border-l-2 border-line pl-2 text-xs">
			{workers.map((w) => {
				const lastLine = w.activity[w.activity.length - 1];
				return (
					<div key={w.id} className="py-0.5">
						<div className="flex items-center gap-1.5">
							{w.status === "running" ? <Loader2 size={11} className="shrink-0 animate-spin text-accent" /> : w.status === "done" ? <Check size={11} className="shrink-0 text-accent" /> : <X size={11} className="shrink-0 text-danger" />}
							<span className="font-medium">{w.title}</span>
							<span className="ml-auto shrink-0 tabular-nums text-ink-muted">{fmtDuration((w.endedAt ?? Date.now()) - w.startedAt)}</span>
						</div>
						{w.status === "running" && lastLine && <div className="truncate pl-4 font-mono text-ink-muted">{lastLine}</div>}
						{w.status !== "running" && w.result && (
							<details className="pl-4">
								<summary className="cursor-pointer text-ink-muted">report</summary>
								<div className="mt-0.5 whitespace-pre-wrap">{w.result}</div>
							</details>
						)}
					</div>
				);
			})}
		</div>
	);
}

/** The agent's clarifying question. Buttons answer with that option; free text goes through the composer. */
function QuestionCard({ call, answerable, onAnswer }: { call: ToolCallRecord; answerable: boolean; onAnswer: (text: string) => void }) {
	const input = (call.input ?? {}) as { question?: string; options?: string[] };
	const options = Array.isArray(input.options) ? input.options.filter((o) => typeof o === "string" && o.trim()) : [];
	return (
		<div className="my-2 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2">
			<div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-accent">
				<HelpCircle size={12} /> The agent asks
			</div>
			<div className="whitespace-pre-wrap">{input.question ?? ""}</div>
			{options.length > 0 && (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{options.map((o) => (
						<button key={o} className="rounded-md border border-line bg-panel px-2.5 py-1 text-left hover:bg-panel-2 disabled:opacity-50" disabled={!answerable} onClick={() => onAnswer(o)}>
							{o}
						</button>
					))}
				</div>
			)}
			{answerable && <div className="mt-1.5 text-xs text-ink-muted">Pick an option or type your answer below.</div>}
		</div>
	);
}

/** Reasoning: collapsed by default; while it streams, the latest words show as a live preview. */
function Thinking({ text, live }: { text: string; live: boolean }) {
	const [open, setOpen] = useState(false);
	const tail = text.replace(/\s+/g, " ").trim().slice(-160);
	return (
		<div className="my-1 text-xs text-ink-muted">
			<button className="flex w-full items-center gap-1 text-left hover:text-ink" onClick={() => setOpen(!open)}>
				<ChevronRight size={12} className={cn("shrink-0 transition-transform", open && "rotate-90")} />
				<span className="shrink-0">{live ? "Thinking" : "Reasoning"}</span>
				{live && !open && <span className="min-w-0 truncate italic opacity-70">{tail}</span>}
			</button>
			{open && <div className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-2">{text}</div>}
		</div>
	);
}

function describeTool(call: ToolCallRecord, asPhase = false): string {
	const input = (call.input ?? {}) as Record<string, unknown>;
	const file = (v: unknown) => String(v ?? "").split("/").slice(-2).join("/");
	switch (call.name) {
		case "Read":
			return asPhase ? `Reading ${file(input.file_path ?? input.path)}` : file(input.file_path ?? input.path);
		case "Edit":
		case "MultiEdit":
			return asPhase ? `Editing ${file(input.file_path ?? input.path)}` : file(input.file_path ?? input.path);
		case "Write":
			return asPhase ? `Writing ${file(input.file_path ?? input.path)}` : file(input.file_path ?? input.path);
		case "Bash":
			return asPhase ? `Running: ${String(input.command ?? "").slice(0, 80)}` : String(input.command ?? "").slice(0, 100);
		case "Grep":
		case "Glob":
			return asPhase ? `Searching ${String(input.pattern ?? "")}` : String(input.pattern ?? "");
		case "compile":
			return asPhase ? "Compiling with latexmk…" : "";
		case "delegate": {
			const tasks = (input.tasks as { title?: string }[] | undefined) ?? [];
			return asPhase ? `Delegating ${tasks.length} task${tasks.length === 1 ? "" : "s"}` : `${tasks.length} worker${tasks.length === 1 ? "" : "s"}: ${tasks.map((t) => t.title).join(" · ")}`;
		}
		case "resolve_comment":
			return asPhase ? `Resolving comment ${input.id ?? ""}` : `${input.id ?? ""}: ${String(input.note ?? "").slice(0, 80)}`;
		default: {
			const s = JSON.stringify(input);
			return asPhase ? `${call.name}…` : s === "{}" ? "" : s.slice(0, 100);
		}
	}
}

function ToolRow({ call }: { call: ToolCallRecord }) {
	const [open, setOpen] = useState(false);
	const pending = call.output === undefined;
	const [, tick] = useState(0);
	useEffect(() => {
		if (!pending) return;
		const t = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(t);
	}, [pending]);
	const elapsed = pending && call.startedAt ? Date.now() - call.startedAt : call.durationMs;
	return (
		<div className="my-1 text-xs">
			<button className={cn("flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-panel-2", call.isError ? "text-danger" : "text-ink-muted")} onClick={() => setOpen(!open)}>
				{pending ? <Loader2 size={12} className="shrink-0 animate-spin text-accent" /> : <Wrench size={12} className="shrink-0" />}
				<span className="shrink-0 font-medium">{call.name}</span>
				<span className="min-w-0 truncate font-mono">{describeTool(call)}</span>
				{elapsed !== undefined && elapsed >= 1000 && <span className="ml-auto shrink-0 tabular-nums opacity-70">{fmtDuration(elapsed)}</span>}
			</button>
			{open && (
				<div className="ml-4 mt-1 max-h-64 overflow-auto rounded border border-line bg-panel-2 p-2 font-mono whitespace-pre-wrap">
					<div className="mb-1 text-ink-muted">input</div>
					{JSON.stringify(call.input, null, 2)}
					{call.output !== undefined && (
						<>
							<div className="mt-2 mb-1 text-ink-muted">output</div>
							{call.output}
						</>
					)}
				</div>
			)}
		</div>
	);
}
