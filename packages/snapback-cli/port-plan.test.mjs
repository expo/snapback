import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DEV_PORT_RANGE,
  materializeDevPortPlan,
  resolveDevPortPlan,
} from './port-plan.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));

const defaults = resolveDevPortPlan({ profile: 'expo', platform: 'web' });
assert.deepEqual(defaults.range, { lo: 4287, hi: 4387, source: 'default' });
assert.deepEqual(
  defaults.owners.map(({ owner, port, source, declaredBy }) => ({ owner, port, source, declaredBy })),
  [
    { owner: 'backend', port: null, source: 'range', declaredBy: null },
    { owner: 'client', port: null, source: 'range', declaredBy: null },
    { owner: 'bootstrap', port: null, source: 'range', declaredBy: null },
    { owner: 'metro', port: null, source: 'range', declaredBy: null },
  ],
);
assert.deepEqual(
  materializeDevPortPlan(defaults, {
    backend: 4287,
    client: 4387,
    bootstrap: 4386,
    metro: 4385,
  }).owners.map(({ owner, port }) => ({ owner, port })),
  [
    { owner: 'backend', port: 4287 },
    { owner: 'client', port: 4387 },
    { owner: 'bootstrap', port: 4386 },
    { owner: 'metro', port: 4385 },
  ],
  'the recorded owner order exposes the backend ascent and supervisor descent deterministically',
);

const pins = resolveDevPortPlan({
  profile: 'expo',
  platform: 'web',
  flags: {
    port: '48000',
    clientPort: '48101',
    bootstrapPort: 48100,
    portRange: '48100-48103',
  },
});
assert.deepEqual(pins.range, { lo: 48100, hi: 48103, source: 'flag' });
assert.deepEqual(
  pins.owners.slice(0, 3).map(({ owner, port, source, declaredBy }) => ({
    owner, port, source, declaredBy,
  })),
  [
    { owner: 'backend', port: 48000, source: 'pinned', declaredBy: 'flag' },
    { owner: 'client', port: 48101, source: 'pinned', declaredBy: 'flag' },
    { owner: 'bootstrap', port: 48100, source: 'pinned', declaredBy: 'flag' },
  ],
  'pins may be outside or inside the selected range',
);

const envPrecedence = resolveDevPortPlan({
  profile: 'expo',
  platform: 'ios',
  flags: { port: '49000', clientPort: '49001', portRange: '49010-49020' },
  env: {
    SNAPBACK_DEV_PORT: '49100',
    SNAPBACK_DEV_CLIENT_PORT: '49101',
    SNAPBACK_DEV_BOOTSTRAP_PORT: '49102',
    SNAPBACK_DEV_PORT_RANGE: '49110-49120',
  },
});
assert.deepEqual(envPrecedence.range, { lo: 49010, hi: 49020, source: 'flag' });
assert.deepEqual(
  envPrecedence.owners.map(({ owner, port, declaredBy }) => ({ owner, port, declaredBy })),
  [
    { owner: 'backend', port: 49000, declaredBy: 'flag' },
    { owner: 'client', port: 49001, declaredBy: 'flag' },
    { owner: 'bootstrap', port: 49102, declaredBy: 'env' },
  ],
);

const envRange = resolveDevPortPlan({
  profile: 'plain',
  env: {
    SNAPBACK_DEV_PORT_RANGE: '49200-49210',
  },
});
assert.deepEqual(envRange.range, { lo: 49200, hi: 49210, source: 'env' });
assert.deepEqual(envRange.owners, [
  { owner: 'backend', port: null, source: 'range', declaredBy: null },
]);

assert.deepEqual(
  materializeDevPortPlan(
    envRange,
    { backend: 49207 },
    { backend: { source: 'attached', declaredBy: null } },
  ).owners,
  [{ owner: 'backend', port: 49207, source: 'attached', declaredBy: null }],
  'receipt-verified adoption records attached provenance instead of range provenance',
);

const rustSource = readFileSync(
  join(packageDir, '..', '..', 'crates', 'snapback-cli', 'src', 'cli.rs'),
  'utf8',
);
const rustLo = Number(rustSource.match(/DEFAULT_PORT_RANGE_START:\s*u16\s*=\s*(\d+)/u)?.[1]);
const rustHi = Number(rustSource.match(/DEFAULT_PORT_RANGE_END:\s*u16\s*=\s*(\d+)/u)?.[1]);
assert.deepEqual(
  DEFAULT_DEV_PORT_RANGE,
  { lo: rustLo, hi: rustHi },
  'Node and Rust must use the same default dev range literals',
);

for (const [label, input, pattern] of [
  ['malformed pin', { profile: 'plain', flags: { port: '1e3' } }, /integer from 1 through 65535/u],
  ['zero pin', { profile: 'plain', flags: { port: '0' } }, /integer from 1 through 65535/u],
  ['large pin', { profile: 'plain', flags: { port: '65536' } }, /integer from 1 through 65535/u],
  ['malformed range', { profile: 'plain', flags: { portRange: '48000:48010' } }, /form <lo>-<hi>/u],
  ['zero range', { profile: 'plain', flags: { portRange: '0-2' } }, /integer from 1 through 65535/u],
  ['large range', { profile: 'plain', flags: { portRange: '65535-65536' } }, /integer from 1 through 65535/u],
  ['reversed range', { profile: 'plain', flags: { portRange: '3-2' } }, /must not exceed/u],
  ['duplicate pins', {
    profile: 'expo', platform: 'ios', flags: { port: '48000', clientPort: '48000' },
  }, /backend and client cannot pin the same port/u],
  ['absent flag owner', { profile: 'plain', flags: { clientPort: '48000' } }, /has owners: backend/u],
  ['absent env owner', {
    profile: 'plain', env: { SNAPBACK_DEV_BOOTSTRAP_PORT: '48000' },
  }, /has owners: backend/u],
  ['narrow native range', {
    profile: 'expo', platform: 'ios', flags: { portRange: '48000-48001' },
  }, /has 3 unpinned owners/u],
  ['pin consumes range slot', {
    profile: 'expo',
    platform: 'web',
    flags: { port: '48000', portRange: '48000-48002' },
  }, /has 3 unpinned owners/u],
]) {
  assert.throws(
    () => resolveDevPortPlan(input),
    (error) => error?.code === 'SNAPBACK_CLI_ARGUMENT_INVALID' && pattern.test(error.message),
    label,
  );
}

console.log('port-plan.test.mjs: 6 resolution/materialization cases and 12 refusal cases passed');
