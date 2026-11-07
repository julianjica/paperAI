import { getProject, removeQueued } from "@/src/server";

/** Remove a queued message before it starts. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]/queue/[qid]">) {
	const { id, qid } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	return removeQueued(project, qid) ? Response.json({ ok: true }) : Response.json({ error: "Not queued (it may have started)" }, { status: 404 });
}
