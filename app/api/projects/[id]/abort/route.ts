import { abortTurn } from "@/src/server";

export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/abort">) {
	const { id } = await ctx.params;
	return Response.json({ aborted: abortTurn(id) });
}
