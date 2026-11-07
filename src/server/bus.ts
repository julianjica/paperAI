import type { ProjectEvent } from "../core/types.ts";

/** One in-process pub/sub per project, feeding the workspace's SSE stream. */
const listeners = new Map<string, Set<(event: ProjectEvent) => void>>();

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
