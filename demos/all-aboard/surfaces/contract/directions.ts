// All Aboard — directions/maps web glue (ENG-23795).
//
// Opening a maps app, copying to the clipboard, and persisting the maps-app
// preference are platform capabilities, not contract state — the same seam as
// geolocation (main.ts / data.ts setDeviceLocation). The .contract declares
// the affordances; this module gives them their web behavior:
//
//   - TAP on the header directions line ([station-directions-<id>]) opens the
//     preferred maps app directly. The contract press under that click would
//     open the directions sheet, so the tap is intercepted;
//   - LONG-PRESS (500ms, within slop) lets the contract press through — the
//     glue synthesizes the click itself — so the bottom sheet opens with
//     Apple Maps / Google Maps / Copy address. On hosts without this glue
//     every press opens the sheet: honest degradation, one extra tap;
//   - the sheet's rows keep their contract press (which closes the sheet) and
//     get their side effect from a NON-blocking capture listener here;
//   - the Settings maps-app row cycles the preference (data.ts module state,
//     persisted to localStorage); the contract press re-stamps the clock so
//     mapsAppLabel re-derives.
//
// The station id rides in the affordance's testId and the resolved travel
// mode in its accessible label ("Get walking/biking directions") — the
// .contract owns what to open; this module only owns how.

import { cycleMapsApp, directionsUrl, getMapsApp, setMapsApp, stationAddress } from './data';

type Cleanup = () => void;

const MAPS_APP_STORAGE_KEY = 'all-aboard.mapsApp';
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const probe = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/.test(probe);
}

function resolveMapsApp(): 'apple' | 'google' {
  const preferred = getMapsApp();
  if (preferred === 'apple' || preferred === 'google') return preferred;
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
  // Boot: adopt the persisted preference before the first render reads it.
  try {
    setMapsApp(window.localStorage.getItem(MAPS_APP_STORAGE_KEY));
  } catch {
    /* storage may be unavailable (private mode); the default stands */
  }

  // Long-press state on the directions affordance. The synthetic click the
  // timer dispatches must reach the contract (opens the sheet); the browser's
  // own trailing click after the release must not then also open maps.
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressOrigin: { x: number; y: number } | null = null;
  let synthetic = false;
  let longPressConsumed = false;

  const cancelPressTimer = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressOrigin = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    const affordance = (event.target as Element).closest('[data-testid^="station-directions-"]');
    if (!affordance) return;
    longPressConsumed = false;
    pressOrigin = { x: event.clientX, y: event.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      longPressConsumed = true;
      synthetic = true;
      try {
        (affordance as HTMLElement).click();
      } finally {
        synthetic = false;
      }
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pressOrigin || !pressTimer) return;
    if (
      Math.abs(event.clientX - pressOrigin.x) > LONG_PRESS_SLOP_PX ||
      Math.abs(event.clientY - pressOrigin.y) > LONG_PRESS_SLOP_PX
    ) {
      cancelPressTimer();
    }
  };

  const onPointerEnd = () => cancelPressTimer();

  // Tap on the directions line: open the preferred maps app instead of the
  // contract's sheet press (which stays the long-press / native path).
  const onDirectionsClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const affordance = target.closest('[data-testid^="station-directions-"]');
    if (!affordance) return;
    if (synthetic) return; // the long-press timer's own click → contract sheet
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (longPressConsumed) {
      // The browser's trailing click after a long-press release: the sheet is
      // already open; do not also open maps.
      longPressConsumed = false;
      return;
    }
    openMaps(directionsUrl(stationIdFrom(affordance), resolveMapsApp(), travelModeFrom(affordance)));
  };

  // Sheet rows and the Settings maps-app cycle: NON-blocking side effects —
  // the contract press still runs (closes the sheet / re-stamps the clock).
  const onAugmentingClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const mapsAppRow = target.closest('[data-testid="maps-app"]');
    if (mapsAppRow) {
      const next = cycleMapsApp();
      try {
        window.localStorage.setItem(MAPS_APP_STORAGE_KEY, next);
      } catch {
        /* preference just won't persist */
      }
      return;
    }
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

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  root.addEventListener('click', onDirectionsClick, true);
  root.addEventListener('click', onAugmentingClick, true);

  return () => {
    cancelPressTimer();
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerEnd);
    root.removeEventListener('pointercancel', onPointerEnd);
    root.removeEventListener('click', onDirectionsClick, true);
    root.removeEventListener('click', onAugmentingClick, true);
  };
}
