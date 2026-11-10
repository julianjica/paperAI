import { activeTurnId, closeStaleSent, ensureSidecar, getProject, lastCompile, listComments, listManuscriptFiles, listQueued, listWorkers, readChat, recoverInterruptedTurns, removeProject, touchProject, turnRunning } from "@/src/server";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	touchProject(id);
	ensureSidecar(project);
	// A turn cut short by a server restart is closed first, so its comments count as stale below.
	recoverInterruptedTurns(project);
	// Comments left "sent" by a turn that is over are closed so the groups stay honest.
	closeStaleSent(project, activeTurnId(id));
	return Response.json({ project, files: listManuscriptFiles(project.folder), chat: readChat(project), comments: listComments(project), workers: listWorkers(project.id), compile: lastCompile(project) ?? null, running: turnRunning(project.id), queued: listQueued(project) });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
	const { id } = await ctx.params;
	removeProject(id);
	return Response.json({ ok: true });
}
