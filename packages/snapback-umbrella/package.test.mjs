import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as define from '@expo/snapback-codegen/define';
import * as familiarCodegen from '@expo/snapback-codegen/familiar';
import * as familiarReact from '@expo/snapback-react/familiar';
import { createDataClient as clientCreateDataClient } from '@expo/snapback-client/data';
import { db as reactDb } from '@expo/snapback-react/data';
import * as data from './data.mjs';
import * as react from './react.mjs';
import * as reactData from './react-data.mjs';
import * as server from './server.mjs';
import * as values from './values.mjs';

test('the experimental umbrella is identity-preserving re-exports only', () => {
  assert.equal(server.defineSchema, define.defineSchema);
  assert.equal(server.defineTable, define.defineTable);
  assert.equal(server.defineAssetUpload, define.defineAssetUpload);
  assert.equal(server.query, familiarCodegen.query);
  assert.equal(server.mutation, familiarCodegen.mutation);
  assert.equal(server.action, familiarCodegen.action);
  assert.equal(values.v, define.v);
  assert.equal(react.SnapbackProvider, familiarReact.SnapbackProvider);
  assert.equal(react.useQueryState, familiarReact.useQueryState);
  assert.equal(data.createDataClient, clientCreateDataClient);
  assert.equal(reactData.db, reactDb);
  assert.deepEqual(Object.keys(data), ['createDataClient']);
  assert.deepEqual(Object.keys(reactData), ['db']);

  for (const file of ['server.mjs', 'values.mjs', 'react.mjs', 'data.mjs', 'react-data.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8').trim();
    assert(
      source.split('\n').filter((line) => line.trim() && !line.trim().startsWith('//'))
        .every((line) => line.startsWith('export ')),
      file,
    );
    assert.doesNotMatch(source, /\b(?:class|function|new|createContext)\b/u, file);
  }
});

test('package metadata marks the familiar umbrella Experimental', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, '@expo/snapback');
  assert.equal(manifest.snapback.maturity, 'Experimental');
  assert.equal(manifest.snapback.authoringProfile, 'snapback-familiar-ts-v1');
  assert.deepEqual(Object.keys(manifest.exports), [
    './server', './values', './data', './react', './react/data', './package.json',
  ]);
  const files = new Set(manifest.files);
  for (const target of Object.values(manifest.exports).flatMap((entry) => (
    typeof entry === 'string' ? [entry] : Object.values(entry)
  ))) {
    if (target === './package.json') continue;
    assert.equal(files.has(target.replace(/^\.\//u, '')), true, target);
  }
});
