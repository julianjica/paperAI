import { engineAvailable, MODELS, readSettings, writeSettings } from "@/src/server";

export async function GET() {
	return Response.json({ settings: readSettings(), models: MODELS, available: { "claude-code": engineAvailable("claude-code"), codex: engineAvailable("codex") } });
}

export async function PUT(request: Request) {
	const patch = (await request.json()) as Record<string, unknown>;
	return Response.json({ settings: writeSettings(patch) });
}
