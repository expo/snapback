import { ClientStore } from '../../../evaluator/src/store.js';
import { queryState, validateCertificate } from '../../../evaluator/src/runner.js';
import { canonicalJson, schemaDigest, validateInputs, valueFromWire, wireJson } from '../../../evaluator/src/value-runtime.js';
import { isSha256, sha256 } from '../../../evaluator/src/hash.js';
import type { Context, Value } from '../../../evaluator/src/types.js';
import { expandRows, ownDeliveryEnvelope, prepareClosureReceipt, type DeliveryEnvelopeV1 } from './protocol.js';
import { ownJson } from './signal.js';
import { rowKey } from './storage.js';
import { SnapbackError, type Args, type FramePatch, type Manifest, type ResourceSnapshot, type Session, type StoredResource } from './types.js';

export function validateManifest(input: Manifest): Manifest {
  const manifest = ownJson(input);
  if (!isSha256(manifest.generation) || !isSha256(manifest.schemaHash)
    || !Number.isSafeInteger(manifest.seq) || manifest.seq < 0
    || schemaDigest(manifest.schema) !== manifest.schemaHash)
    throw new SnapbackError('S3_PROTOCOL', 'The server manifest has an invalid identity.');
  for (const [name, program] of Object.entries(manifest.programs)) {
    if (program.ir.name !== name || program.ir.kind.toLowerCase() !== program.kind.toLowerCase()
      || program.planHash !== program.certificate.plan_hash)
      throw new SnapbackError('S3_PROTOCOL', `Program ${name} has an inconsistent identity.`);
    validateCertificate(manifest.schema, program.ir, program.certificate);
  }
  return manifest;
}

export function queryKey(op: string, args: Args): string { return sha256(canonicalJson([op, args])); }

export function taggedArgs(manifest: Manifest, op: string, args: Args): Record<string, Value> {
  const definition = manifest.programs[op];
  if (!definition) throw new SnapbackError('S3_OPERATION_UNKNOWN', `There is no operation named ${op}.`);
  const failure = (path: string, detail: string): never => { throw new SnapbackError('S3_ARGS', `${path}: ${detail}`); };
  const expected = Object.keys(definition.ir.args).sort();
  for (const name of Object.keys(args)) if (!Object.hasOwn(definition.ir.args, name)) failure(`${op}.${name}`, 'unknown argument');
  const tagged = Object.fromEntries(expected.map(name => {
    const descriptor = definition.ir.args[name];
    if (!Object.hasOwn(args, name)) {
      if (descriptor && typeof descriptor === 'object' && 'Optional' in descriptor) return [name, 'Null' as Value];
      failure(`${op}.${name}`, 'required argument is missing');
    }
    return [name, valueFromWire(descriptor, args[name], `${op}.${name}`, failure, manifest.schema)];
  }));
  validateInputs(manifest.schema, definition.ir, tagged);
  return tagged;
}

type Acquisition = { key: string; op: string; args: Args; envelope: DeliveryEnvelopeV1 };

// @ref LLP 2000#composed-reads — evidence is owned per query while all resources
// evaluate against one authorized pool. A partial sibling confers no completeness.
export class FactPool {
  private store: ClientStore;
  private owners = new Map<string, Acquisition>();
  private currentSeq = -1;
  constructor(readonly manifest: Manifest, readonly session: Session) {
    this.store = new ClientStore(manifest.schema);
  }
  get seq(): number { return this.currentSeq; }
  envelope(key: string): DeliveryEnvelopeV1 | undefined { return this.owners.get(key)?.envelope; }
  clear(): void { this.store = new ClientStore(this.manifest.schema); this.owners.clear(); this.currentSeq = -1; }

  advance(seq: number): FramePatch | null {
    const staged = this.prepare([], seq);
    return staged?.commit() ? staged.patch : null;
  }

  /** Useful for restoring an already durable frame. Live callers must persist
   * prepare().patch before invoking its commit closure. */
  admit(acquisitions: Acquisition[]): FramePatch | null {
    if (!acquisitions.length) return null;
    const staged = this.prepare(acquisitions, acquisitions[0]!.envelope.seq);
    return staged?.commit() ? staged.patch : null;
  }

