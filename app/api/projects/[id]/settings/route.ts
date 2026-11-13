import { engineAvailable, getProject, listMainCandidates, MODELS, settingsFor, switchMainTex, updateProjectSettings } from "@/src/server";
import type { Project, ProjectSettings } from "@/src/core";

function payload(project: Project) {
	return {
		project,
		settings: project.settings ?? {},
		effective: settingsFor(project),
		models: MODELS,
		available: { "claude-code": engineAvailable("claude-code"), codex: engineAvailable("codex") },
		mainTex: project.mainTex,
		candidates: listMainCandidates(project.folder),
	};
}

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	return Response.json(payload(project));
}

/**
 * A field sent as null clears that override (JSON has no undefined).
 * `mainTex` is not a setting: it switches to the sibling project for that
 * root file (its own chat, comments and snapshots), returned as `project`
 * so the client can open it.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/projects/[id]/settings">) {
	const { id } = await ctx.params;
	if (!getProject(id)) return Response.json({ error: "No such project" }, { status: 404 });
	const body = (await request.json()) as Record<string, unknown>;
	const { mainTex, ...rest } = body;
	const patch: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(rest)) patch[k] = v ?? undefined;
	let project = updateProjectSettings(id, patch as ProjectSettings);
	if (typeof mainTex === "string" && mainTex !== project.mainTex) {
		try {
			project = switchMainTex(id, mainTex);
		} catch (error) {
			return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
		}
	}
	return Response.json(payload(project));
}
