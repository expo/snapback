import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  validateObservedPriorVector,
} from '../packages/snapback-publication-authority/request.mjs';
import {
  npmResultIsPackageNotFound,
  PROMOTION_PACKAGE_NAMES,
} from './snapback-publish-core.mjs';
import {
  observePriorVector,
  writeObservedPriorVector,
} from './snapback-observe-prior-vector.mjs';

function npmTags(values) {
  return (args) => {
    assert.deepEqual(args.slice(0, 1), ['view']);
    assert.deepEqual(args.slice(2), ['dist-tags', '--json']);
    return JSON.stringify(values.get(args[1]) ?? {});
  };
}

test('observer derives the full promotion inventory rather than hardcoding names', () => {
  const source = readFileSync(
    new URL('./snapback-observe-prior-vector.mjs', import.meta.url),
    'utf8',
  );
  for (const name of PROMOTION_PACKAGE_NAMES) {
    assert.equal(
      source.includes(name),
      false,
      `observer source must import the inventory instead of spelling ${name}`,
    );
  }
  const values = new Map(PROMOTION_PACKAGE_NAMES.map((name) => [
    name,
    { latest: '1.2.3' },
  ]));
  const vector = observePriorVector({ runNpm: npmTags(values) });
  assert.deepEqual(Object.keys(vector), [...PROMOTION_PACKAGE_NAMES]);
  assert.equal(
    validateObservedPriorVector(vector, { packageNames: PROMOTION_PACKAGE_NAMES }),
    vector,
  );
});

test('observer writes one complete valid vector when every latest tag exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-prior-vector-full-test-'));
  try {
    const out = join(root, 'prior-vector.json');
    const values = new Map(PROMOTION_PACKAGE_NAMES.map((name, index) => [
      name,
      { latest: `1.0.${index}` },
    ]));
    const vector = writeObservedPriorVector({
      out,
      packageNames: PROMOTION_PACKAGE_NAMES,
      runNpm: npmTags(values),
    });
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), vector);
    validateObservedPriorVector(vector, { packageNames: PROMOTION_PACKAGE_NAMES });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('observer records never-published packages as null', () => {
  const values = new Map(PROMOTION_PACKAGE_NAMES.map((name, index) => [
    name,
    index % 3 === 0 ? {} : { latest: '2.3.4' },
  ]));
  const vector = observePriorVector({
    packageNames: PROMOTION_PACKAGE_NAMES,
    runNpm: npmTags(values),
  });
  for (const [index, name] of PROMOTION_PACKAGE_NAMES.entries()) {
    assert.equal(vector[name], index % 3 === 0 ? null : '2.3.4');
  }
  validateObservedPriorVector(vector, { packageNames: PROMOTION_PACKAGE_NAMES });
});

test('observer normalizes the umbrella registry E404 to an absent prior', () => {
  assert.equal(npmResultIsPackageNotFound({
    status: 1,
    stdout: '',
    stderr: 'npm error code E404\nnpm error 404 Not Found',
  }), true);
  assert.equal(npmResultIsPackageNotFound({
    status: 1,
    stdout: '',
    stderr: 'npm error code E401',
  }), false);
  const vector = observePriorVector({
    packageNames: PROMOTION_PACKAGE_NAMES,
    runNpm(args) {
      return args[1] === '@expo/snapback'
        ? null
        : JSON.stringify({ latest: '0.1.20' });
    },
  });
  assert.equal(vector['@expo/snapback'], null);
  assert.equal(vector['create-snapback-app'], '0.1.20');
  validateObservedPriorVector(vector, { packageNames: PROMOTION_PACKAGE_NAMES });
});

test('an npm failure names the package and leaves no output', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-prior-vector-npm-test-'));
  try {
    const out = join(root, 'prior-vector.json');
    const failedName = PROMOTION_PACKAGE_NAMES[4];
    assert.throws(
      () => writeObservedPriorVector({
        out,
        packageNames: PROMOTION_PACKAGE_NAMES,
        runNpm(args) {
          if (args[1] === failedName) throw new Error('npm view exited 1');
          return JSON.stringify({ latest: '1.2.3' });
        },
      }),
      new RegExp(`could not observe registry dist-tags for ${failedName.replace('/', '\\/')}`),
    );
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed registry JSON names the package and leaves no output', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-prior-vector-json-test-'));
  try {
    const out = join(root, 'prior-vector.json');
    const failedName = PROMOTION_PACKAGE_NAMES[2];
    assert.throws(
      () => writeObservedPriorVector({
        out,
        packageNames: PROMOTION_PACKAGE_NAMES,
        runNpm(args) {
          return args[1] === failedName ? '{bad json' : '{"latest":"1.2.3"}';
        },
      }),
      /were not valid JSON/u,
    );
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('non-semver latest value is refused before any output is written', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-prior-vector-version-test-'));
  try {
    const out = join(root, 'prior-vector.json');
    const invalidName = PROMOTION_PACKAGE_NAMES.at(-1);
    assert.throws(
      () => writeObservedPriorVector({
        out,
        packageNames: PROMOTION_PACKAGE_NAMES,
        runNpm(args) {
          return JSON.stringify({
            latest: args[1] === invalidName ? 'not-a-version' : '1.2.3',
          });
        },
      }),
      /is not an exact version or null/u,
    );
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
