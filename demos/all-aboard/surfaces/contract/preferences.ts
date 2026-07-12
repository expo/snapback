// All Aboard application preferences.
//
// These are ordinary app state, not host/device bindings. Separate scalar
// signals keep ETA and maps changes independent while allowing each router
// remount to observe the current session value. localStorage is only a
// best-effort durable mirror; private browsing and native documentless realms
// may deny it without making the current session stale.
// @ref LLP 0052#d1--reactive-host-state-host-bindings — keep app preferences out of appGlue while retaining narrow invalidation.

import { signal } from '@exact/contract/runtime';

export type EtaMode = 'auto' | 'walk' | 'bike';
export type MapsApp = 'default' | 'apple' | 'google';

const ETA_MODE_STORAGE_KEY = 'all-aboard.etaMode';
const MAPS_APP_STORAGE_KEY = 'all-aboard.mapsApp';
const MAPS_APPS: readonly MapsApp[] = Object.freeze(['default', 'apple', 'google']);

const etaModePreference = signal<EtaMode>('auto', { label: 'AllAboard.preference.etaMode' });
const mapsAppPreference = signal<MapsApp>('default', { label: 'AllAboard.preference.mapsApp' });
let etaModePreferenceInitialized = false;
let mapsAppPreferenceInitialized = false;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    etaModePreference.dispose();
    mapsAppPreference.dispose();
  });
}

export function normalizeEtaMode(value?: string | null): EtaMode {
  return value === 'walk' || value === 'bike' ? value : 'auto';
}

export function nextEtaMode(current: string): EtaMode {
  const normalized = normalizeEtaMode(current);
  return normalized === 'auto' ? 'bike' : normalized === 'bike' ? 'walk' : 'auto';
}

export function loadEtaModePreference(fallback?: string | null): EtaMode {
  if (!etaModePreferenceInitialized) {
    etaModePreferenceInitialized = true;
    let value = normalizeEtaMode(fallback);
    try {
      const stored = globalThis.localStorage?.getItem(ETA_MODE_STORAGE_KEY);
      if (stored === 'auto' || stored === 'walk' || stored === 'bike') value = stored;
    } catch {
      // Keep the normalized route/default value.
    }
    etaModePreference.set(value);
  }
  return etaModePreference.get();
}

export function persistEtaModePreference(next: string | null): EtaMode {
  const value = normalizeEtaMode(next);
  etaModePreferenceInitialized = true;
  etaModePreference.set(value);
  try {
    globalThis.localStorage?.setItem(ETA_MODE_STORAGE_KEY, value);
  } catch {
    // The reactive app-lifetime store remains authoritative for this session.
  }
  return value;
}

export function normalizeMapsApp(value?: string | null): MapsApp {
  return MAPS_APPS.includes(value as MapsApp) ? (value as MapsApp) : 'default';
}

export function nextMapsApp(current: string): MapsApp {
  const normalized = normalizeMapsApp(current);
  return MAPS_APPS[(MAPS_APPS.indexOf(normalized) + 1) % MAPS_APPS.length];
}

export function loadMapsAppPreference(): MapsApp {
  if (!mapsAppPreferenceInitialized) {
    mapsAppPreferenceInitialized = true;
    let value: MapsApp = 'default';
    try {
      const stored = globalThis.localStorage?.getItem(MAPS_APP_STORAGE_KEY);
      if (stored === 'default' || stored === 'apple' || stored === 'google') value = stored;
    } catch {
      // Keep the platform-default value.
    }
    mapsAppPreference.set(value);
  }
  return mapsAppPreference.get();
}

export function persistMapsAppPreference(next: string | null): MapsApp {
  const value = normalizeMapsApp(next);
  mapsAppPreferenceInitialized = true;
  mapsAppPreference.set(value);
  try {
    globalThis.localStorage?.setItem(MAPS_APP_STORAGE_KEY, value);
  } catch {
    // The reactive app-lifetime store remains authoritative for this session.
  }
  return value;
}

export function mapsAppLabel(app: string): string {
  if (app === 'apple') return 'Apple Maps';
  if (app === 'google') return 'Google Maps';
  return 'Platform default';
}
