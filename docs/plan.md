# researchAI — plan (2026-11-06)

An Overleaf-like desktop/web app where agents rewrite parts of a LaTeX paper.
Borrows engine plumbing from learnharness (AGPL-3.0, personal use).

## Decisions (made with the owner)
1. Main agent runs the CLI (Claude Code or Codex) with its NATIVE tools on, cwd = paper folder.
2. Layout: chat (left) | PDF (right). Comments are made by highlighting text in the PDF;
   SyncTeX maps the selection back to file:line. No source editor in v1 (read-only diff view only).
3. Delegation: an app-provided `delegate` tool on both engines; the main agent splits work into
   ad-hoc parallel workers on demand. Native subagent features are disabled so every worker is visible.
4. Edit safety: snapshot the manuscript before each turn; show a diff per turn; Revert restores it.
5. New project in researchAI (not a fork). Sample paper under examples/ for live testing.

## Stack
Next.js 16 + React 19 + Tailwind 4 + TypeScript (tsx tests with node:test), pdfjs-dist (text layer for
selection), @anthropic-ai/claude-agent-sdk, codex app-server over JSON-RPC, latexmk + synctex (TeX Live),
Electron shell (dev: `next dev` + electron pointed at localhost).

## Layout
```
app/            page.tsx (projects), p/[id]/page.tsx (workspace), api/* route handlers
components/     workspace, chat, composer, pdf-viewer, comment-popover, comments-panel,
                activity-panel (workers), changes-panel (diff + revert), settings
src/core/       pure types + helpers: events, comments, project, chat record, synctex parsing, diff
src/engine/     engine.ts (common interface + AgentEvent), claude-code.ts, codex.ts, exec.ts (detection)
src/server/     projects store, settings, compile (latexmk), synctex, snapshots, comments store,
                chat store, turn pipeline (snapshot → run → diff → compile → persist), app tools, workers
electron/       main.cjs, preload.cjs (folder picker)
examples/sample-paper/  main.tex, sections/*.tex, appendix.tex, refs.bib
data/           settings.json, projects.json (gitignored)
data/projects/<id>/  build/ (latexmk outdir), snapshots/<turn>/, comments.json, chat.json, queue.json
                     (moved out of the paper folder on 2026-11-11: Dropbox made "conflicted copy"
                     duplicates of chat.json inside <paper>/.researchai/; a legacy folder is migrated)
```

## Engine interface (src/engine/engine.ts)
```ts
type AgentEvent =
  | { type: "session"; id: string }
  | { type: "text_delta"; text: string } | { type: "thinking_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; output: string; isError: boolean }
  | { type: "usage"; input: number; output: number; cacheRead: number }
  | { type: "done"; text: string } | { type: "error"; message: string };
interface RunOptions { cwd; systemPrompt; model; effort; input; resume?: string; tools: AppTool[]; signal }
interface Engine { id: "claude-code" | "codex"; run(o: RunOptions): AsyncIterable<AgentEvent> }
```
- Claude Code: `query()` with `cwd`, `systemPrompt: {preset: "claude_code", append}`, `permissionMode:
  "bypassPermissions"` + `allowDangerouslySkipPermissions`, `disallowedTools: ["Agent", "Task"]`,
  `mcpServers: { researchai: createSdkMcpServer(tools) }`, `settingSources: []` (the app owns the prompt),
  `resume`, `includePartialMessages`, effort. Session id from `system/init`. Env strips ANTHROPIC_API_KEY
  unless RA_CLAUDE_CODE_USE_API_KEY=1.
- Codex: `codex app-server` with shell/file tools ON (`--disable multi_agent` only), `sandbox:
  "workspace-write"`, `approvalPolicy: "never"`, `cwd`, `dynamicTools` for app tools, `thread/start` or
  `thread/resume`, `turn/start`. Item types commandExecution/fileChange map to tool_start/tool_end.

## App tools (given to the main agent)
- `delegate({ tasks: [{ title, instructions }] })` — runs each task as a one-shot worker on the same engine
  (worker model from settings), cwd = paper folder, native tools on, tools = [compile]. Parallel.
  Returns each worker's final text. Workers stream to the activity panel.
- `compile()` — runs latexmk; returns ok/errors (log excerpt).
- `resolve_comment({ id, note })` — marks a sent comment resolved with the agent's note.

## Turn pipeline (POST /api/projects/:id/turn, SSE)
1. Build input: user text + any comments the user sent in this batch (id, file:line, quoted text, request).
2. Snapshot manuscript files (.tex .bib .sty .cls .bst, recursive, excluding the legacy .researchai) → snapshots/<turn>/.
3. Run engine; stream events; persist to chat.json; record session id.
4. On done: diff snapshot vs now (added/removed/changed files with unified diff), compile, emit
   `changes` + `compiled` events. Revert endpoint restores the snapshot (and deletes files created).

## Comments
Highlight in the PDF text layer → popover → comment {id, page, rects, quote, file, line, text, status:
pending|sent|resolved, resolution}. "Send N comments" button sends all pending ones as one turn.
file:line via `synctex edit -o page:x:y:<pdf>`; x,y in PDF points from the top-left of the page.
Highlights are drawn as overlays; resolved comments hide their highlight.
Threads: `thread` holds the exchange after the original request (author replies, agent notes) in
order; `text` and `resolution` stay for old files. A reply (POST .../comments/:cid/reply) sets the
comment back to pending so it rides with the next batch, rendered to the agent as a follow-up with
its history; every closer (resolve_comment and the end-of-turn fallbacks) also notes on the thread.

