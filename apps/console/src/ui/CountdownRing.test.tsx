import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { expectNoAxeViolations } from '../test-utils';
import { CountdownRing } from './CountdownRing';

const CIRCUMFERENCE = 2 * Math.PI * 9;

function draw(props: Partial<ComponentProps<typeof CountdownRing>> = {}) {
  const { container } = render(<CountdownRing fraction={1} state="normal" {...props} />);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg rendered');
  return svg;
}

/** The arc is the one circle that is cut with a dash pattern; the track is whole. */
const arcOf = (svg: SVGSVGElement) => svg.querySelector('circle[stroke-dasharray]');

/** The share of the circumference that the arc covers, read back from its dash pattern. */
function shareOf(svg: SVGSVGElement): number {
  const dash = arcOf(svg)?.getAttribute('stroke-dasharray');
  if (!dash) throw new Error('no arc drawn');
  const [drawn = Number.NaN, rest = Number.NaN] = dash.split(' ').map(Number);
  expect(drawn + rest).toBeCloseTo(CIRCUMFERENCE, 1);
  return drawn / CIRCUMFERENCE;
}

describe('CountdownRing', () => {
  it('is a decorative 22-unit drawing with no text in it', () => {
    const svg = draw();

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 22 22');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg.textContent).toBe('');
    expect(svg.querySelector('text, title, desc')).toBeNull();
    expect(svg).not.toHaveAttribute('role');
    expect(svg).not.toHaveAttribute('tabindex');
  });

  it('has no accessibility violation next to the text it decorates', async () => {
    const { container } = render(
      <p>
        1:30 <CountdownRing fraction={0.75} state="normal" />
      </p>,
    );

    await expectNoAxeViolations(container);
  });

  describe('the arc', () => {
    it('draws a track and, from 12 o’clock, an arc on the same circle', () => {
      const svg = draw({ fraction: 0.5 });
      const circles = svg.querySelectorAll('circle');
      const arc = arcOf(svg);

      expect(circles).toHaveLength(2);
      expect(arc).toHaveAttribute('transform', 'rotate(-90 11 11)');
      circles.forEach((circle) => {
        expect(circle).toHaveAttribute('cx', '11');
        expect(circle).toHaveAttribute('cy', '11');
        expect(circle).toHaveAttribute('r', '9');
      });
    });

    it.each([
      [1, 1],
      [0.5, 0.5],
      [0.25, 0.25],
    ])('covers %s of the circle at a fraction of %s', (fraction, share) => {
      expect(shareOf(draw({ fraction }))).toBeCloseTo(share, 2);
    });

    it('draws no arc at 0, where a round cap would draw a dot', () => {
      const svg = draw({ fraction: 0, state: 'soon' });

      expect(arcOf(svg)).toBeNull();
      expect(svg.querySelectorAll('circle')).toHaveLength(1);
    });

    it('keeps a fraction outside 0 – 1 on the ring', () => {
      expect(shareOf(draw({ fraction: 1.5 }))).toBeCloseTo(1, 2);
      expect(arcOf(draw({ fraction: -0.5 }))).toBeNull();
    });
  });

  describe('state', () => {
    it.each(['normal', 'soon', 'overdue'] as const)('carries data-state="%s"', (state) => {
      expect(draw({ state })).toHaveAttribute('data-state', state);
    });

    it('is a full ring when overdue, whatever the fraction', () => {
      expect(shareOf(draw({ state: 'overdue', fraction: 0 }))).toBeCloseTo(1, 2);
      expect(shareOf(draw({ state: 'overdue', fraction: 0.4 }))).toBeCloseTo(1, 2);
    });

    it('shortens as the time runs out without a change of state', () => {
      expect(shareOf(draw({ state: 'soon', fraction: 0.2 }))).toBeCloseTo(0.2, 2);
    });
  });

  describe('motion', () => {
    it('has no animation element and no inline transition', () => {
      const svg = draw({ state: 'overdue' });

      expect(svg.querySelector('animate, animateTransform, animateMotion, set')).toBeNull();
      expect(svg.getAttribute('style') ?? '').not.toMatch(/transition|animation/);
      svg.querySelectorAll('*').forEach((element) => {
        expect(element.getAttribute('style') ?? '').not.toMatch(/transition|animation/);
      });
    });
  });

  it('merges a className with its own', () => {
    expect(draw({ className: 'extra' })).toHaveClass('extra');
  });
});
