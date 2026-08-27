import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';
import {
  HOUR_MS,
  SOON_MS,
  openExpiringSoon,
  openTrendingWindow,
  refreshTimeWindow,
} from '../../tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(packageDir, '../..');
const fixtureDir = join(root, 'tests/fixtures/guide-time-windowed-live-reads');
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const fixtureDefineSpecifier = '@expo/snapback-codegen/define';
const tempDirs = [];

function materialize(functionsFile) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-guide-time-window-'));
  tempDirs.push(dir);
  for (const [source, target] of [
    ['schema.mjs', 'schema.mjs'],
    [functionsFile, 'functions.mjs'],
  ]) {
    const text = readFileSync(join(fixtureDir, source), 'utf8')
      .replaceAll(fixtureDefineSpecifier, defineUrl);
    writeFileSync(join(dir, target), text);
  }
  return dir;
}

try {
  const naive = await generate(materialize('naive-functions.mjs'));
  assert.equal(naive.ok, false, 'ambient runtime time must fail protected live codegen');
  assert(naive.diagnostics.some((entry) => (
    entry.code === 'SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY'
    && entry.function === 'eventsVisibleNow'
  )), JSON.stringify(naive.diagnostics));

  const recipeDir = materialize('functions.mjs');
  const recipe = await generate(recipeDir);
  assert.equal(recipe.ok, true, JSON.stringify(recipe.diagnostics));
  const manifest = JSON.parse(readFileSync(
    join(recipeDir, 'generated/functions.manifest.json'),
    'utf8',
  ));
  const query = manifest.functions.find((entry) => entry.name === 'eventsVisibleAtPinnedClock');
  assert(query, 'trending recipe query is emitted');
  assert.deepEqual(
    query.argsContract.fields.map((field) => field.name),
    ['clockMs', 'windowMs'],
    'the pasted recipe emits the load-pinned clock argument contract',
  );
  const typingQuery = manifest.functions.find((entry) => entry.name === 'typingLeasesExpiringSoon');
  assert(typingQuery, 'typing-lease recipe query is emitted');
  assert.deepEqual(
    typingQuery.argsContract.fields.map((field) => field.name),
    ['clockMs', 'soonWithinMs'],
    'the typing-lease recipe emits the pinned clock and expiry horizon contract',
  );

  const calls = [];
  let disposals = 0;
  const client = {
    async liveQuery(reference, options) {
      calls.push({ reference, options });
      return { async dispose() { disposals += 1; } };
    },
  };
  const trendingReference = Object.freeze({ name: 'eventsVisibleAtPinnedClock' });
  const typingReference = Object.freeze({ name: 'typingLeasesExpiringSoon' });
  const first = await openTrendingWindow(client, trendingReference, 'guide-proof-trending');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.args.clockMs, first.clockMs);
  assert.equal(calls[0].options.args.windowMs, HOUR_MS);
  assert.equal(calls[0].options.transport, 'stream');
  const second = await refreshTimeWindow(
    first,
    () => openTrendingWindow(client, trendingReference, 'guide-proof-trending'),
  );
  assert.equal(disposals, 1, 'refresh disposes the predecessor generation');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.args.clockMs, second.clockMs);
  const typing = await openExpiringSoon(client, typingReference, 'guide-proof-typing');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.args.clockMs, typing.clockMs);
  assert.equal(calls[2].options.args.soonWithinMs, SOON_MS);
  assert.equal(calls[2].options.transport, 'stream');
} finally {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}

console.log('guide-time-windowed-live-reads.test.mjs: guard, trending window, and typing lease pass');
