import { z } from "zod";
import type { AgentEvent, Effort, EngineId } from "../core/types.ts";

/** A tool the app gives an agent. `schema` is a zod raw shape: Claude Code
 *  takes it directly, Codex gets `jsonSchemaOf(tool)`. */
export interface AppTool {
	name: string;
	description: string;
	schema: z.ZodRawShape;
	handler: (input: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
}

export function jsonSchemaOf(tool: AppTool): Record<string, unknown> {
	const schema = z.toJSONSchema(z.object(tool.schema), { target: "draft-7" }) as Record<string, unknown>;
	delete schema.$schema;
	return schema;
}

export interface RunOptions {
	/** The paper folder: the agent's working directory. */
	cwd: string;
	/** App instructions. On Claude Code they are appended to its default prompt. */
	systemPrompt: string;
	model: string;
	effort: Effort;
	/** The user turn. */
	input: string;
	/** Engine session/thread to resume, from an earlier `session` event. */
	resume?: string;
	tools: AppTool[];
	signal: AbortSignal;
	/** Tag for logs. */
	label?: string;
}

export interface Engine {
	id: EngineId;
	run(options: RunOptions): AsyncIterable<AgentEvent>;
}

/** A push-based async iterable: producers push events, the consumer awaits them. */
export class EventChannel<T> implements AsyncIterable<T> {
	private items: T[] = [];
	private waiting: ((r: IteratorResult<T>) => void) | undefined;
	private closed = false;
	push(item: T) {
		if (this.closed) return;
		if (this.waiting) {
			const w = this.waiting;
			this.waiting = undefined;
			w({ value: item, done: false });
		} else this.items.push(item);
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		if (this.waiting) {
			const w = this.waiting;
			this.waiting = undefined;
			w({ value: undefined as never, done: true });
		}
	}
	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: () => {
				if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false });
				if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
				return new Promise((resolve) => (this.waiting = resolve));
			},
			return: () => {
				this.close();
				return Promise.resolve({ value: undefined as never, done: true });
			},
		};
	}
}

/** Truncate tool output for transcripts and activity lines. */
export function clip(text: string, max = 4000): string {
	return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;
}
