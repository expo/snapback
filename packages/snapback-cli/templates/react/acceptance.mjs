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
assert.equal(artifacts.artifactKind, 'artifactIndex');
assert.deepEqual(functions.functions.map((fn) => fn.name).sort(), ['createTodo', 'listTodos']);
assert.match(app, /useSnapbackQueries/);
assert.match(app, /useSnapbackMutation/);
assert(!app.includes(' as '), 'starter must not need result casts');
console.log('react starter acceptance: generated refs and first-party hooks are coherent');
