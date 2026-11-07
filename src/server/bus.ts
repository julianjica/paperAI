import type { ProjectEvent } from "../core/types.ts";

/** One in-process pub/sub per project, feeding the workspace's SSE stream. */
// On globalThis so SSE subscribers survive a dev-server module reload.
const g = globalThis as unknown as { __raBus?: Map<string, Set<(event: ProjectEvent) => void>> };
g.__raBus ??= new Map();
const listeners = g.__raBus;

export function publish(projectId: string, event: ProjectEvent): void {
	for (const l of listeners.get(projectId) ?? []) {
		try {
			l(event);
		} catch {
			// a dead subscriber never blocks the turn
		}
	}
}

export function subscribe(projectId: string, listener: (event: ProjectEvent) => void): () => void {
	let set = listeners.get(projectId);
	if (!set) listeners.set(projectId, (set = new Set()));
	set.add(listener);
	return () => {
		set!.delete(listener);
	};
}
