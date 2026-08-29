import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const appJson = JSON.parse(read('app.json'));
const source = read('src/CliqueApp.tsx');
const schema = read('snapback/schema.mjs');
const functions = read('snapback/functions.mjs');

for (const name of ['@expo/snapback-cli', '@expo/snapback-client', '@expo/snapback-codegen', '@expo/snapback-expo', '@expo/snapback-react']) {
  assert.equal(packageJson.dependencies[name], '0.1.29', `${name} must remain exactly pinned`);
}
assert(!Object.hasOwn(appJson, 'authoringProfile'), 'default explicit authoring profile must not be overridden');
assert(!source.includes('authoringProfile'));
assert.match(schema, /defineSchema/u);
assert.match(functions, /defineLiveQuery/u);
assert.match(functions, /defineJsMutation/u);
assert.match(functions, /auth:\s*'authenticated'/u);
assert.match(source, /useSnapbackQuery/u);
assert.match(source, /useSnapbackMutation/u);
assert.match(source, /sm-convo-bubble/u);
assert(existsSync(new URL('../snapback/generated/artifacts.json', import.meta.url)));
process.stdout.write('static contract checks passed\n');
