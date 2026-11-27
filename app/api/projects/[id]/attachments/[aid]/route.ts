import fs from "node:fs";
import { attachmentPdfPath, deleteAttachment, getAttachment, getProject } from "@/src/server";

/** The PDF itself, shown inline. */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/attachments/[aid]">) {
	const { id, aid } = await ctx.params;
	const project = getProject(id);
	if (!project) return new Response("No such project", { status: 404 });
	const attachment = getAttachment(project, aid);
	if (!attachment) return new Response("No such attachment", { status: 404 });
	const bytes = fs.readFileSync(attachmentPdfPath(project, aid));
	return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}`, "Cache-Control": "private, max-age=3600" } });
}

/** Remove a document (the chat bubbles that mention it keep their record). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]/attachments/[aid]">) {
	const { id, aid } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	return deleteAttachment(project, aid) ? Response.json({ ok: true }) : Response.json({ error: "No such attachment" }, { status: 404 });
}
