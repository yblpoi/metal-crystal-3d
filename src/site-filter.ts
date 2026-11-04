import type { InterstitialSite } from './crystal/types';
import type { SiteFilter } from './state';

/** Pure visibility filter shared by the renderer, the counts and the list. */
export function filterSites(
  sites: InterstitialSite[],
  showO: boolean,
  showT: boolean,
  filter: SiteFilter,
  selectedSiteId: string | null,
): InterstitialSite[] {
  return sites.filter((site) => {
    if (site.type === 'O' && !showO) return false;
    if (site.type === 'T' && !showT) return false;
    if (filter === 'complete' && !site.complete) return false;
    if (filter === 'selected' && site.id !== selectedSiteId) return false;
    return true;
  });
}
