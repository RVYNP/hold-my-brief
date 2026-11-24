# The procedural agent indicator (spec for AG2)

Work order for the app. The numbers come from a working prototype, kept beside this file in [`reference/`](reference): [`reference/indicator.ts`](reference/indicator.ts) (≈310 lines, no dependencies beyond the app's own `procedural-cover.ts`), [`reference/check.ts`](reference/check.ts) and [`reference/cover-density.ts`](reference/cover-density.ts). Port it rather than re-derive it, then delete `reference/` in the same PR. Contact sheets: [`contact-sheet-dark.png`](contact-sheet-dark.png), [`contact-sheet-light.png`](contact-sheet-light.png); in context on Home: [`in-context-home-dark.png`](in-context-home-dark.png). The look-and-feel notes, videos and other composites are in the owner's lookdev folder, not in the repo.
In this spec, `proto/src/indicator.ts` means `reference/indicator.ts`, `proto/src/check.ts` means `reference/check.ts`, and `proto/vendor/procedural-cover.ts` means the app's `src/procedural-cover.ts` plus `reference/cover-density.ts`. References to `renders/` and `composites/` point at the owner's files. App line references are to `main` @ `cb2a08a`.

**Decisions already made by the owner** (not re-opened here): procedural (code, not Lottie); user picks each agent's colour; user can turn the visual effects on and off; subtle; the squircle `M12 0C20.4 0 24 3.6 24 12S20.4 24 12 24S0 20.4 0 12S3.6 0 12 0Z`; defaults omp teal `#17876f`/`#62d3b6`, Claude Code periwinkle `#4e62cc`/`#a3b0ff`; sizes 18 (lists), 20 (rail), 30 (floating), 34 (Home card); states `idle`, `listening` (loops), `acting` (one shot ≈ 0.9 s), `arriving` (one shot ≤ 1 s).

---

## 1. Module layout

| New file | Pure? | What |
|---|---|---|
| `src/agent-look.ts` | pure (no DOM) | `lookFor`, `markPair`, `agentPalette`, `glyphColour`, `channels`, easing, `defaultMarks`, the settings parser |
| `src/agent-indicator.ts` | canvas | `Indicator` (paints one frame), the shared clock, mounting, pause rules |
| `src/agent-indicator.css` | | host box, `overflow: visible`, `image-rendering: pixelated`, `.agent-indicator[data-effects=off]` |
| `tests/agent-look.test.ts` | | section 11 checks 1-9 (port of `proto/src/check.ts`) |
| `e2e/agent-indicator.spec.ts` | | section 11 checks 10-16 |

Changes to existing files:

| File | Change |
|---|---|
| `src/procedural-cover.ts` | export `mulberry32`, `smoothstep`, `bayer4` (the table), `blue` (rename to `blueThresholds`), `between`; **extract** the first half of `renderCover` (`:270-295`) as `coverDensity` (section 9). `renderCover` becomes `coverDensity` + one `dither` call; **its output must not change by a bit** (check 4). |
| `src/theme.ts` | export `toOklch`, `fromOklch`, `reach`, `contrast`, `rgbToHex`, `hexToRgb` (already exported except `hexToRgb`, `:64`). No behaviour change. The worst-background constants (`lightWorst #e2d0d9`, `darkWorst #2d2a24`) live in `agent-look.ts`; a unit test recomputes them from the family tokens so a palette change cannot silently break them. |
| `src/settings.ts` | Agent control section (`:49-52`): add the Effects switch and the Agents colour rows (section 7). |
| `src/main.ts` | subscribe views to `agentFeed` where `:2066-2068` says nothing draws agents yet; no new native events are needed. |
| `src/icon-rail.ts` | an agents stack above Settings in `.icon-rail-foot` (`:62-71`), under the Pinned/Size locked chips. |
| `src/home.ts` | an Agents section (cards) next to Recently opened. |

---

## 2. Seed → parameters

### 2.1 What a seed is

An agent in the registry is `AgentEntry { kind, name, pid?, terminal?, … }` (`control.ts:332-342`); its key is `(kind, pid)` (`control.rs:200`), and `pid` is **not stable** across runs. Identity inputs, most stable first:

| Input | Decides | Why |
|---|---|---|
| `kind` (`omp`, `claude`, `codex`, `cursor`, `other`, `unknown`; `control.rs:186`) | family, dither method, ink coverage, tones, tempo, tab side/offset, crawl direction, **default colour** | the species: omp always looks like omp |
| `terminal` (e.g. "Ghostty", "Tern") | the texture's composition (the field's seed) | two omps in different terminals are siblings, not twins; same shelf-and-book logic as covers (`procedural-cover.ts:3`) |
| `pid` | where in its loop the agent starts (`phase`) | so four agents never pulse in step; changes nothing visual at rest |
| `name` | only for `kind === 'other'`: part of the **settings key** (`other:<name>`) and of the seed in place of `kind` | scripts that call themselves `other` still get a stable look |

```ts
export const seedSalt = 'hmb-agent/3';
kindSeed = seedFrom(`${seedSalt}\n${key}`)                 // key = kind, or `other\n${name}` for kind "other"
seed     = terminal ? seedFrom(`${seedSalt}\n${key}\n${terminal}`) : kindSeed
phaseRng = mulberry32(seedFrom(`${seedSalt}\n${key}\n${terminal}\n${pid}`))
k        = mulberry32(kindSeed)          // the species stream: draw order below is part of the contract
```

