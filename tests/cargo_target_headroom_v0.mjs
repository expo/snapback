import { strict as assert } from 'node:assert';

import {
  cargoTargetHeadroom,
  MIN_CARGO_TARGET_HEADROOM_KIB,
  measureAvailableKiB,
  resolveCargoTargetDirectory,
} from '../scripts/cargo-target-headroom.mjs';

const calls = [];
const spawnSyncImpl = (command, args, options) => {
  calls.push({ command, args, cwd: options?.cwd });
  if (command === 'cargo') {
    return {
      status: 0,
      stdout: JSON.stringify({ target_directory: '/external/cargo-target' }),
      stderr: '',
    };
  }
  if (command === 'df') {
    return {
      status: 0,
      stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\nexternal 20 10 7340032 50% /external\n',
      stderr: '',
    };
  }
  throw new Error(`unexpected command ${command}`);
};

assert.equal(
  resolveCargoTargetDirectory({ root: '/repo', spawnSyncImpl }),
  '/external/cargo-target',
);
assert.equal(measureAvailableKiB('/external/cargo-target', { spawnSyncImpl }), 7_340_032);
assert.deepEqual(cargoTargetHeadroom({ root: '/repo', spawnSyncImpl }), {
  targetDirectory: '/external/cargo-target',
  availableKiB: 7_340_032,
  cleanup: 'clean',
});
assert(
  calls.some(({ command, args }) => command === 'df' && args.at(-1) === '/external/cargo-target'),
  'headroom must be measured on Cargo metadata target_directory, not the repo root',
);

const independentCapacities = (targetAvailable, repoAvailable) => (command, args) => {
  if (command === 'cargo') {
    return {
      status: 0,
      stdout: JSON.stringify({ target_directory: '/separate-target-volume/target' }),
      stderr: '',
    };
  }
  if (command === 'df') {
    const path = args.at(-1);
    const available = path.startsWith('/separate-target-volume') ? targetAvailable : repoAvailable;
    return {
      status: 0,
      stdout: `Filesystem 1024-blocks Used Available Capacity Mounted on\nmock 20 10 ${available} 50% /mock\n`,
      stderr: '',
    };
  }
  throw new Error(`unexpected command ${command}`);
};

assert.equal(
  cargoTargetHeadroom({
    root: '/high-capacity-repo',
    spawnSyncImpl: independentCapacities(MIN_CARGO_TARGET_HEADROOM_KIB - 1, MIN_CARGO_TARGET_HEADROOM_KIB * 4),
  }).cleanup,
  'clean',
  'a low-capacity Cargo target is cleaned even when the repo filesystem has ample room',
);
assert.equal(
  cargoTargetHeadroom({
    root: '/low-capacity-repo',
    spawnSyncImpl: independentCapacities(MIN_CARGO_TARGET_HEADROOM_KIB, 1),
  }).cleanup,
  'preserve',
  'a healthy Cargo target is preserved even when the repo filesystem is low',
);

assert.throws(
  () => resolveCargoTargetDirectory({
    spawnSyncImpl: () => ({ status: 0, stdout: '{}', stderr: '' }),
  }),
  /target_directory/,
);
assert.throws(
  () => measureAvailableKiB('/target', {
    spawnSyncImpl: () => ({ status: 0, stdout: 'header only\n', stderr: '' }),
  }),
  /no filesystem row/,
);

console.log('cargo target headroom tests: PASS');
