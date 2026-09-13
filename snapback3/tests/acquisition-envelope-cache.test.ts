import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { acquisitionState, chainValue, envelopeFromStored, restoreAcquiredPool, storedResource } from '../packages/snapback3/src/resource/acquisition.js';
import { validateManifest } from '../packages/snapback3/src/resource/facts.js';
import type { DeliveryEnvelopeV1 } from '../packages/snapback3/src/resource/protocol.js';
import type { AcquisitionDeclaration, Manifest, Session, StoredAcquisition, StoredState } from '../packages/snapback3/src/resource/types.js';
import { canonicalProgramJson } from '../packages/evaluator/src/certificate-identity.js';
import { sha256 } from '../packages/evaluator/src/hash.js';
import { wireJson } from '../packages/evaluator/src/value-runtime.js';

const fixture = JSON.parse(readFileSync(new URL('../corpus/named-helper-wrapped-scan.json', import.meta.url), 'utf8'));

function manifest(): Manifest {
  const ir = { ...structuredClone(fixture.program), name: 'cards.list', args: { columnId: 'Id' } };
  const certificate = { ...structuredClone(fixture.certificate), program: 'cards.list', plan_hash: sha256(canonicalProgramJson(ir)) };
  return validateManifest({ generation: sha256('acquisition-envelope-cache'), schemaHash: fixture.certificate.schema_hash,
    schema: structuredClone(fixture.schema), programs: { 'cards.list': {
      kind: 'query', ir, certificate, planHash: certificate.plan_hash,
    } }, seq: 5 });
}

function envelope(current: Manifest): DeliveryEnvelopeV1 {
  const rows = fixture.receipt.rows.map((row: any) => ({ ...row, row: wireJson(row.row) }));
  const ranges = fixture.receipt.ranges.map((range: any) => ({ site: range.site, table: range.table, index: range.index,
    prefix: range.prefix.map((item: any) => ({ Scalar: wireJson(item.Scalar) })), order: range.order, take: range.take,
    after: null, before: null, gt: null, gte: null, lt: null, lte: null, ruleHash: range.rule_hash,
    rowIds: range.row_ids, stop: range.stop, absence: range.absence }));
  return { protocol: 1, generation: current.generation, schemaHash: current.schemaHash,
    planHash: current.programs['cards.list']!.planHash, authority: { principal: 'alice', authEpoch: 1 }, state: 'complete',
    data: rows.map((row: any) => ({ $row: { table: row.table, id: row.id } })), next: null, seq: current.seq, rows,
    receipt: { ranges, absences: [], verdicts: [] }, validator: sha256('acquisition-envelope-cache-validator') };
}

const args = { columnId: 'column-a', c: null };
const chain = (): AcquisitionDeclaration => ({ key: 'cards', op: 'cards.list', args, cursor: 'c', follow: true });
const session = (authEpoch = 1): Session => ({ token: `token-${authEpoch}`,
  principal: { id: 'alice', kind: 'user', name: 'Alice' }, authEpoch, expiresAt: Date.now() + 60_000 });
function checkpoint(resourceKey: string, current: Manifest): StoredAcquisition {
  return { id: 'history', declarationHash: sha256('declaration'), principal: 'alice', authEpoch: 1,
    generation: current.generation, schemaHash: current.schemaHash, status: 'ready', phase: 'validate', seq: current.seq,
    rootKeys: ['cards'], derivedDeclarations: [], pending: [], resourceKeys: [resourceKey], pages: 1 };
}

describe('acquired envelope custody cache', () => {
  test('reuses only the exact module-owned resource, immutable manifest, and row bindings', () => {
    const current = manifest();
    const saved = storedResource('history', 'cards', 'cards.list', args, envelope(current));
    const rows = new Map(saved.rows.map(row => [row.versionKey, row]));
    const first = envelopeFromStored(saved.resource, rows, current);
    expect(envelopeFromStored(saved.resource, rows, current)).toBe(first);
    expect(chainValue<any[]>(chain(), new Map([[saved.resource.key, saved.resource]]), rows, current)).toHaveLength(saved.rows.length);

    const sameContentNewCustody = manifest();
    expect(envelopeFromStored(saved.resource, rows, sameContentNewCustody)).not.toBe(first);

    const storedState = acquisitionState({ version: 2, session: null, manifest: null, frame: null, operations: [],
      acquisitions: [checkpoint(saved.resource.key, current)], acquisitionRows: structuredClone(saved.rows),
      acquisitionResources: [saved.resource] } as StoredState, 'history');
    const rebound = envelopeFromStored(saved.resource, storedState.rows, current);
    expect(rebound).not.toBe(first);
    expect(envelopeFromStored(saved.resource, storedState.rows, current)).toBe(rebound);
  });

  test('missing, replaced, tampered, and mutable inputs never inherit cached custody', () => {
    const current = manifest();
    const saved = storedResource('history', 'cards', 'cards.list', args, envelope(current));
    const ownedRows = new Map(saved.rows.map(row => [row.versionKey, row]));
    const held = envelopeFromStored(saved.resource, ownedRows, current);

    const missing = new Map(ownedRows); missing.delete(saved.rows[0]!.versionKey);
    expect(() => envelopeFromStored(saved.resource, missing, current)).toThrow('missing row version');

    const mutableRows = new Map(structuredClone(saved.rows).map(row => [row.versionKey, row]));
    const replacement = envelopeFromStored(saved.resource, mutableRows, current);
    expect(replacement).not.toBe(held);
    (mutableRows.get(saved.rows[0]!.versionKey)!.row.row as any).forged = 'changed after validation';
    expect(() => envelopeFromStored(saved.resource, mutableRows, current)).toThrow('content-addressed version');

    const mutableResource = structuredClone(saved.resource);
    const beforeHeaderChange = envelopeFromStored(mutableResource, ownedRows, current);
    mutableResource.envelope.seq++;
    mutableResource.envelope.authority.authEpoch++;
    const afterHeaderChange = envelopeFromStored(mutableResource, ownedRows, current);
    expect(afterHeaderChange).not.toBe(beforeHeaderChange);
    expect(afterHeaderChange).toMatchObject({ seq: current.seq + 1, authority: { principal: 'alice', authEpoch: 2 } });

    const changedSchema = structuredClone(current);
    delete changedSchema.schema.tables[saved.rows[0]!.row.table];
    expect(() => envelopeFromStored(saved.resource, ownedRows, changedSchema)).toThrow('invalid table or row identity');
  });

  test('restoration still binds cached envelopes to the current acquisition authority', () => {
    const current = manifest();
    const saved = storedResource('history', 'cards', 'cards.list', args, envelope(current));
    const acquisition = checkpoint(saved.resource.key, current);
    expect(restoreAcquiredPool(current, session(), acquisition, saved.rows, [saved.resource])?.seq).toBe(current.seq);
    expect(restoreAcquiredPool(current, session(2), acquisition, saved.rows, [saved.resource])).toBeUndefined();

    const changedAuthority = structuredClone(saved.resource);
    changedAuthority.envelope.authority.authEpoch = 2;
    expect(() => restoreAcquiredPool(current, session(), acquisition, saved.rows, [changedAuthority]))
      .toThrow('another program or account');
  });
});
