import { act, render, screen, within } from '@testing-library/react';
import { HEAT_DOMAIN } from '../lib/twin-core/twinHeat';
import { useConsole } from '../store';
import { expectNoAxeViolations, resetStore } from '../test-utils';
import { HeatLegend } from './HeatLegend';

const heatOn = () => act(() => useConsole.getState().toggleLayer('heat'));
const legend = () => screen.getByRole('note');

describe('HeatLegend (V2-17.4)', () => {
  beforeEach(() => resetStore(useConsole));

  describe('when it is shown', () => {
    it('draws nothing while Heat is off', () => {
      render(<HeatLegend />);

      expect(screen.queryByRole('note')).toBeNull();
    });

    it('appears with the layer at the campus level, and goes with it', () => {
      render(<HeatLegend />);

      heatOn();
      expect(legend()).toBeInTheDocument();

      heatOn();
      expect(screen.queryByRole('note')).toBeNull();
    });

    it('is drawn with a building in focus', () => {
      heatOn();
      act(() => useConsole.getState().focusBuilding('BLD-DC'));
      render(<HeatLegend />);

      expect(legend()).toBeInTheDocument();
    });

    // Heat draws nothing different there (ADR-0020 "Settled in V2-17.3"), so there is nothing to explain.
    it('is not drawn with an asset isolated or one of its parts, and comes back after', () => {
      heatOn();
      render(<HeatLegend />);

      act(() => useConsole.getState().selectAsset('UPS-01', 'BLD-DC'));
      expect(screen.queryByRole('note')).toBeNull();

      act(() => useConsole.getState().selectPart('Door'));
      expect(screen.queryByRole('note')).toBeNull();

      act(() => useConsole.getState().goCampus());
      expect(legend()).toBeInTheDocument();
    });
  });

  describe('what it says', () => {
    beforeEach(() => heatOn());

    it('titles the measure, by building', () => {
      render(<HeatLegend />);

      expect(within(legend()).getByText('Indoor temperature, by building')).toBeInTheDocument();
    });

    it('reads the scale from the domain: 19, 23 and 27 °C in that order', () => {
      render(<HeatLegend />);

      expect(HEAT_DOMAIN).toEqual([19, 27]);
      expect(legend().textContent).toMatch(/19 °C.*23 °C.*27 °C/);
    });

    it('says it is a reading and not a severity, what a faded building means, and where the numbers are', () => {
      render(<HeatLegend />);

      expect(legend()).toHaveTextContent(
        "A reading, not a severity. Every building reports one; a faded building's sensor is silent. The Assets tab lists each reading.",
      );
    });

    it('hides the ramp from assistive technology: the numbers are in words around it', () => {
      const { container } = render(<HeatLegend />);

      const hidden = container.querySelectorAll('[aria-hidden="true"]');
      expect(hidden).toHaveLength(1);
      expect(hidden[0]).toBeEmptyDOMElement();
    });

    it('is not interactive: no button, link or tab stop', () => {
      render(<HeatLegend />);

      expect(within(legend()).queryByRole('button')).toBeNull();
      expect(within(legend()).queryByRole('link')).toBeNull();
      expect(legend()).not.toHaveAttribute('tabindex');
    });

    it('is not a live region', () => {
      render(<HeatLegend />);

      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(legend()).not.toHaveAttribute('aria-live');
    });
  });

  it('has no accessibility violations', async () => {
    heatOn();
    render(<HeatLegend />);

    await expectNoAxeViolations();
  });
});
