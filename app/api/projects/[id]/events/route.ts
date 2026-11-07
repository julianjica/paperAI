import { getProject, subscribe } from "@/src/server";

/** One SSE stream per open workspace. */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/events">) {
	const { id } = await ctx.params;
	if (!getProject(id)) return new Response("No such project", { status: 404 });
	const encoder = new TextEncoder();
	let unsubscribe = () => {};
	let timer: ReturnType<typeof setInterval> | undefined;
	const stream = new ReadableStream({
		start(controller) {
			const send = (data: unknown) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// closed
				}
			};
			unsubscribe = subscribe(id, send);
			timer = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(": ping\n\n"));
				} catch {
					// closed
				}
			}, 15000);
			request.signal.addEventListener("abort", () => {
				unsubscribe();
				if (timer) clearInterval(timer);
				try {
					controller.close();
				} catch {
					// already closed
				}
			});
		},
		cancel() {
			unsubscribe();
			if (timer) clearInterval(timer);
		},
	});
	return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
