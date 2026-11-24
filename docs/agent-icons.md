# Agent icons: the file contract

Each kind of agent (`omp`, `claude`, `codex`, `cursor`, `other`) can have an animated icon, authored as a **Lottie** animation (exported from
Cavalry or After Effects with Bodymovin/LottieFiles) and saved as one `.json` file. The app bundles the icons of the known kinds in
`src/assets/agents/<kind>.json`, and the user can assign any file that follows this page to a kind in **Settings → Agent control → Icons**.
Until a kind has art, the app draws a squircle in the agent's colour with its initial.

The icon is drawn at **18, 20, 30 and 34 px**.

## The file

| | |
| --- | --- |
| Artboard | **96 × 96**, starting at frame 0 (`ip` = 0), any frame rate |
| Silhouette | a **squircle** (the shape of the fallback, below), solid, so the icon sits with the others |
| Readable at 18 px | a solid silhouette; **no stroke or gap thinner than 4 px at 96** (it would be under 1 px at 18) |
| Size | **at most 512 KB** |
| Images | none needed. If you use any, only **PNG or WebP embedded in the file** as base64 data. Nothing external: no linked image, audio or font file |
| Expressions | **none**. The player has no expression engine, and an expression in a file is ignored, never run |
| Text | outline it. A font that loads from outside the file is refused |
| Format | Lottie JSON. A `.lottie` (dotLottie) archive is not supported |

The squircle of the fallback, on a 24-unit canvas (multiply by 4 for the 96 artboard):
`M12 0C20.4 0 24 3.6 24 12S20.4 24 12 24S0 20.4 0 12S3.6 0 12 0Z`.

## The four states: markers

The timeline carries **four markers**, named exactly (lower case) and each at least one frame long. The marker's start and length are the frames
that state plays; the rest of the timeline is never shown.

| Marker | Used when | Plays |
| --- | --- | --- |
| `idle` | the agent is connected and quiet | **loops** |
| `listening` | the agent waits for what the user does (`hmb events`) | **loops** |
| `acting` | the agent just changed the screen (`show`, `brief`, `goto`, …) | **once**, then goes to `listening` |
| `arriving` | the agent just appeared | **once**, then goes to `idle` |

Make the end of each looping marker match its start, so the loop does not jump.

**The first frame of `idle` is the still.** With Reduce Motion on (the system setting `prefers-reduced-motion`), the icon shows that one frame in
every state and never animates. Design it as the finished, resting icon.

In After Effects add the markers on a layer's or the composition's timeline (Layer → Add Marker; the marker's *comment* is its name, its *duration*
is its length) and tick **Export markers** in Bodymovin. In the JSON they are `markers: [{ "cm": "idle", "tm": 0, "dr": 30 }, …]`.

## Colour: `.tint` and `.fg`

Two layer names are special. Name a layer (or a shape group inside one) so that the name **starts with** one of these, followed by nothing, a
space or a separator:

| Name starts with | The layer's fills and strokes take |
| --- | --- |
| `.tint` (`.tint`, `.tint body`, `.tint-ring`) | the agent's colour (`--a`) |
| `.fg` (`.fg`, `.fg eyes`) | the theme's foreground colour (`--fg`) |

Everything else keeps the colours in the file. Use plain solid fills and strokes on these layers: a gradient is replaced by the one colour. A fill
or stroke that the file does not have is not added. Layer opacity and animation still apply. `.tinted` and `.fgx` do not match.

How it works: lottie-web draws each layer as an SVG `<g>` and puts the layer's `cl` field on it as its class; it never writes the layer's name
(`nm`) into the page. When the app loads a file it copies a name starting `.tint` or `.fg` into `cl` (`tint`, `fg`), keeping any class the exporter
already wrote, in layers, in precompositions and in shape groups. A stylesheet then colours `.tint` and `.fg`. Check your export: the layer's `nm`
in the JSON must be the name you gave it.

The agent colours, light and dark (also the CSS tokens `--agent-<kind>`):

| Kind | Light | Dark |
| --- | --- | --- |
| `omp` | `#17876f` teal | `#62d3b6` |
| `claude` (Claude Code) | `#4e62cc` periwinkle | `#a3b0ff` |
| `codex` | `#b0620f` amber | `#f0a458` |
| `cursor` | `#8447b4` violet | `#d0a0f0` |
| `other` (and any kind `hmb` does not know) | `#6a6878` grey | `#aeacbb` |

Draw the art so that `.tint` shapes read on both a light and a dark page, and leave the rest in colours that do too, or use `.fg`.

## What the app refuses

**Choose file…** checks the file and says why when it refuses; nothing is assigned then. A file is refused when it is over 512 KB, is not valid
JSON or not a Lottie animation, links an image, audio or font from outside the file (or embeds anything but base64 PNG or WebP), or lacks any
of the four markers (or has one twice, or with no length). The file is then copied into the app's data folder, so moving or deleting the original
changes nothing. **Reset** forgets it and deletes the copy. Assignments are saved per kind.

## For developers

`src/agent-appearance.ts`: `agentIcon(agent, { size, state })` returns the element (`setState(state)`, `destroy()`); `validateIconFile(text)` is the
check above (the native side, `src-tauri/src/agent_icons.rs`, repeats it before writing). The player is lottie-web's light SVG build
(`lottie-web/build/player/lottie_light`), which has no expression support: its expression hook is empty and nothing in the app installs one.
