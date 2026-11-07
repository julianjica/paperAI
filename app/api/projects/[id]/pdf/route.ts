import fs from "node:fs";
import { getProject, pdfPath } from "@/src/server";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/pdf">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return new Response("No such project", { status: 404 });
	const file = pdfPath(project);
	if (!fs.existsSync(file)) return new Response("Not compiled yet", { status: 404 });
	const bytes = fs.readFileSync(file);
	return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
