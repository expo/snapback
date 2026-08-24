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
const devModuleTypes = readFileSync(new URL('./src/snapback-dev.d.ts', import.meta.url), 'utf8');
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
assert.match(main, /url:\s*import\.meta\.env\.VITE_SNAPBACK_URL/u);
assert.doesNotMatch(main, /createSnapbackDevAppBinding/u);
assert.doesNotMatch(devModuleTypes, /createSnapbackDevAppBinding/u);
assert.match(main, /<SnapbackProvider/u);
assert.doesNotMatch(main, /new SnapbackClient|createSnapbackReactProvider|AuthCoordinator|bearer|adoptAuthority/u);
assert.match(schemaSource, /kind:\s*'password'/u);
assert.equal(descriptor.authBootstrap.format, 'snapback.application-auth-bootstrap.v1');
assert(descriptor.capabilities.required.includes('auth.application-bootstrap.v1'));
assert.match(packageManifest.scripts.prove, /^snapback verify snapback /);
assert.match(agentInstructions, /only done-oracle/);
assert.equal(packageManifest.scripts['test:live'], undefined);
assert.equal(packageManifest.scripts['carry:headless'], 'node carrier.mjs headless');
assert.equal(packageManifest.scripts['carry:web-browser'], 'node carrier.mjs web-browser');
assert.match(agentInstructions, /carry:web-browser/);
assert.match(carrierSource, /'web-browser'/);
assert(!app.includes(' as '), 'starter must not need result casts');
assert.match(runtimeAcceptance, /from '@expo\/snapback-acceptance'/);
assert.match(runtimeAcceptance, /defineStarterAcceptance/);
assert.match(runtimeAcceptance, /runStarterAcceptanceIfMain/);
assert.doesNotMatch(
  runtimeAcceptance,
  /snapback\.starter-acceptance\.v1|expectedCheckCount|executedCheckCount|projectStarterAcceptanceReceipt|JSON\.stringify\s*\(\s*(?:receipt\b|outcome\b|\{[\s\S]{0,256}?(?:schemaVersion|checks|operations|cleanup|lifecycle)\s*:)/u,
);
for (const check of [
  'anonymous-ready',
  'password-signup-recovery',
  'reload-restores-principal',
  'authenticated-entry-refusal',
  'sign-out',
]) {
  assert.match(runtimeAcceptance, new RegExp(check));
}
assert.doesNotMatch(
  runtimeAcceptance,
  /ensureApp|\.seed\(/,
  'runtime acceptance must not restore browser-side provisioning or seed ownership',
);
assert.match(runtimeAcceptance, /createSnapbackAppClient/);
assert.match(runtimeAcceptance, /url:\s*process\.env\.SNAPBACK_URL/u);
assert.doesNotMatch(runtimeAcceptance, /bindingFor|createSnapbackDevAppBinding/u);
assert.match(runtimeAcceptance, /operation:\s*api\.listTodos/);
assert.match(runtimeAcceptance, /operation:\s*api\.createTodo/);
assert.doesNotMatch(runtimeAcceptance, /AuthCoordinator|adoptAuthority/u);
console.log('react starter static coherence: generated refs and first-party hooks are coherent');
