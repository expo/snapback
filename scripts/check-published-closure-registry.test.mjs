import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CLOSURE_PACKAGE_NAMES,
  checkPublishedClosureRegistry,
  packumentUrl,
} from './check-published-closure-registry.mjs';

const RECORD = {
  schemaVersion: 'snapback-published-closure.v1',
  scope: '@expo/snapback-*',
  registry: 'https://registry.example.test',
  newestPublished: '0.1.29',
  publishedAt: '2026-08-27',
  newestQualified: '0.1.27',
  updateProtocol: 'test fixture',
};

async function tempRoot(t, { record = RECORD, raw } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'snapback-published-closure-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'guide'), { recursive: true });
  if (raw !== undefined) {
    await writeFile(join(root, 'guide', 'published-closure.json'), raw);
  } else {
    await writeFile(
      join(root, 'guide', 'published-closure.json'),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }
  return root;
}

function fetchWithLatest(latestByName) {
  return async (url) => {
    const name = decodeURIComponent(String(url).split('/').pop().replace('%2f', '/'));
    const latest = latestByName[name] ?? latestByName['*'];
    if (latest === undefined) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (latest instanceof Error) throw latest;
    return {
      ok: true,
      status: 200,
      json: async () => ({ 'dist-tags': { latest } }),
    };
  };
}

test('packument URLs encode the scoped slash and leave the unscoped name intact', () => {
  assert.equal(
    packumentUrl('https://registry.npmjs.org', '@expo/snapback-cli'),
    'https://registry.npmjs.org/@expo%2fsnapback-cli',
  );
  assert.equal(
    packumentUrl('https://registry.npmjs.org/', 'create-snapback-app'),
    'https://registry.npmjs.org/create-snapback-app',
  );
});

test('passes when every identity-preset latest equals newestPublished', async (t) => {
  const root = await tempRoot(t);
  const result = await checkPublishedClosureRegistry({
    root,
    packageNames: ['@expo/snapback-cli', 'create-snapback-app'],
    fetchImpl: fetchWithLatest({ '*': '0.1.29' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.recorded, '0.1.29');
  assert.equal(result.registryLatest, '0.1.29');
  assert.equal(result.packages.length, 2);
});

test('fails when the git record is behind registry latest', async (t) => {
  const root = await tempRoot(t);
  await assert.rejects(
    () => checkPublishedClosureRegistry({
      root,
      packageNames: ['@expo/snapback-cli'],
      fetchImpl: fetchWithLatest({ '*': '0.1.30' }),
    }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_PUBLISHED_CLOSURE_BEHIND_REGISTRY');
      assert.match(error.message, /0\.1\.29 is behind registry latest 0\.1\.30/);
      return true;
    },
  );
});

test('fails when the git record is ahead of registry latest', async (t) => {
  const root = await tempRoot(t);
  await assert.rejects(
    () => checkPublishedClosureRegistry({
      root,
      packageNames: ['@expo/snapback-cli'],
      fetchImpl: fetchWithLatest({ '*': '0.1.27' }),
    }),
    (error) => error.code === 'SNAPBACK_PUBLISHED_CLOSURE_AHEAD_OF_REGISTRY',
  );
});

test('fails when identity-preset latest tags disagree', async (t) => {
  const root = await tempRoot(t);
  await assert.rejects(
    () => checkPublishedClosureRegistry({
      root,
      packageNames: ['@expo/snapback-cli', '@expo/snapback-client'],
      fetchImpl: fetchWithLatest({
        '@expo/snapback-cli': '0.1.29',
        '@expo/snapback-client': '0.1.27',
      }),
    }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_PUBLISHED_CLOSURE_INCOHERENT_REGISTRY');
      assert.match(error.message, /@expo\/snapback-cli@0\.1\.29/);
      assert.match(error.message, /@expo\/snapback-client@0\.1\.27/);
      return true;
    },
  );
});

test('fails closed on a missing or malformed record', async (t) => {
  const missing = await tempRoot(t, { raw: '' });
  await rm(join(missing, 'guide', 'published-closure.json'));
  await assert.rejects(
    () => checkPublishedClosureRegistry({
      root: missing,
      packageNames: ['@expo/snapback-cli'],
      fetchImpl: fetchWithLatest({ '*': '0.1.29' }),
    }),
    (error) => error.code === 'SNAPBACK_PUBLISHED_CLOSURE_RECORD_INVALID',
  );

  const malformed = await tempRoot(t, {
    record: { ...RECORD, newestPublished: '0.1' },
  });
  await assert.rejects(
    () => checkPublishedClosureRegistry({
      root: malformed,
      packageNames: ['@expo/snapback-cli'],
      fetchImpl: fetchWithLatest({ '*': '0.1.29' }),
    }),
    (error) => error.code === 'SNAPBACK_PUBLISHED_CLOSURE_RECORD_INVALID',
  );
});

test('fails closed when the registry is unreachable', async (t) => {
  const root = await tempRoot(t);
  await assert.rejects(
    () => checkPublishedClosureRegistry({
      root,
      packageNames: ['@expo/snapback-cli'],
      fetchImpl: fetchWithLatest({ '*': new Error('ECONNRESET') }),
    }),
    (error) => error.code === 'SNAPBACK_PUBLISHED_CLOSURE_REGISTRY_UNAVAILABLE',
  );
});

test('the identity-preset inventory is the fourteen-package public closure', () => {
  assert.equal(CLOSURE_PACKAGE_NAMES.length, 14);
  assert(CLOSURE_PACKAGE_NAMES.includes('@expo/snapback-cli'));
  assert(CLOSURE_PACKAGE_NAMES.includes('create-snapback-app'));
});
