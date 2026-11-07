import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EngineId } from "../core/types.ts";

/**
 * Executable lookup for the local CLIs: RA_<NAME>_PATH → PATH → the usual
 * installer locations. A desktop app launched from Finder gets a minimal
 * PATH, hence the fallbacks.
 */
const cache = new Map<string, string | null>();

function find(name: string, envVar: string, extra: string[]): string | undefined {
	const explicit = process.env[envVar];
	if (explicit) return explicit;
	if (cache.has(name)) return cache.get(name) ?? undefined;
	let found: string | null = null;
	try {
		const cmd = process.platform === "win32" ? "where" : "which";
		const out = execFileSync(cmd, [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0]?.trim();
		found = out && existsSync(out) ? out : null;
	} catch {
		found = null;
	}
	if (!found) found = extra.find((c) => existsSync(c)) ?? null;
	cache.set(name, found);
	return found ?? undefined;
}

export function claudeExecutable(): string | undefined {
	const home = os.homedir();
	return find("claude", "RA_CLAUDE_CODE_PATH", [path.join(home, ".local", "bin", "claude"), path.join(home, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]);
}

export function codexExecutable(): string | undefined {
	const home = os.homedir();
	return find("codex", "RA_CODEX_PATH", [path.join(home, ".local", "bin", "codex"), "/opt/homebrew/bin/codex", "/usr/local/bin/codex"]);
}

export function engineAvailable(id: EngineId): boolean {
	return id === "claude-code" ? !!claudeExecutable() : !!codexExecutable();
}

/** Also finds TeX Live when the app was launched with a minimal PATH. */
export function texPath(): string {
	const extra = ["/Library/TeX/texbin", "/usr/local/texlive/2025/bin/universal-darwin", "/usr/local/texlive/2024/bin/universal-darwin", "/opt/homebrew/bin", "/usr/local/bin"].filter((d) => existsSync(d));
	return [process.env.PATH ?? "", ...extra].filter(Boolean).join(path.delimiter);
}

/** Models offered per engine. Both lists are static; the CLIs accept any id they know. */
export const MODELS: Record<EngineId, { id: string; label: string }[]> = {
	"claude-code": [
		{ id: "claude-opus-5-5", label: "Claude Opus 5.5" },
		{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
		{ id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
	],
	// Ids a ChatGPT-signed-in Codex accepts (pi-ai's openai-codex catalog, 2026-11).
	codex: [
		{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
		{ id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
		{ id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
		{ id: "gpt-6-sol", label: "GPT-6 Sol" },
		{ id: "gpt-6-luna", label: "GPT-6 Luna" },
		{ id: "gpt-6-astra", label: "GPT-6 Astra" },
		{ id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
	],
};
