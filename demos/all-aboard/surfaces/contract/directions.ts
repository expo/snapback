// All Aboard — directions/maps web glue (ENG-23795).
//
// Opening a maps app and copying to the clipboard are platform capabilities
// around Contract-owned app state. The .contract owns and persists the maps
// preference and declares the affordances; this module gives the remaining
// side effects their web behavior:
//
//   - TAP on the header directions line ([station-directions-<id>]) opens the
//     preferred maps app directly. The contract press under that click would
//     open the directions sheet, so the tap is intercepted;
//   - LONG-PRESS delivery belongs to Exact's shared recognizer; this module
//     deliberately owns no timers or pointer state;
//   - the sheet's rows keep their contract press (which closes the sheet) and
//     get their side effect from a NON-blocking capture listener here;
//   - Contract owns the maps-app preference as ordinary app state. Its current
//     value rides in the affordance's accessible label, so this side-effect
//     bridge never re-reads storage or invents a second live state channel.
//
// The station id rides in the affordance's testId and the resolved travel
// mode and preferred app ride in its accessible label — the .contract owns
// what to open; this module only owns how.

import { directionsUrl, stationAddress } from './data';

type Cleanup = () => void;

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const probe = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/.test(probe);
}

function resolveMapsApp(el: Element): 'apple' | 'google' {
  const label = el.getAttribute('aria-label') ?? '';
  if (/preferred app Apple Maps/i.test(label)) return 'apple';
  if (/preferred app Google Maps/i.test(label)) return 'google';
  return isApplePlatform() ? 'apple' : 'google';
}

function directionsAffordance(root: HTMLElement): HTMLElement | null {
  return root.querySelector('[data-testid^="station-directions-"]');
}

function stationIdFrom(el: Element): string {
  return (el.getAttribute('data-testid') ?? '').replace(/^station-directions-/, '');
}

function travelModeFrom(el: Element): 'walk' | 'bike' {
  return /biking/i.test(el.getAttribute('aria-label') ?? '') ? 'bike' : 'walk';
}

function openMaps(url: string): void {
  if (!url) return;
  window.open(url, '_blank', 'noopener');
}

export function installDirections(root: HTMLElement): Cleanup {
  // Tap on the directions line: open the preferred maps app instead of the
  // contract's sheet press (which stays the long-press / native path).
  const onDirectionsClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const affordance = target.closest('[data-testid^="station-directions-"]');
    if (!affordance) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openMaps(directionsUrl(stationIdFrom(affordance), resolveMapsApp(affordance), travelModeFrom(affordance)));
  };

  // Sheet rows: NON-blocking side effects — the contract press still runs
  // (and closes the sheet). The Settings preference is wholly Contract-owned.
  const onAugmentingClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const sheetAction = target.closest(
      '[data-testid="directions-apple"], [data-testid="directions-google"], [data-testid="directions-copy"]',
    );
    if (!sheetAction) return;
    const affordance = directionsAffordance(root);
    const stationId = affordance ? stationIdFrom(affordance) : '';
    if (!stationId) return;
    const mode = affordance ? travelModeFrom(affordance) : 'walk';
    const action = sheetAction.getAttribute('data-testid');
    if (action === 'directions-copy') {
      const address = stationAddress(stationId);
      void navigator.clipboard?.writeText(address).catch(() => {
        console.warn('[all-aboard] clipboard write failed');
      });
      return;
    }
    openMaps(directionsUrl(stationId, action === 'directions-apple' ? 'apple' : 'google', mode));
  };

  root.addEventListener('click', onDirectionsClick, true);
  root.addEventListener('click', onAugmentingClick, true);

  return () => {
    root.removeEventListener('click', onDirectionsClick, true);
    root.removeEventListener('click', onAugmentingClick, true);
  };
}
