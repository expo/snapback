// Node-side generated artifact consumption for demos and acceptance suites.
// Browser bundles use @snapback/vite's equivalent resolver hook.
//
// @ref LLP 0010#generated-artifacts — scripts consume the immutable,
// complete-input cache selected by artifacts.json instead of trusting a
// materialized generated file.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { resolveGeneratedArtifact } from '../../packages/snapback-codegen/review-surface.mjs';

export function readGeneratedJson(generatedRoot, artifactPath) {
  return JSON.parse(readFileSync(
    resolveGeneratedArtifact(generatedRoot, artifactPath),
    'utf8',
  ));
}

export async function importGeneratedModule(generatedRoot, artifactPath) {
  return import(pathToFileURL(resolveGeneratedArtifact(generatedRoot, artifactPath)).href);
}
