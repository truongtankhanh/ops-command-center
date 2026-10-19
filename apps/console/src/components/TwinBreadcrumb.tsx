import { useAssets, useZones } from '../api/queries';
import { crumbsOf, levelOf, type LevelTarget } from '../lib/twinLevel';
import { TWIN_VIEW_ID } from '../lib/twinSummary';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { ArrowLeft, ChevronRight } from '../ui/icons';
import styles from './TwinBreadcrumb.module.css';

/**
 * Where a crumb leads, through the store: the camera follows the level by itself (`twin/useLevelCamera`).
 * The asset is only ever the current crumb, but a part's callout is closed by going to it, so it is handled.
 */
function goTo(target: LevelTarget): void {
  const store = useConsole.getState();
  switch (target.level) {
    case 'campus':
      store.goCampus();
      return;
    case 'building':
      store.focusBuilding(target.zoneId);
      return;
    case 'asset':
      store.selectPart(null);
      return;
  }
}

/**
 * After a press the control that was pressed may be gone (the whole breadcrumb leaves at campus level), which
 * would drop keyboard focus to the page. The 3D view's group is where the stage's keys work (V2-18.3).
 */
const focusView = (): void => document.getElementById(TWIN_VIEW_ID)?.focus();

/**
 * The scene level as a breadcrumb (V2-15.6, frames 03, 12, 15 `.crumbs`): `Campus › Data Center › CT-01`, with a
 * back button that goes up one level and a button for each ancestor, and the current item in `<strong>` with
 * `aria-current="location"`. In the 3D view `StageView` shows it **instead of the 3D / 2D switch** at building and
 * asset level, as the frames do; it renders nothing at campus level.
 *
 * - The crumbs are `crumbsOf` (`lib/twinLevel.ts`): a building or an asset the console does not hold yet is left
 *   out and never shown as an id, and an asset outside any building has no middle crumb (`Campus › TR-01`).
 * - These are actions, not addresses, so they are buttons and not links (the frames draw `<a href="#">`).
 * - The back button is one step of Escape's ladder (`goUp`), so at the level of a part it closes the callout and
 *   its label names the asset; otherwise it names the previous crumb, which for an asset outside a building is
 *   `Campus`.
 * - Moving up changes the level and so the camera: the breadcrumb itself never touches the camera.
 *
 * The same for every role: moving through the scene is not an action on the site. Lives in `components/`
 * (the main chunk) because the tools it sits among are `StageView`'s and `src/twin/` can only be crossed by
 * its dynamic import (V2-12.11 made the same call for the loading card).
 */
export function TwinBreadcrumb() {
  const focusZoneId = useConsole((s) => s.focusZoneId);
  const selectedAssetCode = useConsole((s) => s.selectedAssetCode);
  const selectedPart = useConsole((s) => s.selectedPart);
  const { data: zones } = useZones();
  const { data: assets } = useAssets();

  const level = levelOf({ focusZoneId, selectedAssetCode, selectedPart });
  if (level === 'campus') return null;

  const crumbs = crumbsOf(
    level,
    zones?.find((zone) => zone.id === focusZoneId),
    assets?.find((asset) => asset.code === selectedAssetCode),
  );
  const current = crumbs[crumbs.length - 1];
  const previous = crumbs[crumbs.length - 2] ?? crumbs[0];
  const parent = level === 'part' ? current : previous;

  return (
    <nav aria-label="Scene level" className={styles.crumbs}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        aria-label={`Up one level${parent ? ` — ${parent.label}` : ''}`}
        className={styles.back}
        onClick={() => {
          useConsole.getState().goUp();
          focusView();
        }}
      />
      <ol className={styles.list}>
        {crumbs.map((crumb, index) => (
          <li key={`${index}:${crumb.label}`} className={styles.item}>
            {index > 0 && <Icon glyph={ChevronRight} size={16} className={styles.chevron} />}
            {crumb === current ? (
              <strong aria-current="location" className={styles.current}>
                {crumb.label}
              </strong>
            ) : (
              <Button
                variant="ghost"
                className={styles.link}
                onClick={() => {
                  goTo(crumb.target);
                  focusView();
                }}
              >
                {crumb.label}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
