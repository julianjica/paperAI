import { compile, getProject, hasSnapshot, readChat, revertToSnapshot, turnRunning } from "@/src/server";
import { writeChat } from "@/src/server/chat";

export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/revert">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	if (turnRunning(id)) return Response.json({ error: "Wait for the running turn to finish." }, { status: 409 });
	const { turnId } = (await request.json()) as { turnId: string };
	if (!hasSnapshot(project, turnId)) return Response.json({ error: "No snapshot for that turn (it may have been pruned)." }, { status: 404 });
	const reverted = revertToSnapshot(project, turnId);
	const chat = readChat(project);
	const turn = chat.turns.find((t) => t.id === turnId);
	if (turn) turn.reverted = true;
	writeChat(project, chat);
	const result = await compile(project);
	return Response.json({ reverted, compile: result });
}
