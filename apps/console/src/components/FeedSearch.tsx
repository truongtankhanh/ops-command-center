import type { KeyboardEvent, RefObject } from 'react';
import { TextInput } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Search, X } from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import styles from './FeedSearch.module.css';

/**
 * The feed's search box (frame 01), controlled: the feed owns the query and binds `/` to focus it
 * through `ref` (the input announces the key with `aria-keyshortcuts`). The key hint and the clear
 * button share one slot: the `/` hint while empty, Clear while there is text.
 *
 * Escape with text clears it and is stopped here, so it never also closes the open detail or report
 * (`useCloseOnEscape` listens on `window`). With no text, Escape is left to them, as anywhere else.
 */
export function FeedSearch({
  value,
  onChange,
  ref,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  ref: RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  const clear = () => {
    onChange('');
    ref.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // An Escape that ends an IME composition (e.g. Vietnamese input) is not a request to clear.
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || value === '') return;
    event.preventDefault();
    // Stops the native event at React's root, before it reaches the `window` listeners.
    event.stopPropagation();
    onChange('');
  };

  return (
    <div className={className ? `${styles.search} ${className}` : styles.search}>
      <label>
        <span className={styles.hidden}>Search incidents</span>
        <Icon glyph={Search} size={16} className={styles.icon} />
        <TextInput
          ref={ref}
          type="search"
          className={styles.input}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search code, title or zone"
          aria-keyshortcuts="/"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {value === '' ? (
        <Kbd className={styles.slot}>/</Kbd>
      ) : (
        <button
          type="button"
          className={`${styles.slot} ${styles.clear}`}
          aria-label="Clear search"
          onClick={clear}
        >
          <Icon glyph={X} size={16} />
        </button>
      )}
    </div>
  );
}
