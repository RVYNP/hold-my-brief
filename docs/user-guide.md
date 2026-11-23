# Hold My Brief user guide

Everything Hold My Brief does, in detail. For a quick tour, see the [README](../README.md).

## Opening documents

Open a PDF, DRM-free EPUB, Markdown, TXT or image file (PNG, JPEG, WebP, GIF, AVIF, BMP) with
Ctrl+O, **Open file…** in the command palette, a file drop or a command-line file argument; each opens in a new tab. The Windows installer adds
Hold My Brief to Explorer's **Open with** list for the document and image formats without changing the default
app; clean-account installer behavior has not yet been verified. On macOS the app is offered in Finder's **Open With** for the
same formats. A second instance routes its file request to the running app, and on macOS so do `open -a "Hold My Brief" file.pdf`,
Finder's Open With and files dropped on the Dock icon (several files open as several tabs, in order).

## Tabs

Every document opens in its own tab, from every way of opening one: the file dialog, the library, Home,
recents, the assistant, a command-line argument or a second instance, and a drop. A document that is already open is not opened
twice; its tab is shown instead. Closing the last document tab shows **Home**.

In a window at least 720 px wide the toolbar carries only the open documents, one wide flat tab each: its title on the left (an EPUB's
own title once it is known) and, on the right, where you are in small capitals (`P. 40/146`, or `37 %` for a document without page
numbers; a document you have not read yet shows none), and a close ×. The tab you are reading has a light fill. Hover a tab for its
full title and path. There is no Home tab and no **+**: **Home** is the first icon of the icon rail (see Document library), and
**Add files** on the rail, **Ctrl+T** (**⌘T** on macOS), the command palette or a drop opens documents. When there are more tabs than
fit, the strip scrolls and a **⌄** at its end lists them all, with each one's format and place. Drag a tab to reorder; middle-click a
tab to close it. Empty strip space still drags the window.

The **Library** tab (see *Library tab* under Document library) is a tab like the others, with the library glyph and the name of what it
shows: `All documents`, `Favorites`, a collection's name, or a folder as `refs › 03_wwe_mag`. There is at most one: opening the library
again from anywhere shows it and points it at the new selection instead of opening another. It starts at the front of the strip, can be dragged, closed
with its × or middle-click, and is restored with the other tabs at the next launch, on the same selection.

**Dropping files.** Drop one or several files anywhere on the window and each opens in its own tab, in the order dropped (a file that
is already open is shown instead). While files are over the window the reading area dims behind a "Drop to open in a new tab" panel;
over the tab strip a marker between two tabs and a "+ N files" ghost tab show where they will go, and the tabs open there. Dropped on the
reading area they open after the tab you are reading (at the end from Home). Files of a type the reader does not open are not opened;
one notice names them. A document dragged out of the library (a tree row, row or tile) or Home onto the strip or the reading area opens
the same way, with a small copy of its cover following the pointer; a plain click on any of them still opens it, and Escape cancels a drag.

In a compact window (under 720 px) there is no strip. The title shows the open document's name, how many tabs are open and a ⌄; it
opens a menu with Home, the Library tab when it is open, every document (with its format and place, and a close ×), and **New tab…**.
That **Home** row is how a compact window reaches Home, since it has no icon rail.

| Action | Shortcut |
| --- | --- |
| New tab (opens the file dialog) | Ctrl+T (⌘T on macOS) |
| Close tab | Ctrl+W (⌘W on macOS) |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab, or Ctrl+Alt+Right / Left (⌘⌥→ / ⌘⌥← on macOS) |
| Go to tab 1–8, last tab | Alt+1…8, Alt+9 (⌘1…8, ⌘9 on macOS) |

Ctrl+2, Ctrl+3 and Ctrl+4 stay fit width, two-page spread and page previews, which is why tab numbers use Alt on Windows and
⌘ on macOS rather than Ctrl. On macOS the same ⌘ shortcuts are the Window menu's Show Tab 1…8 and Show Last Tab items.

Each tab keeps its own position, zoom and fit, text settings, hand tool, page-preview scroll and find text. The pin, size lock,
appearance, library and the position of the view controls are shared by the whole window. At most three tabs keep their page in memory (the three
shown most recently; with more than three panes, one per pane, and the tab each pane shows always keeps its page); the others are put away and reopen at the place you left them, with the usual
"Opening…" notice, the next time you select them. Switching between the live tabs is instant.

The open tabs, their order and the one showing are remembered and restored at the next launch (in the browser preview, in this
browser's storage). Only the tab that was showing opens at once (while split, the tab each pane showed); the others open when selected. A tab whose file has gone shows
**File not found** with **Locate…** and **Close tab**, rather than failing the launch. The Library tab comes back drawn from the library as it is then.

With nothing saved, the window opens on **Hand it over.** Once documents have been opened, it opens
on **Home**, a heading over these sections, in this order:

- **Recently opened** is one wide card for the document you looked at last: the cover at its left edge, the title beside it, the
  file type at the bottom left and where you got to (`p. 48 / 146`, `37 %`, `Finished`) at the bottom right. Click it to open the
  document (or switch to its tab). It is left out until something has been opened.
- **Continue reading** shelves what you have started and not finished, most recent first. Under each cover are its title and one
  line with the file type and where you got to (`PDF · p. 40 / 146`). Each of these covers has a fine 1 px outline.
- One shelf for each type of file the library holds, in this order: **PDFs**, **EPUBs**, **Markdown**, **Text**, **Images**. A shelf
  lists that type's documents, those you have opened first (latest first), then the rest by title, up to 30. Under each cover are its title and its type, with where you got to
  once you have opened it. A type with no documents has no shelf.
- A shelf scrolls sideways with the trackpad or a horizontal wheel, by dragging it sideways, with the **‹** and
  **›** buttons that appear at its ends when you point at it, or with the arrow keys (one Tab stop per shelf). It snaps to
  cards. Right-click a card for its menu, or drag it onto the tab strip to open it in a new tab. The whole library is in the library
  panel and the Library tab, with its favorites and collections.

A faint **background** lies behind Home: a dithered picture of the theme's window glow that covers the whole window below the
toolbar (the tab strip and the window buttons never show any of it), under the library rail and Home's content, at 6 %
strength by default. Home itself is only the title and its shelves: no buttons and no filters.
The picture changes once a day (by your local date) and stays the same until the day ends. It takes its colours
from the theme and follows theme changes, and it is drawn only while Home is showing, once and still: nothing on it moves
on its own, and a change fades from one picture to the next over 0.6 s (not at all with reduced motion). Reading
surfaces (PDF, EPUB, Markdown, text and image tabs) and the Library tab stay plain. Choose its pattern, turn it off, or set
its strength with **Background** and **Strength** in Appearance.

Edits made in the library refresh Home. A picture fills in when its
thumbnail is ready; a book without a picture keeps the generated cover it has on its shelf. An EPUB shows the title from its
own metadata once it has been read, and its file name cleaned up until then. A cover looks the same here as in the library.
In the desktop app, the × on a Recently opened card removes it from the recent list and leaves the library entry. A file whose
original has gone is dimmed.

The library offers the same choices under **Choose collection and filters → Filter by format**,
combined with the selected collection, search, availability, and colour. These are view filters, not
conversions: PDFs stay PDFs, EPUBs stay EPUBs, and TXT identifies an actual plain-text file.

A scanned PDF with no text layer shows its pages as images: text on those pages can't be selected
or searched. Nothing is drawn over the page; the subtitle's tooltip says "Image-only page" while one
is on screen, and the first time you drag to select on one, a notice explains why nothing is
selected. Hold My Brief doesn't run OCR in
this build, so run the PDF through an OCR tool first if you need its text. This is a known limit.

## Panes

Read up to four documents at once. The window tiles into **panes**: each pane has its own row of tabs, its own page, zoom, position and view controls, and any pane
can be split again to the right or downwards, to at most four panes. Split the window by any of these:

- **Right-click a document tab ▸ Split right** or **Split down** (the context-menu key or Shift+F10 on a focused tab does the same). That tab moves out of its pane into a
  new pane to the right of it or below it, which shows the tab and becomes the active pane; every other tab stays where it was.
- **Split right** and **Split down** in the command palette, or **Ctrl+\\** (⌘\\ on macOS) and **Ctrl+Shift+\\** (⌘⇧\\). They split the active pane's shown tab. Ctrl+\\ splits
  only while the window is not split; once it is, it cycles through the panes (see below).
- **Right-click a document in the library tree ▸ Open in split right** or **Open in split down**: the document opens in a new pane to the right of the active pane, or below it (it
  moves there when it is open already), and the window is split first when it is not, with the document you were reading, or the one you read last, staying where it was.
- **Right-click a document card or row on Home ▸ Open in split right** or **Open in split down** (**Open** is the other choice there). From Home the document you read last stays on the left.
- **Drag a tab onto a pane's edge** (see *Dropping a tab on a pane* below): the pane splits that way, with the dragged tab in the new pane. While the window is not split, the pane is the reading area.

A split is unavailable, and its menu entry is greyed out with the reason as its tooltip (the palette shows the reason too), when:

- the window already holds four panes (*A window holds at most four panes*);
- the pane has no room: each pane needs 360 px of width and 240 px of height, so a pane must be 728 px wide to split right (*This pane is too narrow to split*) and 488 px high to
  split down (*This pane is too short to split*). A window that is not split needs a reading area (the window less the icon rail, or the library panel while it is docked) 728 px wide,
  and a window of at least 720 px (*The window is too narrow to split*);
- the pane has only one tab (*Open another document first*; before the first split, *Open a second document to split*). A tree row or Home card needs one other document open.

**The active pane.** Click a pane, or its tabs, to make it the active one: the toolbar's title, find (Ctrl+F searches that pane's document), the footer, the progress line and the
scrubber (which span the active pane's left and right edges, at the window's bottom) and the keyboard act on it, and its shown tab carries the accent. The active pane has the coloured line along its
top edge; the other panes are dimmed. Opening a document puts it in the active pane; one that is open in another pane is shown there.