## Verification
- Tests (no LLM): synctex output parsing, snapshot/diff/revert, comments store, turn pipeline with a
  scripted engine, delegate tool fan-out, Codex RPC framing.
- Live: compile examples/sample-paper, one chat turn on Claude Code and on Codex, one comment batch,
  one delegate fan-out, revert.

## Review fixes (advisor, 2026-11-06)
- **Compile queue.** One latexmk in flight per project; a second request while one runs coalesces into
  one pending run. The main agent, workers and the post-turn compile all go through it. The system
  prompt tells agents to use `compile()` rather than latexmk through Bash.
- **Disjoint worker files.** `delegate` tasks declare `files: string[]`; a batch where two tasks share
  a file is rejected as a tool error so the main agent re-plans. Single-file papers get sequential
  workers. The sample paper has sections/*.tex so both shapes are exercised.
- **SyncTeX coordinates.** pdf.js user space is bottom-left; `synctex edit` takes top-left. Convert
  `y = pageHeight - y_pdf`. Run `synctex edit -o page:x:y:<absolute build dir>/main.pdf` from the paper
  folder; verify `Input:` paths resolve. First live check after the sample paper compiles.
- **Permissions.** Try `bypassPermissions` + `allowDangerouslySkipPermissions`; fall back to
  `acceptEdits` + an allow-all `canUseTool` if a folder's settings refuse it.
- **Trade-off.** cwd = paper folder means Claude Code stores sessions under
  `~/.claude/projects/<paper folder>/`, next to the owner's own CLI history for that folder.
- **Long delegate calls.** `delegate` blocks until workers finish. If the Codex app-server times out
  dynamic tool calls, switch to `delegate` returning worker ids + a `wait_workers` tool.
- **Snapshot** also records a listing of the whole tree (minus .researchai and .git) so revert can
  delete files the agent created (figures, scripts).
- Compile on project open, not only after turns.
- Build order: sample paper + compile + synctex check → engine interface + Claude Code adapter + one
  turn end to end → PDF viewer + comments → delegate + workers → Codex → diff/revert → Electron.

## Status (2026-11-06, end of build)
Built and live-checked: compile + synctex; Claude Code turn with Read/Edit/compile; comment batch
with two parallel workers on disjoint files and `resolve_comment`; Codex turn with one delegated
worker (model ids must be ones a ChatGPT login accepts, e.g. `gpt-5.6-sol`); PDF highlight → popover
→ SyncTeX anchor in headless Chrome; diff + revert through the API; 12 deterministic tests pass.
Not yet live-checked: the Electron window (code written, `npm run desktop:dev`), revert from the UI.
Known limits: the `delegate` call blocks until workers finish (no timeout seen on either CLI so far);
sessions resume per project only while the engine stays the same; multi-page selections keep the
first page only.

## Writing standard (2026-11-07)
Correctness is a MUST: no formal statement, proof, intuition, example or implication goes into the paper
unless the agent has verified it (derivation plus a numerical check); a false result or a proof gap is
reported with a counterexample and sent to the author through `ask_author`, never papered over.
Agent edits read as artificial unless they follow the conventions of well-presented formal theory
papers. `src/server/writing-guide.ts` distils those conventions (shape of the paper; how propositions,
definitions and the paragraph after a result are written; prose habits; what reads as artificial; how to
edit someone else's manuscript) and both the main and worker prompts include it verbatim.

## Round two (2026-11-07): threads, per-project settings, robustness
Built by three parallel agents in worktrees and merged. Comment threads: an author reply reopens a
comment and reaches the agent as a follow-up with its history; agent notes land on the thread.
Per-project settings: engine/model/effort overrides and a style note appended to both prompts.
Robustness: per-worker timeouts (default 20 min) and a turn ceiling (default 90 min), both in Settings;
abort reaches every worker and the CLI child; turns interrupted by a server restart are closed with a
note and their changes recovered from the snapshot; the live stream reloads on reconnect; the two CLI
adapters are tested by replaying real recorded transcripts (tests/fixtures, scripts/record-transcript.mjs).

## Backups and synced folders (2026-11-11)
- Agents copied the main file to `*_backup_before_*.tex` before edits (eleven such files in one
  paper). Rule in both prompts: never make backup copies, the turn snapshot is the backup.
  Enforcement: `validateTasks` refuses backup-looking file names; `removeDuplicateCopies` runs at
  the end of every turn and deletes created files that are byte-identical to a pre-existing
  file's snapshot or current version (`TurnRecord.removedCopies`, shown in the Changes tab).
- All app state moved from `<paper>/.researchai/` to `data/projects/<id>/`. The Dropbox-ignore
  xattr was not reliable (one folder never got it; conflicted copies of chat.json piled up).
  latexmk gets an absolute `-outdir`; `synctex edit` is given the absolute PDF path with
  cwd = the paper folder, so input names resolve. `ensureSidecar` migrates a legacy folder
  (own files only, conflicted copies dropped) and removes it.
