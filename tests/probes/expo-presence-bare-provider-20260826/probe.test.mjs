// Runs the LLP 0310 P20 / LLP 0310.000 D2 probe as a regression test: the Expo
// activity-presence facade must keep working under a bare URL-first
// SnapbackProvider on web. If this ever starts failing with
// SNAPBACK_EXPO_ACTIVITY_LIFECYCLE_UNAVAILABLE, the 0.1.27 Clique familiar
// lane's reading became true and LLP 0257's bare-provider fallback broke.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const probeRoot = dirname(fileURLToPath(import.meta.url));

execFileSync(process.execPath, [
  '--conditions=browser',
  '--import', join(probeRoot, 'register.mjs'),
  join(probeRoot, 'run.mjs'),
], { cwd: probeRoot, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

const observation = JSON.parse(readFileSync(join(probeRoot, 'observation.json'), 'utf8'));
assert.equal(observation.schemaVersion, 'snapback.probe.expo-presence-bare-provider.v1');
assert.equal(
  observation.outcome,
  'works',
  `bare-provider facade presence regressed: ${JSON.stringify(observation)}`,
);
assert.equal(observation.diagnosticCode, null);
assert.equal(observation.gatedAdmissionOpened, true, 'the gated admission must open without a lifecycle context');
assert.equal(observation.touch.publishAttempts, 1);
console.log('expo-presence-bare-provider probe: facade works under a bare URL-first SnapbackProvider on web');
