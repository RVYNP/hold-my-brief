# Controlling Hold My Brief from AI agents & the CLI (`hmb`)

Hold My Brief exposes a fast, local per-user control bridge so coding and research agents (Claude Code, Codex, Cursor, T3 Code, OpenCode, scripts) can use it as an always-on-top **visual sidecar** while you keep full manual GUI control.

## Why `hmb` is fast and cheap for agents

- **Zero idle token overhead:** Use the thin `hmb` CLI (or the compact 4-tool `hmb mcp` bridge) instead of loading dozens of tool schemas into every turn.
- **Single-call compound state:** Open a PDF, jump to page 14, highlight a match, split beside a Markdown spec, and pin on top in **one command**.
- **In-place live briefs:** `hmb brief --id plan` renders ephemeral Markdown, charts, flowcharts, and sanitized SVGs directly in a dedicated tab — updating that same tab in place without cluttering your Library or Recents, and without stealing keyboard focus.
- **Bidirectional context:** Browse a 300-page PDF in the GUI, select a paragraph, and let your terminal agent inspect it with `hmb status` / `hmb read --selection`.

## Security & privacy

- **Local only:** On macOS/Linux, Hold My Brief listens on an owner-only (`0600`) Unix domain socket in its app data folder. On Windows, it binds a loopback-only (`127.0.0.1`) raw NDJSON listener guarded by a per-session 256-bit random token. Browsers and remote hosts cannot reach it.
- **Controllable in Settings:** Open **Settings → General → Agent control** to turn local CLI/agent control off or on at any time. Turning it off immediately closes the socket and removes `control.json`.
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

## Visual blocks supported in Markdown & briefs

Hold My Brief renders these natively using your active theme tokens (all 17 light, dark, and glow themes):

- **Callouts:** `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`
- **Charts (` ```chart `):** JSON object with `type`: `"hbar"` | `"bar"` | `"line"` | `"metrics"`, optional `title`, `subtitle`, `unit`, and `data: [{ label, value, highlight? }]` (or `items` for `metrics`).
- **Flowcharts (` ```flow `):** `direction: LR` or `TB`, optional `title: ...`, and chains like `A[Client] --HTTP--> B(Server) -> C[DB]` (`(...)` highlights a node with the theme accent).
- **Inline SVG (` ```svg `)** and **standalone `.svg` files:** Strictly sanitized, supporting Hold My Brief theme variables (`var(--fg)`, `var(--muted)`, `var(--accent)`, `var(--accent-ink)`, `var(--card)`, `var(--border)`).

## Compact MCP server (`hmb mcp`)

For MCP-only clients, point your client at `hmb mcp` (stdio). It exposes only **4 coarse tools** (`hmb_brief`, `hmb_show`, `hmb_status`, `hmb_read`) to keep prompt token overhead minimal:

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

## Drop-in agent skill (`SKILL.md`)

Add this snippet to your agent's skill directory or instructions file:

```markdown
---
name: hold-my-brief
description: Show visual briefs, diagrams, charts, diffs, and referenced PDF/Markdown pages in Hold My Brief without cluttering chat.
---

Use the `hmb` CLI to present visuals in Hold My Brief (pinned beside the user's workspace, non-focus-stealing by default):

- Visual brief (update in place by reusing `--id`):
  `hmb brief --id <slug> --title "<Title>" <<'EOF' ... EOF`
  Supports Markdown, `> [!NOTE|TIP|WARNING]` callouts, ` ```chart ` JSON (`hbar|bar|line|metrics`), ` ```flow ` (`A[Box] -> B(Accent)`), and theme-aware ` ```svg `.
- Open a file at an exact page/line/heading/match (optionally split beside another file or `--watch` for live reload):
  `hmb show <file> [--page N | --heading TEXT] [--find QUERY] [--beside FILE] [--watch] [--pin]`
- Read what the user is currently looking at or selected:
  `hmb status --json` or `hmb read --selection`
```
