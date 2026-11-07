"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Minus, Moon, Plus, RefreshCw, Sun } from "lucide-react";
import type { Comment, PageRect } from "@/src/core";
import { cn } from "@/lib/utils";

/** A highlight the user just made, before it becomes a comment. */
export interface Draft {
	page: number;
	rects: PageRect[];
	quote: string;
	/** synctex point: PDF points from the page's top-left */
	x: number;
	y: number;
	/** where to put the popover, in viewport CSS px */
	anchor: { left: number; top: number };
}

type Pdfjs = typeof import("pdfjs-dist");
type Doc = import("pdfjs-dist").PDFDocumentProxy;

interface PageInfo { viewport: { scale: number; width: number; height: number; convertToPdfPoint(x: number, y: number): number[] }; el: HTMLDivElement }

let pdfjsPromise: Promise<Pdfjs> | undefined;
function loadPdfjs(): Promise<Pdfjs> {
	if (!pdfjsPromise) {
		pdfjsPromise = import("pdfjs-dist").then((m) => {
			m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
			return m;
		});
	}
	return pdfjsPromise;
}

export function PdfViewer({
	projectId,
	version,
	comments,
	activeCommentId,
	onSelectComment,
	onDraft,
	draft,
	compiling,
	onCompile,
}: {
	projectId: string;
	version: number;
	comments: Comment[];
	activeCommentId: string | null;
	onSelectComment: (id: string | null) => void;
	onDraft: (draft: Draft | null) => void;
	draft: Draft | null;
	compiling: boolean;
	onCompile: () => void;
}) {
	const container = useRef<HTMLDivElement>(null);
	const pagesEl = useRef<HTMLDivElement>(null);
	const [doc, setDoc] = useState<Doc | null>(null);
	const [zoom, setZoom] = useState(1);
	const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
	const pages = useRef(new Map<number, PageInfo>());
	const [renderTick, setRenderTick] = useState(0);
	// Dark PDF: inverts the rendered pages. Remembered per browser; defaults to the OS theme.
	const [dark, setDark] = useState(false);
	useEffect(() => {
		try {
			const saved = localStorage.getItem("ra:pdf-dark");
			setDark(saved !== null ? saved === "1" : window.matchMedia("(prefers-color-scheme: dark)").matches);
		} catch {
			// storage unavailable: keep the default
		}
	}, []);
	const toggleDark = () => {
		setDark((d) => {
			try {
				localStorage.setItem("ra:pdf-dark", d ? "0" : "1");
			} catch {
				// ignore
			}
			return !d;
		});
	};

	// Load (and reload on every new version), keeping the scroll position.
	useEffect(() => {
		let cancelled = false;
		setStatus("loading");
		void (async () => {
			try {
				const pdfjs = await loadPdfjs();
				const res = await fetch(`/api/projects/${projectId}/pdf?v=${version}`);
				if (res.status === 404) {
					if (!cancelled) setStatus("missing");
					return;
				}
				const data = await res.arrayBuffer();
				const loaded = await pdfjs.getDocument({ data }).promise;
				if (cancelled) return;
				setDoc((old) => {
					void old?.loadingTask.destroy();
					return loaded;
				});
				setStatus("ready");
			} catch (e) {
				console.error(e);
				if (!cancelled) setStatus("error");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [projectId, version]);

	// Render all pages whenever the document or zoom changes.
	useEffect(() => {
		if (!doc || !pagesEl.current || !container.current) return;
		let cancelled = false;
		const root = pagesEl.current;
		const scrollTop = container.current.scrollTop;
		const width = container.current.clientWidth - 48;
		void (async () => {
			const pdfjs = await loadPdfjs();
			const first = await doc.getPage(1);
			const base = first.getViewport({ scale: 1 });
			const scale = Math.max(0.3, (width / base.width) * zoom);
			const dpr = window.devicePixelRatio || 1;
			const next = new Map<number, PageInfo>();
			const frag = document.createDocumentFragment();
			const pageEls: HTMLDivElement[] = [];
			for (let n = 1; n <= doc.numPages; n++) {
				const page = n === 1 ? first : await doc.getPage(n);
				if (cancelled) return;
				const viewport = page.getViewport({ scale });
				const el = document.createElement("div");
				el.className = "ra-page";
				el.dataset.page = String(n);
				el.style.width = `${viewport.width}px`;
				el.style.height = `${viewport.height}px`;
				el.style.setProperty("--scale-factor", String(viewport.scale));
				el.style.setProperty("--total-scale-factor", String(viewport.scale));
				const canvas = document.createElement("canvas");
				canvas.width = Math.floor(viewport.width * dpr);
				canvas.height = Math.floor(viewport.height * dpr);
				canvas.style.width = `${viewport.width}px`;
				canvas.style.height = `${viewport.height}px`;
				el.appendChild(canvas);
				const textLayer = document.createElement("div");
				textLayer.className = "textLayer";
				el.appendChild(textLayer);
				const overlay = document.createElement("div");
				overlay.className = "ra-overlay absolute inset-0 pointer-events-none";
				overlay.dataset.overlay = String(n);
				el.appendChild(overlay);
				frag.appendChild(el);
				pageEls.push(el);
				next.set(n, { viewport, el });
				const ctx = canvas.getContext("2d")!;
				const task = page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined } as never);
				void task.promise.then(async () => {
					if (cancelled) return;
					const textContent = await page.getTextContent();
					if (cancelled) return;
					const layer = new pdfjs.TextLayer({ textContentSource: textContent, container: textLayer, viewport });
					await layer.render();
				}).catch(() => undefined);
			}
			if (cancelled) return;
			root.replaceChildren(frag);
			pages.current = next;
			setRenderTick((t) => t + 1);
			requestAnimationFrame(() => {
				if (container.current) container.current.scrollTop = scrollTop;
			});
		})().catch(() => {
			// The document was replaced (new compile) while rendering: the newer effect takes over.
		});
		return () => {
			cancelled = true;
		};
	}, [doc, zoom]);

	// Draw highlights into each page's overlay.
	useEffect(() => {
		for (const [n, info] of pages.current) {
			const overlay = info.el.querySelector<HTMLDivElement>(`[data-overlay="${n}"]`);
			if (!overlay) continue;
			overlay.replaceChildren();
			const items: { id: string | null; rects: PageRect[]; kind: "pending" | "sent" | "draft" }[] = comments
				.filter((c) => c.status !== "resolved" && c.rects.some((r) => r.page === n))
				.map((c) => ({ id: c.id, rects: c.rects.filter((r) => r.page === n), kind: c.status === "sent" ? "sent" : "pending" }));
			if (draft && draft.page === n) items.push({ id: null, rects: draft.rects, kind: "draft" });
			for (const item of items) {
				for (const r of item.rects) {
					const div = document.createElement("div");
					div.className = "ra-highlight";
					div.style.left = `${r.x * 100}%`;
					div.style.top = `${r.y * 100}%`;
					div.style.width = `${r.w * 100}%`;
					div.style.height = `${r.h * 100}%`;
					div.style.background = item.id && item.id === activeCommentId ? "var(--highlight-active)" : item.kind === "sent" ? "var(--highlight-sent)" : "var(--highlight)";
					if (item.id) {
						const id = item.id;
						div.dataset.comment = id;
						div.addEventListener("click", (e) => {
							e.stopPropagation();
							onSelectComment(id);
						});
					}
					overlay.appendChild(div);
				}
			}
		}
	}, [comments, draft, activeCommentId, renderTick, onSelectComment]);

	// Scroll the active comment into view.
	useEffect(() => {
		if (!activeCommentId) return;
		const el = pagesEl.current?.querySelector<HTMLElement>(`[data-comment="${activeCommentId}"]`);
		el?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [activeCommentId, renderTick]);

	// Turn a text selection into a draft.
	const onMouseUp = useCallback(() => {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		const quote = sel.toString().trim();
		if (!quote) return;
		const startEl = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>(".ra-page");
		if (!startEl) return;
		const n = Number(startEl.dataset.page);
		const info = pages.current.get(n);
		if (!info) return;
		const pageBox = startEl.getBoundingClientRect();
		const rects: PageRect[] = [];
		for (const r of Array.from(range.getClientRects())) {
			if (r.width < 1 || r.height < 1) continue;
			// Only rects on the start page (multi-page selections keep the first page).
			if (r.top < pageBox.top - 2 || r.bottom > pageBox.bottom + 2) continue;
			rects.push({ page: n, x: (r.left - pageBox.left) / pageBox.width, y: (r.top - pageBox.top) / pageBox.height, w: r.width / pageBox.width, h: r.height / pageBox.height });
		}
		if (rects.length === 0) return;
		// Merge rects that sit on the same line (pdf.js emits one per span).
		const merged: PageRect[] = [];
		for (const r of rects.sort((a, b) => a.y - b.y || a.x - b.x)) {
			const last = merged[merged.length - 1];
			if (last && Math.abs(last.y - r.y) < 0.004 && Math.abs(last.h - r.h) < 0.004) {
				const right = Math.max(last.x + last.w, r.x + r.w);
				last.x = Math.min(last.x, r.x);
				last.w = right - last.x;
			} else merged.push({ ...r });
		}
		const firstRect = merged[0];
		const cssX = firstRect.x * pageBox.width + 2;
		const cssY = (firstRect.y + firstRect.h / 2) * pageBox.height;
		const [px, py] = info.viewport.convertToPdfPoint(cssX, cssY);
		const pageHeightPt = info.viewport.height / info.viewport.scale;
		const lastRect = merged[merged.length - 1];
		onDraft({
			page: n,
			rects: merged,
			quote,
			x: px,
			y: pageHeightPt - py,
			anchor: { left: pageBox.left + (lastRect.x + lastRect.w) * pageBox.width, top: pageBox.top + (lastRect.y + lastRect.h) * pageBox.height },
		});
	}, [onDraft]);

	return (
		<div className="relative flex h-full flex-col">
			<div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-ink-muted">
				<button className="rounded p-1 hover:bg-panel-2" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} title="Zoom out">
					<Minus size={14} />
				</button>
				<span className="w-10 text-center text-xs">{Math.round(zoom * 100)}%</span>
				<button className="rounded p-1 hover:bg-panel-2" onClick={() => setZoom((z) => Math.min(3, z + 0.1))} title="Zoom in">
					<Plus size={14} />
				</button>
				<span className="ml-auto text-xs">{doc ? `${doc.numPages} page${doc.numPages === 1 ? "" : "s"}` : ""}</span>
				<button className="rounded p-1 hover:bg-panel-2" onClick={toggleDark} title={dark ? "Light PDF" : "Dark PDF"}>
					{dark ? <Sun size={14} /> : <Moon size={14} />}
				</button>
				<button className={cn("flex items-center gap-1 rounded border border-line px-2 py-0.5 text-xs hover:bg-panel-2", compiling && "opacity-60")} onClick={onCompile} disabled={compiling} title="Recompile">
					{compiling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Compile
				</button>
			</div>
			<div ref={container} className={cn("flex-1 overflow-auto bg-bg p-6", dark && "ra-pdf-dark")} onMouseUp={onMouseUp} onClick={() => onSelectComment(null)}>
				{status === "missing" && <p className="text-center text-ink-muted">No PDF yet. Compile to render the paper.</p>}
				{status === "error" && <p className="text-center text-danger">Could not load the PDF.</p>}
				{status === "loading" && !doc && (
					<p className="flex items-center justify-center gap-2 text-ink-muted">
						<Loader2 size={14} className="animate-spin" /> Loading PDF…
					</p>
				)}
				<div ref={pagesEl} />
			</div>
		</div>
	);
}
