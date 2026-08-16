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
const main = readFileSync(new URL('./src/main.tsx', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('./snapback/schema.mjs', import.meta.url), 'utf8');
const descriptor = JSON.parse(readFileSync(
  new URL('./snapback/generated/app.descriptor.json', import.meta.url),
  'utf8',
));
const runtimeAcceptance = readFileSync(new URL('./acceptance.mjs', import.meta.url), 'utf8');
const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const agentInstructions = readFileSync(new URL('./AGENTS.md', import.meta.url), 'utf8');
const carrierSource = readFileSync(new URL('./carrier.mjs', import.meta.url), 'utf8');
assert.equal(artifacts.artifactKind, 'artifactIndex');
assert.deepEqual(functions.functions.map((fn) => fn.name).sort(), ['createTodo', 'listTodos']);
assert.match(app, /useSnapbackQueries/);
assert.match(app, /useSnapbackMutation/);
assert.match(app, /useSnapbackAuth/);
assert.match(app, /useSnapbackCurrentPrincipal/);
assert.match(app, /signUpWithPassword/);
assert.match(app, /signInWithPassword/);
assert.match(app, /auth\.signOut/);
assert.match(main, /createSnapbackAppClient/);
assert.match(main, /createSnapbackDevAppBinding/);
assert.match(main, /<SnapbackProvider/u);
assert.doesNotMatch(main, /new SnapbackClient|createSnapbackReactProvider|AuthCoordinator|bearer|adoptAuthority/u);
assert.match(schemaSource, /kind:\s*'password'/u);
assert.equal(descriptor.authBootstrap.format, 'snapback.application-auth-bootstrap.v1');
assert(descriptor.capabilities.required.includes('auth.application-bootstrap.v1'));
assert.match(packageManifest.scripts.prove, /^snapback verify snapback /);
assert.match(agentInstructions, /the acceptance command/);
assert.equal(packageManifest.scripts['carry:headless'], 'node carrier.mjs headless');
assert.equal(packageManifest.scripts['carry:web-browser'], 'node carrier.mjs web-browser');
assert.match(agentInstructions, /carry:web-browser/);
assert.match(carrierSource, /'web-browser'/);
assert(!app.includes(' as '), 'starter must not need result casts');
assert.match(
  runtimeAcceptance,
  /'wait', '--ready-file', readyFile/,
  'runtime acceptance must wait through the package CLI on the application-readiness receipt',
);
assert.match(runtimeAcceptance, /'--level', 'application', '--timeout-ms', '60000'/);
assert.match(runtimeAcceptance, /applicationReadyObserved: true/);
assert.match(runtimeAcceptance, /firstQueryRetries: 0/);
assert.doesNotMatch(runtimeAcceptance, /generated-and-loaded/);
assert.doesNotMatch(
  runtimeAcceptance,
  /ensureApp|\.seed\(/,
  'runtime acceptance must not restore browser-side provisioning or seed ownership',
);
assert.match(runtimeAcceptance, /createSnapbackAppClient/);
assert.doesNotMatch(runtimeAcceptance, /new SnapbackClient|AuthCoordinator|bearer|adoptAuthority/u);
console.log('react starter static coherence: generated refs and first-party hooks are coherent');
