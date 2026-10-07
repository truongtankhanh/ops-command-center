import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Select, Textarea, TextInput } from './Field';

describe('Field', () => {
  it('names a text input by its label, passing native props through', () => {
    render(
      <Field label="Title">
        <TextInput maxLength={160} placeholder="In a few words" required />
      </Field>,
    );

    const input = screen.getByLabelText('Title');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('maxLength', '160');
    expect(input).toHaveAttribute('placeholder', 'In a few words');
    expect(input).toBeRequired();
  });

  it('names a native select by its label', async () => {
    const onChange = vi.fn();
    render(
      <Field label="Type">
        <Select defaultValue="" onChange={(event) => onChange(event.target.value)}>
          <option value="" disabled>
            Choose a type
          </option>
          <option value="medical">Medical</option>
        </Select>
      </Field>,
    );

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'medical');

    expect(onChange).toHaveBeenCalledWith('medical');
  });

  it("names a textarea by its label and keeps the caller's class", async () => {
    render(
      <Field label="Details (optional)">
        <Textarea className="tall" />
      </Field>,
    );

    const textarea = screen.getByLabelText('Details (optional)');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveClass('tall');

    await userEvent.type(textarea, 'Smoke near the stairwell');
    expect(textarea).toHaveValue('Smoke near the stairwell');
  });

  it('marks an invalid control and describes it by its error', () => {
    const { rerender } = render(
      <Field label="Title" error="Enter a title.">
        <TextInput />
      </Field>,
    );

    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a title.');

    rerender(
      <Field label="Title">
        <TextInput />
      </Field>,
    );
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it("adds other descriptions after the error, and lets the control's own win", () => {
    render(
      <>
        <p id="pin-hint">Pin inside Library</p>
        <p id="own">Own description</p>
        <Field label="Location" error="Choose a location." describedBy="pin-hint">
          <TextInput />
        </Field>
        <Field label="Title" error="Enter a title.">
          <TextInput aria-describedby="own" />
        </Field>
      </>,
    );

    expect(screen.getByRole('textbox', { name: 'Location' })).toHaveAccessibleDescription(
      'Choose a location. Pin inside Library',
    );
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveAccessibleDescription(
      'Own description',
    );
  });

  it("shows a count beside the label, outside the control's name", () => {
    render(
      <Field label="Title" count="5 / 160">
        <TextInput />
      </Field>,
    );

    expect(screen.getByText('5 / 160')).toHaveAttribute('aria-hidden', 'true');
    // By role, not `getByLabelText`, which reads the label's raw text, counter included.
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
  });
});
