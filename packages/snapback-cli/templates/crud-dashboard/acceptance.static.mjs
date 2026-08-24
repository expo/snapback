import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const artifacts = readJson('./snapback/generated/artifacts.json');
const functions = readJson('./snapback/generated/functions.manifest.json');
const schema = readJson('./snapback/generated/schema.manifest.json');
const appSource = readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('./snapback/schema.mjs', import.meta.url), 'utf8');
const functionSource = readFileSync(new URL('./snapback/functions.mjs', import.meta.url), 'utf8');
const runtimeAcceptance = readFileSync(new URL('./acceptance.mjs', import.meta.url), 'utf8');
const packageManifest = readJson('./package.json');
const instructions = readFileSync(new URL('./AGENTS.md', import.meta.url), 'utf8');
const carrierSource = readFileSync(new URL('./carrier.mjs', import.meta.url), 'utf8');

assert.equal(artifacts.artifactKind, 'artifactIndex');
assert.equal(schema.auth.mode, 'sessions');
assert.deepEqual(functions.functions.map((fn) => fn.name).sort(), [
  'createProject', 'deleteProject', 'listTeams', 'projectDetail', 'projectDirectory', 'updateProject',
]);
const relational = functions.functions.find((fn) => fn.name === 'projectDirectory');
assert.ok(relational?.runtime?.HostPlan?.RelationalQuery, 'project directory must generate as a relational query');
assert.match(functionSource, /joinedIndex:\s*'by_slug'/);
assert.match(functionSource, /output:\s*'public-read'/);
assert.match(schemaSource, /index\('by_slug', \['slug'\], \{ unique: true \}\)/);
assert.match(appSource, /useSnapbackQuery\(api\.projectDirectory/);
assert.match(appSource, /useSnapbackQuery\(api\.projectDetail/);
assert.match(appSource, /optimistic:\s*\{/);
assert.match(appSource, /createProject/);
assert.match(appSource, /updateProject/);
assert.match(appSource, /deleteProject/);
assert.equal(packageManifest.scripts.dev, 'snapback dev snapback --write-env');
assert.equal(packageManifest.scripts['dev:client'], 'vite');
assert.match(packageManifest.scripts.prove, /^snapback verify snapback /);
assert.match(instructions, /only done-oracle/);
assert.equal(packageManifest.scripts['test:live'], undefined);
assert.equal(packageManifest.scripts['carry:headless'], 'node carrier.mjs headless');
assert.equal(packageManifest.scripts['carry:web-browser'], 'node carrier.mjs web-browser');
assert.match(instructions, /carry:web-browser/);
assert.match(carrierSource, /'web-browser'/);
assert(!appSource.includes(' as '), 'starter UI must not need generated-result casts');
assert.match(runtimeAcceptance, /from '@expo\/snapback-acceptance'/);
assert.match(runtimeAcceptance, /defineStarterAcceptance/);
assert.match(runtimeAcceptance, /runStarterAcceptanceIfMain/);
assert.doesNotMatch(
  runtimeAcceptance,
  /snapback\.starter-acceptance\.v1|expectedCheckCount|executedCheckCount|projectStarterAcceptanceReceipt|JSON\.stringify\s*\(\s*(?:receipt\b|outcome\b|\{[\s\S]{0,256}?(?:schemaVersion|checks|operations|cleanup|lifecycle)\s*:)/u,
);
for (const operation of ['projectDirectory', 'createProject', 'updateProject', 'deleteProject']) {
  assert.match(runtimeAcceptance, new RegExp(`operation:\\s*api\\.${operation}`));
}
console.log('crud-dashboard static coherence: related list/detail/edit, live reads, optimistic mutation, and proof command are coherent');
