// ENG-24360: prove identity drift follows Cloudflare-only semantic inputs,
// including bytes discovered by esbuild and normalized compatibility config.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDeploymentIdentities } from '../scripts/generate-deployment-identity.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const base = await computeDeploymentIdentities();

const notesPath = 'targets/cloudflare/app/notes.app.js';
const notesSource = read(notesPath);
const handlerMutation = new Map([[notesPath, notesSource.replace('addNote requires a text string', 'addNote requires text')]]);
const handlerChanged = await computeDeploymentIdentities({ overrides: handlerMutation });
assert.notEqual(handlerChanged.notes.bundleHash, base.notes.bundleHash, 'handler-only edit must change bundle identity');

const schemaMutation = new Map([[notesPath, notesSource.replace("{ name: 'authorId'", "{ name: 'writerId'")]]);
const schemaChanged = await computeDeploymentIdentities({ overrides: schemaMutation });
assert.notEqual(schemaChanged.notes.schemaHash, base.notes.schemaHash, 'Cloudflare schema edit must change schema identity');
assert.notEqual(schemaChanged.notes.bundleHash, base.notes.bundleHash, 'Cloudflare schema edit must change bundle identity');

const compatPath = 'packages/snapback-harness/compat.json';
const compat = JSON.parse(read(compatPath));
compat.compatibilityDate = '2099-01-01';
const compatChanged = await computeDeploymentIdentities({ overrides: new Map([[compatPath, JSON.stringify(compat)]]) });
assert.notEqual(compatChanged.notes.inputsHash, base.notes.inputsHash, 'compat source edit must change inputs identity');
assert.notEqual(compatChanged['all-aboard'].inputsHash, base['all-aboard'].inputsHash);

const wranglerPath = 'targets/cloudflare/wrangler.jsonc';
const wranglerChanged = await computeDeploymentIdentities({
  overrides: new Map([[wranglerPath, read(wranglerPath).replace(/"compatibility_date":\s*"[^"]+"/, '"compatibility_date": "2099-01-02"')]]),
});
assert.notEqual(wranglerChanged.notes.inputsHash, base.notes.inputsHash, 'normalized Wrangler compatibility edit must change identity');

console.log('cloudflare deployment-identity tests: handler, schema, compat, and Wrangler drift passed');
