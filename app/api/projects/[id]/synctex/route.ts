import { getProject, locate } from "@/src/server";

export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/synctex">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	const { page, x, y } = (await request.json()) as { page: number; x: number; y: number };
	return Response.json({ hit: await locate(project, Number(page), Number(x), Number(y)) });
}
