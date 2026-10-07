import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useState } from 'react';
import { Sheet, SheetHost } from './Sheet';

/** Opens, switches and closes a sheet the way `App` does: one sheet per content key. */
function Harness({
  withHost = true,
  hideOpener = false,
}: {
  withHost?: boolean;
  hideOpener?: boolean;
}) {
  const [content, setContent] = useState<'A' | 'B' | null>(null);
  const page = (
    <>
      {!hideOpener && <button onClick={() => setContent('A')}>Open A</button>}
      <button onClick={() => setContent('B')}>Open B</button>
      <button onClick={() => setContent(null)}>Close from outside</button>
      {content && (
        <Sheet key={content} label={`Sheet ${content}`} onClose={() => setContent(null)}>
          <button onClick={() => setContent(content === 'A' ? 'B' : 'A')}>Switch</button>
          <button onClick={() => setContent(null)}>Close</button>
        </Sheet>
      )}
    </>
  );
  return withHost ? <SheetHost>{page}</SheetHost> : page;
}

const sheet = (name: string) => screen.getByRole('complementary', { name });
const button = (name: string) => screen.getByRole('button', { name });
/** Lets the microtask that returns focus after a close run, before asserting it did not. */
const flush = () => act(async () => {});

describe('Sheet', () => {
  describe('focus', () => {
    it('moves focus to the sheet when it opens', async () => {
      render(<Harness />);

      await userEvent.click(button('Open A'));

      expect(sheet('Sheet A')).toHaveFocus();
      expect(sheet('Sheet A')).toHaveAttribute('tabindex', '-1');
    });

    it('returns focus to the opener on close', async () => {
      render(<Harness />);
      await userEvent.click(button('Open A'));

      await userEvent.click(button('Close'));

      await waitFor(() => expect(button('Open A')).toHaveFocus());
    });

    it('returns focus to the opener after Escape', async () => {
      render(<Harness />);
      await userEvent.click(button('Open A'));

      await userEvent.keyboard('{Escape}');

      expect(screen.queryByRole('complementary')).toBeNull();
      await waitFor(() => expect(button('Open A')).toHaveFocus());
    });

    it('keeps focus outside when the content is switched from outside', async () => {
      render(<Harness />);
      await userEvent.click(button('Open A'));

      await userEvent.click(button('Open B'));

      expect(sheet('Sheet B')).toBeInTheDocument();
      expect(button('Open B')).toHaveFocus();
    });

    it('moves focus to the new content when the old content took it along', async () => {
      render(<Harness />);
      await userEvent.click(button('Open A'));

      // The focused Switch button leaves with sheet A.
      await userEvent.click(button('Switch'));

      expect(sheet('Sheet B')).toHaveFocus();
    });

    it('returns focus to the first opener after a switch', async () => {
      render(<Harness />);
      await userEvent.click(button('Open A'));
      await userEvent.click(button('Switch'));

      await userEvent.click(button('Close'));

      await waitFor(() => expect(button('Open A')).toHaveFocus());
    });

    it('leaves focus where the operator moved it', async () => {
      render(<Harness />);
      await userEvent.click(button('Open A'));

      await userEvent.click(button('Close from outside'));
      await flush();

      expect(button('Close from outside')).toHaveFocus();
    });

    it('does not return focus to an opener that left the page', async () => {
      const { rerender } = render(<Harness />);
      await userEvent.click(button('Open A'));
      rerender(<Harness hideOpener />);

      await userEvent.click(button('Close'));
      await flush();

      expect(document.activeElement).toBe(document.body);
    });

    it('returns focus to the opener without a host too', async () => {
      render(<Harness withHost={false} />);
      await userEvent.click(button('Open A'));

      await userEvent.click(button('Close'));

      await waitFor(() => expect(button('Open A')).toHaveFocus());
    });
  });

  describe('Escape', () => {
    const KEPT = 'Esc keeps your draft.';

    /** A sheet with one text field; focus starts on the sheet itself (mount focus). */
    function renderDraftSheet(keepOpen: boolean, inputProps: ComponentProps<'input'> = {}) {
      const onClose = vi.fn();
      const onKept = vi.fn();
      const ui = (keep: boolean) => (
        <Sheet
          label="Draft"
          onClose={onClose}
          keepOpen={keep}
          keptMessage={KEPT}
          onEscapeKept={onKept}
        >
          <input aria-label="Text" {...inputProps} />
        </Sheet>
      );
      const view = render(ui(keepOpen));
      const status = within(sheet('Draft')).getByRole('status');
      return { onClose, onKept, status, setKeepOpen: (keep: boolean) => view.rerender(ui(keep)) };
    }

    it('closes on Escape', async () => {
      const { onClose, onKept, status } = renderDraftSheet(false);

      await userEvent.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onKept).not.toHaveBeenCalled();
      expect(status).toBeEmptyDOMElement();
    });

    it('stays open on Escape while a draft is kept, and says so', async () => {
      const { onClose, onKept, status } = renderDraftSheet(true);

      await userEvent.keyboard('{Escape}');

      expect(onClose).not.toHaveBeenCalled();
      expect(onKept).toHaveBeenCalledTimes(1);
      expect(status).toHaveTextContent(KEPT);
    });

    it('announces every ignored Escape again', async () => {
      const { onKept, status } = renderDraftSheet(true);
      await userEvent.keyboard('{Escape}');
      const first = status.firstElementChild;

      await userEvent.keyboard('{Escape}');

      expect(onKept).toHaveBeenCalledTimes(2);
      // A new node in the live region is read out again, even with the same text.
      expect(status.firstElementChild).not.toBe(first);
      expect(status).toHaveTextContent(KEPT);
    });

    it('forgets the announcement once nothing is kept', async () => {
      const { status, setKeepOpen } = renderDraftSheet(true);
      await userEvent.keyboard('{Escape}');
      expect(status).toHaveTextContent(KEPT);

      setKeepOpen(false);
      expect(status).toBeEmptyDOMElement();

      // A new draft does not repeat the old announcement.
      setKeepOpen(true);
      expect(status).toBeEmptyDOMElement();
    });

    it('ignores an Escape that ends an IME composition', () => {
      const { onClose } = renderDraftSheet(false);

      fireEvent.keyDown(screen.getByLabelText('Text'), { key: 'Escape', isComposing: true });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores an Escape the content already handled', async () => {
      const { onClose } = renderDraftSheet(false, {
        onKeyDown: (event) => {
          if (event.key === 'Escape') event.preventDefault();
        },
      });
      await userEvent.click(screen.getByLabelText('Text'));

      await userEvent.keyboard('{Escape}');

      expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores other keys', async () => {
      const { onClose } = renderDraftSheet(false);

      await userEvent.keyboard('{Enter}');

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
