/**
 * What the reader tells agents about the user (`hmb events`): the text they select, the page they stay on, the tabs they show or close, and
 * the selection they send. This module decides *when* something is worth saying (settling, de-duplicating) and knows nothing of the DOM or
 * the native bridge: `main.ts` feeds it observations and passes the finished event to `control_event`.
 */

/** A selection stays unchanged this long before it is reported: dragging across a paragraph is one selection, not fifty. */
export const SELECTION_SETTLE_MS = 600;
/** A position stays this long before it is reported: scrolling past ten pages is one move, to where it stops. */
export const PAGE_SETTLE_MS = 800;
/** The most selected text an event carries; the native side cuts every string at the same length. */
export const EVENT_TEXT_MAX = 2000;

export type SelectionInfo = { paneId: string; path: string; title: string; where: string; text: string };
export type PageInfo = { paneId: string; path: string; position: string; progress: number };
export type TabInfo = { action: 'shown' | 'closed'; paneId: string; path: string; title: string; format: string; brief: boolean };

export type AgentEvent =
  | ({ type: 'selection' | 'send' } & SelectionInfo)
  | ({ type: 'page' } & PageInfo)
  | ({ type: 'tab' } & TabInfo);

/** A selection as an event reports it: trimmed, cut to `EVENT_TEXT_MAX`, or undefined when nothing is selected. */
export function selectionInfo(info: Omit<SelectionInfo, 'text'>, text: string): SelectionInfo | undefined {
  const trimmed = text.trim().slice(0, EVENT_TEXT_MAX);
  return trimmed ? { ...info, text: trimmed } : undefined;
}

/** A reading position as a number an agent can compare: 0–1, four decimals. */
export const progressFraction = (fraction: number) => Math.round(Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 10000) / 10000;

export interface AgentEvents {
  /** Reports the selection as it is now (`undefined` for none). Call as often as is cheap: only a change restarts the wait. */
  observeSelection(info: SelectionInfo | undefined): void;
  /** The last selection the user made, still there when focus moving to the palette emptied the live one. */
  lastSelection(): SelectionInfo | undefined;
  /** The user moved on (clicked in the page, changed tab): the remembered selection no longer stands. */
  forgetSelection(): void;
  /** Reports where the active document is; `undefined` when none is. A document seen for the first time is a starting point, not a move. */
  observePosition(info: PageInfo | undefined): void;
  tab(info: TabInfo): void;
  /** The user ran Send selection to agent; false when Agent control is off. */
  send(info: SelectionInfo): boolean;
  /** Agent control went off: nothing waiting may be reported later, and nothing remembered stays. */
  reset(): void;
}

export function createAgentEvents(emit: (event: AgentEvent) => void, enabled: () => boolean): AgentEvents {
  // Selection: the last one seen (kept after it is cleared, so a command can still send it), the one the timer is waiting on, the last one reported.
  let latest: SelectionInfo | undefined, observed: string | undefined, reported: string | undefined, selectionTimer: ReturnType<typeof setTimeout> | undefined;
  // Position: where the active document was last reported (or first seen), and the move waiting to settle.
  let base: { key: string; position: string } | undefined, pending: PageInfo | undefined, pageTimer: ReturnType<typeof setTimeout> | undefined;

  const selectionKey = (info: SelectionInfo) => `${info.paneId}\n${info.path}\n${info.text}`;
  const stopPage = () => { clearTimeout(pageTimer); pageTimer = undefined; pending = undefined; };

  return {
    observeSelection(info: SelectionInfo | undefined) {
      const key = info && selectionKey(info);
      if (info) latest = info;
      if (key === observed) return;
      observed = key; clearTimeout(selectionTimer); selectionTimer = undefined;
      if (!info || !key) return;
      selectionTimer = setTimeout(() => {
        selectionTimer = undefined;
        if (!enabled() || key === reported) return;
        reported = key; emit({ type: 'selection', ...info });
      }, SELECTION_SETTLE_MS);
    },
    lastSelection: () => latest,
    forgetSelection() { latest = undefined; },
    observePosition(info: PageInfo | undefined) {
      if (!info) { stopPage(); base = undefined; return; }
      const key = `${info.paneId}\n${info.path}`;
      if (base?.key !== key) { stopPage(); base = { key, position: info.position }; return; }
      if (info.position === base.position) { stopPage(); return; }
      if (pending && pending.position === info.position) { pending = info; return; }
      clearTimeout(pageTimer); pending = info;
      pageTimer = setTimeout(() => {
        const settled = pending; stopPage();
        if (!settled || !enabled()) return;
        base = { key, position: settled.position }; emit({ type: 'page', ...settled });
      }, PAGE_SETTLE_MS);
    },
    tab(info: TabInfo) { if (enabled()) emit({ type: 'tab', ...info }); },
    send(info: SelectionInfo): boolean {
      if (!enabled()) return false;
      emit({ type: 'send', ...info });
      return true;
    },
    reset() {
      clearTimeout(selectionTimer); selectionTimer = undefined; observed = reported = latest = undefined;
      stopPage(); base = undefined;
    },
  };
}
