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
	/** synctex point on `page` (the first page of the selection): PDF points from the top-left */
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
	// Re-fit the pages when the viewer's width changes (column resize, window resize).
	const [fitWidth, setFitWidth] = useState(0);
	useEffect(() => {
		const el = container.current;
		if (!el) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const ro = new ResizeObserver(() => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => setFitWidth(el.clientWidth), 150);
		});
		ro.observe(el);
		return () => {
			ro.disconnect();
			if (timer) clearTimeout(timer);
		};
	}, []);
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

	// Render all pages whenever the document, zoom or available width changes.
	useEffect(() => {
		if (!doc || !pagesEl.current || !container.current) return;
		void fitWidth;
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
				const endOfContent = document.createElement("div");
				endOfContent.className = "endOfContent";
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
					textLayer.appendChild(endOfContent);
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
	}, [doc, zoom, fitWidth]);

	// Draw highlights into each page's overlay.
	useEffect(() => {
		for (const [n, info] of pages.current) {
			const overlay = info.el.querySelector<HTMLDivElement>(`[data-overlay="${n}"]`);
			if (!overlay) continue;
			overlay.replaceChildren();
			const items: { id: string | null; rects: PageRect[]; kind: "pending" | "sent" | "draft" }[] = comments
				.filter((c) => c.status !== "resolved" && c.rects.some((r) => r.page === n))
				.map((c) => ({ id: c.id, rects: c.rects.filter((r) => r.page === n), kind: c.status === "sent" ? "sent" : "pending" }));
			if (draft) {
				const rects = draft.rects.filter((r) => r.page === n);
				if (rects.length) items.push({ id: null, rects, kind: "draft" });
			}
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

	// Selection stability (pdf.js's own trick): while the pointer is down inside a
	// text layer, an "endOfContent" element covers the page so the selection stays
	// anchored inside that layer instead of jumping to the canvas or other pages.
	useEffect(() => {
		const root = pagesEl.current;
		if (!root) return;
		const onDown = (e: MouseEvent) => {
			const layer = (e.target as Element | null)?.closest?.(".textLayer");
			if (layer) layer.classList.add("selecting");
		};
		const onUp = () => {
			for (const layer of root.querySelectorAll(".textLayer.selecting")) layer.classList.remove("selecting");
		};
		// As the drag crosses into other pages, their layers join the selection too.
		const onChange = () => {
			if (!root.querySelector(".textLayer.selecting")) return;
			const sel = document.getSelection();
			if (!sel || sel.rangeCount === 0) return;
			const range = sel.getRangeAt(0);
			for (const layer of root.querySelectorAll(".textLayer")) if (range.intersectsNode(layer)) layer.classList.add("selecting");
		};
		root.addEventListener("mousedown", onDown);
		document.addEventListener("pointerup", onUp);
		document.addEventListener("selectionchange", onChange);
		window.addEventListener("blur", onUp);
		return () => {
			root.removeEventListener("mousedown", onDown);
			document.removeEventListener("pointerup", onUp);
			document.removeEventListener("selectionchange", onChange);
			window.removeEventListener("blur", onUp);
		};
	}, [renderTick]);

	// Turn a text selection into a draft. Rects come from the selected TEXT only
	// (never from element boxes: a range that touches the layer container would
	// otherwise contribute a page-sized rectangle).
	const onMouseUp = useCallback(() => {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		const layerOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(".textLayer") ?? null;
		const startLayer = layerOf(range.startContainer);
		const endLayer = layerOf(range.endContainer);
		// Both ends must sit in text; a drag anchored on blank page or the chat is not a highlight.
		if (!startLayer || !endLayer) return;
		const raw: PageRect[] = [];
		let quote = "";
		let firstInfo: PageInfo | undefined;
		let firstBox: DOMRect | undefined;
		for (const layer of Array.from(pagesEl.current?.querySelectorAll<HTMLElement>(".textLayer") ?? [])) {
			if (!range.intersectsNode(layer)) continue;
			const pageEl = layer.closest<HTMLElement>(".ra-page");
			if (!pageEl) continue;
			const n = Number(pageEl.dataset.page);
			const info = pages.current.get(n);
			if (!info) continue;
			const pageBox = pageEl.getBoundingClientRect();
			const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (!range.intersectsNode(node)) continue;
				const r = document.createRange();
				r.selectNodeContents(node);
				if (node === range.startContainer) r.setStart(node, range.startOffset);
				if (node === range.endContainer) r.setEnd(node, range.endOffset);
				if (r.collapsed) continue;
				const text = r.toString();
				quote += quote && !quote.endsWith(" ") && !text.startsWith(" ") ? ` ${text}` : text;
				for (const cr of Array.from(r.getClientRects())) {
					if (cr.width < 1 || cr.height < 1) continue;
					const rect: PageRect = { page: n, x: (cr.left - pageBox.left) / pageBox.width, y: (cr.top - pageBox.top) / pageBox.height, w: cr.width / pageBox.width, h: cr.height / pageBox.height };
					// A single line of text is never a sizeable fraction of the page.
					if (rect.h > 0.08 || rect.w > 0.98) continue;
					if (!firstInfo) {
						firstInfo = info;
						firstBox = pageBox;
					}
					raw.push(rect);
				}
			}
		}
		quote = quote.replace(/\s+/g, " ").trim();
		if (!quote || raw.length === 0 || !firstInfo || !firstBox) return;
		// Merge rects that sit on the same line (pdf.js emits one per span).
		const merged: PageRect[] = [];
		for (const r of raw.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
			const last = merged[merged.length - 1];
			if (last && last.page === r.page && Math.abs(last.y - r.y) < 0.004 && Math.abs(last.h - r.h) < 0.006) {
				const right = Math.max(last.x + last.w, r.x + r.w);
				last.x = Math.min(last.x, r.x);
				last.w = right - last.x;
			} else merged.push({ ...r });
		}
		// The SyncTeX anchor is the start of the selection; the popover sits at its end.
		const firstRect = merged[0];
		const cssX = firstRect.x * firstBox.width + 2;
		const cssY = (firstRect.y + firstRect.h / 2) * firstBox.height;
		const [px, py] = firstInfo.viewport.convertToPdfPoint(cssX, cssY);
		const pageHeightPt = firstInfo.viewport.height / firstInfo.viewport.scale;
		const lastRect = merged[merged.length - 1];
		const lastBox = pages.current.get(lastRect.page)?.el.getBoundingClientRect() ?? firstBox;
		onDraft({
			page: firstRect.page,
			rects: merged,
			quote,
			x: px,
			y: pageHeightPt - py,
			anchor: { left: lastBox.left + (lastRect.x + lastRect.w) * lastBox.width, top: lastBox.top + (lastRect.y + lastRect.h) * lastBox.height },
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
