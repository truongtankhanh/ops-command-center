import styles from './TwinStage.module.css';
import { TwinCanvas } from './TwinCanvas';

/**
 * The 3D twin, as the lazy chunk's entry (ADR-0020): `StageView` loads it with `React.lazy` when the
 * 3D view is in effect, so the 2D view, the fallback and the sign-in screens never download three.js.
 * The `Campus 3D view` landmark, the loading placeholder and the load-failure fallback belong to
 * `StageView` (main chunk): this chunk's CSS is not loaded yet while they show.
 *
 * A default export, the console's exception to named exports: `React.lazy` needs one.
 */
export default function TwinStage() {
  return (
    <div className={styles.fill}>
      <TwinCanvas />
    </div>
  );
}
