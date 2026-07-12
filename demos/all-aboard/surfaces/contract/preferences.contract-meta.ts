// Contract boundary descriptors for All Aboard's reactive application stores.

import { capability, defineContractModule, pure, store } from '@exact/contract/exports';

export default defineContractModule('./preferences.ts', {
  normalizeEtaMode: pure({ params: ['value'], result: 'string', depends: 'args' }),
  nextEtaMode: pure({ params: ['current'], result: 'string', depends: 'args' }),
  normalizeMapsApp: pure({ params: ['value'], result: 'string', depends: 'args' }),
  nextMapsApp: pure({ params: ['current'], result: 'string', depends: 'args' }),
  mapsAppLabel: pure({ params: ['app'], result: 'string', depends: 'args' }),
  loadMapsAppPreference: store({
    params: {},
    reads: ['app.preference.mapsApp'],
    effects: ['app.preference.read'],
    snapshotReadable: true,
  }),
  persistMapsAppPreference: capability({
    params: { next: 'string' },
    effects: ['app.preference.write'],
  }),
  loadEtaModePreference: store({
    params: { fallback: 'string' },
    reads: ['app.preference.etaMode'],
    effects: ['app.preference.read'],
    snapshotReadable: true,
  }),
  persistEtaModePreference: capability({
    params: { next: 'string' },
    effects: ['app.preference.write'],
  }),
});