**Keys.** While split, **Ctrl+\\** (⌘\\) moves the focus to the next pane in reading order (left before right, top before bottom), and from the last to the first. **Ctrl+Alt+←, →, ↑, ↓**
(⌥⌘ and the arrows on macOS) move it to the neighbouring pane in that direction. While the window is not split, Ctrl+Alt+← and → are Previous tab and Next tab, as always. The keyboard shortcut reference (*Keyboard shortcuts*) lists them all.

**Moving a tab.** A tab's menu has **Move to the other side** while there are two panes, and **Move to pane ▸** while there are three or four: the submenu names each other pane
by the document it shows. The tab goes to the end of that pane, which shows it and becomes the active one. When the moved tab was its pane's last, the pane closes (below). Drag a tab onto another
pane's row to put it there, at the marked slot. Drag within a row to reorder it, as before.

**Dropping a tab on a pane.** While you drag a tab over a pane's page, where the pointer is decides what letting go does:

- **The outer quarter on a side** (left, right, top or bottom; in a corner, the nearer side) splits that pane that way, with the dragged tab in the new pane. A shaded half and an outline show the half the
  new pane will take. Not split, this is the reading area's four quarters: the right and bottom ones do what Split right and Split down do for that tab, and on the left or top the dragged tab becomes the
  first pane and the other documents the second.
- **The centre** moves the tab into that pane, after its last tab, where it is shown; the whole pane is shaded. A tab dropped on the centre of its own pane does nothing.

The same rules as the menus apply: at four panes, or where the panes that would result don't fit (each needs 360 px by 240 px), no split preview shows and letting go changes nothing, while the centre still moves the
tab. A pane's only tab can't split its own pane (*Open another document first*). Esc during a drag, or letting go anywhere else, changes nothing. Home and the Library tab can't be dragged into panes.
Folded, the other panes are out of sight, so a drag has nowhere to land on them: use the menu.

**Closing a pane.** **Close pane** in a tab's menu (and in the palette) closes that pane: its tabs join the pane that takes its room (its sibling in the layout, or the first pane of the sibling's
group, in reading order), and that pane becomes the active one. Closing or moving a pane's last tab closes the pane the same way. **Close the split** (a tab's menu, the palette) merges every
pane's tabs into one row, in reading order, after the Library tab. Home (the rail's first icon) and the Library tab belong to the window: they cover all the panes, and a pane's tab brings the panes back as they were.

**Dividers.** Every split has its own **divider**. Drag it to resize the two groups of panes it separates; it snaps to 40, 50 and 60 % when you let go near them, never takes a pane under 360 px
wide or 240 px high, goes back to 50 % on a double-click and moves 2 % with the arrow keys along its direction when it has focus (Home and End go to the limits).

**Readers.** The window keeps at most three documents (or one per pane, when that is more) open as live readers, counted across the panes; the others are put to sleep with their place and
reopen where they were when shown. The document each pane shows is always live.

**Folding.** When the reading area is narrower than the panes need (728 px for two side by side, more for more), for example after docking the library or in a narrower window, only the
active pane shows, at full size, and its row ends with the **pane map**: a small picture of the layout, one cell per pane laid out like the panes, the active pane's cell filled and the others outlined,
and "n panes" beside it. Press it for a menu with a row per pane (the map with that pane filled, and the name of the document it shows); choosing a row makes that pane the active one. Ctrl+\\ still moves
on to the next pane. The panes appear again by themselves as soon as there is room. In a window under 720 px the panes are always folded.

The panes are remembered with the tabs: at the next launch the layout (every divider's place), each pane's row, the document each pane showed and the active pane come back, each shown
document at the place you left it (the other tabs open when selected). A session saved before panes existed opens as it always did.

## The window

The toolbar is one row, and the window has no separate title bar. On macOS the close, minimize and
zoom buttons are three quiet grey circles at the toolbar's left end that take their usual colours when you point at them (the green one enters full screen, and zooms when you hold Option); on Windows, minimize, maximize and close sit at its right
end. Drag any empty part of the toolbar to move the window, and double-click it to maximize. The
tabs start at its left end (after the window buttons on a Mac) and run up to its right end (see Tabs above). In windows
720 pixels wide and up the toolbar has no library button, because the icon rail's **Library** is the way in (see Document
library); in compact windows the library button stands first, before the tabs. Ctrl+K opens the command
palette, where you can open a file, jump, find or change any setting.

The toolbar holds the document tabs and nothing else on its right: pin, lock and the window sizes are in **Settings** (below), and
the open document's own actions are the **More** button of the view controls (see Zoom and the hand tool). Everything else,
such as fit and zoom, is on the page's floating controls, on its keys, and in the palette, which reaches every command.

