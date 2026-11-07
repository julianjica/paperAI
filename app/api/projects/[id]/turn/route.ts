import { getProject, startTurn, turnRunning } from "@/src/server";

/** Starts a turn; progress arrives on the events stream. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/turn">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	if (turnRunning(id)) return Response.json({ error: "A turn is already running." }, { status: 409 });
	const body = (await request.json()) as { text?: string; sendComments?: boolean };
	try {
		const { turnId, done } = startTurn(project, { text: String(body.text ?? ""), sendComments: body.sendComments === true });
		done.catch((error) => console.error(`[turn ${turnId}]`, error));
		return Response.json({ turnId });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
}
