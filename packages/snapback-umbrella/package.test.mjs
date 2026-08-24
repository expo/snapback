import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as define from '@expo/snapback-codegen/define';
import * as familiarCodegen from '@expo/snapback-codegen/familiar';
import {
  FAMILIAR_ADVERTISED_ENTRYPOINT_EXPORTS,
  FAMILIAR_DISPOSITIONS,
} from '../snapback-codegen/familiar-dispositions.mjs';
import * as familiarReact from '@expo/snapback-react/familiar';
import * as react from './react.mjs';
import * as server from './server.mjs';
import * as values from './values.mjs';

test('the experimental umbrella is identity-preserving re-exports only', () => {
  assert.equal(server.defineSchema, define.defineSchema);
  assert.equal(server.defineTable, define.defineTable);
  assert.equal(server.defineAssetUpload, define.defineAssetUpload);
  assert.equal(server.defineAuth, define.defineAuth);
  assert.equal(server.defineEphemeral, define.defineEphemeral);
  assert.equal(server.ephemeral, define.ephemeral);
  assert.equal(server.allow, define.allow);
  assert.equal(server.membershipResource, define.membershipResource);
  assert.equal(server.query, familiarCodegen.query);
  assert.equal(server.mutation, familiarCodegen.mutation);
  assert.equal(server.action, familiarCodegen.action);
  assert.equal(values.v, define.v);
  assert.equal(react.SnapbackProvider, familiarReact.SnapbackProvider);
  assert.equal(react.useQueryState, familiarReact.useQueryState);

  for (const file of ['server.mjs', 'values.mjs', 'react.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8').trim();
    assert(
      source.split('\n').filter((line) => line.trim() && !line.trim().startsWith('//'))
        .every((line) => line.startsWith('export ')),
      file,
    );
    assert.doesNotMatch(source, /\b(?:class|function|new|createContext)\b/u, file);
  }
});

test('advertised Familiar entrypoints cover every claimed constructor', () => {
  const entrypoints = { server, values };
  for (const [name, constructor] of Object.entries(FAMILIAR_DISPOSITIONS.constructors)) {
    if (constructor.disposition !== 1 && constructor.disposition !== 2) continue;
    assert.equal(
      Boolean(constructor.entrypoint) !== Boolean(constructor.loweringOnly),
      true,
      `${name} must be exactly public-entrypoint projected or adapter-only lowering`,
    );
    if (constructor.entrypoint) {
      assert(
        FAMILIAR_ADVERTISED_ENTRYPOINT_EXPORTS[constructor.entrypoint]?.includes(name),
        `${name} is direct/defaulted but absent from its advertised entrypoint projection`,
      );
    }
  }
  for (const [entrypoint, names] of Object.entries(FAMILIAR_ADVERTISED_ENTRYPOINT_EXPORTS)) {
    for (const name of names) {
      const disposition = FAMILIAR_DISPOSITIONS.constructors[name];
      assert(
        disposition && (disposition.disposition === 1 || disposition.disposition === 2),
        `${entrypoint}.${name} is advertised without a direct/defaulted constructor disposition`,
      );
      assert.equal(
        Object.hasOwn(entrypoints[entrypoint], name),
        true,
        `${entrypoint}.${name} is claimed but absent from the advertised entrypoint`,
      );
    }
  }
});

test('package metadata marks the familiar umbrella Experimental', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, '@expo/snapback');
  assert.equal(manifest.snapback.maturity, 'Experimental');
  assert.equal(manifest.snapback.authoringProfile, 'snapback-familiar-ts-v1');
  assert.deepEqual(Object.keys(manifest.exports), [
    './server', './values', './react', './package.json',
  ]);
});
