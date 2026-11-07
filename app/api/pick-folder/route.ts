import { pickFolder } from "@/src/server";

/** Opens a native folder dialog on the server's machine (local, single-user app). */
export async function POST() {
	return Response.json({ folder: await pickFolder() });
}
