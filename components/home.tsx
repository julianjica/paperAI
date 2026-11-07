"use client";

import { useEffect, useState } from "react";
import { FolderOpen, FileText, Trash2 } from "lucide-react";
import type { Project } from "@/src/core";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { SettingsDialog } from "@/components/settings-dialog";
import { setFavicon } from "@/lib/favicon";

export function Home() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [folder, setFolder] = useState("");
	const [candidates, setCandidates] = useState<string[] | null>(null);
	const [resolvedFolder, setResolvedFolder] = useState("");
	const [mainTex, setMainTex] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);

	const refresh = () => api.get<{ projects: Project[] }>("/api/projects").then((r) => setProjects(r.projects)).catch(() => undefined);
	useEffect(() => {
		void refresh();
		setFavicon("idle");
	}, []);

	const [picking, setPicking] = useState(false);
	const pickFolder = async () => {
		setPicking(true);
		setError(null);
		try {
			const desktop = (window as unknown as { researchai?: { pickFolder(): Promise<string | null> } }).researchai;
			// Electron has a native dialog; in the browser the server opens one on this machine.
			const chosen = desktop ? await desktop.pickFolder() : (await api.post<{ folder: string | null }>("/api/pick-folder")).folder;
			if (chosen) {
				setFolder(chosen);
				await scan(chosen);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setPicking(false);
		}
	};

	const scan = async (f = folder) => {
		setError(null);
		setCandidates(null);
		if (!f.trim()) return;
		try {
			const r = await api.get<{ folder: string; candidates: string[] }>(`/api/projects/candidates?folder=${encodeURIComponent(f.trim())}`);
			setResolvedFolder(r.folder);
			setCandidates(r.candidates);
			setMainTex(r.candidates[0] ?? "");
			if (r.candidates.length === 0) setError("No .tex file with \\documentclass found in that folder.");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const open = async () => {
		if (!resolvedFolder || !mainTex) return;
		setBusy(true);
		setError(null);
		try {
			const r = await api.post<{ project: Project }>("/api/projects", { folder: resolvedFolder, mainTex });
			window.location.href = `/p/${r.project.id}`;
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setBusy(false);
		}
	};

	const remove = async (p: Project) => {
		if (!confirm(`Forget project "${p.name}"? The paper folder is not touched.`)) return;
		await api.del(`/api/projects/${p.id}`);
		void refresh();
	};

	return (
		<div className="h-full overflow-auto">
			<div className="mx-auto max-w-2xl px-4 py-10">
				<header className="mb-8 flex items-center justify-between">
					<div>
						<h1 className="text-xl font-semibold">researchAI</h1>
						<p className="text-ink-muted">Open a LaTeX project. Agents rewrite the parts you point at.</p>
					</div>
					<button className="rounded-md border border-line px-3 py-1.5 hover:bg-panel-2" onClick={() => setSettingsOpen(true)}>
						Settings
					</button>
				</header>

				<section className="rounded-lg border border-line bg-panel p-4">
					<h2 className="mb-2 font-medium">Open a paper folder</h2>
					<div className="flex items-center gap-3">
						<button className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-accent-ink disabled:opacity-50" disabled={picking} onClick={() => void pickFolder()}>
							<FolderOpen size={16} /> {picking ? "Choose in the dialog…" : "Browse…"}
						</button>
						<span className="text-ink-muted">or paste a path</span>
						<input
							className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-3 py-1.5"
							placeholder="/path/to/paper-folder"
							value={folder}
							onChange={(e) => setFolder(e.target.value)}
							onBlur={() => folder.trim() && void scan()}
							onKeyDown={(e) => e.key === "Enter" && void scan()}
						/>
					</div>
					{candidates && candidates.length > 0 && (
						<div className="mt-3 flex items-center gap-2">
							<label className="text-ink-muted">Main file</label>
							<select className="rounded-md border border-line bg-panel-2 px-2 py-1" value={mainTex} onChange={(e) => setMainTex(e.target.value)}>
								{candidates.map((c) => (
									<option key={c} value={c}>
										{c}
									</option>
								))}
							</select>
							<button className="ml-auto rounded-md bg-accent px-3 py-1.5 text-accent-ink disabled:opacity-50" disabled={busy} onClick={() => void open()}>
								Open
							</button>
						</div>
					)}
					{error && <p className="mt-2 text-danger">{error}</p>}
				</section>

				<section className="mt-8">
					<h2 className="mb-2 font-medium">Recent</h2>
					{projects.length === 0 && <p className="text-ink-muted">No projects yet. Try the sample: <code className="font-mono">examples/sample-paper</code> in this repo.</p>}
					<ul className="divide-y divide-line rounded-lg border border-line bg-panel">
						{projects.map((p) => (
							<li key={p.id} className="flex items-center gap-3 px-4 py-3">
								<FileText size={16} className="text-ink-muted" />
								<a href={`/p/${p.id}`} className="flex-1 hover:underline">
									<div>{p.name}</div>
									<div className="text-xs text-ink-muted">
										{p.folder} · opened {timeAgo(p.openedAt)}
									</div>
								</a>
								<button className="text-ink-muted hover:text-danger" onClick={() => void remove(p)} title="Forget">
									<Trash2 size={16} />
								</button>
							</li>
						))}
					</ul>
				</section>
			</div>
			{settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
		</div>
	);
}
