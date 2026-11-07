import { compile, getProject } from "@/src/server";

export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/compile">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	return Response.json({ result: await compile(project) });
}
