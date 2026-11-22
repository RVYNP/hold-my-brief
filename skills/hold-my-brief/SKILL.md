---
name: hold-my-brief
description: Show the user visuals and references in Hold My Brief (the always-on-top reader) with the `hmb` CLI - live Markdown briefs with charts, flow diagrams and SVG, PDFs/EPUBs/Markdown opened at an exact page, heading or match, split panes, and what the user is looking at or has selected. Use whenever a plan, comparison, diagram, diff summary or document reference reads better on a screen than in chat, or when the user says "show me", "put it in Hold My Brief", "hmb" or "brief".
license: MIT
compatibility: macOS, Windows and Linux with Hold My Brief running and Settings → Agent control on; the `hmb` binary on PATH.
---

# Hold My Brief (`hmb`)

Hold My Brief is the user's screen for agents: a small reader window beside their work. You push things to it; they look; they
point back by selecting text or turning pages, which you read with `hmb status` / `hmb read --selection`. Chat stays short.

`hmb` talks to the running app over a private per-user socket. It never steals keyboard focus unless you pass `--focus`.

## Check it is there

```sh
hmb ping            # {"pid":…,"ready":true,"version":1}
hmb status --json   # window size, layout, panes, tabs, active document and position, user's selection
```

If `ping` fails: the app is not running (`hmb` launches it unless `--no-launch`) or Agent control is off in Settings. Say so; do not retry in a loop.

## Briefs: show something you made

~~~sh
hmb brief --id plan --title "Migration plan" <<'EOF'
# Migration plan

> [!TIP]
> Re-running with the same --id updates this tab in place and keeps the user's scroll position.

```chart
{"type":"hbar","title":"Time per step","unit":"min","data":[{"label":"Build","value":14,"highlight":true},{"label":"Test","value":6}]}
```

```flow
direction: LR
Agent[hmb CLI] --NDJSON--> Sock(control socket) -> App[Hold My Brief]
```
EOF
~~~

- One `--id` per topic. Push again with the same id to update it; `--append` adds to the end. Never open a new id for each revision.
- Briefs are ephemeral: never saved to the Library, Recents or the session. `--format md|txt|svg`; `--file F` or `--text T` instead of stdin.
- `--base-dir DIR` lets relative images in the Markdown resolve inside DIR.
- Blocks: callouts `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`; ` ```chart ` JSON with `type` `hbar|bar|line|metrics`, `data: [{label, value, highlight?}]`
  (or `items: [{label, value, note?, tone?}]` for metrics); ` ```flow ` with `direction: LR|TB` and chains `A[Box] --label--> B(Accent) -> C[Box]`;
  ` ```svg ` (sanitized: no scripts, no external URLs; colour with `var(--fg)`, `var(--muted)`, `var(--accent)`, `var(--card)`, `var(--border)`).
- Raw HTML in Markdown is not rendered. Use the blocks above.

## Show a document or reference

```sh
hmb show spec.pdf --page 14 --find "token refresh"     # open, jump, highlight the first match
hmb show notes.md --heading "Rollout" --watch           # reload in place whenever the file changes on disk
hmb show spec.pdf --beside notes.md --beside-find "SLA" # two documents side by side
hmb goto 42                                             # page or line in the active document
hmb find "query" --show 2                               # list matches, reveal the third
hmb outline --json                                      # headings / table of contents with their targets
```

`--ephemeral` keeps an opened file out of the Library and Recents. `--pin` keeps the window on top.

## Splits need room

`--split right|down` (on `brief`) and `--beside` (on `show`) need a window large enough: side by side, the reading area must be
at least 728 px wide; stacked, 488 px tall. When it is not, the document opens as a tab instead and the reply has
`"splitRefused": "<why>"`. Then try `--split down`, or `hmb cmd --reading` (760 × 900), or tell the user. Read the reply; do not assume.

## Read what the user is looking at

```sh
hmb read --selection        # only the user's highlighted text
hmb read --limit 4000       # text of the visible page(s); scanned PDFs have none and say so
```

## Window and appearance

```sh
hmb cmd --pin | --unpin | --lock | --unlock | --compact | --reading | --focus
hmb cmd --theme graphite --mode dark --page sepia
```

The reply's `done` lists every change made. Restore anything you changed for a demo.

## Clean up

`hmb close --briefs` closes every brief; `hmb close <id-or-path>` one. Close what you opened when the task ends unless the user wants it kept.

## Etiquette

- The user reads there while you work: update one brief in place rather than stacking tabs, and do not navigate a document they are reading unless asked.
- Keep the chat reply short and point at the brief by its title.
