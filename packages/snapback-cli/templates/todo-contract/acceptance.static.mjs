import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const artifacts = JSON.parse(readFileSync(new URL('./snapback/generated/artifacts.json', import.meta.url), 'utf8'));
const functions = JSON.parse(readFileSync(new URL('./snapback/generated/functions.manifest.json', import.meta.url), 'utf8'));
const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const agentInstructions = readFileSync(new URL('./AGENTS.md', import.meta.url), 'utf8');
assert.equal(artifacts.artifactKind, 'artifactIndex');
assert.deepEqual(functions.functions.map((fn) => fn.name).sort(), ['createTodo', 'listTodos']);
assert.match(packageManifest.scripts.prove, /^snapback verify snapback /);
assert.match(agentInstructions, /the acceptance command/);
console.log('todo-contract static coherence: generated package surface is coherent');
