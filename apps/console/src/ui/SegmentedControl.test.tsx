import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type Ref, useState } from 'react';
import { expectNoAxeViolations } from '../test-utils';
import { Info } from './icons';
import { SegmentedControl } from './SegmentedControl';

type Level = 'low' | 'high' | 'other';

const OPTIONS = [
  { value: 'low', label: 'Low', severity: 'low' },
  { value: 'high', label: 'High', severity: 'high' },
  { value: 'other', label: 'Other' },
] as const;

function Harness({ onChange }: { onChange?: (value: Level) => void }) {
  const [value, setValue] = useState<Level>('low');
  return (
    <SegmentedControl
      legend="Severity"
      name="severity"
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

/** A choice not made yet, with an icon on every option. */
function Choice({
  layout,
  step,
  error,
  describedBy,
  ref,
  onChange,
}: {
  layout?: 'row' | 'grid' | 'compact-grid';
  step?: number;
  error?: string;
  describedBy?: string;
  ref?: Ref<HTMLFieldSetElement>;
  onChange?: (value: Level) => void;
}) {
  const [value, setValue] = useState<Level | null>(null);
  return (
    <SegmentedControl
      ref={ref}
      legend="Severity"
      name="severity"
      options={OPTIONS.map((option) => ({ ...option, icon: Info }))}
      value={value}
      layout={layout}
      step={step}
      error={error}
      describedBy={describedBy}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a radio group named by its legend, one radio per option', () => {
    render(<Harness />);

    const group = screen.getByRole('group', { name: 'Severity' });
    expect(group.tagName).toBe('FIELDSET');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('name', 'severity');
    }
  });

  it('checks the option matching the value', () => {
    render(<Harness />);

    expect(screen.getByLabelText('Low')).toBeChecked();
    expect(screen.getByLabelText('High')).not.toBeChecked();
  });

  it('reports the chosen value and checks it', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(screen.getByLabelText('High'));

    expect(onChange).toHaveBeenCalledWith('high');
    expect(screen.getByLabelText('High')).toBeChecked();
    expect(screen.getByLabelText('Low')).not.toBeChecked();
  });

  it('marks an option with its severity, and leaves the others unmarked', () => {
    render(<Harness />);

    expect(screen.getByLabelText('High').closest('label')).toHaveAttribute('data-severity', 'high');
    expect(screen.getByLabelText('Other').closest('label')).not.toHaveAttribute('data-severity');
  });

  it('checks nothing until a choice is made', async () => {
    const onChange = vi.fn();
    render(<Choice onChange={onChange} />);

    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();

    await userEvent.click(screen.getByLabelText('High'));
    expect(screen.getByLabelText('High')).toBeChecked();
    expect(onChange).toHaveBeenCalledWith('high');
  });

  it('keeps icons out of the names, and lays out a grid', () => {
    const { rerender } = render(<Choice />);

    const low = screen.getByRole('radio', { name: 'Low' });
    expect(low.closest('label')!.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // `data-layout` is the grid's only non-class hook (ADR-0016 §4).
    expect(screen.getByRole('group').querySelector('[data-layout="grid"]')).toBeNull();

    rerender(<Choice layout="grid" />);
    expect(screen.getByRole('group').querySelector('[data-layout="grid"]')).not.toBeNull();
  });

  it('lays out a compact grid as a grid, marked compact', () => {
    const { rerender } = render(<Choice layout="grid" />);
    expect(screen.getByRole('group').querySelector('[data-compact]')).toBeNull();

    rerender(<Choice layout="compact-grid" />);
    const options = screen.getByRole('group').querySelector('[data-layout="grid"]');
    expect(options).toHaveAttribute('data-compact');
  });

  it('shows a step number without making it part of the name', () => {
    render(<Choice step={2} />);

    const group = screen.getByRole('group', { name: 'Severity' });
    const legend = group.querySelector('legend')!;
    expect(legend).toHaveTextContent('2Severity');
    expect(within(legend).getByText('2')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is described by its hint and its error together', () => {
    render(
      <>
        <p id="severity-hint">Suggested for lift entrapment: High.</p>
        <Choice describedBy="severity-hint" error="Choose a severity." />
      </>,
    );

    expect(screen.getByRole('group', { name: 'Severity' })).toHaveAccessibleDescription(
      'Choose a severity. Suggested for lift entrapment: High.',
    );
  });

  it('describes the group by its error and hands its fieldset to ref', () => {
    const ref = createRef<HTMLFieldSetElement>();
    render(<Choice ref={ref} error="Choose a severity." />);

    const group = screen.getByRole('group', { name: 'Severity' });
    expect(group).toHaveAccessibleDescription('Choose a severity.');
    expect(ref.current).toBe(group);
  });

  // UI-16: automated accessibility check, unchecked with an error, then with a choice made.
  it('has no axe violations, with an error', async () => {
    render(<Choice error="Choose a severity." />);
    await expectNoAxeViolations();

    await userEvent.click(screen.getByRole('radio', { name: 'High' }));

    expect(screen.getByRole('radio', { name: 'High' })).toBeChecked();
    await expectNoAxeViolations();
  });

  it('has no axe violations as a numbered compact grid with a hint', async () => {
    render(
      <>
        <p id="severity-hint">Suggested for lift entrapment: High.</p>
        <Choice layout="compact-grid" step={1} describedBy="severity-hint" />
      </>,
    );
    await expectNoAxeViolations();
  });
});
