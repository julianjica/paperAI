import { getProject, lastCompile, listComments, listManuscriptFiles, listQueued, listWorkers, readChat, removeProject, touchProject, turnRunning } from "@/src/server";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	touchProject(id);
	return Response.json({ project, files: listManuscriptFiles(project.folder), chat: readChat(project), comments: listComments(project), workers: listWorkers(project.id), compile: lastCompile(project) ?? null, running: turnRunning(project.id), queued: listQueued(project) });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
	const { id } = await ctx.params;
	removeProject(id);
	return Response.json({ ok: true });
}
