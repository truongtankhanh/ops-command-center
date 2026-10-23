import { useEffect } from 'react';
import { useIncidents } from '../api/queries';
import { faviconMark, mapColors } from '../styles/tokens';
import { countActiveBySeverity } from './incidents';

/** The mark with a critical-red dot in its top-right corner, ringed in the ground colour. */
const BADGED_ICON = `data:image/svg+xml,${encodeURIComponent(
  faviconMark.replace(
    '</svg>',
    `<circle cx="25" cy="7" r="6" fill="${mapColors.severity.critical}" stroke="${mapColors.ground}" stroke-width="2"/></svg>`,
  ),
)}`;

/**
 * Shows the active critical incidents on the browser tab, so they are seen from another tab or
 * window: the title becomes `(N) Ops Command Center` and the favicon gets a red dot. The count is
 * the critical KPI tile's, taken from the incident list, so it follows the first load, every live
 * event and every refetch alike.
 *
 * The title and icon from `index.html` are put back when the count drops to zero and when the
 * console unmounts (sign-out).
 */
export function useAttentionBadge(): void {
  const { data: incidents = [] } = useIncidents();
  const critical = countActiveBySeverity(incidents).critical;

  useEffect(() => {
    if (critical === 0) return;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const title = document.title;
    const href = icon?.getAttribute('href');
    document.title = `(${critical}) ${title}`;
    icon?.setAttribute('href', BADGED_ICON);
    // Cleanup runs before the next count is applied, so each run starts from the original values.
    return () => {
      document.title = title;
      if (icon && href != null) icon.setAttribute('href', href);
    };
  }, [critical]);
}
