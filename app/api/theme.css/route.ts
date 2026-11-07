import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/config";

/**
 * Optional local theme: `data/theme.css` (gitignored) overrides the design
 * tokens in app/globals.css. Lets a licensed palette stay on this machine.
 */
export async function GET() {
	const file = path.join(DATA_DIR, "theme.css");
	let css = "";
	try {
		css = fs.readFileSync(file, "utf8");
	} catch {
		css = "/* no local theme: add data/theme.css to override the tokens in app/globals.css */\n";
	}
	return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" } });
}
