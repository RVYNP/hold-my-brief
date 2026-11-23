# Controlling Hold My Brief from AI agents & the CLI (`hmb`)

Hold My Brief exposes a fast, local per-user control bridge so coding and research agents (Claude Code, Codex, Cursor, T3 Code, OpenCode, scripts) can use it as an always-on-top **visual sidecar** while you keep full manual GUI control.

## Why `hmb` is fast and cheap for agents

- **Zero idle token overhead:** Use the thin `hmb` CLI (or the compact 5-tool `hmb mcp` bridge) instead of loading dozens of tool schemas into every turn.
- **Single-call compound state:** Open a PDF, jump to page 14, highlight a match, split beside a Markdown spec, and pin on top in **one command**.
- **In-place live briefs:** `hmb brief --id plan` renders ephemeral Markdown, charts, flowcharts, and sanitized SVGs directly in a dedicated tab — updating that same tab in place without cluttering your Library or Recents, and without stealing keyboard focus.
- **Bidirectional context:** Browse a 300-page PDF in the GUI, select a paragraph, and let your terminal agent inspect it with `hmb status` / `hmb read --selection`.

## Security & privacy

- **Local only:** On macOS/Linux, Hold My Brief listens on an owner-only (`0600`) Unix domain socket in its app data folder. On Windows, it binds a loopback-only (`127.0.0.1`) raw NDJSON listener guarded by a per-session 256-bit random token. Browsers and remote hosts cannot reach it.
- **Controllable in Settings:** Open **Settings → Agent control** (desktop app) to turn local CLI/agent control off or on at any time. Turning it off immediately closes the socket and removes `control.json`.
- **Safe visuals:** All inline SVGs and `.svg` files pass through a strict allow-list sanitizer (`<script>`, `<foreignObject>`, event handlers, and external URLs are stripped).

## Building the `hmb` CLI

```sh
cargo build --release --manifest-path src-tauri/Cargo.toml --bin hmb
# Optional: symlink onto your PATH
ln -sf "$(pwd)/src-tauri/target/release/hmb" /usr/local/bin/hmb
```

## CLI reference

```sh
# 1. Inspect current reader state (active tab, position, split panes, selection)
hmb status --json

# 2. Show a document, jump to a location, highlight a phrase, and split beside another file
hmb show spec.pdf --page 14 --find "token refresh" --beside docs/auth.md --pin

# 3. Auto-reload a file as an agent edits it on disk
hmb show docs/plan.md --watch

# A split needs room: side by side, the reading area must be at least 728 px wide (two 360 px panes and the divider); stacked, 488 px tall.
# When the window cannot make the split, the document opens as a tab in the current pane and the reply
# says why in `splitRefused` (for example "The window is too narrow to split"); try `--split down` or widen the window.

# 4. Push or update an ephemeral visual brief in place (never added to Library/Recents)
hmb brief --id plan --title "Migration Plan" --split right <<'EOF'
# Migration Plan

> [!TIP]
> Re-running `hmb brief --id plan` updates this tab in place and keeps your scroll position.

```chart
{
  "type": "metrics",
  "title": "Benchmark",
  "items": [
    { "label": "Warm IPC", "value": "14 ms", "tone": "positive" },
    { "label": "Tool calls", "value": "1", "note": "compound show" }
  ]
}
```

```flow
direction: LR
Agent[hmb CLI] --NDJSON--> Socket(Local Socket) -> App[Hold My Brief]
```
EOF

# 5. Read what the user is looking at (or just their highlighted text)
hmb read --limit 4000
hmb read --selection

# 6. Navigate, search, theme, or clean up
hmb goto 42
hmb find "architecture" --show
hmb cmd --theme graphite --mode dark --pin
hmb close --briefs
```

## Wait for the user

The reader records what the user does, and `hmb events` returns it, waiting until something happens. Use it to let the user point at
something instead of describing it: show a brief, then wait for them to select a passage and send it.

```sh
hmb events --wait 60 --type send,selection    # block up to 60 s; print what the user sent or selected
hmb events --since 12 --json                  # everything after seq 12, as the reply JSON
hmb events --follow | while read -r e; do …; done   # one JSON line per event, forever
```

`hmb events [--since N] [--wait SECONDS] [--type a,b] [--limit N] [--follow] [--json]`:

| Flag | Meaning |
| --- | --- |
| `--since N` | Only events with `seq` greater than N (default 0: everything the app still holds). |
| `--wait SECONDS` | Without a matching event, wait up to this long (0–60, default 30). An empty list after the wait is not an error; the exit code is 0. |
| `--type a,b` | Only these types (repeatable): `selection`, `page`, `tab`, `send`. |
| `--limit N` | At most N events (default 50, at most 256). |
| `--follow` | Loop forever, passing each reply's `next` as the next call's `since`, and print each event as one JSON line (NDJSON) as it arrives. A wait of 0 is raised to 1 s here. Ends on Ctrl-C, when the reader of the pipe goes away, or when the app stops answering (exit 1). |
| `--json` | Print the reply (`{ "events": [...], "next": N }`) instead of one line per event. |

