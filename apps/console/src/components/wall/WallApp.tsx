import styles from './WallApp.module.css';

/**
 * The video wall's screen (V2-21.2, frame 18). For now only its place: a labelled, empty `main`, so that wall mode
 * already mounts nothing interactive. V2-21.3 draws the header, the stage and the side column in it.
 */
export function WallApp({ screen }: { screen: number }) {
  return <main className={styles.wall} aria-label={`Video wall ${screen}`} />;
}
