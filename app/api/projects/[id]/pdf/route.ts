import fs from "node:fs";
import { getProject, pdfPath, servedPdfPath } from "@/src/server";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/pdf">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return new Response("No such project", { status: 404 });
	// Prefer the atomically published copy; fall back to the build output for projects compiled before it existed.
	const file = fs.existsSync(servedPdfPath(project)) ? servedPdfPath(project) : pdfPath(project);
	if (!fs.existsSync(file)) return new Response("Not compiled yet", { status: 404 });
	const bytes = fs.readFileSync(file);
	if (bytes.length === 0) return new Response("Build in progress", { status: 503, headers: { "Retry-After": "2" } });
	return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
