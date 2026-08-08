import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const artifacts = JSON.parse(readFileSync(
  new URL('./snapback/generated/artifacts.json', import.meta.url),
  'utf8',
));
const functions = JSON.parse(readFileSync(
  new URL('./snapback/generated/functions.manifest.json', import.meta.url),
  'utf8',
));
const app = readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');
const runtimeAcceptance = readFileSync(new URL('./acceptance.mjs', import.meta.url), 'utf8');
const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const agentInstructions = readFileSync(new URL('./AGENTS.md', import.meta.url), 'utf8');
const carrierSource = readFileSync(new URL('./carrier.mjs', import.meta.url), 'utf8');
assert.equal(artifacts.artifactKind, 'artifactIndex');
assert.deepEqual(functions.functions.map((fn) => fn.name).sort(), ['createTodo', 'listTodos']);
assert.match(app, /useSnapbackQueries/);
assert.match(app, /useSnapbackMutation/);
assert.match(packageManifest.scripts.prove, /^snapback verify snapback /);
assert.match(agentInstructions, /the acceptance command/);
assert.equal(packageManifest.scripts['carry:headless'], 'node carrier.mjs headless');
assert.equal(packageManifest.scripts['carry:web-browser'], 'node carrier.mjs web-browser');
assert.match(agentInstructions, /carry:web-browser/);
assert.match(carrierSource, /'web-browser'/);
assert(!app.includes(' as '), 'starter must not need result casts');
assert.match(
  runtimeAcceptance,
  /event\.state === 'generated-and-loaded' && event\.managed === true/,
  'runtime acceptance must wait for the managed CLI load lifecycle, not only the ready file',
);
assert.doesNotMatch(
  runtimeAcceptance,
  /ensureApp|\.seed\(/,
  'runtime acceptance must not restore browser-side provisioning or seed ownership',
);
console.log('react starter static coherence: generated refs and first-party hooks are coherent');
