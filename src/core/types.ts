/** Pure domain types shared by server and browser. No IO here. */

export type EngineId = "claude-code" | "codex";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Settings {
	engine: EngineId;
	/** Model for the main agent. */
	model: string;
	/** Model for delegated workers. */
	workerModel: string;
	effort: Effort;
	workerEffort: Effort;
}

export interface Project {
	id: string;
	/** Absolute path of the paper folder. */
	folder: string;
	/** Main .tex file, relative to `folder`. */
	mainTex: string;
	name: string;
	createdAt: number;
	openedAt: number;
}

/** A rectangle on a PDF page in CSS-pixel-independent units: fractions of page width/height. */
export interface PageRect {
	page: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

export type CommentStatus = "pending" | "sent" | "resolved";

export interface Comment {
	id: string;
	createdAt: number;
	/** Where the highlight sits in the PDF (fractions of the page box, top-left origin). */
	rects: PageRect[];
	page: number;
	/** The highlighted text. */
	quote: string;
	/** Source anchor from SyncTeX: file relative to the folder, 1-based line. */
	file: string | null;
	line: number | null;
	/** What the user wants done here. */
	text: string;
	status: CommentStatus;
	/** The turn that carried it to the agent. */
	turnId?: string;
	/** The agent's note when it resolved the comment. */
	resolution?: string;
}

/** Events an engine run emits. Both engines produce exactly this stream. */
export type AgentEvent =
	| { type: "session"; id: string }
	| { type: "text_delta"; text: string }
	| { type: "thinking_delta"; text: string }
	| { type: "tool_start"; id: string; name: string; input: unknown }
	| { type: "tool_end"; id: string; name: string; output: string; isError: boolean }
	| { type: "usage"; input: number; output: number; cacheRead: number }
	| { type: "done"; text: string }
	| { type: "error"; message: string };

/** One tool call as recorded in the transcript. */
export interface ToolCallRecord {
	id: string;
	name: string;
	input: unknown;
	output?: string;
	isError?: boolean;
}

export type ChatMessage =
	| { role: "user"; id: string; text: string; commentIds?: string[]; timestamp: number }
	| {
			role: "assistant";
			id: string;
			turnId: string;
			/** Ordered parts, as streamed. */
			parts: AssistantPart[];
			usage?: { input: number; output: number; cacheRead: number };
			error?: string;
			aborted?: boolean;
			timestamp: number;
	  };

export type AssistantPart =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string }
	| { kind: "tool"; call: ToolCallRecord };

export interface FileChange {
	path: string;
	kind: "added" | "removed" | "modified";
	/** Unified diff (text files only). */
	diff: string;
}

export interface TurnRecord {
	id: string;
	startedAt: number;
	endedAt?: number;
	changes: FileChange[];
	/** Whether the snapshot still exists for revert. */
	reverted?: boolean;
	compile?: CompileResult;
}

export interface CompileResult {
	ok: boolean;
	/** Error lines from the log (empty when ok). */
	errors: string[];
	durationMs: number;
	/** Monotonic version of the PDF; the viewer reloads when it changes. */
	version: number;
}

export type WorkerStatus = "running" | "done" | "error";

export interface WorkerState {
	id: string;
	turnId: string;
	title: string;
	files: string[];
	status: WorkerStatus;
	startedAt: number;
	endedAt?: number;
	/** Streamed activity: the last text and tool lines, newest last. */
	activity: string[];
	result?: string;
}

/** Events the workspace subscribes to over SSE (one stream per project). */
export type ProjectEvent =
	| { type: "turn_start"; turnId: string }
	| { type: "agent"; turnId: string; event: AgentEvent }
	| { type: "turn_end"; turnId: string; turn: TurnRecord }
	| { type: "worker"; worker: WorkerState }
	| { type: "compiled"; result: CompileResult }
	| { type: "comments"; comments: Comment[] };