`seedFrom` is `procedural-cover.ts:43`. **Family and method of the six known kinds come from a fixed table (`kindSlots`), not the hash**, the way `shelf.ts` gives sibling shelves their family by slot (`shelf.ts:132-135`), so they cannot collide by accident and a later change to the hash cannot reshuffle them. Only `other:<name>` keys take family and method from the hash. `seedSalt` and the draw order still fix the hashed parameters (ink, tones, tempo, tab, crawl, texture composition); treat both as frozen once released.

### 2.2 Parameters and their ranges

Drawn from `k` **in this order** (a new parameter is appended, never inserted):

| # | Parameter | Draw | Range / values | Effect |
|---|---|---|---|---|
| 1 | `method` | `k()` (always drawn) | `kindSlots[kind].method`, else `['bayer4','bayer8','blue'][floor(k()*3)]` | grain character: Bayer 4 = fine regular hatch, Bayer 8 = chunkier regular, blue = organic dust. `atkinson` is excluded: error diffusion cannot be animated by a threshold. |
| 2 | `ink` | `k()` | `.20 + .10·k()` | share of texture pixels at rest (the covers' is .31-.37, `procedural-cover.ts:13`; an icon is quieter) |
| 3 | `tones` | `k()` | `k() < .5 ? 2 : 3` | 3 = soft (ink 1 and 2), 2 = crisp (ink 2 only, ≈ 1.7 : 1), as `coverPalette(…, tones)` (`:252-255`) |
| 4 | `tempo` | `k()` | `.90 + .22·k()` | loop period multiplier (idle 7 s, listening 2 s); one-shots ignore it |
| 5 | `tabSide`, `tabOffset` | `k()`, `k()` | `k() < .5 ? -1 : 1`; `.14 + .08·k()` | which side of centre the tab sits on and how far |
| 6 | `crawl` | `k()` | one of `[1,0] [0,1] [1,1] [1,-1] [-1,0] [0,-1]` | direction of the listening texture crawl |
| – | `family` | none | `kindSlots[kind].family`, else `coverFamilies[(kindSeed >>> 24) % 5]` = `familyFor(kindSeed)` | pattern family (`procedural-cover.ts:51`) |
| – | `phase` | `phaseRng()` | 0-1 | start offset in the loop |

In prototype: `kindSlots` and `lookFor(kind, terminal, pid)`, `proto/src/indicator.ts:107-138`. The known kinds (five families for six kinds, so cursor shares omp's family with a different method):

| kind | family | method | tones | ink | tempo |
|---|---|---|---|---|---|
| omp | stripes | blue | 3 | .29 | 1.00 |
| claude | flow | bayer8 | 2 | .28 | .94 |
| codex | contours | bayer4 | 2 | .20 | .96 |
| cursor | stripes | bayer8 | 2 | .29 | .98 |
| other | truchet | bayer8 | 2 | .21 | 1.07 |
| unknown | arcs | bayer4 | 2 | .24 | .97 |

### 2.3 What stays constant on purpose

Silhouette, glyph, sizes, easing and state durations are **the same for every agent**: only the *skin* varies, like covers on a shelf. Two agents are told apart by colour first, texture second; both together are what makes them look like the app's own art.

---

## 3. Colour

### 3.1 Defaults and derivation

One user-visible colour per agent key; the light and dark marks are derived, never stored.

```ts
markPair(hex): { light, dark }
  light = reach(base, lightWorst #e2d0d9, 3, -0.01)   // theme.ts:92 `reach`; the darkest light rail wash of the 7 families (Peony: --chrome 92 % + --fg 8 %, style.css:201,206,380), darker than every light Home card
  dark  = reach(fromOklch([max(L, .74), min(C, .15), H]), darkWorst #2d2a24, 3, +0.01)   // the lightest dark Home card (Birch --hover), lighter than every dark rail wash; L >= .74, chroma <= .15: quiet at night
```

(`accentVars`, `theme.ts:155-181`, holds accent marks to 3.5 : 1 against **white**; the indicator instead holds 3 : 1 (WCAG 1.4.11, a filled graphic) against the **worst real background it sits on**, which is the stricter test: on white every preset lands at 4.3-4.6 : 1. Glow themes are not covered: their rail is glass over a glow with no single colour; e2e check 15 samples them.) Why not call `accentVars` itself: its dark mark is tuned to sit on text surfaces at L .68; a 20 px solid squircle wants L ≥ .74 to stay present at night.

| Kind | Default light | Default dark | Source |
|---|---|---|---|
| omp | `#17876f` | `#62d3b6` | owner |
| claude | `#4e62cc` | `#a3b0ff` | owner |
| codex | `markPair('#c27a1a')` → `#a96600` | `#e39842` | Amber preset (`appearance.ts:12`) |
| cursor | `markPair('#5f8a3a')` → `#568131` | `#8dbb6a` | Moss |
| other | `markPair('#c2456b')` → `#c2456b` | `#f77f9e` | Rose |
| unknown | `markPair('#6a6c74')` → `#6a6c74` | `#a8aab3` | graphite, quiet on purpose |

Presets offered in the picker are the app's own seven accents (`appearance.ts:12`): Acid `#e13a3a`, Iris `#a86af4`, Blue `#3d6fff`, Teal `#2b8a84`, Rose `#c2456b`, Moss `#5f8a3a`, Amber `#c27a1a`. Derived marks for each (light | dark): Acid `#dd3637` | `#fb8178`; Iris `#9657df` | `#bc92f9`; Blue `#3a6cfb` | `#82a8ff`; Teal `#23847e` | `#63bdb6`; Rose `#c2456b` | `#f77f9e`; Moss `#568131` | `#8dbb6a`; Amber `#a96600` | `#e39842`. Pathological custom colours behave: `#f0f0f0` → light `#767676`, `#101010` → dark `#ababab`, `#ffee00` → light `#817800`, dark `#f9ee6c` (checks 5 and 6). The owner's omp light `#17876f` sits exactly at the bar (3.01 : 1 on Peony's rail wash) and is kept as approved.

### 3.2 Tones (the "palette mixing")

`agentPalette(mark, scheme)` → `[base, ink1, ink2]`: OKLCH lightness **away from the ground** by .07 and .14, hue and chroma kept (`fromOklch` reduces chroma to fit; `theme.ts:83`), i.e. lighter on dark, darker on light, exactly the direction of `coverPalette` (`procedural-cover.ts:246-249`). If there is no headroom (`L ± .14` outside .05-.97: near-white on dark, near-black on light) the direction flips so the steps survive. Measured steps for every default and preset: 1.23-1.36 : 1, inside the app's 1.15-1.45 band (`:245`); extremes are held to 1.10-1.45 (check 6).

### 3.3 Glyph / initial contrast

The glyph is two dots (`r = 1.75/24 · size`, centres ±2.9/24 · size from the middle; the rail's agents mark). `glyphColour(palette)` picks white `#ffffff` or `#14120f`, whichever has the higher **minimum** contrast over all three tones, and nudges it with `reach` if that minimum is under **3 : 1**. An initial letter (only allowed at ≥ 30 px, never at 18/20) must reach **4.5 : 1** on the weakest tone by the same routine. Texture is kept out of the glyph by a clear zone: density × `smoothstep(.6, 2.2, distance to a dot in cells)`.

Contrast table (defaults; page = Lilac surface `#fbfafc` / `#1e1d24`):

| kind | scheme | base | ink1 | ink2 | glyph | glyph min ratio | base vs page |
|---|---|---|---|---|---|---|---|
| omp | light | `#17876f` | `#00715b` | `#005b49` | `#ffffff` | 4.4 | 4.27 |
| omp | dark | `#62d3b6` | `#7aeacc` | `#9fffe4` | `#14120f` | 10.3 | 9.16 |
| claude | light | `#4e62cc` | `#3c4db5` | `#2c379d` | `#ffffff` | 5.3 | 5.12 |
| claude | dark | `#a3b0ff` | `#bfc9ff` | `#dce2ff` | `#14120f` | 9.1 | 8.13 |
| codex | light | `#a96600` | `#8d5400` | `#734400` | `#ffffff` | 4.6 | 4.40 |
| codex | dark | `#e39842` | `#fbae5a` | `#ffcd9a` | `#14120f` | 7.9 | 7.03 |
| cursor | light | `#568131` | `#426c1a` | `#305800` | `#ffffff` | 4.6 | 4.41 |
| cursor | dark | `#8dbb6a` | `#a3d280` | `#b9e996` | `#14120f` | 8.4 | 7.52 |
| other | light | `#c2456b` | `#aa2e57` | `#921244` | `#ffffff` | 4.8 | 4.63 |
| other | dark | `#f77f9e` | `#ffa1b7` | `#ffc6d1` | `#14120f` | 7.6 | 6.75 |
| unknown | light | `#6a6c74` | `#565860` | `#43454d` | `#ffffff` | 5.2 | 5.03 |
| unknown | dark | `#a8aab3` | `#bec0c9` | `#d5d7e0` | `#14120f` | 8.1 | 7.22 |

Ink moving away from the ground only ever raises glyph contrast, so the base tone is the binding case.

---

## 4. Geometry and grid

| Size (css px) | Where | `cell` | `n` (cells) | `pad` | canvas (cells) |
|---|---|---|---|---|---|
| 18 | lists, popover | 1 | 18 | 6 | 30 |
| 20 | rail | 1 | 20 | 6 | 32 |
| 30 | floating, in the gutter | 2 | 15 | 5 | 25 |
| 34 | Home card | 2 | 17 | 6 | 29 |

`cell` = 1 CSS px up to 20 px, else **2** (the app's pixel, `home-banner.ts:8`). `n = round(size / cell)`, `pad = ceil(n · .3)` cells of room on every side for the tab, ring and spotlight; the host box stays `size × size` with `overflow: visible`.

Layers, back to front, every frame:

1. **Outside cells** (tab, ink ring, spotlight): drawn first so the vector squircle covers their roots ("from behind").
2. **Squircle**: vector `Path2D` of the owner's path, filled with `palette[0]`, scaled `n·cell·dpr / 24`. The silhouette is always a smooth solid vector: crisp at any DPR and identical to the owner-approved shape.
3. **Texture cells**: clipped to the squircle path, nearest-neighbour from the cell buffer.
4. **Glyph**: vector circles on top.

Signed distance for the ring/spotlight: rounded box of radius `.404·n` (matches the path's 45° point to 0.2 unit), `proto/src/indicator.ts` `Indicator` constructor.

**Never** scale, rotate or sub-cell-translate a dithered canvas (it destroys the grid; this is why arriving has no lift scale or lean). Motion is whole cells.

---

## 5. Frame model: what animates and how

Each frame is `paint(state, t)`:

```
ch = channels(state, t, look, reduced)                     // a handful of numbers, section 6
for each texture cell (x, y) inside the squircle:
  v  = density[(y+oy)·W + (x+ox)] + ch.bias                 // density from coverDensity (section 9); (ox, oy) = 2 + round(ch.crawl)·look.crawl
  v += ch.bandGain · exp(-((yUp − ch.band)/.3)²)            // acting: an ink band travelling up; yUp = 0 at the bottom, 1 at the top
  v *= clearZone(glyph)                                     // keep the glyph clean
  tone = ordered threshold with the SCREEN-FIXED map of `method` (bayer4 / bayer8 / blue thresholds), tones as in look
paint outside cells: tab rows, ring, spotlight, each as (level > threshold) with the same map
```

**The one idea: animate the dither's *threshold relationship* (a bias, a band, a radius), not pixels.** The threshold map is fixed to the screen; the density under it changes. Pixels near a stroke's edge change tone first, so motion reads as ink rising and draining. The only thing that moves pattern content is listening's 1-2 cell crawl, which shifts the density under the fixed map by whole cells (a deliberate, small departure from research.md "animate only a threshold": a shifted field is what makes a listening agent look *attentive* rather than merely tinted).

At `bias = 0`, `band < 0`, no crawl, the frame **is** `renderCover`'s 2-tone dither of the same density (check 4). The resting icon is literally a miniature cover.

---

## 6. States

### 6.1 Mapping from the app's events

| Source (`control.ts`) | Instance in rail / list / Home card | Floating instance (gutter) |
|---|---|---|
| `AgentEntry.listening === true` (`:341`) | base state `listening` | base `listening` |
| `listening === false` | base `idle` | base `idle` |
| `control-agent-action` with `method` ∈ `show`, `brief` and a `path`/`target` (`:345-350`) | one-shot `acting` | one-shot `arriving` (lands beside the shown content), then base |
| any other applied action (`goto`, `find`, `cmd`, `close`, …) | one-shot `acting` | one-shot `acting` if shown, else nothing |
| entry leaves the registry | unmount (dither-out is optional; with effects on: ring level 0 → bias +.3 over 200 ms, then remove) | same |

Priority `arriving` > `acting` > base. A one-shot ends in the current base state (not necessarily the one it began in). An action within 300 ms of the last one-shot's start is coalesced into it (no restart); one that comes during a running one-shot is queued once. State changes between loops cross-fade with **no tween**: the channels switch at the next frame step (the app's own loops, e.g. `answer-pending`, are not eased either).

### 6.2 Easing tokens (Fluent 2, research.md 4.3)

| Name | cubic-bezier | Use |
|---|---|---|
| `out` | (.1, .9, .2, 1) | surfacing: band, tab out, ring spread, lift |
| `in` | (.9, .1, 1, .2) | defined, unused here |
| `io` | (.33, 0, .67, 1) | draining, host travel, settle |
| `soft` | (.45, 0, .55, 1) | defined; loops use raw sine/cosine |

`bezier(...)` is solved by Newton, 8 iterations (`proto/src/indicator.ts`). `seg(t, a, b)` = clamp((t-a)/(b-a)).

### 6.3 Channels per state (`t` in seconds; all of `proto/src/indicator.ts` `channels`)

**idle**: loop, period `7 s × tempo` (kept off the 4-6 s band research.md 4.2 warns about for tempo .9-1.12 → 6.3-7.8 s, accepted: the swing is a few pixels, not a body).
`bias = .045 · sin(2π t / period)`. Nothing else. Reduced: `bias = 0`.

**listening**: loop, `2 s × tempo`. With `s = ½ − ½ cos(2π t / period)`:
`tab = .075 + .03·s` (in widths, rounded to whole cells), `bias = .05·s`, `crawl = 1.5·s` cells (rounded). Reduced: `tab = .075`, `bias = 0`, `crawl = 0`.

**acting**: one shot, **0.9 s**.
- `band = lerp(-.3, 1.3, out(seg(t, 0, .55)))`, `bandGain = .6` (an ink band travels bottom → top, "pulled up")
- `tab = .13 · out(seg(t, 0, .2)) · (1 − io(seg(t, .5, .9)))`, the growing row **dithers in** (ink rising) instead of sliding
- `bias = .12 · out(seg(t, 0, .2)) · (1 − io(seg(t, .5, .9)))`
- ends at rest. Reduced: for `t < .9` hold `bias .3, tab .11` as one static frame, then rest.

**arriving**: one shot, **1.0 s**.
- `travel = io(seg(t, .1, .5))`: the **host** moves the element by `round(travel · distance / cell) · cell` along its rail-slot → gutter path (whole cells; not a CSS `scale`/`rotate`)
- `bias`: `.3 · out(seg(t, 0, .12))` until .5 ("carrying it"), then `lerp(.3, .5, out(seg(t, .5, .58)))`, falling with `1 − io(seg(t, .58, 1))`
- landing at .5 s: ink ring `ring = .02 + .13·out(seg(t, .5, .9))` (widths), `ringLevel = .36 · (1 − io(seg(t, .6, 1)))` (the ring dissolves by threshold, max 36 % of its cells ever on: tone-on-tone ink, research.md archive finding)
- spotlight `glow = .5 · (1 − io(seg(t, .55, 1)))`, drawn only on the 30 px floating instance, multiplied by the glow strength of section 7.5
- ends at rest. Reduced: no travel (the host places the icon at the target), `bias .3, ring .1, ringLevel .4` held 0.9 s, then rest.

### 6.4 Rendering rate (the "on twos" feel, and the budget)

| State | Steps per second | Draw only when |
|---|---|---|
| idle | 8 | the quantized key `(round(bias·64), …)` changed |
| listening | 15 | key changed |
| acting, arriving | 30 | key changed |
| any, reduced | 0 | state or settings changed |

### 6.5 What changes at 18 px versus 34 px

| | 18 / 20 px (cell 1) | 30 / 34 px (cell 2) |
|---|---|---|
| Texture | all families; tones as per look; texture is fine hatching, read as grain not pattern | the family is legible |
| Tab | 6 × 1-3 cells, whole rows only in loops | 6 × 1-5 cells, taper on the last row (≥ 5 wide) |
| Ink ring | up to ~3 cells, dotted | up to ~5 cells |
| Spotlight | **dropped** (< 30 px) | only on the floating 30 px (gutter) |
| Acting band | shown (reads as a bottom-to-top shimmer) | shown (reads as a travelling band) |
| Initial letter | **not allowed** | allowed if it holds 4.5 : 1 |
| `truchet` | reads as noise (tiles 3-6 px); accepted | readable |

---

## 7. Settings

### 7.1 Names, defaults, storage

One key, same style as `hold-my-brief:appearance` (`theme.ts:31`) and `hold-my-brief:home-banner` (`home.ts:190`), `localStorage`, wrapped in try/catch, parsed defensively like `parse()` (`theme.ts:185-198`):

```ts
export const agentLooksKey = 'hold-my-brief:agent-looks';
export type AgentLooks = { effects: boolean; colours: Record<string, string> };   // colours: key -> '#rrggbb'
export const defaultAgentLooks: AgentLooks = { effects: true, colours: {} };
```

- `effects` default **true**; anything not `true`/`false` → default.
- `colours[key]` accepted only if `/^#[0-9a-f]{6}$/i` (`theme.ts:54`), lower-cased; invalid entries dropped; the key is `kind`, or `other:<name>` for `kind: "other"`; at most 32 entries (drop the oldest).
- Both are global to the user, **not per window**, and are read at startup before first paint and applied live when changed (like `applyAppearance`, `theme.ts:209`).

### 7.2 UI (Settings sheet, `settings.ts:49-52`)

Inside the existing Agent control section, below the note:

- Row **Agent effects** with a `.settings-switch` (`settings.ts:51` markup; `style.css:1412-1415`): on by default; `aria-label="Agent indicator effects"`. Note line: "Texture and motion on agent icons. Off leaves a flat coloured icon."
- A sub-list, one row per agent key that is **connected now or has a saved colour**: name, an 18 px indicator preview (live), and a **swatch row built like the accent row** (`appearance.ts:69-75`): the agent's default (labelled "Default"), the seven accent presets, a custom `<input type=color>`; the same `.swatch` / `.swatches` classes (`style.css:1436-1439`) and roving radiogroup helper (`radioGroup`, `appearance.ts`), so keyboard behaviour is identical. Hover previews and click keeps, like the theme sheet.
- Changing a colour re-derives `markPair` and repaints every instance of that key (rail, list, Home, gutter).
- Agent control off (`settings.ts:70`) hides the sub-list (no agents) but keeps the saved values.

### 7.3 Exactly what **Effects off** removes and keeps

| Removed | Kept |
|---|---|
| the dither texture inside the squircle | the **solid vector squircle** in the agent's colour (`palette[0]`) |
| the tab, the ink band, the ink ring | the glyph (two dots, contrast-checked) |
| the spotlight / glow around the floating icon | per-agent colour (it is a setting, not an effect) |
| every animation: idle drift, listening crawl, acting, arriving, and the host's arrival travel (the icon is *placed*, no fade) | the icon's presence, size and position; hover/focus styles of its button |
| the shared clock stops (zero timers) | accessible name `"<name>, <state>"` and `title` tooltips (so state is still readable as text) |

With effects off the **frame is static**, rendered once per change. Open decision 1 (section 12) is whether `listening` should still show the tab as a static information mark.

### 7.4 Relation to the system's Reduce Motion

`prefers-reduced-motion: reduce` (the same query `home.ts:284,495` uses; the global CSS rule already zeroes durations, `style.css:918-920`): **motion off, texture stays.**
- idle and listening: static frame (idle = frame 0; listening = static tab, no crawl);
- acting and arriving: **no tween**: one static "cue" frame held 0.9 s then the base frame (section 6.3 "Reduced"); no host travel;
- the shared clock runs only for those 0.9 s holds.
Effects off wins over reduced motion (nothing at all). `forced-colors: active` is treated as Effects off. `prefers-reduced-transparency` / `prefers-contrast: more` (the blocks at `style.css:892-917,1654-1663`) switch the **spotlight and ring off** (they are the glow family), texture stays.

### 7.5 Relation to the background-strength setting

The spotlight is the same kind of thing as Home's ground: a dithered light. So it obeys the Appearance:
- **BACKGROUND = None** (`theme.ts:26`, `Appearance.banner`) → spotlight off (a user who removed the glow does not want a new one).
- otherwise glow strength = `min(.5, .12 + (backgroundStrength − .02)/.28 · .5)` (`backgroundStrength` .02-.30, default .06, `theme.ts:42-43,51`): default → .19, 30 % → .5. It multiplies the `glow` channel and the spotlight threshold level (`proto/src/indicator.ts` `glowStrength`).
- the spotlight is drawn only inside the **gutter box** (`overflow: hidden` on it), never over text, so it needs no `groundInkStrength` (`theme.ts:50`) text-contrast guarantee; if a layout ever puts it over text, clamp the strength to `groundInkStrength` (.08 → .26 mapped).
Texture and ring do not follow the strength slider (they are the icon, not the ground).

---

## 8. Rendering approach and budgets

**Canvas 2D, one `<canvas>` per indicator. No WebGL, no worker.** Grids are 30 × 30 cells at most; a WebGL context per icon (four to a dozen) costs more than the whole frame, and contexts are a scarce resource; a worker's message and transfer cost exceeds the compute.

### 8.1 Pipeline

- Cache per `(seed, size, cell, scheme, markHex, dpr)`: `density` (`Float32Array`, `(n+4)²`), threshold map (shared per `method` and `g`), `inside`/`sdf`/`glyphDist` (`Uint8/Float32`), `Path2D`, cell buffer (`OffscreenCanvas` where available, else a detached `<canvas>`) and its `ImageData`. LRU of 64 entries with `rememberRecent` (`covers.ts:11`). About 15 KB per entry.
- Frame: fill `ImageData`, `putImageData` to the small buffer, `drawImage` it scaled to the visible canvas with `imageSmoothingEnabled = false`. The vector squircle and glyph are drawn directly.
- **Crisp pixels / DPR.** `deviceCell = max(1, round(cell × dpr))`; the grid is derived in **device** pixels (`n = round(size·dpr / deviceCell)`), the canvas backing store is `g × deviceCell` and its CSS size `g × deviceCell / dpr`; `image-rendering: pixelated`. At integer DPR (1, 2, 3) cells are exactly `cell × dpr` device px. At 1.5 the cell becomes 2 device px (not 1 or 3, never a blend); the vector squircle stays exact at any DPR. Re-create on `devicePixelRatio` change (`matchMedia('(resolution: …dppx)')`).
- Sizes: 18/20 draw 1 CSS px cells; 30/34 draw 2 CSS px cells.

### 8.2 Reuse of `procedural-cover.ts` (by name)

| Used | As |
|---|---|
| `seedFrom` (`:43`) | seeds |
| `mulberry32` (`:55`, export it) | the species stream, the phase |
| `coverFamilies`, `familyFor` (`:7`, `:51`) | the family |
| `ditherMethods` (`:9`), `inkCoverage` (`:13`) | method names; the coverage band the icon's `ink` sits below |
| `bayer8` (`:175`), `bayer4` (`:172`, export), `blue()` (`:212`, export as `blueThresholds`) | the three screen-fixed threshold maps |
| `makers` via the extracted **`coverDensity`** (`:270-295`) | the density field |
| `smoothstep` (`:67`, export) | clear zone |

Not used: `renderCover`'s dither call and `coverPalette` (the icon builds its own tones from the agent colour).

### 8.3 `coverDensity` (the extraction)

`coverDensity({ seed, width, height, family?, dither?, target? }) → { density: Float32Array, family }`: exactly `renderCover` lines `:270-295` (field, stretch, S-curve, bisect of the knob `q`), returning the **shaped density at the best `q`** instead of the dithered pixels; `target` defaults to the value `renderCover` draws (`between(rng, inkCoverage.low + .01, inkCoverage.high - .01)`, `:275`), which is drawn either way so the stream stays aligned. The indicator passes `target = look.ink` and its method. A working copy is appended to [`proto/vendor/procedural-cover.ts`](proto/vendor/procedural-cover.ts). `renderCover` is rewritten to call it; check 4 proves the output is bit-identical: **all 45 `(family × method × seed)` cases pass** in the prototype (`node proto/dist/check.mjs`).

Cost note: `coverDensity` is the expensive part (≤ 11 dither passes over `(n+4)²` ≈ 400 cells, ≈ 0.1-0.3 ms); it runs **once per cache entry**, never per frame.

### 8.4 Clock and pausing

One shared scheduler (`agentIndicatorClock`), not one `requestAnimationFrame` per icon:

- Each mounted indicator registers `{ state, startedAt, stepMs, lastKey }`. A tick runs only the indicators whose next step is due; if none is due the clock sleeps with one `setTimeout` to the earliest due time (idle at 8 steps/s needs no rAF); with none registered it is fully stopped.
- **Pause rules:** `document.visibilityState === 'hidden'` → everything stops; `IntersectionObserver` (as `home.ts:536`) → an off-screen or `hidden` indicator is unregistered; a closed popover/drawer unmounts; the Home card unmounts with Home. **`.window-inactive`** (`style.css:962`, `main.ts:2104`) → **loops** freeze on their current frame, **one-shots still play**: a pinned reader beside other work is when arrivals matter most.
- A frame is skipped if its quantized channel key equals `lastKey` (idle changes the key only every few frames).

### 8.5 Budgets (hard limits for the work order)

Measured on the prototype, four agents, 400 frames per state, whole-loop timing (ms per agent-frame, 18 and 34 px, DPR 1 and 2):

| Engine | flush once per run | flush (readback) after **every** frame: upper bound |
|---|---|---|
| Playwright **WebKit** (the app's engine family; closest to WKWebView) | **0.063-0.066** | **0.26-0.27** |
| Chromium (headless shell) | 0.006-0.014 | 0.017-0.024 |

WebKit is ~9× Chromium; the per-frame readback is a synchronous GPU read the app never does, so real cost sits between the two WebKit columns. Not measured in the app's own WKWebView.

| Budget | Limit |
|---|---|
| CPU per agent-frame (WKWebView, M-series, p95) | **≤ 0.3 ms** (above the WebKit upper bound) |
| 4 agents, all in `listening` (15 steps/s) | **≤ 2 % of one core** (4 × 15 × 0.3 ms = 18 ms/s) |
| 4 agents, all in `idle` (8 steps/s) | ≤ 1 % of one core |
| 4 agents acting at once (30 steps/s, ≤ 0.9 s) | ≤ 4 % of one core while it lasts |
| Hidden window / closed popover / effects off / reduced motion at rest | **0 timers, 0 frames** |
| Cache | ≤ 64 entries, ≤ 1 MB |
| Per-frame allocations | none (reuse `ImageData`, arrays, `Path2D`) |
| Startup | `coverDensity` for 4 agents × 2 sizes ≤ 3 ms total, off the critical path (first paint shows the flat squircle, texture paints next frame) |

---

## 9. Placement contract (what AG2 builds around the indicator)

- **Rail:** 20 px, centred in the 36 px column (`library.css:411`), stacked above Settings in `.icon-rail-foot` and below the chips (`icon-rail.ts:62-71`); button 36 × 36, 8 px radius, same hover/focus/tooltip as other rail buttons (`library.css:429-440`); the tooltip names the agent and state.
- **Popover list:** 18 px, left of the name; the name row carries the state as text.
- **Home card:** 34 px in a card of the Home card colour (`--home-card`, `style.css:1105`), name 12 px / 600, state in mono 11 px muted (`.home-card-meta`, `:1161`); 125 px wide cards in an "Agents" section beside Recently opened (see `composites/home-agents-lilac-*.png`).
- **Floating (gutter):** 30 px, with its spotlight (`spotlight: true`), a small card below (name + what it showed, mono 10-11 px, `--card`, 1 px `--border`, 6 px radius); lands beside the target block; arrival travel is the host's, in whole cells, from the rail slot (which keeps a faint hairline squircle outline while the icon is out). The gutter is ~60 px wide at Reading size, so the card must be ≤ 56 px or sit under the icon without overlapping text (see `composites/reader-lilac-*_settled.png`).
- **Accessible name** on every instance: `"<name>, <state>"` updated on state change (`role="img"`); the canvas is `aria-hidden`.

---

## 10. Tokens summary (for CSS / TS constants)

```ts
export const agentSizes = [18, 20, 30, 34] as const;
export const cellFor = (size: number) => size <= 20 ? 1 : 2;
export const duration = { idle: 7, listening: 2, acting: .9, arriving: 1 } as const;          // seconds
export const steps = { idle: 8, listening: 15, acting: 30, arriving: 30 } as const;           // per second
export const tempoRange = [.90, 1.12], inkRange = [.20, .30], toneStep = [.07, .14];          // OKLCH L
export const tab = { width: .36, rest: .075, breath: .03, acting: .13 } as const;             // of the squircle width
export const ring = { start: .02, spread: .13, level: .36 } as const;
export const glowStrength = (strength: number) => Math.min(.5, .12 + (strength - .02) / .28 * .5);
```

---

## 11. Acceptance checks

Unit (`tests/agent-look.test.ts`, port of [`proto/src/check.ts`](proto/src/check.ts), which implements 1-8; the prototype run is `node proto/dist/check.mjs` → **all passed**; 9 is new):

1. `lookFor` is deterministic; the same `(kind, terminal, pid)` always gives the same look.
2. `pid` changes only `phase`; `terminal` changes the seed but not family or method.
3. The six known kinds take family and method from `kindSlots`; no two share both; omp, Claude Code and Codex differ in family **and** in method; named `other:<name>` keys hash their own.
4. `coverDensity` thresholded at `bias = 0` equals `renderCover`'s 2-tone pixels for all 5 families × 3 methods × 3 seeds, and `renderCover` itself is unchanged after the refactor (existing tests in `tests/` keep passing).
5. For every default, preset and extreme, both schemes: mark ≥ 3 : 1 on the worst background (`#e2d0d9` / `#2d2a24`); glyph ≥ 3 : 1 on the weakest tone.
6. For those and the extremes (`#f0f0f0`, `#101010`, `#ffee00`, `#808080`, `#00ff00`): tone steps 1.10-1.45.
7. `acting` and `arriving` end with `bias = tab = ringLevel = glow = 0`; every channel finite at every `t`.
8. Reduced: idle `bias` is 0 at all `t`; listening is constant.
9. Settings parser: garbage / missing / invalid hex → defaults; unknown keys dropped; > 32 entries truncated.

E2E (`e2e/agent-indicator.spec.ts`, Playwright against the web build like the existing specs):

10. Effects **off**: the canvas contains exactly the mark colour, the glyph colour and anti-aliased edge pixels of those two (no third opaque colour), unchanged over 2 s and across all four states.
11. Effects **on**: ≥ 3 distinct opaque colours inside the squircle; ink share inside ≈ `look.ink` ± .06 at rest.
12. `emulateMedia({ reducedMotion: 'reduce' })`: pixel-identical canvas over 1 s in idle and listening; acting shows the hold frame for 0.9 s then the base frame.
13. `visibilitychange` to hidden: zero rAF/timer callbacks from the clock afterwards (spy); window inactive: idle canvas freezes, an `acting` one-shot still plays.
14. DPR 1 and 2: canvas backing size = `g × deviceCell`; every cell is an exact `deviceCell` square (sample the 18 px icon, check run lengths).
15. Four themes (Brief and Lilac × light and dark), three agents, four sizes: golden screenshots of the flat (effects-off) squircle plus glyph contrast read back from pixels ≥ 3 : 1.
16. Perf: mounting 4 agents × `listening` for 5 s keeps long tasks < 4 ms and the clock's summed frame time under the section 8.5 budget (use `performance.now` around the paint, log p95).

Manual / visual: compare against `renders/contact-sheet_lilac-{dark,light}.png`, `composites/`, and `renders/effects-on-vs-off_*.mp4`; check the rail at 1× next to the monochrome line icons (open decision 3).

---

## 12. Differences from research.md, and open decisions

### 12.1 Differences from research.md (and why)

| research.md | This spec | Why |
|---|---|---|
| Recommends **A Bookmark**: ribbon hangs from the **bottom**, off-centre, same colour (§5A, §6) | A **tab on the top edge**, wide (36 % of width), short, in the **strongest ink tone**, off-centre; arrives by a dither row growing, not a shape sliding | In the first dither render, a bottom ribbon in the body colour read as a **speech-bubble tail** even off-centre (research §5A flagged this); a narrow top tab read as a stem. A wide, ink-toned top tab reads as a tab / folder tab (`archive: canon-18/19`, §3 of research). |
| Finals built in **Cavalry and exported as Lottie**; Position-only ribbon, keyframe tables, Fill Alpha for halos (§7) | **Code**: channels, thresholds and one 2D canvas | Owner's new direction. §7's Cavalry constraints (no scale, no blur, loops need explicit end keys) are obsolete; the *visual* constraints (no blur, no hairlines, ≥ 1 px features) are kept. |
| Idle: "no opacity change", translate ≤ 0.6 u (§4.2) | Idle drifts the dither **threshold** ±4.5 %, so a few pixels change tone; no opacity or position change | Gives the texture a pulse without moving the body; Reduce Motion frame 0 is still the complete mark. |
| Listening differs from idle by the tab (static silhouette) | Same, plus a **1-2 cell texture crawl** and a whole-cell tab breath | The crawl is the one place pattern content moves (a mild departure from "animate only a threshold", §3 print-05/06). |
| Acting: ribbon extends 11.5 u with one ≤ 10 % overshoot; body lift 0.8 u | **No overshoot, no body motion**; an ink **band** sweeps bottom → top while the tab dithers in | Dither grids cannot overshoot below a cell; the sweep is "pulled up" as a direction. |
| Arriving: lift scale 1.05-1.06, lean ±2.5°, body y −3.5 u, B's press landing "optional second pass" | **No scale, no rotation, no lift**; the host moves the icon in whole cells; landing = an **ink ring that dissolves by threshold** (B's stamp ink ring re-expressed as dither) | Scaling or rotating a dithered canvas destroys the grid. B's ring was research's own optional second pass. |
| Reduce Motion: only frame 0 of idle; optional 150-200 ms dissolve for acting/arriving (§4.4) | Static frames for loops; acting/arriving are **0.9 s static cue frames, no tween** | Keeps a non-moving cue (what Apple/Material do) without a fade the app's own reduced-motion rule (`style.css:918-920`) would zero anyway. |
| One hue, tint shades for stamp ink (§4.2) | Same: ink tones are OKLCH shades of the agent colour | consistent |
| "Acting decays to idle after ~3 s of nothing" (§4.2, tldraw) | Acting is a **0.9 s** shot; the base state is the registry's `listening` bool | `AgentEntry.listening` already carries it (`control.ts:341`). |
| No controls | Per-agent colour and a global **Effects** switch | Owner's new direction. |

### 12.2 Open decisions for the owner (each has a stated default so AG2 can proceed)

1. **Effects off and `listening`.** The brief says effects off leaves a solid squircle, so states are then invisible except as text (name + state in the accessible name and list rows). Recommend keeping a *static* tab for `listening` as an information mark. **Default: follow the brief (solid squircle only).**
2. **Per-agent effects override.** Only a global switch is specified. **Default: global only.**
3. **Rail rest softness.** Two coloured 20 px squircles are louder than the monochrome rail icons (`composites/crop_rail-1x-zoom4_dark.png`). Option: at rest in the rail, mix the mark ~20 % toward `--muted`. **Default: off (full colour).**
4. **Reduce Motion cue.** 0.9 s static hold (specified) vs a 150-200 ms dissolve. **Default: static hold.**
5. **Third-party defaults.** Codex Amber, Cursor Moss, other Rose, unknown graphite are proposals. **Default: as listed in 3.1.**
6. **`seedSalt`.** Changing it re-rolls ink, tones, tempo, tab and texture of every agent (not family or method of the known kinds). **Default: lock `hmb-agent/3` at release.**
7. **`truchet` at 18 px reads as noise.** Keep for consistency with covers, or restrict agent families to four. **Default: keep five.**
8. **Rail grain vs floating grain.** 20 px uses 1 px cells, 30/34 px use 2 px cells, so one agent's grain differs by size. **Default: accepted.**

---

## 13. Prototype map

| Path | What |
|---|---|
| `reference/indicator.ts` | all logic above, one file (look, colour, channels, `Indicator.paint`) |
| `reference/cover-density.ts` | the block appended to the app's `procedural-cover.ts`: extra exports and `coverDensity` |
| `reference/check.ts` | acceptance checks 1-8 (45 identity cases included; 144 assertions) |
| owner's `renders/`, `composites/` (not in the repo) | per-state videos (18/30/34 px, three agents), effects on vs off, Reduce Motion, contact sheets, and the indicator laid over real screenshots; the two contact sheets and the Home composite are copied here |
