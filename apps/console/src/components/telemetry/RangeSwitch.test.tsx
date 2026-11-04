import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { READING_RANGES, type ReadingRange } from '../../lib/telemetry/readingRange';
import { expectNoAxeViolations } from '../../test-utils';
import { RangeSwitch } from './RangeSwitch';

const ASSET_RANGES = READING_RANGES.filter((option) => option.id !== 'alarm');

/** The switch with its value held, as a tab holds it; `onChange` sees every choice. */
function Harness({
  initial = '15m',
  options = READING_RANGES,
  onChange,
}: {
  initial?: ReadingRange;
  options?: typeof READING_RANGES;
  onChange?: (range: ReadingRange) => void;
}) {
  const [value, setValue] = useState<ReadingRange>(initial);
  return (
    <RangeSwitch
      options={options}
      value={value}
      onChange={(range) => {
        onChange?.(range);
        setValue(range);
      }}
    />
  );
}

const radio = (name: string) => screen.getByRole('radio', { name });
const checkedName = () =>
  screen.getAllByRole('radio').find((option) => option.getAttribute('aria-checked') === 'true')
    ?.textContent;

describe('RangeSwitch', () => {
  it('is a radio group named "Reading range", one radio per option, in order', () => {
    render(<Harness />);

    expect(screen.getByRole('radiogroup', { name: 'Reading range' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual([
      '15 min',
      '1 h',
      'Around the alarm',
    ]);
  });

  it('draws only the options it is given', () => {
    render(<Harness options={ASSET_RANGES} />);

    expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual([
      '15 min',
      '1 h',
    ]);
  });

  it('checks the value only, with aria-checked', () => {
    render(<Harness initial="1h" />);

    expect(radio('1 h')).toHaveAttribute('aria-checked', 'true');
    expect(radio('15 min')).toHaveAttribute('aria-checked', 'false');
    expect(radio('Around the alarm')).toHaveAttribute('aria-checked', 'false');
  });

  it('is one Tab stop, on the checked option', async () => {
    render(
      <>
        <button type="button">Before</button>
        <Harness initial="1h" />
        <button type="button">After</button>
      </>,
    );

    await userEvent.tab();
    await userEvent.tab();
    expect(radio('1 h')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('keeps the first option reachable when the value is not offered', () => {
    render(<Harness initial="alarm" options={ASSET_RANGES} />);

    expect(checkedName()).toBeUndefined();
    expect(radio('15 min')).toHaveAttribute('tabindex', '0');
    expect(radio('1 h')).toHaveAttribute('tabindex', '-1');
  });

  it('moves and checks with → and ←, wrapping at the ends', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    radio('15 min').focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(radio('1 h')).toHaveFocus();
    expect(checkedName()).toBe('1 h');
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(radio('15 min')).toHaveFocus();
    expect(checkedName()).toBe('15 min');
    await userEvent.keyboard('{ArrowLeft}');
    expect(radio('Around the alarm')).toHaveFocus();
    expect(checkedName()).toBe('Around the alarm');
    expect(onChange.mock.calls.map(([range]) => range)).toEqual(['1h', 'alarm', '15m', 'alarm']);
  });

  it('moves and checks with ↓ and ↑ as with → and ←', async () => {
    render(<Harness />);
    radio('15 min').focus();

    await userEvent.keyboard('{ArrowDown}');
    expect(radio('1 h')).toHaveFocus();
    expect(checkedName()).toBe('1 h');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(radio('Around the alarm')).toHaveFocus();
    expect(checkedName()).toBe('Around the alarm');
  });

  it('jumps to the ends with Home and End', async () => {
    render(<Harness initial="1h" />);
    radio('1 h').focus();

    await userEvent.keyboard('{End}');
    expect(radio('Around the alarm')).toHaveFocus();
    expect(checkedName()).toBe('Around the alarm');
    await userEvent.keyboard('{Home}');
    expect(radio('15 min')).toHaveFocus();
    expect(checkedName()).toBe('15 min');
  });

  it('moves the Tab stop with the choice', async () => {
    render(<Harness />);
    radio('15 min').focus();

    await userEvent.keyboard('{ArrowRight}');

    expect(radio('1 h')).toHaveAttribute('tabindex', '0');
    expect(radio('15 min')).toHaveAttribute('tabindex', '-1');
    expect(radio('Around the alarm')).toHaveAttribute('tabindex', '-1');
  });

  it('checks the option clicked', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(radio('Around the alarm'));

    expect(checkedName()).toBe('Around the alarm');
    expect(onChange).toHaveBeenCalledWith('alarm');
  });

  it('checks the focused option with Space', async () => {
    render(<Harness />);
    radio('1 h').focus();

    await userEvent.keyboard(' ');

    expect(checkedName()).toBe('1 h');
  });

  it('leaves other keys to the browser', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    radio('15 min').focus();

    await userEvent.keyboard('a');

    expect(onChange).not.toHaveBeenCalled();
    expect(radio('15 min')).toHaveFocus();
  });

  it('announces nothing through a live region', () => {
    const { container } = render(<Harness />);

    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(<Harness initial="1h" />);

    await expectNoAxeViolations(container);
  });
});
