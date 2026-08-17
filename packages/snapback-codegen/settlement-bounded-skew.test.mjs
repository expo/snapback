import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SETTLEMENT_BOUNDED_SKEW_MAX_MS,
  add,
  defineMutation,
  insert,
  lit,
  runtimeNow,
} from './define.mjs';
import { generate } from './index.mjs';

const direct = defineMutation({
  plan: insert('events', { capturedAt: runtimeNow(), observedAt: runtimeNow() }),
  boundedSkew: { field: 'capturedAt', maxSkewMs: 5_000 },
});
assert.deepEqual(direct.boundedSkew, { field: 'capturedAt', maxSkewMs: 5_000 });

for (const declaration of [
  { field: 'capturedAt', maxSkewMs: 0 },
  { field: 'capturedAt', maxSkewMs: SETTLEMENT_BOUNDED_SKEW_MAX_MS + 1 },
  { field: '', maxSkewMs: 1 },
]) {
  assert.throws(
    () => defineMutation({
      plan: insert('events', { capturedAt: runtimeNow() }),
      boundedSkew: declaration,
    }),
    /boundedSkew/,
  );
}
assert.throws(
  () => defineMutation({
    plan: insert('events', { capturedAt: add(runtimeNow(), lit(1)) }),
    boundedSkew: { field: 'capturedAt', maxSkewMs: 5_000 },
  }),
  /exactly one direct runtimeNow\(\) write/,
);
assert.throws(
  () => defineMutation({
    plan: [
      insert('events', { capturedAt: runtimeNow() }),
      insert('events', { capturedAt: runtimeNow() }),
    ],
    boundedSkew: { field: 'capturedAt', maxSkewMs: 5_000 },
  }),
  /exactly one direct runtimeNow\(\) write/,
);

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const dir = mkdtempSync(join(tmpdir(), 'snapback-bounded-skew-'));
try {
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  events: defineTable({ capturedAt: v.integer(), observedAt: v.integer() })
    .visibility({ kind: 'public-read' }).sync(),
});
`);
  writeFileSync(join(dir, 'functions.mjs'), `
import { defineMutation, insert, runtimeNow } from '${defineUrl}';
export const recordEvent = defineMutation({
  plan: insert('events', { capturedAt: runtimeNow(), observedAt: runtimeNow() }),
  boundedSkew: { field: 'capturedAt', maxSkewMs: 5000 },
});
`);
  const generated = await generate(dir);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const manifest = JSON.parse(
    readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
  );
  const recordEvent = manifest.functions.find((fn) => fn.name === 'recordEvent');
  assert.deepEqual(recordEvent.boundedSkew, { field: 'capturedAt', maxSkewMs: 5_000 });
  assert(recordEvent.requiredCapabilities.includes('settlement.bounded_skew'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('settlement-bounded-skew.test.mjs: declaration and capability checks passed');
