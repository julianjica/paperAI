import { compile, engineAvailable, getProject, listMainCandidates, MODELS, setMainTex, settingsFor, turnRunning, updateProjectSettings } from "@/src/server";
import type { Project, ProjectSettings } from "@/src/core";

function payload(project: Project) {
	return {
		settings: project.settings ?? {},
		effective: settingsFor(project),
		models: MODELS,
		available: { "claude-code": engineAvailable("claude-code"), codex: engineAvailable("codex") },
		mainTex: project.mainTex,
		candidates: listMainCandidates(project.folder),
	};
}

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/settings">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	return Response.json(payload(project));
}

/**
 * A field sent as null clears that override (JSON has no undefined).
 * `mainTex` is not a setting but the project's root file: switching it
 * recompiles in the background (the viewer picks the new PDF up from the
 * compiled event).
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
		if (turnRunning(id)) return Response.json({ error: "Wait for the running turn to finish before changing the main file." }, { status: 409 });
		try {
			project = setMainTex(id, mainTex);
		} catch (error) {
			return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
		}
		void compile(project);
	}
	return Response.json(payload(project));
}