Without `--json`, each event is one line: `seq type place text…`, where `place` is the position label, title or path. A reply that
starts with `(older events were dropped)` had missed events (see `dropped` below).

### Events

Every event has `seq` (starts at 1 and grows by one per event while the app runs), `at` (Unix ms), `type`, and these fields:

| `type` | Sent when | Fields |
| --- | --- | --- |
| `selection` | The user's text selection in a reading surface stopped changing for 600 ms, is not empty and differs from the last one reported | `paneId`, `path`, `title`, `where` (position label), `text` (at most 2000 characters) |
| `send` | The user ran **Send selection to agent** (palette, or Ctrl+Shift+Enter / ⌘⇧↩) | the same as `selection` |
| `page` | The active document's position label changed and stayed for 800 ms (not while a document loads or reloads) | `paneId`, `path`, `position`, `progress` (0–1, four decimals) |
| `tab` | A pane showed another tab, or a tab was closed | `action` (`shown` \| `closed`), `paneId`, `path`, `title`, `format`, `brief` (boolean) |

Briefs have `path` `hold-my-brief:brief/<id>`. No document text other than the user's selection is ever in an event; strings are cut at 2000 characters.

### The `since` / `next` loop

A reply is `{ "events": [...], "next": N }`. `next` is the `seq` of the last event returned, or the latest `seq` when none matched, so
passing it back as `since` never repeats or skips an event:

```sh
next=0
while :; do
  reply=$(hmb events --since "$next" --wait 30 --type send --json) || break
  next=$(jq -r .next <<<"$reply")
  jq -c '.events[]' <<<"$reply" | while read -r e; do …; done
done
```

The app keeps the newest 256 events. If `since` is older than the oldest it still has, the reply also has `"dropped": true`: some events
were lost, so re-read the state with `hmb status` rather than assuming. If the app restarted, its `seq` starts again at 1; a `since`
larger than the latest `seq` returns `next` as the latest `seq`, which puts the loop back in step.

Events are kept in memory only, never written to disk, and only while **Settings → Agent control** is on: turning it off drops the
log and the reader stops recording. `events` is answered by the app itself, so a waiting call never delays `show`, `brief` or `status`.

## Visual blocks supported in Markdown & briefs

Hold My Brief renders these natively using your active theme tokens (all 17 light, dark, and glow themes):

- **Callouts:** `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`
- **Charts (` ```chart `):** JSON object with `type`: `"hbar"` | `"bar"` | `"line"` | `"metrics"`, optional `title`, `subtitle`, `unit`, and `data: [{ label, value, highlight? }]` (or `items` for `metrics`).
- **Flowcharts (` ```flow `):** `direction: LR` or `TB`, optional `title: ...`, and chains like `A[Client] --HTTP--> B(Server) -> C[DB]` (`(...)` highlights a node with the theme accent).
- **Inline SVG (` ```svg `)** and **standalone `.svg` files:** Strictly sanitized, supporting Hold My Brief theme variables (`var(--fg)`, `var(--muted)`, `var(--accent)`, `var(--accent-ink)`, `var(--card)`, `var(--border)`).

## Compact MCP server (`hmb mcp`)

For MCP-only clients, point your client at `hmb mcp` (stdio). It exposes only **5 coarse tools** (`hmb_brief`, `hmb_show`, `hmb_status`, `hmb_read`, `hmb_events`) to keep prompt token overhead minimal. `hmb_events` takes `since`, `wait` (seconds, at most 30) and `types`, and returns the same `{ "events": [...], "next": N }` reply as `hmb events --json`; the MCP server answers one request at a time, so a waiting `hmb_events` call holds the others until it returns.

```json
{
  "mcpServers": {
    "hold-my-brief": {
      "command": "hmb",
      "args": ["mcp"]
    }
  }
}
```

## Agent skill (`skills/hold-my-brief/SKILL.md`)

The repository ships an [Agent Skills](https://agentskills.io) skill that teaches agents when and how to use `hmb`:
[`skills/hold-my-brief/SKILL.md`](../skills/hold-my-brief/SKILL.md). Link or copy its folder into the skill directory your agent reads:

```sh
ln -s "$(pwd)/skills/hold-my-brief" ~/.claude/skills/hold-my-brief   # Claude Code
ln -s "$(pwd)/skills/hold-my-brief" ~/.agents/skills/hold-my-brief   # Codex, omp and other Agent Skills readers
```
