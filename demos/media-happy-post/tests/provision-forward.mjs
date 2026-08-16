import { readFileSync } from 'node:fs';
import { SnapbackClient } from '@expo/snapback-client';

const generated = (name) => JSON.parse(readFileSync(new URL(`../snapback/generated/${name}`, import.meta.url), 'utf8'));
const client = new SnapbackClient('http://127.0.0.1:4431', { rqsStore: null });
const result = await client.ensureApp({
  intent: 'provision',
  requestedMode: 'sessions',
  schema: generated('schema.manifest.json'),
  functions: generated('functions.manifest.json'),
});
console.log('PROVISION_FORWARD_OK', JSON.stringify(result).slice(0, 200));
await client.closeAuth();
