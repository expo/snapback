import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const artifacts = JSON.parse(readFileSync(new URL('./snapback/generated/artifacts.json', import.meta.url), 'utf8'));
const functions = JSON.parse(readFileSync(new URL('./snapback/generated/functions.manifest.json', import.meta.url), 'utf8'));
const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const agentInstructions = readFileSync(new URL('./AGENTS.md', import.meta.url), 'utf8');
const carrierSource = readFileSync(new URL('./carrier.mjs', import.meta.url), 'utf8');
const runtimeAcceptance = readFileSync(new URL('./acceptance.mjs', import.meta.url), 'utf8');
assert.equal(artifacts.artifactKind, 'artifactIndex');
assert.deepEqual(functions.functions.map((fn) => fn.name).sort(), ['createTodo', 'listTodos']);
assert.match(packageManifest.scripts.prove, /^snapback verify snapback /);
assert.match(agentInstructions, /only done-oracle/);
assert.equal(packageManifest.scripts['test:live'], undefined);
assert.equal(packageManifest.scripts['carry:headless'], 'node carrier.mjs headless');
assert.match(agentInstructions, /carry:headless/);
assert.match(carrierSource, /headless:\s*\{\}/);
assert.match(runtimeAcceptance, /from '@expo\/snapback-acceptance'/);
assert.match(runtimeAcceptance, /defineStarterAcceptance/);
assert.match(runtimeAcceptance, /runStarterAcceptanceIfMain/);
assert.doesNotMatch(
  runtimeAcceptance,
  /snapback\.starter-acceptance\.v1|expectedCheckCount|executedCheckCount|projectStarterAcceptanceReceipt|JSON\.stringify\s*\(\s*(?:receipt\b|outcome\b|\{[\s\S]{0,256}?(?:schemaVersion|checks|operations|cleanup|lifecycle)\s*:)/u,
);
assert.match(runtimeAcceptance, /bindingFor\(app,/);
assert.match(runtimeAcceptance, /createSnapbackAppClient\s*\(\s*\{[\s\S]*?app,[\s\S]*?binding,[\s\S]*?streamless:\s*true,/u);
assert.match(runtimeAcceptance, /operation:\s*api\.listTodos/);
assert.match(runtimeAcceptance, /operation:\s*api\.createTodo/);
assert.match(runtimeAcceptance, /step\(paths\.listTodos/);
assert.match(runtimeAcceptance, /step\(paths\.createTodo/);
assert.match(runtimeAcceptance, /sessionClient\.query\(api\.listTodos/);
assert.match(runtimeAcceptance, /sessionClient\.mutate\(api\.createTodo/);
console.log('todo-contract static coherence: generated package surface is coherent');