While another app has focus, the reader's buttons and progress line fade so a pinned window stays
quiet beside your work; the tabs, the document's position and the page keep full strength. Click the
reader and everything returns.

## Settings

**Settings** is a sheet at the bottom of the window: the icon rail's last icon opens it, and a compact window (no icon rail) has a
Settings button at the toolbar's right end. It has five sections, top to bottom, and scrolls inside itself, so it fits a 420 × 620
window. Escape closes it.

- **Window** (desktop app only): **Keep on top** (Ctrl+Shift+T) keeps the reader above ordinary windows, and **Lock size**
  (Ctrl+Shift+L) captures its outer dimensions while allowing movement. Each is a switch that stays in step with its shortcut
  and with the palette while the sheet is open. **Compact** (420 × 620) and **Reading** (760 × 900) resize the window.
- **Agent control** (desktop app only): **Local CLI & agents** lets the `hmb` command and AI agents on this computer show
  documents and live briefs in the reader (see [Agent control](agent-control.md)). It is on by default; turning it off closes the
  private socket at once.

  While it is on, an agent can also wait for you with `hmb events`: the reader tells it which text you select (once the
  selection has stopped changing), which page you stay on, which tab you show or close, and what you send. Only your selected
  text is ever sent, never the rest of the document; the events live in memory, go nowhere but that local socket, and are
  dropped when you turn Agent control off. To hand an agent something on purpose, select text and run **Send selection to
  agent** from the palette (Ctrl+K) or with Ctrl+Shift+Enter (⌘⇧↩ on macOS); the notice says "Sent to agent". The command is
  dimmed, with the reason, when nothing is selected or Agent control is off.

  A scanned page, a chart or an image has no text to select. Run **Send area to agent** (palette, or Ctrl+Shift+A, ⌘⇧A on macOS)
  and drag a box over the page: the agent gets a picture of that box and where it is on the page, and the notice says "Sent area to
  agent". Esc, a box smaller than 8 × 8 px, a click outside the pane or another tab cancels. It works on PDF pages and images only,
  and the picture is kept in the app's data folder (the newest 20, readable by you only) until Agent control is turned off.
- **Appearance:** colour and text, below.
- **Library:** the side the library docks on, **Left** or **Right** (see Document library).
- **More:** **All commands…** (Ctrl+K), **AI assistant…** (desktop app), **Keyboard shortcuts**, **Clear recent files** and
  **Delete saved reading data…**.

## Appearance

Open **Settings** (or choose **Appearance and text…** in the palette) and look at its Appearance section. Colour and text are on
one page, top to bottom: **Mode** is at the top, beside the section's title; every other
setting is a labelled row below it. Themes, glows and accents are plain color discs with no names under them.
Hover over or focus a theme or glow disc and its name is on the line beneath the glows; it is also that disc's
tooltip and accessible name. One ring marks the kept choice in all three rows.

- **Mode:** System (default; follows the operating system as it changes), Light or Dark.
- **Theme:** Brief (default), Lilac, Birch, Graphite, Arctic, and two pinks: Blossom (soft blush with a
  rose accent) and Peony (bold, magenta-tinted, deep aubergine in dark mode). A disc is the theme's window tone
  against its accent. Each has a light and a dark version, and every one keeps its text at WCAG AA contrast or better.
  Every theme has a soft window glow behind the library and the area around PDF pages, with the toolbar kept solid; the glow themes below are the strong version.
  Hover over or focus a theme to preview it on the whole window, click or press Enter to keep it, and
  move away or press Escape to go back to the theme you kept. The line under the glows says which theme is kept,
  or, while you preview another, which one you are seeing and how to keep it or return.
- **Glow:** ten themes with one mode each: Aurora, Dusk, Nebula, Solar, Ember and Orchid (dark), then
  Glacier, Peach, Lagoon and Moss (light), ported from Tracks. A disc shows the theme's glow with its accent
  as a dot. Two soft glows of colour sit behind the toolbar, the library and the area around PDF pages;
  text documents keep an opaque page. Choosing one fixes the mode (the Mode control shows it, disabled, and the
  line under the glows says "Glow themes have one mode."), and choosing a normal theme again brings your earlier
  mode back. With reduced transparency, more contrast or forced colours on, the glow is not drawn.
- **Accent:** the theme's own accent, one of seven presets, or a custom color. Contrast is adjusted
  automatically so text and controls stay readable.
- **Page:** Match theme, White, Sepia or Dim for text documents (Markdown, TXT and reflowable EPUB).
  PDF pages, fixed-layout EPUB pages and images always keep their original colors.
- **Background:** the pattern of Home's background: Flow (default), Arcs, Stripes, Contours or Truchet, the same families as the
  generated covers; **None** turns it off.
- **Strength:** how strongly the background shows, from 2 % to 30 % (6 % by default); live, and greyed while Background is None.
  Up to 8 % Home's text keeps its usual colours: it is the most at which the muted text keeps 4.5:1 contrast on the strongest part of
  the picture in every theme. Above 8 % the muted text (the small lines under
  covers) deepens toward the main text colour as you go, reaching it at 30 %, so it keeps that contrast in every theme. 30 % is the top
  of the slider.

Below a hairline, a **preview** of a page of text in the reading font shows the settings the open document uses, live,
and under it are **Size**, **Spacing**, **Margins** and, for plain text, **Lines**. **Text size & spacing…** in the palette
opens the panel with the size stepper focused. Size (**A−** and **A+**, 12–40 px), spacing (Tight, Normal, Relaxed, Loose),
margins (Narrow, Medium, Wide) and, for plain text, whether long lines wrap are saved with the document, and changes show
on the page above the panel as you make them. For a PDF, a fixed-layout book, an image or when nothing is open, the preview
and these rows give way to one note: PDF pages, fixed-layout books and images keep their colors and zoom instead
(Ctrl + and Ctrl −); the color rows stay.

In a wide window, Markdown and plain text stop at a comfortable line length (about 70 characters) and
centre on the page instead of running edge to edge. Plain text with wrapping turned off keeps every
column.

Choices are saved on this computer and applied before the window first paints, so there is no flash
of the wrong theme. The window frame (the Windows title bar, the macOS window buttons) follows the
light or dark mode.

Markdown and text documents are set in Geist Serif, as are titles (the document name, headings,
dialog titles); the interface is set in Geist. Both are bundled with the app (SIL Open Font License),
so nothing is downloaded. Geist Serif has one weight, so bold and italic in a document are drawn from
it rather than from a separate face. EPUB books keep their publisher's fonts, and PDFs their own.
Positions, paths and key labels use JetBrains Mono, bundled as well.

In Markdown, a fenced or indented code block is a rounded, tinted box set in JetBrains Mono, with the language (the first word after the
opening fence) in its top-left corner. **Copy** and **Open** sit in the top-right corner: **Copy** puts the block's exact text on the
clipboard and says *Copied* for a moment; **Open** shows the block in the same sheet EPUB code blocks use. The corner is not selectable, so
selecting across a block and copying never takes the label or the buttons. A long line wraps, with the wrapped part indented under the
line it continues, while the Wrap setting is on. Inline `code` is a small chip in the same face.

