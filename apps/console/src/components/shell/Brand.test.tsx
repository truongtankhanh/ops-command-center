import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-utils';
import { Brand } from './Brand';

describe('Brand', () => {
  it.each(['md', 'lg'] as const)('names the product once, as the page heading (%s)', (size) => {
    render(<Brand size={size} site="Langbiang Tech Campus" />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Ops Command Center' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  // The site is the caller's (V3-05.1): the header and the wall pass the API's name, the sign-in
  // screens a static line. Nothing is drawn for a name that has not loaded.
  it.each(['md', 'lg'] as const)('shows the site it is given (%s)', (size) => {
    render(<Brand size={size} site="Langbiang Tech Campus" />);

    expect(screen.getByText('Langbiang Tech Campus')).toBeInTheDocument();
  });

  it.each(['md', 'lg'] as const)('draws no site line without one (%s)', (size) => {
    const { container } = render(<Brand size={size} />);

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    // The heading is the only text: no placeholder and no name of its own.
    expect(container).toHaveTextContent(/^Ops Command Center$/);
  });

  it('draws no site line for an empty name', () => {
    const { container } = render(<Brand site="" />);

    expect(container).toHaveTextContent(/^Ops Command Center$/);
  });

  it('marks only the stacked size, for the sign-in screens', () => {
    const { container, rerender } = render(<Brand size="lg" />);
    expect(container.firstElementChild).toHaveAttribute('data-size', 'lg');

    rerender(<Brand />);
    expect(container.firstElementChild).not.toHaveAttribute('data-size');
  });

  it('has no axe violations, with or without the site', async () => {
    const { container, rerender } = render(<Brand site="Langbiang Tech Campus" />);
    await expectNoAxeViolations(container);

    rerender(<Brand />);
    await expectNoAxeViolations(container);
  });
});
