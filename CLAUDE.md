# researchAI

Read `docs/plan.md` first: decisions, architecture, and the review fixes that shape the code.

- `src/core` is pure (types + helpers, no IO). `src/engine` wraps the two CLIs behind one
  `Engine` interface emitting `AgentEvent`s. `src/server` owns all state under `data/` and
  `data/projects/<id>/` (never inside the paper folder, which is usually synced). `app/api` routes are transport only. `components/` renders.
- The main agent runs with the CLI's native tools ON and cwd = the paper folder. Native
  subagents are disabled; delegation goes through the app's `delegate` tool so workers are visible.
- Compiles are serialized per project (`src/server/compile.ts`). Never call latexmk elsewhere.
- `npm test` must pass (tsx + node:test, no LLM). `npx tsc --noEmit` must be clean.
- This Next.js version differs from training data: read `node_modules/next/dist/docs/` before
  touching routing or config.
