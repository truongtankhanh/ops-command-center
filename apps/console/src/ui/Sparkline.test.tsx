import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { expectNoAxeViolations } from '../test-utils';
import { Sparkline } from './Sparkline';

const WINDOW = 15 * 60_000;
const series = { times: [0, WINDOW], values: [0, 1], from: 0, to: WINDOW };

function draw(props: Partial<ComponentProps<typeof Sparkline>> = {}) {
  const { container } = render(<Sparkline {...series} {...props} />);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg rendered');
  return svg;
}

describe('Sparkline', () => {
  it('is a decorative 96 × 28 drawing with no text in it', () => {
    const svg = draw({ limit: 0.5 });

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 96 28');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg.textContent).toBe('');
    expect(svg.querySelector('text, title')).toBeNull();
    expect(svg).not.toHaveAttribute('role');
  });

  it('has no accessibility violation next to the reading it decorates', async () => {
    const { container } = render(
      <p>
        71 °C <Sparkline {...series} limit={0.5} />
      </p>,
    );

    await expectNoAxeViolations(container);
  });

  describe('severity and staleness', () => {
    it('carries no severity or stale attribute by default', () => {
      const svg = draw();

      expect(svg).not.toHaveAttribute('data-severity');
      expect(svg).not.toHaveAttribute('data-stale');
    });

    it.each(['critical', 'high', 'medium', 'low'] as const)('tints for %s', (over) => {
      expect(draw({ over })).toHaveAttribute('data-severity', over);
    });

    it('marks a stale series', () => {
      expect(draw({ stale: true })).toHaveAttribute('data-stale');
    });

    it('keeps both attributes when stale and over, so CSS can let stale win', () => {
      const svg = draw({ stale: true, over: 'critical' });

      expect(svg).toHaveAttribute('data-stale');
      expect(svg).toHaveAttribute('data-severity', 'critical');
    });
  });

  describe('tone', () => {
    it('carries no tone attribute by default, so the drawing is the live-data signal', () => {
      expect(draw()).not.toHaveAttribute('data-tone');
    });

    it('carries none for an explicit signal either: only the second tone is marked', () => {
      expect(draw({ tone: 'signal' })).not.toHaveAttribute('data-tone');
    });

    it('marks the second series', () => {
      expect(draw({ tone: 'secondary' })).toHaveAttribute('data-tone', 'secondary');
    });

    it('keeps the tone beside severity and staleness, so CSS can let those win', () => {
      const svg = draw({ tone: 'secondary', over: 'critical', stale: true });

      expect(svg).toHaveAttribute('data-tone', 'secondary');
      expect(svg).toHaveAttribute('data-severity', 'critical');
      expect(svg).toHaveAttribute('data-stale');
    });

    it('draws the same line and dot in either tone', () => {
      const plain = draw();
      const polyline = plain.querySelector('polyline')?.getAttribute('points');
      const dot = plain.querySelector('circle')?.getAttribute('cx');
      const second = draw({ tone: 'secondary' });

      expect(second.querySelector('polyline')?.getAttribute('points')).toBe(polyline);
      expect(second.querySelector('circle')?.getAttribute('cx')).toBe(dot);
    });

    it('has no accessibility violation in the second tone', async () => {
      const { container } = render(
        <p>
          71 °C <Sparkline {...series} limit={0.5} tone="secondary" />
        </p>,
      );

      await expectNoAxeViolations(container);
    });
  });

  describe('parts', () => {
    it('draws the line and the dot of a series, and no limit without one', () => {
      const svg = draw();

      expect(svg.querySelector('line')).toBeNull();
      expect(svg.querySelector('polyline')).toHaveAttribute('points', '0,23.17 96,4.83');
      const dot = svg.querySelector('circle');
      expect(dot).toHaveAttribute('cx', '96');
      expect(dot).toHaveAttribute('cy', '4.83');
      expect(dot).toHaveAttribute('r', '2.5');
    });

    it('draws the limit across the whole width', () => {
      const line = draw({ limit: 0.5 }).querySelector('line');

      expect(line).toHaveAttribute('x1', '0');
      expect(line).toHaveAttribute('x2', '96');
      expect(line?.getAttribute('y1')).toBe(line?.getAttribute('y2'));
    });

    it('draws only the limit for an empty series', () => {
      const svg = draw({ times: [], values: [], limit: 85 });

      expect(svg.querySelector('line')).not.toBeNull();
      expect(svg.querySelector('polyline')).toBeNull();
      expect(svg.querySelector('circle')).toBeNull();
    });

    it('draws a lone reading as a dot without a line', () => {
      const svg = draw({ times: [WINDOW / 2], values: [3] });

      expect(svg.querySelector('polyline')).toBeNull();
      expect(svg.querySelector('circle')).toHaveAttribute('cx', '48');
    });

    it('ends before the right edge when the last reading is 40 s old', () => {
      const svg = draw({ times: [0, WINDOW - 40_000], values: [1, 2] });

      expect(svg.querySelector('circle')).toHaveAttribute('cx', '91.73');
    });

    it('steps a boolean: every segment is horizontal or vertical', () => {
      const svg = draw({
        times: [0, WINDOW / 3, (2 * WINDOW) / 3],
        values: [0, 1, 0],
        step: true,
        range: { min: 0, max: 1 },
      });

      const points = (svg.querySelector('polyline')?.getAttribute('points') ?? '')
        .split(' ')
        .map((pair) => pair.split(',').map(Number) as [number, number]);
      expect(points).toHaveLength(5);
      points.slice(1).forEach(([x, y], index) => {
        const [previousX, previousY] = points[index] ?? [NaN, NaN];
        expect(x === previousX || y === previousY).toBe(true);
      });
    });
  });

  it("keeps the caller's class", () => {
    expect(draw({ className: 'spaced' })).toHaveClass('spaced');
  });
});
