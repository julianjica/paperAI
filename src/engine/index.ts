import type { EngineId } from "../core/types.ts";
import { createClaudeCodeEngine } from "./claude-code.ts";
import { createCodexEngine } from "./codex.ts";
import type { Engine } from "./engine.ts";

const engines = new Map<EngineId, Engine>();
/** Test seam: replace an engine. */
export function setEngine(id: EngineId, engine: Engine) {
	engines.set(id, engine);
}
export function engineFor(id: EngineId): Engine {
	let e = engines.get(id);
	if (!e) {
		e = id === "claude-code" ? createClaudeCodeEngine() : createCodexEngine();
		engines.set(id, e);
	}
	return e;
}
export type { Engine, AppTool, RunOptions } from "./engine.ts";
