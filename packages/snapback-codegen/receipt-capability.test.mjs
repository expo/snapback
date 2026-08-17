import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CONTRACT_RECEIPT_CAPABILITY,
  contractReceiptCapability,
  createSnapbackContractSurface,
  SNAPBACK_CONTRACT_RECEIPT_CAPABILITY,
} from '../snapback-contract/index.mjs';
import { generate } from './index.mjs';

assert.equal(
  contractReceiptCapability(),
  CONTRACT_RECEIPT_CAPABILITY.NONE,
  'a target with no receipt implementation must claim none',
);
assert.equal(
  contractReceiptCapability({ mutationReceipts: true }),
  CONTRACT_RECEIPT_CAPABILITY.MUTATION,
);
assert.equal(
  contractReceiptCapability({ mutationReceipts: true, subscriptionReceipts: true }),
  CONTRACT_RECEIPT_CAPABILITY.MUTATION_AND_SUBSCRIPTION,
);
assert.throws(
  () => contractReceiptCapability({ subscriptionReceipts: true }),
  /cannot represent subscription receipts without mutation receipts/,
);

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-receipts-'));

try {
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
});
`);
  writeFileSync(join(dir, 'functions.mjs'), `
import { arg, defineLiveQuery, defineMutation, patch, returnChangedCount, v } from '${defineUrl}';
export const listTodos = defineLiveQuery({ table: 'todos', args: {} });
export const editTitle = defineMutation({
  args: { id: v.string(), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnChangedCount(),
});
`);

  const result = await generate(dir);
  assert.equal(result.ok, true, `expected clean generation, got: ${JSON.stringify(result.diagnostics)}`);
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'contract-data.manifest.json'), 'utf8'));
  assert.equal(manifest.receipts, SNAPBACK_CONTRACT_RECEIPT_CAPABILITY);

  const observed = [];
  const client = {
    async liveQuery(_name, options) {
      observed.push({
        kind: 'subscription',
        event: 'established',
        correlation: options.correlation,
      });
      return { rows: [], version: 0, connection: 'live', dispose() {} };
    },
    async query() {
      return { rows: [], version: 0 };
    },
    async mutate(name, options) {
      observed.push({
        kind: 'mutation',
        mutation: name,
        correlation: options.correlation,
      });
      return { changed: 0 };
    },
    receipts() {
      return [...observed];
    },
  };
  const runtime = {
    createContractMockQueryBoundary(initialRows) {
      const rows = new Map(Object.entries(initialRows));
      return {
        query(key, project = (value) => value) {
          return project(rows.get(key) ?? []);
        },
        write(key, update) {
          const next = update(rows.get(key) ?? []);
          rows.set(key, next);
          return next;
        },
      };
    },
    createBoundaryContractDataProvider(_manifest, boundary, options) {
      return { boundary, ...options };
    },
    createProviderQueryHandle(provider, name, args) {
      return { provider, name, args };
    },
    createProviderEphemeralHandle(provider, name, args) {
      return { provider, name, args };
    },
  };

  const surface = await createSnapbackContractSurface({
    runtime,
    client,
    userId: 'receipt-test',
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
  });
  await surface.links.editTitle({ id: 'missing', title: 'Receipt' });
  const observedKinds = new Set(surface.receipts().map((receipt) => receipt.kind));
  assert.deepEqual(observedKinds, new Set(['subscription', 'mutation']));
  assert.equal(
    manifest.receipts,
    contractReceiptCapability({
      mutationReceipts: observedKinds.has('mutation'),
      subscriptionReceipts: observedKinds.has('subscription'),
    }),
    'the generated claim must equal the receipt kinds the adapter exposes',
  );
  surface.dispose();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('receipt-capability.test.mjs: all cases passed');
