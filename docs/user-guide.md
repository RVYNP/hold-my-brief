# Hold My Brief user guide

Everything Hold My Brief does, in detail. For a quick tour, see the [README](../README.md).

## Opening documents

Open a PDF, DRM-free EPUB, Markdown, TXT or image file (PNG, JPEG, WebP, GIF, AVIF, BMP) with
Ctrl+O, **Open file…** in the command palette, a single-file drop or a command-line file argument. The Windows installer adds
Hold My Brief to Explorer's **Open with** list for the document formats without changing the default
app; clean-account installer behavior has not yet been verified. A second instance routes its file
request to the running app.

A scanned PDF with no text layer shows its pages as images: text on those pages can't be selected
or searched, and each such page carries an "Image-only page" note. Hold My Brief doesn't run OCR in
this build, so run the PDF through an OCR tool first if you need its text. This is a known limit
([#16](https://github.com/RVYNP/hold-my-brief/issues/16)).

## The window

The toolbar is one row, and the window has no separate title bar. On macOS the close, minimize and
zoom buttons sit at the toolbar's left end; on Windows, minimize, maximize and close sit at its right
end. Drag any empty part of the toolbar to move the window, and double-click it to maximize. The
document's name in the middle opens the command
palette (Ctrl+K), where you can open a file, jump, find or change any setting.

The pin button keeps the reader above ordinary windows. The lock button captures its outer
dimensions while allowing movement. Each is highlighted while on. Ctrl+Shift+T toggles pin;
Ctrl+Shift+L toggles lock. The ··· menu opens just under its button and holds what has no other
home: **All commands…** (the palette), Go to, Contents, Back, page rotation and spreads when the
document has pages, **Appearance and text…**, the AI assistant, the window presets (Compact
420 × 620, Reading 760 × 900), the shortcut reference and the data commands. Everything else, such as
fit and zoom, is on the page's floating controls, on its keys, and in the palette.

While another app has focus, the reader's buttons and progress line fade so a pinned window stays
quiet beside your work; the document's name, its position and the page keep full strength. Click the
reader and everything returns.

## Appearance

Open the menu and choose **Appearance and text…** to open the Appearance panel at the bottom of the
window. Its **Colour** tab holds:

- **Mode:** System (default; follows the operating system as it changes), Light or Dark.
- **Theme:** Brief (default), Lilac, Birch, Graphite, Arctic, and two pinks: Blossom (soft blush with a
  rose accent) and Peony (bold, magenta-tinted, deep aubergine in dark mode). Each has a light and a
  dark version, and every one keeps its text at WCAG AA contrast or better.
  Hover over or focus a theme to preview it on the whole window, click or press Enter to keep it, and
  move away or press Escape to go back to the theme you kept.
- **Accent:** the theme's own accent, one of seven presets, or a custom color. Contrast is adjusted
  automatically so text and controls stay readable.
- **Page:** Match theme, White, Sepia or Dim for text documents (Markdown, TXT and reflowable EPUB).
  PDF pages, fixed-layout EPUB pages and images always keep their original colors.

The **Text** tab (also **Text size & spacing…** in the palette) sets the open document's text size
(12–40 px), line spacing (Tight, Normal, Relaxed, Loose) and margins (Narrow, Medium, Wide), and for
plain text whether long lines wrap. Changes show on the page above the panel as you make them and are
saved with the document. PDF pages, fixed-layout books and images zoom instead (Ctrl + and Ctrl −).

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
Positions, paths and key labels use JetBrains Mono if installed, otherwise a system monospace face.

The theme design is inspired by [Tern](https://stencil.so/tern) by Stencil, and the Graphite theme
uses Tern's default palette. See [Credits](../README.md#credits).

## Moving through a document

PgDn/PgUp change pages. Space/Shift+Space traverse one screen, scrolling a tall PDF page before
advancing. Ctrl+G jumps to a physical page, EPUB chapter/percentage or source line. The position
(page, chapter or line) is shown next to the document's name in the toolbar; hover the name to see
the kind of view. It reports **position**, never completion or material actually read.

While you read, the footer is just the progress line along the window's bottom edge. Move the
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
level (**Fit**, **Width** or a percentage; click it to switch between fit page and fit width), zoom
in, the **Hand** tool and, for PDF and fixed-layout EPUB, **Single page** / **Two pages** buttons, and
stays in step with Ctrl+−/+ and Ctrl+0/2/3. When a zoomed page is larger
than the panel, press **H** (or the Hand button) and drag to pan it 1:1; text selection pauses while
the hand is on, and a click without movement still follows links. Middle-button drag pans in any
mode. The Hand button reads "Zoom in to pan" while the page fits, and the hand turns off when a new
document opens or the page fits again. Markdown, TXT and reflowable EPUB reflow instead of zooming,
so they have no pill and no panning.

### Two-page spread

**Two-page spread** (the ··· menu, the pill's book button, or Ctrl+3) shows PDF and
fixed-layout EPUB pages side by side, edge to edge, like an open book. By default page 1 is a cover
shown alone on the right and pairs follow as 2–3, 4–5…; turn off **Cover page alone** in the menu for
documents that should pair 1–2. Fixed-layout EPUBs keep their publisher's page sides and
right-to-left page progression. Pages of different sizes are scaled to a common height; fit page fits
the whole spread and fit width its width. Page turns, Go to, Back and the scrubber move by spread, and
the position reads "Pages 2–3 of 27". Reflowable EPUB shows two text columns instead.

The choice is remembered per document (new documents open in single-page view), and the saved place
is the first visible page, so switching views keeps it. When the reading panel is narrower than 600
pixels (or, for reflowable EPUB, taller than wide), pages show one at a time; the Two pages button and
the subtitle explain that two-page view is waiting for more width, and it returns as soon as the
panel is wide enough.

### Find in document

**Ctrl+F** searches the open document's text. Matches are counted as you type ("3 of 12"), Enter
goes to the next match and Shift+Enter to the previous one, wrapping at either end; the current
match is highlighted in the page and the reader scrolls to it. **Aa** matches case exactly and
**ab** matches whole words only. Escape closes the bar and clears the highlight. The bar sits above
the page and moves it down rather than covering it; with the library open it starts at the drawer's
edge, so the drawer never hides what you type.

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

The desktop app can hand questions to Claude, using your own Anthropic API key. It is off until you
turn it on, and without a key the app never makes a network request.

**Turn it on:** choose **AI assistant…** in the ··· menu (or type `ai` in the palette), paste an API
key from the [Anthropic Console](https://console.anthropic.com/settings/keys) and choose **Turn on**.
The key is checked with Anthropic first, then kept in macOS Keychain or Windows Credential Manager.
The app's own files never hold it, and the window never sees it again. Pick a model there too;
the newest Sonnet is chosen by default. **Turn off and forget key** deletes the key from the
keychain.

**Ask:** type into the palette as usual. With the assistant on, every query also offers
**Ask Claude**. When the text reads as a question ("what…", "why…", "summarize…", or anything ending
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
documents; never full file paths or your notes) go to
Anthropic over HTTPS from the app's native side. Anthropic's terms for your API account apply to
that data. Use is billed to your API key.

### Keyboard shortcuts

**Keyboard shortcuts** in the ··· menu (or the palette) shows the same list, grouped as in the
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
| Fit page / fit width | Ctrl+0 / Ctrl+2 |
| Two-page spread | Ctrl+3 |
| Zoom or text size | Ctrl++ / Ctrl+− |
| Hand tool (pan a zoomed page) | H, or drag with the middle button |
| Close a dialog | Escape |

## Saved reading data

Saved reading data lives in the native per-user local application-data directory under
`xyz.rpayton.holdmybrief` (on macOS, `~/Library/Application Support/xyz.rpayton.holdmybrief`),
not beside the source documents. Identical file bytes share resume state even after a rename.
Changed revisions keep the previous revision's state and show a best-effort restoration message. The
menu separately clears recents and saved reading data; neither deletes documents.

> **Renamed from Float Reader.** Before the rename the bundle identifier was
> `io.github.rvynp.floatreader`, so Float Reader builds kept their data in a folder of that name.
> The identifier changed to `xyz.rpayton.holdmybrief` with the rename, and data from the old
> folder is **not migrated**: the first Hold My Brief launch starts with an empty library and no
> saved positions. The old folder is left untouched and can be deleted by hand once you no longer
> need it.

## Document library

Use the sidebar button at the left of the toolbar, or **Ctrl+B**, to open the library. It opens as a
drawer that floats over the reading panel at every width, so opening, closing, resizing or moving it
never changes the page's size, zoom or place. Escape closes the drawer while focus is inside it. Wide
and compact visibility preferences are remembered separately.

Drag the divider between the drawer and the page to resize the drawer (240–520 pixels, and never more
than 55% of the window, which keeps at least 320 pixels of the reading panel clear beside it). Because
the drawer floats over the page, a wider drawer covers more of the page. Double-click the divider to
reset it to 270 pixels. The divider is also focusable: Left and Right resize by 16 pixels
(Shift: 64), Home and End jump to the narrowest and widest sizes, and Enter resets. The header button
beside **×** moves the drawer to the other side of the reading panel; compact windows follow the same
side. Width and side are remembered, and the width is re-fitted when the window shrinks.

In compact windows (below 720 pixels) the drawer covers the reading panel behind a scrim, cannot be
resized, and closes on a click outside it or after you open a document from it. Escape closes it
while focus is inside the drawer.

- **Add files** selects several documents or images at once without opening them. Select a
  collection first to add new entries directly to it.
- **Index a folder of PDFs** (desktop only) picks a folder and adds every PDF beneath it. The folder
  becomes a collection, and each first-level subfolder that contains PDFs becomes a child
  collection. Entries point at the original files; nothing is copied. Indexing the same folder
  again refreshes it without duplicating entries or losing favorites and reading positions.
- **New collection** creates a named group. Use **Edit** beside a collection to rename it, or its
  **×** control to delete it after confirmation. Deleting a collection puts its documents in
  **Unfiled**; it does not delete them.
- Each document's **···** control opens **Info**, **Organize document** (move it to a collection or
  remove its library entry after confirmation) and, for a missing original, **Locate**.
- Star a document for **Favorites**. Search filters the selected view by filename or path; sorting
  offers recent-first or name order.
- Click a document to reopen it at its saved reading position. A missing or unreadable source
  reports an error without replacing the document you are reading.

### Grid and list

The row under the search field names the collection you are looking at; click it for the collection
list and the format and availability filters. Beside it, the two glyphs switch between a **grid** of
thumbnails and a **list** of names. The grid keeps each reference's real proportions, so tall
posters and wide spreads read as themselves; books and text show a plain card with their title. The
choice is remembered per collection, and a collection that is mostly images or PDFs opens as a grid.
Hovering or focusing a tile shows its name, format, star and ··· menu; the document you are reading
is marked **Reading**, and a missing original is dimmed.

Thumbnails are made on this computer: images are scaled down, and a PDF's first page is rendered
with the reader's own PDF engine, reading only as much of the file as that page needs. They are kept
in the app's cache folder (at most 192 MB) and remade automatically when a file changes, so a large
library is slow only the first time it is shown. Thumbnails are a disposable cache: deleting them
loses nothing.

### Library board

The board shows a whole collection at once. Choose the expand button in the library header, or run
**Library board** from the command palette. The drawer opens across the reading panel, with your
collections on the left and every reference as a true-proportion thumbnail; the page underneath keeps
its size and place. Click a reference to select it. From 1200 px wide, a detail strip on the right
shows its collections, tags, notes and source. Press Enter or double-click to open it and return to
reading. Press Escape, or choose **Back to reading**, to return to the drawer exactly as you left it.
The board needs a window at least 720 px wide.

### Filter by colour

The library can be narrowed to references whose pictures are mostly one colour: red, orange,
yellow, green, teal, blue, purple, pink, brown, black, white or grey. Choose a colour in the filter
menu (beside the collection name), or click a swatch in the board's detail strip. A chip such as
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
