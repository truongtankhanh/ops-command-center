import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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
});
