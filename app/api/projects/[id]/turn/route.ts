import { getProject, submit } from "@/src/server";

/** Starts a turn; progress arrives on the events stream. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/turn">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	const body = (await request.json()) as { text?: string; sendComments?: boolean };
	try {
		// Starts a turn, or queues the message while one is running.
		return Response.json(submit(project, { text: String(body.text ?? ""), sendComments: body.sendComments === true }));
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
}
