/**
 * The text of the user's selection that lies inside `host`, or '' when none does. A selection can reach past the reading surface
 * (select-all spans the whole page; a drag can end over the footer, a notice or a pill), and what lies outside is reader chrome, not
 * document. Anything inside is serialised by the browser's own `Selection.toString`, so line breaks and unselectable
 * parts (code gutters) come out as they do when the user copies.
 */
export function hostSelectionText(host: HTMLElement, sel: Selection): string {
  if (sel.isCollapsed || !sel.rangeCount) return '';
  const ranges = Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i));
  if (!ranges.some(range => range.intersectsNode(host))) return '';
  if (ranges.every(range => host.contains(range.startContainer) && host.contains(range.endContainer))) return sel.toString();
  // The selection reaches outside: read it back clipped to the host, then put the user's selection back as it was.
  const { anchorNode, anchorOffset, focusNode, focusOffset } = sel;
  const kept = ranges.map(range => range.cloneRange());
  const inside = document.createRange();
  inside.selectNodeContents(host);
  sel.removeAllRanges();
  for (const range of kept) {
    if (!range.intersectsNode(host)) continue;
    const clip = range.cloneRange();
    if (clip.compareBoundaryPoints(Range.START_TO_START, inside) < 0) clip.setStart(inside.startContainer, inside.startOffset);
    if (clip.compareBoundaryPoints(Range.END_TO_END, inside) > 0) clip.setEnd(inside.endContainer, inside.endOffset);
    sel.addRange(clip);
  }
  const text = sel.toString();
  sel.removeAllRanges();
  if (kept.length === 1 && anchorNode && focusNode) sel.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  else for (const range of kept) sel.addRange(range);
  return text;
}
