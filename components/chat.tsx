"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Streamdown, type PluginConfig } from "streamdown";
import { createMathPlugin } from "@streamdown/math";
import { ChevronRight, Loader2, Wrench } from "lucide-react";
import type { AssistantPart, ChatMessage, ToolCallRecord } from "@/src/core";
import { cn } from "@/lib/utils";

const plugins = { math: createMathPlugin({ singleDollarTextMath: true }) } as unknown as PluginConfig;

export function Chat({ messages, running }: { messages: ChatMessage[]; running: boolean }) {
	const bottom = useRef<HTMLDivElement>(null);
	const box = useRef<HTMLDivElement>(null);
	const [stick, setStick] = useState(true);
	useEffect(() => {
		if (stick) bottom.current?.scrollIntoView({ block: "end" });
	}, [messages, stick]);
	return (
		<div
			ref={box}
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
				<Message key={m.id} message={m} streaming={running && i === messages.length - 1} />
			))}
			<div ref={bottom} />
		</div>
	);
}

const Message = memo(function Message({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
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
	return (
		<div className="mb-4">
			{message.parts.map((p, i) => (
				<Part key={i} part={p} />
			))}
			{streaming && message.parts.length === 0 && (
				<div className="flex items-center gap-2 text-ink-muted">
					<Loader2 size={14} className="animate-spin" /> Thinking…
				</div>
			)}
			{message.error && <div className="mt-1 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-danger">{message.error}</div>}
			{message.aborted && <div className="mt-1 text-xs text-ink-muted">Stopped.</div>}
		</div>
	);
});

function Part({ part }: { part: AssistantPart }) {
	if (part.kind === "text") {
		return (
			<div className="ra-prose">
				<Streamdown plugins={plugins}>{part.text}</Streamdown>
			</div>
		);
	}
	if (part.kind === "thinking") return <Thinking text={part.text} />;
	return <ToolRow call={part.call} />;
}

function Thinking({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="my-1 text-xs text-ink-muted">
			<button className="flex items-center gap-1 hover:text-ink" onClick={() => setOpen(!open)}>
				<ChevronRight size={12} className={cn("transition-transform", open && "rotate-90")} /> Reasoning
			</button>
			{open && <div className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-2">{text}</div>}
		</div>
	);
}

function summarize(call: ToolCallRecord): string {
	const input = (call.input ?? {}) as Record<string, unknown>;
	switch (call.name) {
		case "Read":
		case "Edit":
		case "Write":
		case "MultiEdit":
			return String(input.file_path ?? input.path ?? "");
		case "Bash":
			return String(input.command ?? "").slice(0, 100);
		case "Grep":
			return String(input.pattern ?? "");
		case "Glob":
			return String(input.pattern ?? "");
		case "delegate": {
			const tasks = (input.tasks as { title?: string }[] | undefined) ?? [];
			return `${tasks.length} worker${tasks.length === 1 ? "" : "s"}: ${tasks.map((t) => t.title).join(" · ")}`;
		}
		case "resolve_comment":
			return `${input.id ?? ""}: ${String(input.note ?? "").slice(0, 80)}`;
		default: {
			const s = JSON.stringify(input);
			return s === "{}" ? "" : s.slice(0, 100);
		}
	}
}

function ToolRow({ call }: { call: ToolCallRecord }) {
	const [open, setOpen] = useState(false);
	const pending = call.output === undefined;
	return (
		<div className="my-1 text-xs">
			<button className={cn("flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-panel-2", call.isError ? "text-danger" : "text-ink-muted")} onClick={() => setOpen(!open)}>
				{pending ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
				<span className="font-medium">{call.name}</span>
				<span className="truncate font-mono">{summarize(call)}</span>
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
