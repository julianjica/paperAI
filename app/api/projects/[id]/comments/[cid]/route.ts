import { deleteComment, getProject, updateComment } from "@/src/server";

export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]/comments/[cid]">) {
	const { id, cid } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	const patch = (await request.json()) as Record<string, unknown>;
	const allowed: Record<string, unknown> = {};
	if (typeof patch.text === "string") allowed.text = patch.text;
	if (patch.status === "pending") Object.assign(allowed, { status: "pending", resolution: undefined, turnId: undefined }); // reopen
	const comment = updateComment(project, cid, allowed);
	return comment ? Response.json({ comment }) : Response.json({ error: "No such comment" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]/comments/[cid]">) {
	const { id, cid } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	deleteComment(project, cid);
	return Response.json({ ok: true });
}
