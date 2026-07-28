import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SnapbackClient } from '@snapback/client';
import { resolveGeneratedArtifact } from '@snapback/codegen/review-surface';

const readyPath = process.argv[2];
if (!readyPath) throw new Error('usage: provision-snapback.mjs <ready.json>');
const ready = JSON.parse(await readFile(resolve(readyPath), 'utf8'));
const adminToken = (await readFile(ready.adminTokenFile, 'utf8')).trim();
const demoRoot = resolve(import.meta.dirname, '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const generatedJson = async (path) => JSON.parse(
  await readFile(resolveGeneratedArtifact(generatedRoot, path), 'utf8'),
);
const client = new SnapbackClient(ready.serverUrl, { adminToken });
await client.ensureApp({
  schema: await generatedJson('schema.manifest.json'),
  functions: await generatedJson('functions.manifest.json'),
  seed: JSON.parse(await readFile(join(demoRoot, 'snapback', 'seed.json'), 'utf8')),
});
process.stdout.write(`Signal Desk provisioned at ${ready.serverUrl}.\n`);
