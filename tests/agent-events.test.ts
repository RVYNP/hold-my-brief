import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_TEXT_MAX, PAGE_SETTLE_MS, SELECTION_SETTLE_MS, createAgentEvents, progressFraction, selectionInfo, type AgentEvent, type AgentEvents, type PageInfo, type SelectionInfo } from '../src/agent-events';

const where = { paneId: 'a', path: '/book.pdf', title: 'Book', where: 'p. 4' };
const chosen = (text: string): SelectionInfo => ({ ...where, text });
const at = (position: string, progress = 0.5): PageInfo => ({ paneId: 'a', path: '/book.pdf', position, progress });

describe('agent events', () => {
  let sent: AgentEvent[], on: boolean, events: AgentEvents;
  beforeEach(() => { vi.useFakeTimers(); sent = []; on = true; events = createAgentEvents(event => sent.push(event), () => on); });
  afterEach(() => vi.useRealTimers());

  describe('selection', () => {
    it('is reported once it has not changed for the settle time, and not before', () => {
      events.observeSelection(chosen('lifetimes'));
      vi.advanceTimersByTime(SELECTION_SETTLE_MS - 1);
      expect(sent).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(sent).toEqual([{ type: 'selection', ...chosen('lifetimes') }]);
    });

    it('waits for a selection that is still being dragged, and reports where it ended', () => {
      for (const text of ['life', 'lifetimes', 'lifetimes and borrows']) { events.observeSelection(chosen(text)); vi.advanceTimersByTime(300); }
      expect(sent).toEqual([]);
      vi.advanceTimersByTime(SELECTION_SETTLE_MS);
      expect(sent.map(event => event.type === 'selection' && event.text)).toEqual(['lifetimes and borrows']);
    });

    it('does not restart the wait when the same selection is observed again', () => {
      events.observeSelection(chosen('lifetimes'));
      vi.advanceTimersByTime(400);
      events.observeSelection(chosen('lifetimes'));
      vi.advanceTimersByTime(200);
      expect(sent).toHaveLength(1);
    });

    it('does not report the selection it already reported, even after it was cleared and made again', () => {
      events.observeSelection(chosen('lifetimes')); vi.advanceTimersByTime(SELECTION_SETTLE_MS);
      events.observeSelection(undefined); vi.advanceTimersByTime(SELECTION_SETTLE_MS * 2);
      events.observeSelection(chosen('lifetimes')); vi.advanceTimersByTime(SELECTION_SETTLE_MS * 2);
      expect(sent).toHaveLength(1);
      events.observeSelection(chosen('borrows')); vi.advanceTimersByTime(SELECTION_SETTLE_MS);
      expect(sent).toHaveLength(2);
    });

    it('reports nothing for a selection cleared before it settled', () => {
      events.observeSelection(chosen('lifetimes')); vi.advanceTimersByTime(300);
      events.observeSelection(undefined); vi.advanceTimersByTime(SELECTION_SETTLE_MS * 2);
      expect(sent).toEqual([]);
    });

    it('is a different selection in another pane or document', () => {
      events.observeSelection(chosen('same words')); vi.advanceTimersByTime(SELECTION_SETTLE_MS);
      events.observeSelection({ ...chosen('same words'), paneId: 'b' }); vi.advanceTimersByTime(SELECTION_SETTLE_MS);
      expect(sent).toHaveLength(2);
    });

    it('says nothing while Agent control is off, and nothing that was waiting once it goes off', () => {
      on = false;
      events.observeSelection(chosen('private')); vi.advanceTimersByTime(SELECTION_SETTLE_MS * 2);
      expect(sent).toEqual([]);
      on = true;
      events.observeSelection(chosen('waiting')); events.reset(); vi.advanceTimersByTime(SELECTION_SETTLE_MS * 2);
      expect(sent).toEqual([]);
      expect(events.lastSelection()).toBeUndefined();
    });

    it('is trimmed and cut to the length an event carries, and empty selections are none', () => {
      expect(selectionInfo(where, '  \n ')).toBeUndefined();
      expect(selectionInfo(where, '  words \n')?.text).toBe('words');
      expect(selectionInfo(where, 'x'.repeat(EVENT_TEXT_MAX + 500))?.text).toHaveLength(EVENT_TEXT_MAX);
    });
  });

  describe('Send selection to agent', () => {
    it('sends the remembered selection after the live one is gone, until the user forgets it', () => {
      events.observeSelection(chosen('lifetimes'));
      events.observeSelection(undefined);
      expect(events.lastSelection()).toEqual(chosen('lifetimes'));
      expect(events.send(events.lastSelection()!)).toBe(true);
      expect(sent).toEqual([{ type: 'send', ...chosen('lifetimes') }]);
      events.forgetSelection();
      expect(events.lastSelection()).toBeUndefined();
    });

    it('sends nothing while Agent control is off', () => {
      on = false;
      expect(events.send(chosen('lifetimes'))).toBe(false);
      expect(sent).toEqual([]);
    });
  });

  describe('page', () => {
    it('is reported when the position has changed and stayed, with where it settled', () => {
      events.observePosition(at('p. 4', 0.1));
      events.observePosition(at('p. 5', 0.2)); vi.advanceTimersByTime(500);
      events.observePosition(at('p. 6', 0.3)); vi.advanceTimersByTime(PAGE_SETTLE_MS - 1);
      expect(sent).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(sent).toEqual([{ type: 'page', ...at('p. 6', 0.3) }]);
    });

    it('treats the first position of a document, and a tab switch, as a starting point', () => {
      events.observePosition(at('p. 4'));
      vi.advanceTimersByTime(PAGE_SETTLE_MS * 2);
      events.observePosition({ ...at('p. 90'), path: '/other.pdf' });
      vi.advanceTimersByTime(PAGE_SETTLE_MS * 2);
      expect(sent).toEqual([]);
    });

    it('reports nothing when the reader comes back to where it was before the wait ended', () => {
      events.observePosition(at('p. 4'));
      events.observePosition(at('p. 5')); vi.advanceTimersByTime(300);
      events.observePosition(at('p. 4')); vi.advanceTimersByTime(PAGE_SETTLE_MS * 2);
      expect(sent).toEqual([]);
    });

    it('keeps waiting through movement inside one position label, and does not report it twice', () => {
      events.observePosition(at('p. 4'));
      events.observePosition(at('p. 5', 0.41)); vi.advanceTimersByTime(500);
      events.observePosition(at('p. 5', 0.45)); vi.advanceTimersByTime(PAGE_SETTLE_MS - 500);
      expect(sent).toEqual([{ type: 'page', ...at('p. 5', 0.45) }]);
      events.observePosition(at('p. 5', 0.49)); vi.advanceTimersByTime(PAGE_SETTLE_MS * 2);
      expect(sent).toHaveLength(1);
    });

    it('forgets its starting point while no document is in place (a load), so what comes after is not a move', () => {
      events.observePosition(at('p. 4'));
      events.observePosition(at('p. 5')); events.observePosition(undefined);
      events.observePosition(at('p. 9')); vi.advanceTimersByTime(PAGE_SETTLE_MS * 2);
      expect(sent).toEqual([]);
    });

    it('is not reported once Agent control is off', () => {
      events.observePosition(at('p. 4')); events.observePosition(at('p. 5'));
      on = false; vi.advanceTimersByTime(PAGE_SETTLE_MS * 2);
      expect(sent).toEqual([]);
    });

    it('turns a fraction into a number from 0 to 1 with four decimals', () => {
      expect([progressFraction(0.123456), progressFraction(-1), progressFraction(7), progressFraction(NaN)]).toEqual([0.1235, 0, 1, 0]);
    });
  });

  describe('tab', () => {
    it('is reported as it is, while Agent control is on', () => {
      const tab = { action: 'closed', paneId: 'a', path: 'hold-my-brief:brief/plan', title: 'Plan', format: 'md', brief: true } as const;
      events.tab(tab);
      on = false; events.tab(tab);
      expect(sent).toEqual([{ type: 'tab', ...tab }]);
    });
  });
});
