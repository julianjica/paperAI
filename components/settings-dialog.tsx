"use client";

import { useEffect, useState } from "react";
import type { Effort, EngineId, ProjectSettings, Settings } from "@/src/core";
import { api } from "@/lib/api";

type Models = Record<EngineId, { id: string; label: string }[]>;
interface Loaded { settings: Settings; models: Models; available: Record<EngineId, boolean> }
interface ProjectLoaded { settings: ProjectSettings; effective: Settings & { styleNote?: string }; models: Models; available: Record<EngineId, boolean> }
/** What the project PUT accepts: null clears an override (JSON drops undefined). */
type ProjectPatch = { [K in keyof ProjectSettings]?: ProjectSettings[K] | null };

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const ENGINE_LABEL: Record<EngineId, string> = { "claude-code": "Claude Code", codex: "Codex" };
const select = "w-full rounded-md border border-line bg-panel-2 px-2 py-1";

/**
 * Global settings, and with `projectId` the per-paper overrides above them.
 * Each project control's first option is "Use default (…)" so the author sees
 * what falls through from the global section below.
 */
export function SettingsDialog({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
	const [data, setData] = useState<Loaded | null>(null);
	const [proj, setProj] = useState<ProjectLoaded | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		api.get<Loaded>("/api/settings").then(setData).catch((e) => setError(String(e)));
		if (projectId) api.get<ProjectLoaded>(`/api/projects/${projectId}/settings`).then(setProj).catch((e) => setError(String(e)));
	}, [projectId]);

	const save = async (patch: Partial<Settings>) => {
		if (!data) return;
		const next = { ...data.settings, ...patch };
		setData({ ...data, settings: next });
		try {
			await api.put("/api/settings", patch);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const changeEngine = (engine: EngineId) => {
		if (!data) return;
		const models = data.models[engine];
		void save({ engine, model: models[0]?.id ?? "", workerModel: models[1]?.id ?? models[0]?.id ?? "" });
	};

	const saveProject = async (patch: ProjectPatch) => {
		if (!proj || !projectId) return;
		const settings: ProjectSettings = { ...proj.settings };
		for (const [k, v] of Object.entries(patch)) {
			if (v == null) delete settings[k as keyof ProjectSettings];
			else (settings as Record<string, unknown>)[k] = v;
		}
		setProj({ ...proj, settings });
		try {
			setProj(await api.put<ProjectLoaded>(`/api/projects/${projectId}/settings`, patch));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	// Switching the paper's engine also pins its models: a Claude id on Codex (or the reverse) would fail at run time.
	const changeProjectEngine = (engine: EngineId | "") => {
		if (!proj) return;
		if (!engine) return void saveProject({ engine: null, model: null, workerModel: null });
		const models = proj.models[engine];
		void saveProject({ engine, model: models[0]?.id ?? "", workerModel: models[1]?.id ?? models[0]?.id ?? "" });
	};

	const ready = data && (!projectId || proj);
	const engine = proj?.settings.engine ?? data?.settings.engine ?? "claude-code";
	const modelLabel = (id: string) => data?.models[data.settings.engine].find((m) => m.id === id)?.label ?? id;
	// A default model only makes sense on the default engine: a Claude id on Codex fails at run time.
	const sameEngine = !proj?.settings.engine || proj.settings.engine === data?.settings.engine;
	const defaultModel = (id: string) => (sameEngine ? `Use default (${modelLabel(id)})` : undefined);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
			<div className="max-h-[calc(100vh-32px)] w-[28rem] max-w-[calc(100vw-32px)] overflow-y-auto rounded-lg border border-line bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="font-semibold">Settings</h2>
					<button className="text-ink-muted hover:text-ink" onClick={onClose}>
						Close
					</button>
				</div>
				{!ready && !error && <p className="text-ink-muted">Loading…</p>}
				{error && <p className="text-danger">{error}</p>}
				{data && proj && projectId && (
					<section className="mb-6 space-y-4">
						<SectionTitle>This paper</SectionTitle>
						<Row label="Engine">
							<select className={select} value={proj.settings.engine ?? ""} onChange={(e) => changeProjectEngine(e.target.value as EngineId | "")}>
								<option value="">Use default ({ENGINE_LABEL[data.settings.engine]})</option>
								<option value="claude-code">Claude Code{proj.available["claude-code"] ? "" : " (not found)"}</option>
								<option value="codex">Codex{proj.available.codex ? "" : " (not found)"}</option>
							</select>
						</Row>
						<Row label="Main agent model">
							<ModelSelect models={proj.models[engine]} value={proj.settings.model ?? ""} fallback={defaultModel(data.settings.model)} onChange={(model) => void saveProject({ model: model || null })} />
						</Row>
						<Row label="Main agent effort">
							<EffortSelect value={proj.settings.effort ?? ""} fallback={`Use default (${data.settings.effort})`} onChange={(effort) => void saveProject({ effort: effort || null })} />
						</Row>
						<Row label="Worker model">
							<ModelSelect models={proj.models[engine]} value={proj.settings.workerModel ?? ""} fallback={defaultModel(data.settings.workerModel)} onChange={(workerModel) => void saveProject({ workerModel: workerModel || null })} />
						</Row>
						<Row label="Worker effort">
							<EffortSelect value={proj.settings.workerEffort ?? ""} fallback={`Use default (${data.settings.workerEffort})`} onChange={(workerEffort) => void saveProject({ workerEffort: workerEffort || null })} />
						</Row>
						<Row label="Style note">
							<StyleNote value={proj.settings.styleNote ?? ""} onSave={(styleNote) => void saveProject({ styleNote: styleNote || null })} />
							<p className="mt-1 text-xs text-ink-muted">Read by the main agent and every worker. Target journal, &quot;we&quot; or &quot;I&quot;, notation conventions, passages never to touch.</p>
						</Row>
					</section>
				)}
				{data && (
					<section className="space-y-4">
						{projectId && <SectionTitle>Defaults for all papers</SectionTitle>}
						<Row label="Engine">
							<select className={select} value={data.settings.engine} onChange={(e) => changeEngine(e.target.value as EngineId)}>
								<option value="claude-code">Claude Code{data.available["claude-code"] ? "" : " (not found)"}</option>
								<option value="codex">Codex{data.available.codex ? "" : " (not found)"}</option>
							</select>
							<p className="mt-1 text-xs text-ink-muted">Runs the signed-in CLI on your machine. Billing follows that CLI&apos;s login.</p>
						</Row>
						<Row label="Main agent model">
							<ModelSelect models={data.models[data.settings.engine]} value={data.settings.model} onChange={(model) => void save({ model })} />
						</Row>
						<Row label="Main agent effort">
							<EffortSelect value={data.settings.effort} onChange={(effort) => void save({ effort: effort as Effort })} />
						</Row>
						<Row label="Worker model">
							<ModelSelect models={data.models[data.settings.engine]} value={data.settings.workerModel} onChange={(workerModel) => void save({ workerModel })} />
						</Row>
						<Row label="Worker effort">
							<EffortSelect value={data.settings.workerEffort} onChange={(workerEffort) => void save({ workerEffort: workerEffort as Effort })} />
						</Row>
					</section>
				)}
			</div>
		</div>
	);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
	return <h3 className="border-b border-line pb-1 text-sm font-medium">{children}</h3>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="block">
			<div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
			{children}
		</label>
	);
}

/** `fallback`, when given, is a leading "" option that means "no override". */
function ModelSelect({ models, value, fallback, onChange }: { models: { id: string; label: string }[]; value: string; fallback?: string; onChange: (v: string) => void }) {
	const known = models.some((m) => m.id === value);
	return (
		<select className={select} value={value} onChange={(e) => onChange(e.target.value)}>
			{fallback !== undefined && <option value="">{fallback}</option>}
			{!known && value && <option value={value}>{value}</option>}
			{models.map((m) => (
				<option key={m.id} value={m.id}>
					{m.label}
				</option>
			))}
		</select>
	);
}

function EffortSelect({ value, fallback, onChange }: { value: Effort | ""; fallback?: string; onChange: (v: Effort | "") => void }) {
	return (
		<select className={select} value={value} onChange={(e) => onChange(e.target.value as Effort | "")}>
			{fallback !== undefined && <option value="">{fallback}</option>}
			{EFFORTS.map((e) => (
				<option key={e} value={e}>
					{e}
				</option>
			))}
		</select>
	);
}

/** Edits locally and saves on blur, so typing does not fire a request per keystroke. */
function StyleNote({ value, onSave }: { value: string; onSave: (v: string) => void }) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return (
		<textarea
			className={`${select} min-h-[7rem] resize-y text-sm`}
			value={draft}
			placeholder="e.g. Target: Management Science. Write in the first person plural. Keep the notation of Section 2; never edit the appendix proofs."
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => {
				if (draft.trim() !== value.trim()) onSave(draft.trim());
			}}
		/>
	);
}
