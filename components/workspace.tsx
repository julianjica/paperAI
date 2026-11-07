"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import type { AgentEvent, ChatMessage, Comment, CompileResult, Project, ProjectEvent, QueuedMessage, TurnRecord, WorkerState } from "@/src/core";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { setFavicon } from "@/lib/favicon";
import { Chat } from "@/components/chat";
import { Composer } from "@/components/composer";
import { PdfViewer, type Draft } from "@/components/pdf-viewer";
import { CommentPopover } from "@/components/comment-popover";
import { CommentsPanel } from "@/components/comments-panel";
import { ActivityPanel } from "@/components/activity-panel";
import { ChangesPanel } from "@/components/changes-panel";
import { SourceView } from "@/components/source-view";
import { SettingsDialog } from "@/components/settings-dialog";

interface Loaded {
	project: Project;
	files: string[];
	chat: { messages: ChatMessage[]; turns: TurnRecord[] };
	comments: Comment[];
	workers: WorkerState[];
	compile: CompileResult | null;
	running: boolean;
	queued: QueuedMessage[];
}

type Tab = "chat" | "comments" | "activity" | "changes";

export function Workspace({ id }: { id: string }) {
	const [data, setData] = useState<Loaded | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("chat");
	const [view, setView] = useState<"pdf" | "source">("pdf");
	const [sourceFile, setSourceFile] = useState<string | null>(null);
	const [sourceLine, setSourceLine] = useState<number | null>(null);
	const [activeComment, setActiveComment] = useState<string | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [draftAnchor, setDraftAnchor] = useState<{ file: string; line: number } | null | undefined>(undefined);
	const [compiling, setCompiling] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [pdfVersion, setPdfVersion] = useState(0);
	const [toast, setToast] = useState<string | null>(null);
	const turnsRunning = useRef(false);
	// Width of the left column, draggable and remembered per browser.
	const [asideWidth, setAsideWidth] = useState(416);
	useEffect(() => {
		try {
			const saved = Number(localStorage.getItem("ra:aside-width"));
			if (saved >= 280) setAsideWidth(saved);
		} catch {
			// storage unavailable
		}
	}, []);
	const startResize = (e: React.MouseEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startW = asideWidth;
		const max = Math.max(320, window.innerWidth * 0.7);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		const onMove = (ev: MouseEvent) => setAsideWidth(Math.min(max, Math.max(280, startW + ev.clientX - startX)));
		const onUp = () => {
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			setAsideWidth((w) => {
				try {
					localStorage.setItem("ra:aside-width", String(w));
				} catch {
					// ignore
				}
				return w;
			});
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	};

	// Tab state: pulsing icon while a turn runs, a check when it finishes (cleared when you come back).
	const wasRunning = useRef(false);
	useEffect(() => {
		const running = data?.running ?? false;
		const name = data?.project.name ?? "researchAI";
		if (running) {
			wasRunning.current = true;
			setFavicon("working");
			document.title = `● Working · ${name}`;
			return;
		}
		if (wasRunning.current) {
			wasRunning.current = false;
			setFavicon("done");
			document.title = `✓ Done · ${name}`;
			const clear = () => {
				if (document.visibilityState !== "visible") return;
				setFavicon("idle");
				document.title = name;
				document.removeEventListener("visibilitychange", clear);
				window.removeEventListener("focus", clear);
			};
			document.addEventListener("visibilitychange", clear);
			window.addEventListener("focus", clear);
			// Already looking at it: keep the check for a few seconds, then settle.
			const t = setTimeout(() => document.visibilityState === "visible" && document.hasFocus() && clear(), 6000);
			return () => {
				clearTimeout(t);
				document.removeEventListener("visibilitychange", clear);
				window.removeEventListener("focus", clear);
			};
		}
		setFavicon("idle");
		document.title = name;
	}, [data?.running, data?.project.name]);

	const load = useCallback(async () => {
		try {
			const r = await api.get<Loaded>(`/api/projects/${id}`);
			setData(r);
			turnsRunning.current = r.running;
			if (r.compile) setPdfVersion(r.compile.version);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [id]);

	useEffect(() => {
		void load();
	}, [load]);

	// Compile on open so the PDF is fresh.
	const compiledOnOpen = useRef(false);
	useEffect(() => {
		if (!data || compiledOnOpen.current) return;
		compiledOnOpen.current = true;
		setCompiling(true);
		api.post<{ result: CompileResult }>(`/api/projects/${id}/compile`).catch(() => undefined).finally(() => setCompiling(false));
	}, [data, id]);

	// Live events. The browser reconnects by itself after the server goes away;
	// events sent meanwhile are lost, so every (re)connect reloads the state.
	const streamLost = useRef(false);
	useEffect(() => {
		const es = new EventSource(`/api/projects/${id}/events`);
		es.onopen = () => {
			if (streamLost.current) {
				streamLost.current = false;
				showToast("Reconnected to the server; the view was refreshed.");
			}
			void load();
		};
		es.onerror = () => {
			streamLost.current = true;
		};
		es.onmessage = (m) => {
			const ev = JSON.parse(m.data) as ProjectEvent;
			switch (ev.type) {
				case "turn_start":
					turnsRunning.current = true;
					void load();
					break;
				case "agent":
					setData((d) => (d ? { ...d, running: true, chat: { ...d.chat, messages: applyAgentEvent(d.chat.messages, ev.turnId, ev.event) } } : d));
					break;
				case "turn_end":
					turnsRunning.current = false;
					void load();
					break;
				case "worker":
					setData((d) => {
						if (!d) return d;
						const workers = d.workers.some((w) => w.id === ev.worker.id) ? d.workers.map((w) => (w.id === ev.worker.id ? ev.worker : w)) : [...d.workers, ev.worker];
						return { ...d, workers };
					});
					break;
				case "compiled":
					setData((d) => (d ? { ...d, compile: ev.result } : d));
					setPdfVersion(ev.result.version);
					if (!ev.result.ok) showToast(`Compile failed: ${ev.result.errors[0] ?? "see log"}`);
					break;
				case "comments":
					setData((d) => (d ? { ...d, comments: ev.comments } : d));
					break;
				case "queue":
					setData((d) => (d ? { ...d, queued: ev.queued } : d));
					break;
			}
		};
		return () => es.close();
	}, [id, load]);

	const showToast = (t: string) => {
		setToast(t);
		setTimeout(() => setToast(null), 6000);
	};

	// Resolve a draft highlight to file:line through SyncTeX.
	useEffect(() => {
		if (!draft) {
			setDraftAnchor(undefined);
			return;
		}
		let cancelled = false;
		setDraftAnchor(undefined);
		api.post<{ hit: { file: string; line: number } | null }>(`/api/projects/${id}/synctex`, { page: draft.page, x: draft.x, y: draft.y })
			.then((r) => !cancelled && setDraftAnchor(r.hit))
			.catch(() => !cancelled && setDraftAnchor(null));
		return () => {
			cancelled = true;
		};
	}, [draft, id]);

	const send = async (text: string, sendComments: boolean) => {
		try {
			await api.post(`/api/projects/${id}/turn`, { text, sendComments });
			setTab("chat");
		} catch (e) {
			showToast(e instanceof Error ? e.message : String(e));
		}
	};

	const addComment = async (text: string) => {
		if (!draft) return;
		await api.post(`/api/projects/${id}/comments`, { rects: draft.rects, page: draft.page, quote: draft.quote, file: draftAnchor?.file ?? null, line: draftAnchor?.line ?? null, text });
		setDraft(null);
		window.getSelection()?.removeAllRanges();
		setTab("comments");
	};

	const selectComment = useCallback(
		(cid: string | null) => {
			setActiveComment(cid);
			if (cid && data) {
				const c = data.comments.find((x) => x.id === cid);
				if (c?.file) {
					setSourceFile(c.file);
					setSourceLine(c.line);
				}
			}
		},
		[data],
	);

	const revert = async (turnId: string) => {
		if (!confirm("Restore the manuscript files as they were before this turn? Files the agent created will be deleted.")) return;
		try {
			await api.post(`/api/projects/${id}/revert`, { turnId });
			await load();
		} catch (e) {
			showToast(e instanceof Error ? e.message : String(e));
		}
	};

	const onDraft = useCallback((d: Draft | null) => setDraft(d), []);

	if (error) return <div className="p-6 text-danger">{error}</div>;
	if (!data) return <div className="p-6 text-ink-muted">Loading…</div>;
	const pending = data.comments.filter((c) => c.status === "pending").length;
	const running = data.running;

	return (
		<div className="flex h-full flex-col">
			<header className="flex h-10 items-center gap-3 border-b border-line bg-panel px-3">
				<a href="/" className="flex items-center gap-1 text-ink-muted hover:text-ink" title="Projects">
					<ArrowLeft size={14} />
				</a>
				<span className="truncate font-medium">{data.project.name}</span>
				<span className="truncate text-xs text-ink-muted">{data.project.folder}</span>
				<div className="ml-auto flex items-center gap-1 rounded-md border border-line p-0.5 text-xs">
					<button className={cn("rounded px-2 py-0.5", view === "pdf" && "bg-panel-2")} onClick={() => setView("pdf")}>
						PDF
					</button>
					<button className={cn("rounded px-2 py-0.5", view === "source" && "bg-panel-2")} onClick={() => setView("source")}>
						Source
					</button>
				</div>
				{data.compile && !data.compile.ok && <span className="text-xs text-danger" title={data.compile.errors.join("\n")}>compile errors</span>}
				<button className="text-ink-muted hover:text-ink" onClick={() => setSettingsOpen(true)} title="Settings">
					<SettingsIcon size={16} />
				</button>
			</header>
			<div className="flex min-h-0 flex-1">
				<aside className="flex shrink-0 flex-col bg-panel" style={{ width: asideWidth }}>
					<nav className="flex border-b border-line text-xs">
						{(
							[
								["chat", "Chat"],
								["comments", `Comments${pending ? ` (${pending})` : ""}`],
								["activity", `Activity${data.workers.some((w) => w.status === "running") ? " •" : ""}`],
								["changes", "Changes"],
							] as [Tab, string][]
						).map(([t, label]) => (
							<button key={t} className={cn("flex-1 px-2 py-2 hover:bg-panel-2", tab === t ? "border-b-2 border-accent font-medium" : "text-ink-muted")} onClick={() => setTab(t)}>
								{label}
							</button>
						))}
					</nav>
					{/* Every panel stays mounted: switching tabs keeps the chat draft and scroll positions. */}
					<div className="flex min-h-0 flex-1 flex-col">
						<div className={cn("flex min-h-0 flex-1 flex-col", tab !== "chat" && "hidden")}>
							<Chat
								messages={data.chat.messages}
								running={running}
								workers={data.workers}
								currentTurn={running ? data.chat.turns[data.chat.turns.length - 1] : undefined}
								queued={data.queued}
								onAnswer={(text) => void send(text, false)}
								onShowActivity={() => setTab("activity")}
								onRemoveQueued={(qid) => void api.del(`/api/projects/${id}/queue/${qid}`).catch(() => undefined)}
							/>
							<Composer projectId={id} running={running} pendingComments={pending} onSend={send} onAbort={() => void api.post(`/api/projects/${id}/abort`)} />
						</div>
						<div className={cn("min-h-0 flex-1", tab !== "comments" && "hidden")}>
							<CommentsPanel
								comments={data.comments}
								activeId={activeComment}
								running={running}
								onSelect={selectComment}
								onDelete={(cid) => void api.del(`/api/projects/${id}/comments/${cid}`)}
								onReopen={(cid) => void api.patch(`/api/projects/${id}/comments/${cid}`, { status: "pending" })}
								onClearResolved={() => {
									const resolved = data.comments.filter((c) => c.status === "resolved");
									if (resolved.length && confirm(`Delete ${resolved.length} resolved comment${resolved.length === 1 ? "" : "s"}?`)) for (const c of resolved) void api.del(`/api/projects/${id}/comments/${c.id}`);
								}}
								onSendAll={() => void send("", true)}
							/>
						</div>
						<div className={cn("min-h-0 flex-1", tab !== "activity" && "hidden")}>
							<ActivityPanel workers={data.workers} />
						</div>
						<div className={cn("min-h-0 flex-1", tab !== "changes" && "hidden")}>
							<ChangesPanel turns={data.chat.turns} running={running} onRevert={(t) => void revert(t)} />
						</div>
					</div>
				</aside>
				<div className="group relative w-1.5 shrink-0 cursor-col-resize border-l border-line hover:bg-accent/40" onMouseDown={startResize} title="Drag to resize">
					<div className="absolute inset-y-0 -left-1 -right-1" />
				</div>
				<main className="min-w-0 flex-1">
					{view === "pdf" ? (
						<PdfViewer
							projectId={id}
							version={pdfVersion}
							comments={data.comments}
							activeCommentId={activeComment}
							onSelectComment={selectComment}
							onDraft={onDraft}
							draft={draft}
							compiling={compiling}
							onCompile={() => {
								setCompiling(true);
								api.post(`/api/projects/${id}/compile`).catch(() => undefined).finally(() => setCompiling(false));
							}}
						/>
					) : (
						<SourceView projectId={id} files={data.files} file={sourceFile ?? data.project.mainTex} line={sourceLine} onPick={(f) => { setSourceFile(f); setSourceLine(null); }} />
					)}
				</main>
			</div>
			{draft && <CommentPopover draft={draft} anchorFile={draftAnchor} onSubmit={addComment} onCancel={() => { setDraft(null); window.getSelection()?.removeAllRanges(); }} />}
			{toast && <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-md border border-line bg-panel px-3 py-2 shadow-lg">{toast}</div>}
			{settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
		</div>
	);
}

/** Mirror of the server's part folding, applied to the streaming assistant message. */
function applyAgentEvent(messages: ChatMessage[], turnId: string, e: AgentEvent): ChatMessage[] {
	const idx = messages.findIndex((m) => m.role === "assistant" && m.turnId === turnId);
	if (idx < 0) return messages;
	const m = messages[idx];
	if (m.role !== "assistant") return messages;
	const parts = m.parts.map((p) => (p.kind === "tool" ? { ...p, call: { ...p.call } } : { ...p }));
	switch (e.type) {
		case "text_delta": {
			const last = parts[parts.length - 1];
			if (last?.kind === "text") last.text += e.text;
			else parts.push({ kind: "text", text: e.text });
			break;
		}
		case "thinking_delta": {
			const last = parts[parts.length - 1];
			if (last?.kind === "thinking") last.text += e.text;
			else parts.push({ kind: "thinking", text: e.text });
			break;
		}
		case "tool_start":
			parts.push({ kind: "tool", call: { id: e.id, name: e.name, input: e.input, startedAt: Date.now() } });
			break;
		case "tool_end": {
			const p = parts.find((x) => x.kind === "tool" && x.call.id === e.id);
			if (p?.kind === "tool") {
				p.call.output = e.output;
				p.call.isError = e.isError;
				if (p.call.startedAt) p.call.durationMs = Date.now() - p.call.startedAt;
			}
			break;
		}
		case "usage": {
			const u = m.usage ?? { input: 0, output: 0, cacheRead: 0 };
			return messages.map((x, i) => (i === idx ? { ...m, parts, usage: { input: u.input + e.input, output: u.output + e.output, cacheRead: u.cacheRead + e.cacheRead } } : x));
		}
		case "error":
			return messages.map((x, i) => (i === idx ? { ...m, parts, error: e.message } : x));
		default:
			return messages;
	}
	return messages.map((x, i) => (i === idx ? { ...m, parts } : x));
}
