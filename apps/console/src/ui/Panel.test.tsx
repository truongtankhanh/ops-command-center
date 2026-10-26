import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../test-utils';
import { Panel } from './Panel';

describe('Panel', () => {
  it('renders its children', () => {
    render(<Panel>Layers</Panel>);

    expect(screen.getByText('Layers')).toBeInTheDocument();
  });

  it('is flat unless asked otherwise', () => {
    render(<Panel>Layers</Panel>);

    expect(screen.getByText('Layers')).toHaveAttribute('data-variant', 'flat');
  });

  it('is floating when asked', () => {
    render(<Panel variant="floating">Layers</Panel>);

    expect(screen.getByText('Layers')).toHaveAttribute('data-variant', 'floating');
  });

  it('keeps its variant when the caller passes a data attribute of the same name', () => {
    render(
      <Panel variant="floating" data-variant="flat">
        Layers
      </Panel>,
    );

    expect(screen.getByText('Layers')).toHaveAttribute('data-variant', 'floating');
  });

  it("keeps the caller's class for its placement", () => {
    render(<Panel className="top">Layers</Panel>);

    expect(screen.getByText('Layers')).toHaveClass('top');
  });

  it('passes other div attributes through, since a bare div has no role of its own', () => {
    render(
      <Panel role="region" aria-label="Map layers">
        Layers
      </Panel>,
    );

    expect(screen.getByRole('region', { name: 'Map layers' })).toHaveTextContent('Layers');
  });

  it('has no axe violations, flat or floating', async () => {
    render(
      <>
        <Panel role="region" aria-label="Flat panel">
          <p>Flat</p>
        </Panel>
        <Panel variant="floating" role="region" aria-label="Floating panel">
          <p>Floating</p>
        </Panel>
      </>,
    );

    expect(screen.getByRole('region', { name: 'Flat panel' })).toHaveAttribute(
      'data-variant',
      'flat',
    );
    expect(screen.getByRole('region', { name: 'Floating panel' })).toHaveAttribute(
      'data-variant',
      'floating',
    );
    await expectNoAxeViolations();
  });
});
