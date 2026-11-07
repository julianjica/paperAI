"use client";

import { useEffect, useState } from "react";
import type { Effort, EngineId, Settings } from "@/src/core";
import { api } from "@/lib/api";

interface Loaded { settings: Settings; models: Record<EngineId, { id: string; label: string }[]>; available: Record<EngineId, boolean> }
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
	const [data, setData] = useState<Loaded | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		api.get<Loaded>("/api/settings").then(setData).catch((e) => setError(String(e)));
	}, []);

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

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
			<div className="w-[28rem] max-w-[calc(100vw-32px)] rounded-lg border border-line bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="font-semibold">Settings</h2>
					<button className="text-ink-muted hover:text-ink" onClick={onClose}>
						Close
					</button>
				</div>
				{!data && !error && <p className="text-ink-muted">Loading…</p>}
				{error && <p className="text-danger">{error}</p>}
				{data && (
					<div className="space-y-4">
						<Row label="Engine">
							<select className="w-full rounded-md border border-line bg-panel-2 px-2 py-1" value={data.settings.engine} onChange={(e) => changeEngine(e.target.value as EngineId)}>
								<option value="claude-code">Claude Code{data.available["claude-code"] ? "" : " (not found)"}</option>
								<option value="codex">Codex{data.available.codex ? "" : " (not found)"}</option>
							</select>
							<p className="mt-1 text-xs text-ink-muted">Runs the signed-in CLI on your machine. Billing follows that CLI&apos;s login.</p>
						</Row>
						<Row label="Main agent model">
							<ModelSelect models={data.models[data.settings.engine]} value={data.settings.model} onChange={(model) => void save({ model })} />
						</Row>
						<Row label="Main agent effort">
							<EffortSelect value={data.settings.effort} onChange={(effort) => void save({ effort })} />
						</Row>
						<Row label="Worker model">
							<ModelSelect models={data.models[data.settings.engine]} value={data.settings.workerModel} onChange={(workerModel) => void save({ workerModel })} />
						</Row>
						<Row label="Worker effort">
							<EffortSelect value={data.settings.workerEffort} onChange={(workerEffort) => void save({ workerEffort })} />
						</Row>
					</div>
				)}
			</div>
		</div>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="block">
			<div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
			{children}
		</label>
	);
}

function ModelSelect({ models, value, onChange }: { models: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
	const known = models.some((m) => m.id === value);
	return (
		<select className="w-full rounded-md border border-line bg-panel-2 px-2 py-1" value={value} onChange={(e) => onChange(e.target.value)}>
			{!known && value && <option value={value}>{value}</option>}
			{models.map((m) => (
				<option key={m.id} value={m.id}>
					{m.label}
				</option>
			))}
		</select>
	);
}

function EffortSelect({ value, onChange }: { value: Effort; onChange: (v: Effort) => void }) {
	return (
		<select className="w-full rounded-md border border-line bg-panel-2 px-2 py-1" value={value} onChange={(e) => onChange(e.target.value as Effort)}>
			{EFFORTS.map((e) => (
				<option key={e} value={e}>
					{e}
				</option>
			))}
		</select>
	);
}
