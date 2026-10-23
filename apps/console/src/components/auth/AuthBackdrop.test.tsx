import { render } from '@testing-library/react';
import { AuthBackdrop } from './AuthBackdrop';

describe('AuthBackdrop', () => {
  it('is decoration: hidden from assistive technology, no text, no image role, nothing to focus', () => {
    const { container } = render(<AuthBackdrop />);

    const backdrop = container.querySelector('[data-backdrop]');
    expect(backdrop).toBeInTheDocument();
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(container).toHaveTextContent('');
    expect(container.querySelector('img, video, button, a, input, [tabindex]')).toBeNull();
  });
});
