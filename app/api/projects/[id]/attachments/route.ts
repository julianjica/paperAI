import { addAttachment, getProject, listAttachments, MAX_ATTACHMENT_BYTES } from "@/src/server";

/** The documents attached to this project's chat. */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/attachments">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	return Response.json({ attachments: listAttachments(project) });
}

/** Upload one PDF (multipart field "file"); it is sent with a later message by id. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/attachments">) {
	const { id } = await ctx.params;
	const project = getProject(id);
	if (!project) return Response.json({ error: "No such project" }, { status: 404 });
	const length = Number(request.headers.get("content-length") ?? 0);
	if (length > MAX_ATTACHMENT_BYTES + 4096) return Response.json({ error: `The file is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` }, { status: 413 });
	let file: File | null = null;
	try {
		const form = await request.formData();
		const f = form.get("file");
		if (f instanceof File) file = f;
	} catch {
		// not multipart
	}
	if (!file) return Response.json({ error: "Send the PDF as the multipart field \"file\"." }, { status: 400 });
	try {
		const attachment = await addAttachment(project, file.name, new Uint8Array(await file.arrayBuffer()));
		return Response.json({ attachment });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
}
