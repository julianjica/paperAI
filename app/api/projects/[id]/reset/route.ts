import { getProject, resetChat, turnRunning } from "@/src/server";

/** Start a fresh chat (and a fresh engine session) for the project. */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/reset">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	if (turnRunning(id)) return Response.json({ error: "Wait for the running turn to finish." }, { status: 409 });
	resetChat(project);
	return Response.json({ ok: true });
}
