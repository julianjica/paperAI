import { engineAvailable, getProject, MODELS, settingsFor, updateProjectSettings } from "@/src/server";
import type { Project, ProjectSettings } from "@/src/core";

function payload(project: Project) {
	return { settings: project.settings ?? {}, effective: settingsFor(project), models: MODELS, available: { "claude-code": engineAvailable("claude-code"), codex: engineAvailable("codex") } };
}

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/settings">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	return Response.json(payload(project));
}

/** A field sent as null clears that override (JSON has no undefined). */
export async function PUT(request: Request, ctx: RouteContext<"/api/projects/[id]/settings">) {
	const { id } = await ctx.params;
	if (!getProject(id)) return Response.json({ error: "No such project" }, { status: 404 });
	const body = (await request.json()) as Record<string, unknown>;
	const patch: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(body)) patch[k] = v ?? undefined;
	return Response.json(payload(updateProjectSettings(id, patch as ProjectSettings)));
}
