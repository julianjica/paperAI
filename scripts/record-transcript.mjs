#!/usr/bin/env node
/**
 * Record one short, real turn on an engine and save the raw wire messages as
 * a test fixture (tests/fixtures/<engine>-ok.json). The adapter tests replay
 * these through the real adapters, so a CLI/SDK format change shows up as a
 * failing test instead of a silent loss of events.
 *
 *   node scripts/record-transcript.mjs claude-code
 *   node scripts/record-transcript.mjs codex
 *
 * Needs the CLI signed in. Runs in a temp folder with no app tools. The
 * options mirror src/engine/claude-code.ts and src/engine/codex.ts; keep
 * them in step. Secrets, tokens, the home path and account ids are scrubbed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engine = process.argv[2];
if (engine !== "claude-code" && engine !== "codex") {
	console.error("usage: node scripts/record-transcript.mjs <claude-code|codex>");
	process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[3] ?? path.join(root, "tests", "fixtures", `${engine}-ok.json`);
const PROMPT = "Reply with the single word OK and do nothing else.";
const SYSTEM = "You are being used to record a test fixture. Follow the user's instruction exactly; do not use tools.";
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ra-record-"));
const home = os.homedir();
const user = path.basename(home);

// A stuck CLI must not hang the recording.
setTimeout(() => {
	console.error("timed out after 2 minutes");
	process.exit(1);
}, 120_000).unref();

const SECRET_KEYS = new Set(["token", "accesstoken", "access_token", "refreshtoken", "refresh_token", "idtoken", "id_token", "authtoken", "auth_token", "apikey", "api_key", "secret", "password", "cookie", "authorization", "accountid", "account_id", "chatgptaccountid", "chatgpt_account_id", "email", "userid", "user_id", "installationid", "installation_id", "servername", "plantype", "plan_type"]);
function scrub(value) {
	if (typeof value === "string") {
		return value
			.split(cwd).join("/tmp/paper")
			.split(home).join("/home/user")
			.split(`/Users/${user}`).join("/home/user")
			.split(`/home/${user}`).join("/home/user")
			.split(os.hostname()).join("host")
			.split(user).join("user")
			.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[scrubbed]")
			.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[scrubbed]")
			.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[scrubbed]");
	}
	if (Array.isArray(value)) return value.map(scrub);
	if (value && typeof value === "object") {
		const o = {};
		for (const [k, v] of Object.entries(value)) o[k] = SECRET_KEYS.has(k.toLowerCase()) ? (v == null ? v : "[scrubbed]") : scrub(v);
		return o;
	}
	return value;
}

function save(fixture) {
	fs.mkdirSync(path.dirname(out), { recursive: true });
	fs.writeFileSync(out, `${JSON.stringify(scrub(fixture), null, "\t")}\n`);
	console.log(`wrote ${out}`);
	fs.rmSync(cwd, { recursive: true, force: true });
}

function cleanEnv() {
	const env = { ...process.env };
	delete env.CLAUDECODE;
	delete env.CLAUDE_CODE_ENTRYPOINT;
	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;
	delete env.OPENAI_API_KEY;
	delete env.CODEX_API_KEY;
	return env;
}

function which(name) {
	for (const c of [path.join(home, ".local", "bin", name), "/opt/homebrew/bin/" + name, "/usr/local/bin/" + name]) if (fs.existsSync(c)) return c;
	return undefined;
}

async function recordClaudeCode() {
	const { query } = await import("@anthropic-ai/claude-agent-sdk");
	const messages = [];
	const options = {
		cwd,
		model: "claude-haiku-5-5",
		effort: "low",
		systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM },
		settingSources: [],
		permissionMode: "bypassPermissions",
		allowDangerouslySkipPermissions: true,
		disallowedTools: ["Agent", "Task", "AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
		allowedTools: [],
		includePartialMessages: true,
		env: cleanEnv(),
		...(which("claude") ? { pathToClaudeCodeExecutable: which("claude") } : {}),
	};
	for await (const m of query({ prompt: PROMPT, options })) messages.push(m);
	save({ engine: "claude-code", recordedAt: new Date().toISOString(), prompt: PROMPT, messages });
}

function recordCodex() {
	// Same arguments as codexArgs() in src/engine/codex-rpc.ts.
	const disabled = ["multi_agent", "apps", "plugins", "tool_suggest", "memories", "recommended_plugins", "goals", "computer_use", "browser_use", "in_app_browser"];
	const overrides = ["mcp_servers={}", "project_doc_max_bytes=0", "tools.experimental_request_user_input={enabled=false}"];
	const args = ["app-server", ...disabled.flatMap((f) => ["--disable", f]), ...overrides.flatMap((o) => ["-c", o])];
	const child = spawn(which("codex") ?? "codex", args, { cwd, env: cleanEnv(), stdio: ["pipe", "pipe", "inherit"] });
	const lines = []; // { dir: "in" | "out", message } in wire order
	let nextId = 1;
	const waiting = new Map();
	const send = (message) => {
		lines.push({ dir: "out", message });
		child.stdin.write(`${JSON.stringify(message)}\n`);
	};
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			waiting.set(id, { resolve, reject });
			send({ id, method, params });
		});
	let buffer = "";
	let threadId;
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		buffer += chunk;
		let nl;
		while ((nl = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (!line) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			lines.push({ dir: "in", message });
			if (message.id !== undefined && message.method === undefined) {
				const w = waiting.get(message.id);
				waiting.delete(message.id);
				if (message.error) w?.reject(new Error(message.error.message));
				else w?.resolve(message.result);
			} else if (message.id !== undefined) {
				// A server request (approval, tool call): refuse, there are none expected.
				send({ id: message.id, error: { code: -32000, message: "not handled by the recorder" } });
			} else if (message.method === "turn/completed") {
				setTimeout(() => {
					child.kill("SIGTERM");
					save({ engine: "codex", recordedAt: new Date().toISOString(), prompt: PROMPT, lines });
				}, 300);
			}
		}
	});
	child.on("error", (e) => {
		console.error(e);
		process.exit(1);
	});
	(async () => {
		await request("initialize", { clientInfo: { name: "researchai", title: "researchAI", version: "1" }, capabilities: { experimentalApi: true } });
		send({ method: "initialized" });
		const common = { model: "gpt-5.6-sol", baseInstructions: SYSTEM, approvalPolicy: "never", sandbox: "workspace-write", cwd, dynamicTools: [] };
		threadId = (await request("thread/start", { ...common, ephemeral: false })).thread.id;
		await request("turn/start", { threadId, input: [{ type: "text", text: PROMPT }], model: common.model, effort: "low", summary: "auto" });
	})().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}

if (engine === "claude-code") await recordClaudeCode();
else recordCodex();
