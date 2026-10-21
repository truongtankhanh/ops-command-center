import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-utils';
import { WallLegend } from './WallLegend';

describe('WallLegend', () => {
  it('names what the beacons and markers mean, with nothing to press', () => {
    render(<WallLegend />);

    const list = screen.getByRole('list', { name: 'Legend' });
    expect(list).toHaveTextContent('Open');
    expect(list).toHaveTextContent('Being handled');
    expect(list).toHaveTextContent('Camera');
    expect(list).toHaveTextContent('Colour = severity');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('has no axe violation', async () => {
    const { container } = render(<WallLegend />);

    await expectNoAxeViolations(container);
  });
});
