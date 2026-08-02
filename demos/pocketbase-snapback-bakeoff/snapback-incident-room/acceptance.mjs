import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const functions = JSON.parse(readFileSync(new URL('./snapback/generated/functions.manifest.json', import.meta.url), 'utf8'));
const app = readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');
assert.equal(functions.functions.length, 10);
assert.equal(functions.cronJobs.some((job) => job.name === 'hourlyMaintenance'), true);
assert.equal(functions.assetUploadIntents.some((intent) => intent.name === 'incidentAttachment'), true);
assert.match(app, /transport: 'stream'/);
assert.match(app, /subscribeEphemeral/);
assert.match(app, /searchIncidents/);
console.log('snapback incident room static acceptance: generated operations and UI bindings are coherent');
