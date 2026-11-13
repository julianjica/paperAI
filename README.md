# paperAI

**An Overleaf-like editor where coding agents rewrite parts of your LaTeX paper.**

Open a project folder, pick the main `.tex`, and the app compiles and renders the PDF.
Chat with the main agent on the left, or highlight a passage in the PDF and leave a comment
the way you would in Overleaf. Send the comments as a batch and the agent edits the sources,
recompiles, and reports back. When a request splits into independent pieces, the agent spins
up parallel workers on demand.

It runs on the **Claude Code** or **Codex** CLI already signed in on your machine. There are
no API keys to manage: each run is billed to whatever plan that CLI is logged into.

> **Personal use only.** Anthropic's and OpenAI's terms do not allow apps to offer their
> subscription sign-in to other users. Run this for yourself; don't distribute builds.
> Engine plumbing is adapted from [learnharness](https://github.com/julianjica/learnharness)
> (AGPL-3.0), so this project is AGPL-3.0 as well.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install and run](#install-and-run)
- [Using the app](#using-the-app)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Development](#development)
- [Known limits](#known-limits)

---

## Features

| | |
|---|---|
| **Chat with the paper** | Ask for rewrites, additions, cuts, consistency checks. The agent edits the `.tex`/`.bib` files in place, compiles, and tells you what changed in terms of sections and passages. |
| **Comments on the PDF** | Highlight text in the rendered PDF and write what should change. SyncTeX maps the highlight to `file:line`, so the agent knows exactly where to look. A **Send** button ships every pending comment as one batch; each one comes back resolved with a short note. |
| **Parallel workers** | The main agent can delegate independent tasks (several sections, several comments in different files) to workers that run at the same time. Each worker is limited to the files it declares; overlapping batches are refused. Workers appear in the **Activity** tab with live progress and their final reports. |
| **Safe edits** | Before every turn the manuscript is snapshotted. The **Changes** tab shows a per-file diff for each turn and a **Revert** button that restores the snapshot and removes files the agent created. |
| **Two engines** | Claude Code (`claude`) or Codex (`codex`), chosen in Settings, with separate models and effort levels for the main agent and for workers. |
| **Web or desktop** | Runs in the browser from `npm run dev`, or inside an Electron window with a native folder picker. |

## Requirements

- **Node.js 22+** and npm.
- **A TeX distribution** with `latexmk` and `synctex` (MacTeX / TeX Live). `/Library/TeX/texbin` is found automatically on macOS.
- **At least one CLI, installed and signed in:**
  - Claude Code: install it, run `claude`, then `/login`.
  - Codex: install it, then `codex login`.
- A plan with room in it. Turns and workers count against the plan's normal limits.

## Install and run

```bash
git clone git@github.com:julianjica/paperAI.git
cd paperAI
npm install
npm run dev
```

Open the URL printed by `next dev` (normally `http://localhost:3000`). To try it right away,
open the sample paper that ships with the repo: press **Browse…**, choose
`examples/sample-paper`, and **Open**.

Desktop window instead of a browser tab:

```bash
npm run desktop:dev   # next dev + Electron, with a native "Open folder" dialog
```

## Using the app

1. **Open a paper.** Press **Browse…** and choose the folder in the native dialog (or paste a
   path). Pick the main `.tex` when the folder holds several, and Open. The app compiles once
   so the PDF is fresh.
2. **Set the engine and models** (gear icon): Claude Code or Codex, the main-agent model, the
   worker model, and effort levels. Only CLIs found on your machine are offered.
3. **Chat.** Type a request and press Enter. The agent reads and edits files, compiles, and
   replies. Tool calls show as collapsible rows; the PDF refreshes when the compile succeeds.
   **Stop** aborts the current turn.
4. **Comment.** Select text in the PDF. A popover shows the quote and the resolved source
   location; write what should change and **Add comment**. Pending comments are highlighted
   in yellow. Repeat as needed.
5. **Send the batch.** In the Comments tab press **Send N**, or send a chat message with
   "Include pending comments" checked. Comments turn blue while in progress and move to
   Resolved with the agent's note when done. Click a comment to jump to it in the PDF and to
   its line in the Source view.
6. **Review and revert.** The Changes tab lists every turn's file changes with a diff.
   Revert restores the files as they were before that turn.

## How it works

```
browser ──SSE──▶ Next.js route handlers ──▶ turn pipeline
                                              │  snapshot → run engine → diff → compile → persist
                                              ▼
                        Engine (one interface, two adapters)
                   ┌──────────────────────┬───────────────────────┐
                   │ Claude Code          │ Codex                  │
                   │ @anthropic-ai/       │ codex app-server       │
                   │ claude-agent-sdk     │ JSON-RPC over stdio    │
                   │ native tools ON      │ native tools ON        │
                   │ cwd = paper folder   │ sandbox workspace-write│
                   └──────────────────────┴───────────────────────┘
                         app tools: compile · resolve_comment · delegate
```

- **The main agent** runs with the CLI's own file and shell tools, in your paper folder, with
  the app's instructions appended to the CLI's prompt. The CLI's built-in subagents are
  disabled so that all delegation goes through the app and is visible.
- **App tools.** `compile` runs `latexmk -pdf -synctex=1` through a per-project queue (one
  build at a time; concurrent requests coalesce). `resolve_comment` records the note you see
  in the Comments tab. `delegate` takes a list of tasks, each with a title, full instructions
  and the files it may edit; it runs them in parallel as one-shot worker sessions on the same
  engine and returns their reports.
- **Comments** are stored with the highlight rectangles, the quoted text, and the SyncTeX
  anchor. The agent receives them as a numbered list with ids; the line is where the
  highlighted text starts, and the agent is told to open the file and look around it.
- **Sessions resume.** Each project keeps its Claude Code session or Codex thread, so later
  turns only send what's new. A failed turn drops the session and the next one starts fresh.
- **Snapshots** copy the manuscript files (`.tex .bib .sty .cls .bst`) plus a listing of the
  whole tree, so a revert can also delete figures or scripts the agent created.

## Configuration

Settings are edited in the app and stored in `data/settings.json` (or under the user data
folder in the desktop app).

| Env var | Effect |
|---|---|
| `RA_CLAUDE_CODE_PATH` / `RA_CODEX_PATH` | Use this executable instead of searching `PATH` and the usual install locations. |
| `RA_CLAUDE_CODE_USE_API_KEY=1` / `RA_CODEX_USE_API_KEY=1` | Let the CLI see `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from the environment. By default they are stripped so the CLI's login decides billing. |
| `RA_DATA_DIR` | Where the project list and settings live (default `./data`). |
| `RA_DEV_URL` | Electron only: point the window at a running dev server instead of spawning the built one. |

Codex model ids must be ones your ChatGPT login accepts (the settings list offers
`gpt-5.6-sol`, `gpt-5.6-luna`, `gpt-6-sol`, and so on).

## Project layout

```
app/            Next.js pages and API route handlers (transport only)
components/     workspace, chat, composer, PDF viewer, comment popover, panels, settings
src/core/       pure types and helpers (events, comments, SyncTeX parsing, LaTeX log parsing)
src/engine/     Engine interface + Claude Code and Codex adapters
src/server/     projects, settings, compile queue, SyncTeX, snapshots, comments, chat, turn pipeline, workers, app tools
electron/       desktop shell and preload (folder picker)
examples/       sample paper for trying the app
tests/          deterministic tests (no LLM, no network)
docs/plan.md    design record: decisions, architecture, review fixes, status
```

A project is one root document: a folder plus its main .tex, with its own chat, comments
and history. To work on another root file of the same folder (a slides deck, a short
version, a submission variant), open the paper's settings and pick it under "Main file":
the app opens that document's project (created on first use with the same settings), and
picking the previous file brings its chat back.

Per-project state (build output, chat, comments, snapshots) lives under the app's data
directory, `data/projects/<id>/`, never inside the paper folder: a paper folder is usually
synced (Dropbox, Overleaf, git), and app state inside it produced "conflicted copy"
duplicates and constant churn. The only file the app writes into the folder is the
compiled `<main>.pdf`. A `.researchai/` folder left by an older version is moved out and
removed the first time the paper is opened.

Agents never make backup copies of files: every turn is snapshotted and can be reverted,
and a copy of an existing file left in the folder at the end of a turn is deleted (the
Changes tab says so).

## Development

```bash
npm test            # tsx + node:test; scripted engines, real file system in temp dirs
npx tsc --noEmit    # typecheck
npm run build       # production build (standalone output, used by the desktop shell)
```

The tests cover SyncTeX parsing, LaTeX error extraction, snapshot/diff/revert, the comments
store, the turn pipeline with a scripted engine (resume, tool recording, delegation with
disjoint files, error handling), and both engine adapters against scripted CLIs.

## Known limits

- `delegate` blocks until every worker finishes; very long batches hold the turn open.
- A text selection that spans two PDF pages keeps only the first page.
- Switching engines starts a fresh session for the project (history stays in the chat, but
  the model does not carry it over).
- The desktop shell is a thin wrapper; there is no packaged installer yet.
