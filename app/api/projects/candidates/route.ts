import { listMainCandidates } from "@/src/server";
import fs from "node:fs";
import path from "node:path";

export async function GET(request: Request) {
	const folder = new URL(request.url).searchParams.get("folder") ?? "";
	const abs = path.resolve(folder.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
	if (!folder || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return Response.json({ error: "Not a folder" }, { status: 400 });
	return Response.json({ folder: abs, candidates: listMainCandidates(abs) });
}
