import path from "node:path";
import { DATA_DIR } from "../../config.ts";
import type { Settings } from "../core/types.ts";
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
