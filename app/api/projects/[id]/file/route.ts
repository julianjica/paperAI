import fs from "node:fs";
import path from "node:path";
import { getProject } from "@/src/server";

/** Read-only view of a manuscript file. */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/file">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	const rel = new URL(request.url).searchParams.get("path") ?? "";
	const abs = path.resolve(project.folder, rel);
	if (!abs.startsWith(project.folder + path.sep)) return Response.json({ error: "Outside the project" }, { status: 400 });
	try {
		return Response.json({ path: rel, text: fs.readFileSync(abs, "utf8") });
	} catch {
		return Response.json({ error: "Cannot read file" }, { status: 404 });
	}
}
