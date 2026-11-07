import { addProject, listProjects } from "@/src/server";

export async function GET() {
	return Response.json({ projects: listProjects() });
}

export async function POST(request: Request) {
	const body = (await request.json()) as { folder?: string; mainTex?: string };
	try {
		const project = addProject(String(body.folder ?? ""), String(body.mainTex ?? ""));
		return Response.json({ project });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
}
