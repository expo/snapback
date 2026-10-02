// Focused device regression; run with node, optionally naming a different
// snapback4 directory whose scripts/build-wasm.sh artifact should be checked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../../', import.meta.url)));
const { initSync, WebDevice } = await import(pathToFileURL(resolve(root, 'packages/snapback4/src/wasm/snapback4_device.js')));
initSync({ module: readFileSync(resolve(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')) });
const program = { name: 'answer', kind: 'Query', args: {}, body: [{ Return: { Literal: { Int: 7 } } }] };
const stub = { name: 'job', kind: 'job', args: {}, body: [{ Return: { Literal: { String: 'a'.repeat(64) } } }] };
const backend = { generation: 1, schema: { tables: {} }, programs: [program, stub] };
const request = name => JSON.stringify({ op: 'query', name, viewer: 'user:alice', args: {}, now: 1 });
const device = new WebDevice(JSON.stringify(backend), '[]');
assert.equal(JSON.parse(device.call(request('answer'))).ok.data, 7);
assert.ok(JSON.parse(device.call(request('job'))).ok.denied);
const kept = device.drain();
device.free();
const reopened = new WebDevice(null, kept);
assert.equal(JSON.parse(reopened.call(request('answer'))).ok.data, 7);
reopened.free();
let unexpected = 0;
for (const builtin of ['JobAs', { JobQuery: { program, cursor: null, all: false } }, { JobQuery: { program, cursor: null, all: true } }]) {
  const forged = structuredClone(backend);
  const poison = { Block: { body: [{ Require: { condition: { Literal: { Bool: false } }, code: 'ARGUMENT_EXECUTED', site: null } }], value: { Literal: 'Null' } } };
  forged.programs[0].body = [{ Return: { Builtin: { builtin, args: builtin === 'JobAs' ? [poison, poison] : [poison] } } }];
  let decoded;
  try { decoded = new WebDevice(JSON.stringify(forged), '[]'); }
  catch (error) { assert.match(String(error), /unknown variant.*Job(As|Query)/); continue; }
  console.log('Unexpectedly decoded server builtin:', JSON.stringify(builtin), 'execution:', decoded.call(request('answer')));
  decoded.free();
  unexpected++;
}
assert.equal(unexpected, 0, 'server builtins must refuse during decoding before arguments can execute');
console.log('PASS: web opens/reopens digest stubs, ordinary queries execute, jobs refuse, all three server-only builtin forms fail during decoding before argument evaluation.');
