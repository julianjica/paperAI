import path from "node:path";
import { DATA_DIR } from "../../config.ts";
import type { Project, Settings } from "../core/types.ts";
import { readJson, writeJson } from "./fsjson.ts";

const FILE = () => path.join(DATA_DIR, "settings.json");

export const DEFAULT_SETTINGS: Settings = {
	engine: "claude-code",
	model: "claude-opus-5-5",
	workerModel: "claude-sonnet-5-5",
	effort: "high",
	workerEffort: "medium",
};

export function readSettings(): Settings {
	return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(FILE(), {}) };
}

export function writeSettings(patch: Partial<Settings>): Settings {
	const next = { ...readSettings(), ...patch };
	writeJson(FILE(), next);
	return next;
}

/** The settings a run actually uses: global values with the project's overrides on top. */
export type EffectiveSettings = Settings & { styleNote?: string };

/**
 * Global settings overridden by the project's defined fields. Copies field by
 * field rather than spreading so an override stored as undefined/null falls
 * back to the default instead of blanking it.
 */
export function settingsFor(project: Project): EffectiveSettings {
	const out: EffectiveSettings = readSettings();
	for (const [k, v] of Object.entries(project.settings ?? {})) {
		if (v != null && v !== "") (out as unknown as Record<string, unknown>)[k] = v;
	}
	return out;
}
