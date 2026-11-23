import type { ReadingFlow } from './types';
import { FONT_MAX, FONT_MIN } from './text-size';

const listIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';

export type ReadingControls = {
  element: HTMLElement;
  /** The Contents button: the popover opens above it. */
  contents: HTMLButtonElement;
  /** Shows the reading controls available for this reflowable document (Contents when it has headings, Pages | Scroll for EPUBs, and A− / A+). */
  update: (state: { flow?: ReadingFlow; hasContents: boolean; fontSize: number }) => void;
};

/**
 * The view controls of a reflowable document (EPUB, Markdown, plain text), in the pill: Contents (when the document has an
 * outline), Pages | Scroll (for EPUBs), and A− <size> A+. The pill places and shows it; what each control does is the reader's, handed in here.
 */
export function createReadingControls(handlers: { contents: () => void; flow: (flow: ReadingFlow) => void; size: (direction: -1 | 1) => void }): ReadingControls {
  const element = document.createElement('span');
  element.id = 'view-reading'; element.className = 'view-group'; element.setAttribute('role', 'group'); element.setAttribute('aria-label', 'Reading controls');
  element.innerHTML = `<button id="view-contents" class="view-text" type="button" aria-haspopup="dialog" title="Contents">${listIcon}<span>Contents</span></button>`
    + '<span id="view-contents-sep" class="view-sep" aria-hidden="true"></span>'
    + '<span id="view-flow" class="view-segmented" role="group" aria-label="Reading view"><button id="flow-pages" class="view-text" type="button" aria-pressed="true" title="Pages view: turn pages">Pages</button><button id="flow-scroll" class="view-text" type="button" aria-pressed="false" title="Scroll view: one continuous column">Scroll</button></span>'
    + '<span id="view-flow-sep" class="view-sep" aria-hidden="true"></span>'
    + '<span class="view-size" role="group" aria-label="Text size"><button id="text-smaller" class="view-text" type="button" aria-label="Smaller text" title="Smaller text (Ctrl −)">A−</button><output id="text-size" title="Text size in px" aria-live="polite"></output><button id="text-larger" class="view-text" type="button" aria-label="Larger text" title="Larger text (Ctrl +)">A+</button></span>';
  const get = (id: string) => element.querySelector<HTMLButtonElement>(`#${id}`)!;
  const [contents, pages, scroll, smaller, larger] = ['view-contents', 'flow-pages', 'flow-scroll', 'text-smaller', 'text-larger'].map(get);
  const contentsSep = element.querySelector<HTMLElement>('#view-contents-sep')!;
  const flowGroup = element.querySelector<HTMLElement>('#view-flow')!;
  const flowSep = element.querySelector<HTMLElement>('#view-flow-sep')!;
  const size = element.querySelector<HTMLOutputElement>('#text-size')!;
  contents.onclick = handlers.contents;
  pages.onclick = () => handlers.flow('paginated');
  scroll.onclick = () => handlers.flow('scrolled');
  smaller.onclick = () => handlers.size(-1);
  larger.onclick = () => handlers.size(1);
  return {
    element, contents,
    update({ flow, hasContents, fontSize }) {
      contents.hidden = contentsSep.hidden = !hasContents;
      const hasFlow = flow !== undefined;
      flowGroup.hidden = flowSep.hidden = !hasFlow;
      if (hasFlow) { pages.setAttribute('aria-pressed', String(flow === 'paginated')); scroll.setAttribute('aria-pressed', String(flow === 'scrolled')); }
      size.textContent = String(fontSize);
      smaller.disabled = fontSize <= FONT_MIN; larger.disabled = fontSize >= FONT_MAX;
    },
  };
}
