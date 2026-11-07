import { getProject, replyToComment } from "@/src/server";

/** The author replies on a comment's thread; the comment goes back to pending for the next batch. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/comments/[cid]/reply">) {
	const { id, cid } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	const body = (await request.json()) as { text?: string };
	const text = body.text?.trim();
	if (!text) return Response.json({ error: "Empty reply" }, { status: 400 });
	const comment = replyToComment(project, cid, text);
	return comment ? Response.json({ comment }) : Response.json({ error: "No such comment" }, { status: 404 });
}
