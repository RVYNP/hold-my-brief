/**
 * Tab titles that tell open documents apart. Two documents often share a name in different folders (`…/03_wwe_mag/source.pdf`
 * and `…/09_dirtrider/source.pdf`), so when two or more open tabs would show the same title each gets the shortest trailing part
 * of its folder path that sets it apart from the others, as editors do: "source.pdf" + "09_dirtrider". Pure, so it is unit-tested.
 */

export type TitledTab = { path: string; title: string };

/** A browser-build library path is `<64-hex content id>/<file name>`: the id is no help to a reader, so only its start is shown. */
const CONTENT_ID = /^[0-9a-f]{64}$/;

/** The folders above a file, outermost first. */
function folders(path: string): string[] {
  const parts = path.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts;
}

const shown = (segment: string) => (CONTENT_ID.test(segment) ? segment.slice(0, 6) : segment);

/**
 * The extra text, by path, for every tab whose title another open tab shares; tabs with a unique title get nothing. Each hint is
 * the fewest trailing folders that make the hints of that group all different ("09_dirtrider", then "mags/09_dirtrider"...). When
 * folders cannot do it (the same folder, different titles that came out equal), the file name is the hint.
 */
export function titleHints(tabs: readonly TitledTab[]): Map<string, string> {
  const groups = new Map<string, TitledTab[]>();
  for (const tab of tabs) groups.set(tab.title, [...(groups.get(tab.title) ?? []), tab]);
  const hints = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const parents = group.map(tab => folders(tab.path));
    const deepest = Math.max(...parents.map(parent => parent.length));
    let chosen: string[] | undefined;
    for (let depth = 1; depth <= deepest && !chosen; depth++) {
      const candidate = parents.map(parent => parent.slice(-depth).map(shown).join('/'));
      if (new Set(candidate).size === group.length) chosen = candidate;
    }
    chosen ??= group.map(tab => tab.path.split(/[\\/]/).pop() ?? tab.path);
    group.forEach((tab, index) => { if (chosen[index]) hints.set(tab.path, chosen[index]); });
  }
  return hints;
}

const EXTENSION = /\.[A-Za-z0-9]{1,5}$/;

/**
 * Cuts a name in the middle so it fits: the start and the end, with the extension, joined by "…" ("Haeckel - Kun…plate 15.jpg").
 * Images from one series share their start and differ at the end, so the end is the part to keep; the tail gets the larger half.
 * `fits` says whether a candidate is narrow enough (the strip measures it in the tab's real font). A name that already fits is
 * returned as it is; when nothing fits, the shortest cut ("…" and the extension) is returned, and the caller's CSS clips the rest.
 * A name of one character or none cannot be cut and is returned as it is.
 */
export function middleTruncate(name: string, fits: (candidate: string) => boolean): string {
  if (name.length <= 1 || fits(name)) return name;
  const dot = name.search(EXTENSION), extension = dot > 0 ? name.length - dot : 0;
  const cut = (kept: number) => {
    const tail = Math.min(kept, Math.max(extension, Math.ceil(kept * 0.6)));
    return `${name.slice(0, kept - tail).trimEnd()}…${name.slice(name.length - tail)}`;
  };
  // The largest number of kept characters that fits; the smallest keeps the extension (or one character of a name without one).
  let low = Math.max(extension, 1), high = name.length - 1;
  if (low > high) return name;
  if (!fits(cut(low))) return cut(low);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(cut(middle))) low = middle; else high = middle - 1;
  }
  return cut(low);
}