  /** Stage only the incoming batch, never clone the existing row pool. No new
   * row or evidence becomes visible until the caller's durable write succeeds. */
  prepare(acquisitions: Acquisition[], seq: number): { patch: FramePatch; commit(): boolean } | null {
    if (seq < this.currentSeq) return null;
    const decoded = acquisitions.map(item => {
      const envelope = ownDeliveryEnvelope(item.envelope);
      const program = this.manifest.programs[item.op];
      if (!program || envelope.generation !== this.manifest.generation || envelope.schemaHash !== this.manifest.schemaHash
        || envelope.planHash !== program.planHash || envelope.authority.principal !== this.session.principal.id
        || envelope.authority.authEpoch !== this.session.authEpoch)
        throw new SnapbackError('S3_AUTHORITY_CHANGED', 'A response belongs to another program or account.');
      if (envelope.seq !== seq) throw new SnapbackError('S3_PROTOCOL', 'A read batch contains multiple snapshots.');
      return { ...item, envelope, prepared: prepareClosureReceipt(envelope, this.manifest.schema, program.ir) };
    });
    const rows = new Map<string, typeof decoded[number]['prepared']['rows'][number]>();
    const equal = (left: Value, right: Value): boolean => canonicalJson(wireJson(left)) === canonicalJson(wireJson(right));
    for (const item of decoded) if (!item.envelope.connected) for (const row of item.prepared.rows) {
      const key = rowKey(row), previous = rows.get(key)?.row;
      if (previous && !equal(previous, row.row)) throw new SnapbackError('S3_PROTOCOL', 'Rows disagree within one server snapshot.');
      rows.set(key, row);
    }
    const checkCurrentRows = () => {
      if (seq !== this.currentSeq) return;
      for (const row of rows.values()) {
        const previous = this.store.byId(row.table, row.id);
        if (previous && !equal(previous, row.row)) throw new SnapbackError('S3_PROTOCOL', 'Rows disagree within one server snapshot.');
      }
    };
    checkCurrentRows();
    const resources: StoredResource[] = [];
    const persistedRows = new Map<string, DeliveryEnvelopeV1['rows'][number]>();
    for (const item of decoded) {
      if (item.envelope.connected) continue;
      const { rows: wireRows, ...envelope } = item.envelope;
      resources.push({ key: item.key, op: item.op, args: item.args, rowKeys: wireRows.map(rowKey), envelope });
      for (const row of wireRows) persistedRows.set(rowKey(row), row);
    }
    const patch: FramePatch = { seq, generation: this.manifest.generation, schemaHash: this.manifest.schemaHash,
      principal: this.session.principal.id, authEpoch: this.session.authEpoch,
      rows: [...persistedRows.values()], resources };
    return { patch, commit: () => {
      if (seq < this.currentSeq) return false;
      checkCurrentRows();
      if (seq > this.currentSeq) { this.clear(); this.currentSeq = seq; }
      for (const row of rows.values()) this.store.put(row.table, row.row);
      for (const item of decoded) if (!item.envelope.connected) {
        this.store.setReceipt(item.key, item.prepared, this.manifest.programs[item.op]!.ir);
        this.owners.set(item.key, item);
      }
      return true;
    } };
  }

  restore(frame: FramePatch): void {
    if (frame.principal !== this.session.principal.id || frame.authEpoch !== this.session.authEpoch
      || frame.generation !== this.manifest.generation || frame.schemaHash !== this.manifest.schemaHash) return;
    const rows = new Map(frame.rows.map(row => [rowKey(row), row]));
    this.admit(frame.resources.map(resource => ({ ...resource, envelope: { ...resource.envelope,
      rows: resource.rowKeys.map(key => {
        const row = rows.get(key);
        if (!row) throw new SnapbackError('S3_STORAGE', 'A cached resource has a missing row.');
        return row;
      }) } })));
  }

  read<T>(op: string, args: Args): ResourceSnapshot<T> | undefined {
    const owned = this.owners.get(queryKey(op, args));
    if (owned) return snapshot<T>(owned.envelope, false);
    const program = this.manifest.programs[op];
    if (!program || program.kind.toLowerCase() !== 'query' || this.currentSeq < 0
      || program.ir.read_time_granularity_ms != null) return;
    try {
      const context: Context = { viewer: this.session.principal.id, principal_kind: this.session.principal.kind,
        auth_epoch: this.session.authEpoch, args: taggedArgs(this.manifest, op, args),
        now: null, new_ids: [], read_time: null };
      const local = this.store.reexecute(program.ir, context, program.certificate);
      if (local.state !== 'fresh') return;
      return Object.freeze({ data: ownJson(wireJson(local.execution.result)) as T,
        status: 'ready', complete: queryState(program.certificate, local.execution.trace, context.viewer) === 'complete',
        fresh: false, next: local.execution.next, seq: this.currentSeq });
    } catch {
      // A failed local proof is unavailable knowledge. It is never an empty
      // collection, zero count, or authoritative application refusal.
      return;
    }
  }
}

export function snapshot<T>(envelope: DeliveryEnvelopeV1, fresh: boolean): ResourceSnapshot<T> {
  if (envelope.state === 'denied') return Object.freeze({ data: undefined, status: 'denied', complete: false,
    fresh, seq: envelope.seq, error: new SnapbackError(envelope.rule ?? 'S3_DENIED', 'This resource is unavailable to this account.') });
  const unavailable = envelope.state === 'partial' && envelope.data === null;
  return Object.freeze({ data: unavailable ? undefined : ownJson(expandRows(envelope)) as T,
    status: unavailable ? 'loading' : 'ready', complete: envelope.state === 'complete', fresh,
    next: envelope.next, seq: envelope.seq });
}
