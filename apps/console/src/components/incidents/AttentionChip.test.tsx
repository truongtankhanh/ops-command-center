import type { Incident } from '@occ/contracts';
import { act, render } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-utils';
import { AttentionChip } from './AttentionChip';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const NOW = Date.parse('2026-10-08T08:00:00.000Z');

// A high incident: its attention threshold is 5 minutes, so it is `soon` at a quarter left (75 s).
const incident: Incident = {
  id: 'i1',
  code: 'INC-000042',
  type: 'fire_alarm',
  severity: 'high',
  status: 'open',
  title: 'Smoke in the stairwell',
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: new Date(NOW).toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
};

/** The incident as it stood `ageMs` before the (faked) present. */
const reportedAgo = (ageMs: number, overrides: Partial<Incident> = {}): Incident => ({
  ...incident,
  reportedAt: new Date(NOW - ageMs).toISOString(),
  ...overrides,
});

// Only the clock and the interval are faked, so React's own scheduling is untouched and `getTimerCount` counts the chip's timer.
describe('AttentionChip', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const chipOf = (container: HTMLElement) => container.querySelector('[data-attention]');
  /** The drawn part: the ring, the optional clock and the words. */
  const figureOf = (container: HTMLElement) => chipOf(container)?.firstElementChild;

  describe('states', () => {
    it('shows a neutral ring and the time to attention, with no clock, on a new incident', () => {
      const { container } = render(<AttentionChip incident={reportedAgo(60 * SECOND)} />);

      expect(chipOf(container)).toHaveAttribute('data-attention', 'normal');
      expect(figureOf(container)).toHaveTextContent('4:00 to attention');
      expect(figureOf(container)?.querySelector('svg[data-state]')).toHaveAttribute(
        'data-state',
        'normal',
      );
      // The ring alone: the clock is for soon and overdue.
      expect(figureOf(container)?.querySelectorAll('svg')).toHaveLength(1);
    });

    it('is still neutral with 76 s left', () => {
      const { container } = render(<AttentionChip incident={reportedAgo(224 * SECOND)} />);

      expect(chipOf(container)).toHaveAttribute('data-attention', 'normal');
      expect(figureOf(container)).toHaveTextContent('1:16 to attention');
    });

    it('turns to the warning state, with a clock and the words, at a quarter left (75 s)', () => {
      const { container } = render(<AttentionChip incident={reportedAgo(225 * SECOND)} />);

      expect(chipOf(container)).toHaveAttribute('data-attention', 'soon');
      expect(figureOf(container)).toHaveTextContent('1:15 to attention');
      expect(figureOf(container)?.querySelector('svg[data-state]')).toHaveAttribute(
        'data-state',
        'soon',
      );
      expect(figureOf(container)?.querySelectorAll('svg')).toHaveLength(2);
    });

    it('reads the time over in the danger state, with a clock and a full ring', () => {
      const { container } = render(
        <AttentionChip incident={reportedAgo(5 * MINUTE + 5 * SECOND)} />,
      );

      expect(chipOf(container)).toHaveAttribute('data-attention', 'overdue');
      expect(figureOf(container)).toHaveTextContent('+0:05 over');
      expect(figureOf(container)).not.toHaveTextContent('to attention');
      expect(figureOf(container)?.querySelector('svg[data-state]')).toHaveAttribute(
        'data-state',
        'overdue',
      );
      expect(figureOf(container)?.querySelectorAll('svg')).toHaveLength(2);
    });
  });

  describe('when it draws nothing', () => {
    it.each(['acknowledged', 'resolved'] as const)('shows none on a %s incident', (status) => {
      const { container } = render(
        <AttentionChip incident={reportedAgo(60 * SECOND, { status })} />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('shows none for a report date it cannot read', () => {
      const { container } = render(
        <AttentionChip incident={reportedAgo(0, { reportedAt: 'not a date' })} />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('shows none for a severity it does not know', () => {
      const { container } = render(
        <AttentionChip
          incident={reportedAgo(60 * SECOND, { severity: 'catastrophic' as Incident['severity'] })}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('goes at once when the same incident is acknowledged', () => {
      const { container, rerender } = render(<AttentionChip incident={reportedAgo(60 * SECOND)} />);
      expect(chipOf(container)).not.toBeNull();

      rerender(
        <AttentionChip
          incident={reportedAgo(60 * SECOND, {
            status: 'acknowledged',
            acknowledgedAt: new Date(NOW).toISOString(),
            version: 2,
          })}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('accessibility', () => {
    it('hides the figure from assistive tech and is not a live region', () => {
      const { container } = render(<AttentionChip incident={reportedAgo(225 * SECOND)} />);

      const chip = chipOf(container);
      expect(figureOf(container)).toHaveAttribute('aria-hidden', 'true');
      expect(chip).not.toHaveAttribute('role');
      expect(chip?.querySelector('[role], [aria-live]')).toBeNull();
      expect(chip).not.toHaveAttribute('aria-live');
    });

    it('says one sentence in whole minutes, the same for a second and different by the minute', () => {
      const { container } = render(<AttentionChip incident={reportedAgo(60 * SECOND)} />);
      const sentence = () => chipOf(container)?.lastElementChild;
      expect(sentence()).toHaveTextContent('attention time in 4 minutes');
      expect(sentence()).not.toHaveAttribute('aria-hidden');

      // 3:59 left: the figure on screen moved, the sentence did not.
      advance(SECOND);
      expect(figureOf(container)).toHaveTextContent('3:59 to attention');
      expect(sentence()).toHaveTextContent('attention time in 4 minutes');

      // 2:59 left: the next minute.
      advance(MINUTE);
      expect(figureOf(container)).toHaveTextContent('2:59 to attention');
      expect(sentence()).toHaveTextContent('attention time in 3 minutes');
    });

    it('says "less than a minute" in the last minute', () => {
      const { container } = render(
        <AttentionChip incident={reportedAgo(5 * MINUTE - 30 * SECOND)} />,
      );

      expect(chipOf(container)?.lastElementChild).toHaveTextContent(
        'attention time in less than a minute',
      );
    });

    it('says "just past" in the first minute over and "past … by N minutes" after', () => {
      const { container } = render(
        <AttentionChip incident={reportedAgo(5 * MINUTE + 5 * SECOND)} />,
      );
      expect(chipOf(container)?.lastElementChild).toHaveTextContent('just past attention time');

      advance(2 * MINUTE);

      expect(chipOf(container)?.lastElementChild).toHaveTextContent(
        'past attention time by 2 minutes',
      );
      expect(figureOf(container)).toHaveTextContent('+2:05 over');
    });

    it('has no axe violations with a soon chip and an overdue chip', async () => {
      render(
        <>
          <AttentionChip incident={reportedAgo(225 * SECOND, { id: 'soon' })} />
          <AttentionChip incident={reportedAgo(5 * MINUTE + 5 * SECOND, { id: 'over' })} />
        </>,
      );

      await expectNoAxeViolations();
    });
  });

  describe('the clock', () => {
    it('steps the figure each second near the threshold', () => {
      const { container } = render(<AttentionChip incident={reportedAgo(60 * SECOND)} />);
      expect(figureOf(container)).toHaveTextContent('4:00 to attention');

      advance(SECOND);
      expect(figureOf(container)).toHaveTextContent('3:59 to attention');
      advance(SECOND);
      expect(figureOf(container)).toHaveTextContent('3:58 to attention');
    });

    it('moves from soon to overdue on its own', () => {
      const { container } = render(<AttentionChip incident={reportedAgo(5 * MINUTE - SECOND)} />);
      expect(chipOf(container)).toHaveAttribute('data-attention', 'soon');

      advance(SECOND);
      expect(chipOf(container)).toHaveAttribute('data-attention', 'overdue');
      expect(figureOf(container)).toHaveTextContent('+0:00 over');
    });

    it('keeps one timer, and clears it when it goes', () => {
      const { unmount } = render(<AttentionChip incident={reportedAgo(60 * SECOND)} />);
      expect(vi.getTimerCount()).toBe(1);

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  // V3-22.5: nothing to reduce under `prefers-reduced-motion`. A test cannot read the CSS module (it reaches vitest as the class
  // map), so this holds the DOM to it; `AttentionChip.module.css` has no animation or transition either (read, V3-22.5 log).
  describe('motion', () => {
    it.each([
      ['soon', 225 * SECOND],
      ['overdue', 5 * MINUTE + 5 * SECOND],
    ])('has no animated element and no inline motion when %s', (state, ageMs) => {
      const { container } = render(<AttentionChip incident={reportedAgo(ageMs)} />);

      const chip = chipOf(container);
      expect(chip).toHaveAttribute('data-attention', state);
      expect(chip).not.toHaveAttribute('style');
      expect(chip?.querySelector('animate, animateTransform, animateMotion, set')).toBeNull();
      for (const element of chip?.querySelectorAll('*') ?? []) {
        expect(element.getAttribute('style') ?? '').not.toMatch(/transition|animation/);
      }
    });
  });
});