A fenced block whose language is one of bash (`sh`, `zsh`, `console`), shell, JavaScript (`js`, `jsx`), TypeScript (`ts`, `tsx`), JSON, Python
(`py`), CSS, HTML or XML (`html`), Markdown (`md`), YAML (`yml`), SQL, Rust, Go, Swift, diff or plaintext is coloured: keywords, strings, names,
numbers and comments each take a colour of the current theme, and diff adds a tint to added and removed lines. The language is never guessed:
a block with no language, or with one that is not in the list, stays in the ink colour and keeps its label. A block over 2,000 lines or 200 KB is
left plain. The text itself is not changed, so Find, Copy and saved places work as before. With increased contrast or forced colours the
blocks are not coloured. EPUB code blocks keep the publisher's colours.

The theme design is inspired by [Tern](https://stencil.so/tern) by Stencil, and the Graphite theme
uses Tern's default palette. See [Credits](../README.md#credits).

## Moving through a document

PgDn/PgUp change pages. Space/Shift+Space traverse one screen, scrolling a tall PDF page before
advancing. Ctrl+G jumps to a physical page, EPUB chapter/percentage or source line. The position
(page, chapter or line) is shown next to the document's name in the toolbar; hover the name to see
the kind of view. It reports **position**, never material actually read: the library's **Finished** means the saved position reached
the last page or the end of the text, not that it was read.

While you read, the footer is just the progress line along the reading area's bottom edge, a thin
line that fades out at both ends. Move the
pointer to the bottom of the page, or Tab to it, and the previous/next arrows and the full position
slide up over the page; clicking the position opens Go to. The line scrubs the entire document: click
it to jump, or drag its thumb to preview
a destination and release to navigate. PDF and fixed-layout EPUB snap to physical pages (to whole
spreads in two-page view);
Markdown/TXT use source lines; reflowable EPUB uses whole-book percentage. With the slider focused,
arrows adjust one page/line (0.1% for reflowable EPUB), and Home/End select the first/last location.
The slider is disabled until a document opens and for single-page/single-line documents. Scrubbing
saves the resulting reading position without modifying the source file.

### Zoom and the hand tool

PDFs, images and fixed-layout EPUBs show a small floating view-controls pill at the bottom of the
reading panel (bottom-right once the panel is 720 pixels wide or more). It holds zoom out, the zoom
level (always the real scale, such as **82%**, with a small chevron: it opens the zoom menu, below; double-click it
to switch between fit page and fit width), zoom
in, the **Hand** tool and, for PDF and fixed-layout EPUB, **Single page** / **Two pages** buttons (PDFs
also get **Page previews**, below), and stays in step with Ctrl+−/+ and Ctrl+0/1/2/3/4. The hand is available at every zoom: press **H** (or the
Hand button) and drag. When a zoomed page is larger than the panel, the drag pans it 1:1. When the
page or spread fits the panel (a fit, or zoomed out far enough), the drag slides the whole page, or both pages
of a spread, around the panel 1:1, like a sheet across a desk; at least 64 pixels of it always stay
inside. The page keeps its place when you turn pages and goes back to the middle on a fit (Ctrl+0 or Ctrl+2, even
when it is already fitted), when you switch between one and two pages, or when you open another document. A zoom holds the
spot at the centre of the panel instead and may keep the page slid (see "Where a zoom stays", below). Text
selection pauses while the hand is on, and a click without movement still follows links. Middle-button
drag pans or slides in any mode. The hand turns off when a new document opens (and, in a fixed-layout EPUB, when switching between one and two pages rebuilds the view). Markdown and TXT
reflow instead of zooming, so they have no zoom controls and no panning; their pill and a reflowable EPUB's hold reading controls instead (next).

**More.** Every pill ends with a **More** (⋯) button. It opens a menu of the document's own actions: **Go to…** (Ctrl+G),
**Contents** (when the document has an outline; the pill of a reflowable EPUB, Markdown or TXT document has its own **Contents**, so the menu leaves it out),
**Back after jump** (Alt+←), **Rotate page 90°** (page-based documents), **Two-page spread** (Ctrl+3) and **Cover page alone**
(PDF and fixed-layout EPUB; it applies while two pages show). Escape, a choice or a press elsewhere closes the menu. The same commands are
in the palette (Ctrl+K), and the footer's position button (Go to) and Alt+← reach two of them.

**Reflowable EPUB, Markdown and TXT: Contents, Pages or Scroll, text size.** A reflowable EPUB's pill reads **Contents** · **Pages | Scroll** · **A− 18 A+**.
A Markdown or TXT document (an agent brief too) has no page flow, so its pill drops **Pages | Scroll**: **Contents** · **A− 18 A+**. **Contents** shows in
all three only when the document has an outline (a contents list for an EPUB, at least one heading for Markdown and TXT); with none, the pill reads
**A− 18 A+** (an EPUB keeps **Pages | Scroll**). Everything below about **Contents** and the text size applies to all three.
**Contents** opens the contents list above the pill (Ctrl+K → Contents opens the same list). A chapter entry reads "Chapter 3:
Working with Pointers": the number, then the title; text before the chapter number is dropped, and an entry with no chapter
number keeps its own label. Entries keep the contents' nesting, show the page each
starts on (`p. ~34` when the page is an estimate, the publisher's own page label when the book has a page list), and mark the
entry you are in, which is scrolled into view and focused. Up and Down, Home and End move between entries, Enter or a click
goes there and closes the list, and Escape closes it. **Pages** turns pages; **Scroll** is one continuous column per chapter,
and a wheel or trackpad gesture that starts at the end of a chapter goes on into the next. Switching keeps your place. The choice
is remembered per document (and is also in the palette as **Pages view** and **Scroll view**). The first time a book is opened with
no choice saved, it starts in Scroll if it looks like a reference book, that is, if `<pre>` blocks appear in at least 3 of its
first 10 spine items, or `<pre>` and `<table>` hold at least a fifth of their text; otherwise in Pages. Your choice always wins afterwards.
**A−** and **A+** step the text size by 2 px between 12 and 40 px, the same setting as the size stepper in **Settings › Appearance**.
Code blocks in a reflowable EPUB wrap instead of scrolling sideways, with wrapped lines indented under the line they continue, and are set
at a tighter line height than the text. Each is framed like a Markdown block, a rounded box with a hairline border, and a block the book gave no
background is tinted like one; the book's own fonts, colours and background are kept. When the book names the language of a block (a `language-…`
class, pandoc's or Sphinx's markup), it is written small in the block's top-left corner, always. In Scroll a code block may run wider than the
text column. A code background that is light on a dark page (or dark on a light one) takes a tint of the page, and its text is lifted to stay
readable.
Point at a code block, or Tab onto it, and two small buttons appear in its top-right corner: **Open code** shows the block in a sheet over
the reading area, in the mono face at 0.9 of the text size and unwrapped, with line numbers, scrolling both ways and the language in the
header when the book names one; **Copy code** copies the block's text exactly as the book has it (no line numbers) and says *Copied* for a
moment. Escape, **Close** or a click outside the sheet closes it and puts focus back on the block's Open button.

**What the percentage means.** Zoom is a true scale, the same as in a design tool: **100%** is actual size.
For a PDF, a page at its physical size at screen resolution (1 point = 96/72 CSS pixels, so a Letter page is
816 × 1056 px); for an image, one image pixel per screen pixel; for a fixed-layout EPUB, the book's
declared page size. In a two-page spread the taller page is at that scale and its partner matches its height.
Reflowable text has no zoom. **Fit page** and **Fit width** are modes, not levels: they keep refitting the page
as the window changes size, and the level shows the percentage they come to (a Letter page fitted to a short
window might read 68%). The zoom menu puts a check by the fit in force. Any zoom you choose yourself (the
buttons, a rung, a typed percentage, a preset, Ctrl/⌘ + wheel or a pinch) leaves the fit and holds that
scale whatever the window does; the next double-click or Ctrl+0 / Ctrl+2 returns to a fit.

**Where a zoom stays.** A zoom does not snap the view to the page's centre or top. Zooming with the buttons, Ctrl +/−,
a rung, a typed percentage, a preset, or Actual size (Ctrl 1) holds the spot at the centre of the reading panel, as in
a design tool: scroll to a corner, zoom, and you are still at that corner. From a fit, the page's middle stays in the
middle. A page that now fits the panel on an axis is slid there (the same slide as the hand tool's, kept within 64 pixels of
the panel's edge, and cleared by the next zoom or fit) so the spot stays at the centre; a page that overflows is scrolled, and
against the end of its scroll range it rests against that end instead. **Fit width** keeps the line at the top of the panel, so you stay where you were
reading instead of going back to the top of the page; **Fit page** shows the whole page, centred. Page turns and
switching between one and two pages work as before. This applies to PDFs and images; a fixed-layout EPUB zooms inside its own viewer and is unchanged.

**The zoom menu.** Click the zoom level (or press Enter, Space or an arrow key on it) for a popover
above the pill. Its top is a field: type a percentage such as `135` and press Enter to apply it.
Anything it cannot read goes back to the current level, and a number outside 10–800 is held to that
range. Below it are **Zoom in** (Ctrl +), **Zoom out** (Ctrl −), **Fit page** (Ctrl 0), **Fit width**
(Ctrl 2), **Actual size (100%)** (Shift+0) and the presets **50%** and **200%**. Up and Down move through the field and the
entries, Home and End jump to the first and last entry, and Escape, Tab, a click elsewhere or choosing
an entry close it. Escape and Tab put focus back on the level. A choice does too when the menu was opened
from the keyboard; opened with the mouse, it leaves focus on the page, so PgDn and Space keep working.

**Steps.** Zoom in and zoom out (the buttons, the menu and Ctrl +/−) move along a ladder: 10, 25, 33, 50, 67,
75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 600 and 800 %. From a level between two rungs, a fit's
included, they go to the next one in that direction. A very large sheet (an A0 poster, say) stops short of
800 %: no side of a page is drawn longer than 24,000 pixels, so the limit of such a page is its own, and the
buttons are disabled there. A page is drawn onto a canvas of at most 16 million pixels; past roughly 430 % a
Letter page (about 215 % on a high-density display) is therefore drawn at fewer device pixels than it is shown
at, and looks softer.

**Wheel and pinch.** Hold Ctrl (⌘ on a Mac) and turn the mouse wheel, or pinch on a trackpad, to zoom
smoothly toward the pointer: the spot on the page under the pointer stays under it. The page is scaled
while you gesture and drawn sharply once you pause, in the same place: nothing moves when you stop, and pressing
Control or Shift moves nothing either. A page that is smaller than the panel on an axis is slid there so the spot stays under
the pointer (the page may end up off-centre; Ctrl+0 centres it again), and a page that overflows is scrolled. The page cannot
be pulled past its own end: if the spot is nearer the edge of the page than the panel's edge allows, the page rests against
that end while you zoom, and stays there. In a fixed-layout EPUB the wheel and pinch zoom too,
but the page is resized once you pause rather than scaled while you gesture, and the spot is not held.

**Documents opened from an older version.** Before this version a saved zoom was a multiple of the fit
(1 was the fit itself). The first time such a document opens, a multiple of exactly 1 becomes the fit, and
any other is converted, from the size the page then fits at, to the true scale that draws it at the size
you left it, and is saved in the new form; the document is never converted twice, and a fixed-layout EPUB's
saved zoom, which already was a scale of the book's page size, is kept as it is.

If the pill covers something you are reading, drag the dotted grip at its left end to put it anywhere
in the reading panel. It stays inside the panel and above the footer, keeps its proportional place
when you resize the window, and stays beside the library panel. With the grip focused,
the arrow keys move it 16 px (Shift: 64 px). Double-click the grip, or press Home or Enter on it, to
return it to the default spot. Moving it never resizes or refits the page.

### Two-page spread

**Two-page spread** (the pill's **More** menu, the pill's book button, or Ctrl+3) shows PDF and
fixed-layout EPUB pages side by side, edge to edge, like an open book. By default page 1 is a cover
shown alone on the right and pairs follow as 2–3, 4–5…; turn off **Cover page alone** in the More menu for
documents that should pair 1–2. Fixed-layout EPUBs keep their publisher's page sides and
right-to-left page progression. Pages of different sizes are scaled to a common height; fit page fits
the whole spread and fit width its width. Page turns, Go to, Back and the scrubber move by spread, and
the position reads "Pages 2–3 of 27". Reflowable EPUB shows two text columns instead.

The choice is remembered per document (new documents open in single-page view), and the saved place
is the first visible page, so switching views keeps it. When the reading panel is narrower than 600
pixels (or, for reflowable EPUB, taller than wide), pages show one at a time; the Two pages button and
the subtitle explain that two-page view is waiting for more width, and it returns as soon as the
panel is wide enough.

### Page previews

For PDFs, **Page previews** (the pill's filmstrip button, **Ctrl+4**, or *Page previews* in the command
palette) shows the document as a filmstrip under the page. The page you are on (or the spread, in
two-page view) sits in the middle with an accent ring; pages before it are to its left, faded back, and
pages after it to its right, so you can see where you are. Spreads are joined pairs, paired the way the
view pairs them, so the cover stands alone. Each item is numbered by its place in the document ("20",
or "20–21" for a spread), never by the page labels a PDF prints; the footer still shows those.

Scroll the strip to look ahead or back: the mouse wheel (or a trackpad's sideways swipe) and dragging
both move it sideways without changing where you are reading. Click a page, or Tab to the strip, use the
arrow keys to move along it (Home and End go to the ends) and press Enter or Space, to go there as if you
had turned the pages; the strip then glides back to the middle (it jumps if your system asks for reduced
motion, or when the page is far away). PgDn and PgUp keep turning pages from anywhere, and the strip
follows. Thumbnails are drawn for the pages in or near view, after the page itself, and, once the strip has
rested, for a screenful on each side of it, so a scroll finds them ready. They never delay the page or a
page turn, and a long document costs no more than a short one.

Hovering the progress bar along the footer shows a small card above the pointer with the page that spot
would go to ("Page 12 of 146", or the spread, in two-page view); dragging the bar moves the card with it,
and it disappears when the pointer leaves. It works whether or not the strip is open. Other formats keep the
bar's plain tooltip.

The strip is a fixed band, so turning pages never refits the page; turning the strip on or off fits
the page once to the room that remains, and the view-controls pill stays above it. The strip ends above the
footer's lane along the bottom edge, so the footer, when you move to the edge to open it, never covers a thumbnail. It is one setting for
every PDF (off until you turn it on) and is remembered between sessions. While the reading area is
shorter than 360 px the strip is hidden and the page gets the whole height; it returns with the height,
and the setting is kept. Markdown, TXT, EPUB and images have no previews.

### Find in document

**Ctrl+F** searches the open document's text. Matches are counted as you type ("3 of 12"), Enter
goes to the next match and Shift+Enter to the previous one, wrapping at either end; the current
match is highlighted in the page and the reader scrolls to it. **Aa** matches case exactly and
**ab** matches whole words only. Escape closes the bar and clears the highlight. The bar sits above
the page and moves it down rather than covering it; the library panel docks beside the reading panel, so
it never hides what you type.

Search runs over each format's real text: the PDF text layer, EPUB chapter text, and Markdown or
plain-text source. A scanned PDF that has no text layer says so rather than reporting no matches,
and images have nothing to search. Markdown searches its source, so markup such as a URL or table
pipe is findable too.

### Command palette

**Ctrl+K**, or a click on the document's name in the toolbar, opens a search field over every reader
action, so you can run something without finding it in the menu. Start typing to filter: matching is
forgiving, so `zoom` finds the four zoom commands through their other names and `fit pa` finds
**Fit page**. Arrow keys move the highlight, Enter runs the highlighted command and Escape closes the
palette.

The field also reads what you type as a request. A number, with or without `page`, `p`, `line` or
`go to` in front, or a percentage such as `35%`, offers **Go to** that location, read the same way as
Ctrl+G. `find …`, `search for …` or `where is …` offers to find the rest of the text. Any other text
that names no command is offered as a find in the open document, so typing a phrase and pressing
Enter opens the find bar on it. None of this uses a language model or the network.

Commands that need a document open, or the desktop app for pin and size lock, are listed but marked
with the reason they cannot run yet. With a document open the palette is the quickest route to Go to,
Contents, appearance and window presets; from the empty screen it still reaches **Open file** and the
library.

### AI assistant (optional)

The desktop app can hand questions to an AI model, using your own API key from Anthropic (Claude),
OpenRouter or OpenAI. It is off until you turn it on, and without a key the app never makes a network
request.

**Turn it on:** choose **AI assistant…** in Settings › More (or type `ai` in the palette), pick a
provider, paste an API key (**Get a key** opens the provider's key page) and choose **Turn on**.
Only one provider's key is kept at a time: turning on another provider replaces the first key. The
key is checked with the provider first, then kept in macOS Keychain or Windows Credential Manager.
The app's own files never hold it, and the window never sees it again. Pick a model there too, each
provider remembering its own choice; for Anthropic the newest Sonnet is chosen by default. **Turn off
and forget key** deletes the key from the keychain.

**Ask:** type into the palette as usual. With the assistant on, every query also offers
**Ask the assistant**. When the text reads as a question ("what…", "why…", "summarize…", or anything ending
in "?"), that row comes first; otherwise it comes last, after go to, find and the commands. The
answer drops from the toolbar over the top of the page. It lists each thing the assistant did
("Searched for "Darcy": 12 matches", "Went to Page 7") above a short answer, with a field for a
follow-up. Escape or × closes it and ends the conversation.

**What it can do:** read the text where you are (the page or spread on screen, the current EPUB
chapter, or the Markdown/text lines from the top of the view), search the whole document and show a
match, go to a page, chapter, percentage or line, read the contents, search your library and open a
document from it, show the library filtered by colour and words ("the green packaging scans"),
change mode, theme or page tone, and run reader commands: library, back,
first/last location, fit, rotate, spread, zoom, pin, size lock and the window presets. It cannot open
files outside your library, delete anything, change your library or reach the file system.

**What is sent:** only when you ask, your question and the results of what it looked at (text from
the page you're on, search excerpts, the contents, and the titles, tags and folder names of library
documents; never full file paths or your notes) go to your chosen provider over HTTPS from the app's
native side. When you ask it to open a document from your library, text from that document can be
sent too, one document per question: opening a document ends the answer, so reading it takes a new
question. Text in a document is treated as data, never as instructions. With OpenRouter, the request
is forwarded to the provider of the model you pick. That provider's terms for your account apply to
the data. Use is billed to your API key.

### Keyboard shortcuts

**Keyboard shortcuts** in Settings › More (or the palette) shows the same list, grouped as in the
palette and built from it, so it always matches the app; the browser preview leaves out pin and size
lock.

| Action | Shortcut |
| --- | --- |
| Find in document | Ctrl+F |
| Command palette: go to, find, run a command or ask Claude | Ctrl+K |
| Next / previous page | PgDn / PgUp (Right / Left in page mode) |
| Next / previous screen | Space / Shift+Space |
| First / last location | Home / End |
| Go to page, chapter or line | Ctrl+G |
| Back after a jump | Alt+Left |
| Open a file | Ctrl+O |
| Document library | Ctrl+B |
| Resize library (divider focused) | Left / Right (Shift: larger steps), Home / End, Enter resets |
| Pin / size lock | Ctrl+Shift+T / Ctrl+Shift+L |
| Send the selection to an agent (Agent control on) | Ctrl+Shift+Enter (⌘⇧↩ on macOS) |
| Send a dragged area of a PDF page or image to an agent | Ctrl+Shift+A (⌘⇧A on macOS) |
| Fit page / fit width / actual size (100%) | Ctrl+0 / Ctrl+2 / Shift+0 |
| New tab / close tab | Ctrl+T / Ctrl+W (⌘T / ⌘W on macOS) |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Go to tab 1–8, last tab | Alt+1…8, Alt+9 (⌘1…8, ⌘9 on macOS) |
| Two-page spread | Ctrl+3 |
| Page previews (PDF) | Ctrl+4 |
| Zoom or text size | Ctrl++ / Ctrl+− (pages step along the zoom ladder); Ctrl/⌘ + wheel or trackpad pinch zooms toward the pointer |
| Hand tool (pan a zoomed page, or move a page that fits) | H, or drag with the middle button |
| Close a dialog | Escape |

## Saved reading data

Saved reading data lives in the native per-user local application-data directory under
`xyz.rpayton.holdmybrief` (on macOS, `~/Library/Application Support/xyz.rpayton.holdmybrief`),
not beside the source documents. Identical file bytes share resume state even after a rename.
Changed revisions keep the previous revision's state and show a best-effort restoration message. In Settings › More,
**Clear recent files** and **Delete saved reading data…** are separate; neither deletes documents. Each saved position also
keeps how far into the document it was (a fraction, and the page and page count for paged documents) so the library
can show it; positions saved before this version have none until you read the document again.

> **Renamed from Float Reader.** Before the rename the bundle identifier was
> `io.github.rvynp.floatreader`, so Float Reader builds kept their data in a folder of that name.
> The identifier changed to `xyz.rpayton.holdmybrief` with the rename, and data from the old
> folder is **not migrated**: the first Hold My Brief launch starts with an empty library and no
> saved positions. The old folder is left untouched and can be deleted by hand once you no longer
> need it.

## Document library

In windows 720 pixels wide and up, a slim **icon rail** (no box, only a soft wash from the window's edge and a 1 px hairline along its inner edge) stands on the side the library is kept on, and the
library **panel** opens beside it. Its icons stand at the top of the reading area, and an open document is fitted beside the rail, never under its icons. The icon rail has five bare icons in one group, from the top: **Home**, **Add files**, **Library**, **Search** and
**Settings**. That is all of it: there is one way to the library. **Home** shows Home and is marked as the current page while Home is showing; it has no keyboard shortcut. **Library** (**Ctrl+B**) opens the panel or collapses it (the
icon rail stays) and is filled with the accent tone while the panel is open. **Search** (**Ctrl+Shift+F**) opens the panel
if it is closed and puts the cursor in its filter field. **Add files** opens a menu with **Add files…** and **Sources…**
(indexing folders), even when the panel is closed. **Settings** opens the Settings sheet (see Settings). Hover an icon for its name and
shortcut; the names are shown only while the panel is closed, because an open panel already says where you are.

The panel **docks**: when it opens, the reading panel (the page, Home, find, page previews, the view controls) gives it that
width and starts beside it, so nothing is ever drawn under it. The page is fitted again, or keeps its zoom, exactly as
it does when you resize the window. Escape closes the panel while focus is inside it. Wide and compact visibility preferences
are remembered separately. In compact windows (below 720 pixels) there is no icon rail: the sidebar button at the left
of the toolbar opens the library as a sheet.

The panel's header is its title, **Library**, and how many documents it holds. The title is a button: it opens the
Library tab on all documents. Under the header the filter field is always there, reading *Filter 40 documents*
with your count. It narrows everything below it as you type (every word must match the name or a folder above it; the
matches are highlighted and their folders open); Esc clears it, and Esc on an empty field closes the panel.

Below it are four sections, in this order, each folding open and closed with a chevron and its count; whether each is open
is remembered, like a folder's:

- **Favorites**: the documents you starred, as one flat list, with how far you got in each.
- **Collections**: your own collections, nested as you made them, with their documents. (A collection that only mirrors an
  indexed folder is not listed twice.) The **+** at the right of its caption, or **New collection…** in the menu of the
  caption (right-click, or Shift+F10), makes a collection.
- **Folders**: one bold root for each folder you indexed, its subfolders (with a chevron, a folder icon and how many
  documents are beneath), and the documents as rows with their file name, their format icon and, at the right, how far
  you got (`p. 62 / 88`, `37 %`, `Finished`). Files that share a name (many are called `source.pdf`) sit under their own
  folders, which is how you tell them apart here. Elsewhere (Home, tabs, the Library tab, Favorites) a file with a generic
  name (`source`, `document`, `scan`, `file`, `untitled`, or only digits) is shown by its folder's name instead.
- **Loose files**: documents added by hand that are not in an indexed folder.

Favorites and Collections are always listed; Folders and Loose files appear once they have something in them.

Click a row to open a document (a document that is already open shows its tab), **⌘-click** (Ctrl-click on Windows and
Linux) or middle-click to give it a tab in the background, or right-click for **Open in new tab**, **Add to / Remove
from favorites**, **Details**, **Organize…** (collections), **Remove from library…** and, on the desktop, **Locate
original…**. The same works in every section. Click a folder, a collection or a section caption to open or close it; double-click a
folder or collection to show it in the Library tab (its row stays highlighted while the tab shows it). The folders above the document you are reading open by themselves, so it
is always in view. The tree is a keyboard tree across all four sections: one Tab stop, Up and Down move, Right opens a
section, folder or collection or enters it, Left closes it or goes to its parent, Home and End jump, Enter opens a
document or toggles a section or folder, and typing a name jumps to it.

The panel and the icon rail reach the window's bottom edge, a small margin short of it, and the footer and its progress line
span only the reading area beside them, so neither is under them; the view controls, page previews, find bar and image navigation sit beside them.

An image opened from a collection shows a small **previous / next** pill at the bottom of the reading panel, just
above the footer's strip, so the footer never covers it when it opens. The view controls stand directly above it
(and a view-controls pill you drag stays clear of it), beside the panel, at any window width.

The library can be kept on either side. Choose **Left** or **Right** under **Library** in **Settings**,
right-click the icon rail and choose **Move to the right side** (or **Move to the left side**), or use **Move library to
other side** in the command palette (**Ctrl+K**). It is one setting: the icon rail and the panel always stand on the same
side, and the side is remembered.

Drag the divider between the panel and the page to resize it (240–520 pixels, and never more
than 55% of the window, which keeps at least 320 pixels of the reading panel clear beside it). The panel is docked, so a
wider one leaves the page less room and the page is fitted again as it is for any resize. Double-click the divider to
reset it to 270 pixels. The divider is also focusable: Left and Right resize by 16 pixels
(Shift: 64), Home and End jump to the narrowest and widest sizes, and Enter resets. Width and side are remembered,
and the width is re-fitted when the window shrinks.

In compact windows the sheet covers the reading panel behind a scrim, cannot be resized, and closes on a click
outside it or after you open a document from it. Escape closes it while focus is inside. It has the same header, filter
field and sections; its title still opens the Library tab, and the sheet gets out of the way so you can see it.

- **Add files** (in the **+** menu) selects several documents or images at once without opening them. Show a
  collection in the Library tab first to add new entries directly to it. New references with no picture of their own
  open the **intake** sheet (below).
- **Index a folder** (desktop only) picks a folder and adds every PDF, EPUB, Markdown and text file
  beneath it. The folder becomes a collection, and each first-level subfolder that contains such
  files becomes a child collection. Entries point at the original files; nothing is copied. Indexing
  the same folder again refreshes it without duplicating entries or losing favorites and reading
  positions. When it finishes, the intake sheet shows what came in.
- **New collection** creates a named group. Use **Edit** beside a collection to rename it, or its
  **×** control to delete it after confirmation. Deleting a collection puts its documents in
  **Unfiled**; it does not delete them.
- Each document's **···** control opens **Info**, **Organize document** (move it to a collection or
  remove its library entry after confirmation) and, for a missing original, **Locate**.
- Star a document for **Favorites**. Search filters the selected view by filename, path, tags, notes,
  collection name and, for an EPUB, the title and authors inside the book; sorting offers
  recent-first or name order.
- Click a document to reopen it at its saved reading position. A missing or unreadable source
  reports an error without replacing the document you are reading.

### Grid and list

The **Recent ☰** menu switches between a **grid** of thumbnails and a **list** of names. A list row has a
small cover or thumbnail, the title and a line with its format and how far you got: `PDF · p. 12 / 96` for pages,
`EPUB · 38 %` for text that reflows (Markdown and text files too), `Finished` at the last page or the end, and nothing
for a document you have not opened yet. The same line is in the Library tab's detail strip. Progress is the saved reading
position, read again when the library opens; the browser build uses the positions it keeps itself. A grid tile has its title under it (two
lines at most, then an ellipsis), so a scanned page is never anonymous. The **Size** slider sets how wide the
tiles are at least, and is remembered with the choice of view per collection. A drawer narrower than 400
pixels opens on the list until you choose; the grid keeps each reference's real proportions, so tall
posters and wide spreads read as themselves; a reference with no picture shows a generated cover
(below). A collection that is mostly images, PDFs or EPUBs opens as a grid where the drawer is at least
400 pixels wide. Hovering or focusing a tile shows its star and ··· menu; the document you are
reading is marked **Reading**, and a missing original is dimmed.

The library has no pages. The grid or list scrolls all the way through everything that matches, however many
references that is; the count is in the Library tab's header (`230 references`). References are added as you
scroll, and a shelf's heading is shown once, with its tiles continuing under it. Changing the search, a type
chip, the sort, the view or the collection starts again at the top. **↑** and **↓** move between references (the
grid also takes **←** and **→**), **Page Up** and **Page Down** move a screenful, and **Home** and **End** go to
the first and the last reference of the whole set, however far down that is. Thumbnails are made only for tiles on
or near the screen: scrolling quickly past a tile before its turn comes cancels its request.

Thumbnails are made on this computer: images are scaled down, and a PDF's first page is rendered
with the reader's own PDF engine, reading only as much of the file as that page needs. They are kept
in the app's cache folder (at most 192 MB) and remade automatically when a file changes, so a large
library is slow only the first time it is shown. Thumbnails are a disposable cache: deleting them
loses nothing.

### Titles, covers and shelves

**EPUB titles and covers.** An EPUB shows the title (and author) written inside the book instead of
its file name, and its own cover image as the thumbnail when it has one. Only the book's package
file (which holds the title) and its cover are read, never the whole book, and the result is remembered so it is not
read again until the file changes. The file name stays visible in the Library tab's detail strip, in small
monospaced type, and on the list's second line.

**Generated covers.** A reference with no picture (an EPUB without a cover, Markdown, plain text)
gets a borderless 3:4 cover in the colours of its shelf. A band of calm dithered pixel art fills the
top half and carries no text; below it sit the title in the reading face, then the format and, at
the right, the version or date a file name ends with (`Rust-Book-1.99.epub` gives 1.99,
`Photoshop-UXP-Docs-2026-10-29.epub` gives 2026-10-29). **Every book's cover is its own pattern**,
made on this computer from a seed that comes from the book's path, so the same book always looks the
same and no two look alike. The shelf sets the rest: the colour, and the kind of pattern (contours,
flow, stripes and so on), so a shelf reads as a set and another collection looks different; a
reference in no collection gets a quiet blue-grey and a pattern of its own. Light and dark mode each
have their own quiet version, and all of the text keeps at least 4.5:1 contrast. The open or
selected reference carries the same accent ring as a picture.

**A new pattern.** Point at or Tab to a generated cover in the grid and a small **↻**
appears at its top right (named *New cover pattern for* the title): it gives that book a fresh random
pattern, in the same colours and kind as its shelf, and the book keeps it. The ··· menu has the same
**New cover pattern**, and **Reset cover** (shown once the book has a pattern of its own) goes back to
the one its path gives. The Library tab's detail strip has its own ↻ on the cover. A book that shows a real
picture has no pattern to change.

**Shelves.** When you open a collection that has child collections, the grid groups its
references into shelves: a quiet monospaced header (the collection's name in capitals, then a count)
above that collection's tiles, with the references that sit directly in the parent first under the
parent's own name. Shelves are ordered by collection name, so a numeric prefix sets the order. Search,
format, availability and colour filters apply inside every shelf, and a shelf with nothing left
disappears. Tab follows the same order, shelf by shelf. The list view is unchanged, and a collection
without children is a plain grid.

**Collection names.** The library shows a collection's name without an ordering prefix: a leading
number and its separator are dropped, hyphens and underscores become spaces, and the first letter is
capitalised, so `1-languages` shows as **Languages** and `2-creative-apps` as **Creative apps**. This
is display only: the stored name, and the folder it came from, are unchanged, and the edit dialog
shows the real name.

### Intake

When files arrive with **Add files**, or a folder with **Index a folder**, a sheet opens titled *n new
references*, with where they came from in small monospaced type under the title (the folder, or
*Added files*). It does not open for a single PDF, image or EPUB that has its own cover, nor when
every added file does; it always opens after indexing a folder. The new references are grouped by shelf (their
first collection, shown by display name; those in none are *Unfiled*), each shelf with a quiet
header and its count, then its books as covers 132 px wide, as in the Library tab: the generated cover (or the real
picture), with the title, format and version.

- **↻** on a cover, shown on hover or focus (Tab to it, **Enter**), gives that book a new pattern.
  **New patterns** does so for every book on the sheet.
- **shelf ▾** in a shelf's header moves that shelf's books to another personal collection you pick
  (or to Unfiled). The books take that collection's colour and pattern kind; memberships that belong
  to an indexed folder stay.
- **Keep all** closes the sheet; **Esc** does the same. Nothing is waiting on your answer: the books
  are already in your library and every change you made is saved, so the sheet is a review, not a
  confirmation. At most 60 books are shown per shelf, with *and n more* under them; **New patterns** and
  **shelf ▾** still apply to all of them.

### Library tab

The Library tab shows a whole selection of the library at once, in the reading panel, as a tab beside your documents. The panel
is its only navigation: click the panel's **Library** title for all documents, double-click a folder or a collection in the tree
for that one, or run **Open Library tab** from the command palette. If the tab is already open
it is shown and pointed at the new selection; it is never opened twice. The panel marks what the tab shows (the folder or collection
row is highlighted), and the tab's name says it too. Nothing covers the page you were reading: switching back to a document is
a click on its tab.

The header has the name of what is shown, as a button: its menu offers the selections the tree has no row for (**All
documents**, **Favorites**, **Continue reading**, **Unfiled** and each **Source**). Next to it are the number of references and one
chip for each file type the library holds (PDF, EPUB, Markdown, Text, Images); click a type to show only those, click it again to
clear it. Under it are the search field, a colour menu, the **List** and **Grid** buttons and **Recent ☰**, one menu for **Sort by**
(Recent, Name A–Z), **Show** (any availability, ready, missing) and, with the grid on, a **Size** slider for the tiles. The documents
scroll all the way through. Click one to select it; from 900 px of reading panel a detail strip on the right shows its
collections, tags, notes and source. Click the selected document again, or press Enter, to open it: its tab opens, or is shown if it
is already open. **⌘-click** (Ctrl-click on Windows and Linux) or middle-click gives it a tab in the background instead.

### Filter by colour

The library can be narrowed to references whose pictures are mostly one colour: red, orange,
yellow, green, teal, blue, purple, pink, brown, black, white or grey. Choose a colour in the colour menu beside the Library tab's
search field, or click a swatch in its detail strip. A chip such as
**Blue ×** appears in the scope row; its × removes the filter. The filter applies on top of the
current collection and search. Colours are measured on this computer as thumbnails are made, and
remembered with them; while some are still being measured the chip says how many.

The desktop library stores references to original paths, not copies. Organizing, favoriting, and
removing entries never move, rename, or delete source files or saved positions. Opening a document
adds it to the library automatically. The existing recent-file list is migrated on first load; the
library is not subject to the 20-file recent limit. Clearing recents or reading data does not clear
the library. If you move a source externally, use **Open** or **Add files** to select its new path
and remove the stale entry.

Library metadata lives alongside reading state in the per-user application-data directory. Browser
preview storage is separate: IndexedDB caches selected file contents so entries can reopen after a
reload; removing a browser library entry removes only that cached copy, not the original file.

## Privacy and safety

Hold My Brief never changes your documents, has no account, sends no analytics and needs no internet
connection. Document scripts and automatic external-resource requests are blocked; EPUB content runs
in a sandbox without script permission; Markdown raw HTML is disabled; local images load only from
inside the opened document's folder. A web link opens in your browser only when you click it.
