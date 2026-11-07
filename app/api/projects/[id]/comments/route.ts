import { addComment, getProject, listComments } from "@/src/server";
import type { Comment } from "@/src/core";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/comments">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	return Response.json({ comments: listComments(project) });
}

export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/comments">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	const body = (await request.json()) as Omit<Comment, "id" | "createdAt" | "status">;
	if (!body.text?.trim()) return Response.json({ error: "Empty comment" }, { status: 400 });
	return Response.json({ comment: addComment(project, { rects: body.rects ?? [], page: body.page, quote: body.quote ?? "", file: body.file ?? null, line: body.line ?? null, text: body.text }) });
}
