import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateArtifactAndMetadata } from '../scripts/check-workspace-graph.mjs';

const artifact = JSON.parse(readFileSync(new URL('../crates/allowed-dependencies.v1.json', import.meta.url)));

function metadata(name = 'snapback', dependencies = ['axum', 'celld-ltx', 'clap', 'ibex-runtime', 'rusqlite']) {
  const id = `${name} 0.1.0 (path+file:///fixture/${name})`;
  return {
    packages: [{ id, name, publish: [], dependencies: dependencies.map((dependency) => ({ name: dependency })) }],
    workspace_members: [id],
  };
}

test('the Phase 1 remainder is assigned and carries only named confinement exemptions', () => {
  assert.deepEqual(validateArtifactAndMetadata(artifact, metadata()), {
    members: ['snapback'],
    plannedCrates: 13,
  });
});

test('an unassigned workspace member fails closed', () => {
  assert.throws(() => validateArtifactAndMetadata(artifact, metadata('surprise')), /has no owner\/rank assignment/u);
});

test('a confined external outside its owner and remainder exemption fails closed', () => {
  assert.throws(
    () => validateArtifactAndMetadata(artifact, metadata('snapback-types', ['axum'])),
    /may not depend on confined external axum/u,
  );
});

test('publishable workspace crates fail closed', () => {
  const value = metadata();
  value.packages[0].publish = null;
  assert.throws(() => validateArtifactAndMetadata(artifact, value), /publish = false/u);
});

test('the committed matrix cannot widen without amending its checked projection', () => {
  const widened = structuredClone(artifact);
  widened.crates.find((entry) => entry.name === 'snapback-kernel')
    .allowedWorkspaceDependencies.push('snapback-auth');
  assert.throws(() => validateArtifactAndMetadata(widened, metadata()), /matrix crate rows drifted/u);
});
