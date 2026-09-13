import { referenceName, type Op } from '../api.js';
import { canonicalJson, wireJson } from '../../../evaluator/src/value-runtime.js';
import { sha256 } from '../../../evaluator/src/hash.js';
import { FactPool, queryKey, taggedArgs } from './facts.js';
import { expandRows, ownDeliveryEnvelope, type DeliveryEnvelopeV1 } from './protocol.js';
import { ownJson } from './signal.js';
import { SnapbackError, type AcquisitionDeclaration, type Args, type Manifest, type Session,
  type StoredAcquisition, type StoredAcquisitionResource, type StoredAcquisitionRow, type StoredState } from './types.js';

export interface PageChain<T = unknown> {
  readonly key: string;
  readonly op: string;
  readonly args: Readonly<Args>;
  readonly cursor?: string;
  readonly __result?: T;
}

export interface PageOptions<A> {
  /** Stable chain identity. The default is derived from the operation and initial arguments. */
  key?: string;
  /** Optional cursor argument. It is inferred when the program has exactly one. */
  cursor?: Extract<keyof A, string>;
}

export function pages<A, T extends readonly unknown[]>(operation: Op<A, T, any>, args: A, options?: PageOptions<A>): PageChain<T>;
export function pages<T = unknown>(operation: string, args?: Args, options?: PageOptions<Args>): PageChain<T>;
export function pages<T>(operation: string | Op<any, T, any>, input: Args = {}, options: PageOptions<any> = {}): PageChain<T> {
  const op = typeof operation === 'string' ? operation : referenceName(operation);
  const args = ownJson(input);
  return Object.freeze({ key: options.key ?? sha256(canonicalJson([op, args])), op, args,
    ...(options.cursor ? { cursor: options.cursor } : {}) });
}

export interface AcquisitionSpec<Root = unknown> {
  /** Stable application-owned dataset name. */
  id: string;
  /** Bump when the declaration or derivation code changes. */
  revision: string;
  /** The certified page query must return a list. Non-list composite pages are refused before storage admission. */
  root: PageChain<Root>;
  expand?: (root: Root) => readonly PageChain<unknown>[];
}

export function resolveChain(manifest: Manifest, page: PageChain): AcquisitionDeclaration {
  if (typeof page.key !== 'string' || !page.key || new TextEncoder().encode(page.key).length > 512)
    throw new SnapbackError('S3_ACQUISITION_DECLARATION', 'An acquisition chain key must be 1 through 512 UTF-8 bytes.');
  const program = manifest.programs[page.op];
  if (!program || program.kind.toLowerCase() !== 'query')
    throw new SnapbackError('S3_OPERATION_UNKNOWN', `${page.op} is not a query.`);
  if (program.ir.read_time_granularity_ms != null)
    throw new SnapbackError('S3_ACQUISITION_DECLARATION', `${page.op} is clock-sensitive and cannot form a durable offline dataset.`);
  const tagged = taggedArgs(manifest, page.op, page.args as Args);
  const args = ownJson(Object.fromEntries(Object.entries(tagged).map(([name, value]) => [name, wireJson(value)])));
  if (!program.certificate.result_pages || Object.keys(program.certificate.result_pages).length === 0)
    throw new SnapbackError('S3_ACQUISITION_DECLARATION', `${page.op} does not return a certified page.`);
  const cursors = Object.entries(program.ir.args).filter(([, value]) => value && typeof value === 'object'
    && !Array.isArray(value) && (value as any).Optional === 'Cursor').map(([name]) => name);
  const cursor = page.cursor ?? (cursors.length === 1 ? cursors[0] : undefined);
  if (!cursor || !cursors.includes(cursor))
    throw new SnapbackError('S3_ACQUISITION_DECLARATION', `${page.op} needs one explicit optional cursor argument.`);
  const value = args[cursor];
  if (value !== null && typeof value !== 'string')
    throw new SnapbackError('S3_ACQUISITION_DECLARATION', `${page.op}.${cursor} must be null or a cursor string.`);
  return ownJson({ key: page.key, op: page.op, args, cursor, follow: true });
}

export function declarationIdentity(id: string, revision: string, root: AcquisitionDeclaration): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || typeof revision !== 'string' || !revision || revision.length > 128)
    throw new SnapbackError('S3_ACQUISITION_DECLARATION', 'Acquisition id and revision must be stable nonempty identifiers.');
  return sha256(canonicalJson({ id, revision, root: { key: root.key, op: root.op, args: root.args, cursor: root.cursor } }));
}

export function resourceVersionKey(row: DeliveryEnvelopeV1['rows'][number]): string {
  return sha256(canonicalJson([row.table, row.id, row.row]));
}

// Freshly decoded rows already crossed the full delivery decoder. Restored
// rows cross this content-address check once per loaded object, then retain
// that custody while several resource chains walk the same shared version.
type StoredRowCustody = { owned: StoredAcquisitionRow; validated: boolean };
const ownedStoredRows = new WeakMap<object, StoredRowCustody>();
function ownStoredRow(stored: StoredAcquisitionRow): StoredAcquisitionRow {
  const held = ownedStoredRows.get(stored as object);
  if (held?.owned === stored) return stored;
  const owned = ownJson(stored);
  ownedStoredRows.set(owned as object, { owned, validated: false });
  return owned;
}
function checkedStoredRow(key: string, stored: StoredAcquisitionRow, manifest: Manifest): DeliveryEnvelopeV1['rows'][number] {
  let custody = ownedStoredRows.get(stored as object);
  if (!custody) {
    const owned = ownStoredRow(stored);
    custody = { owned, validated: false };
    ownedStoredRows.set(owned as object, custody);
  }
  const owned = custody.owned;
  const row = owned?.row;
  if (!row || typeof row.table !== 'string' || !row.table || !Object.hasOwn(manifest.schema.tables, row.table)
    || typeof row.id !== 'string' || !row.id || !row.row || typeof row.row !== 'object' || Array.isArray(row.row)
    || row.row.id !== row.id || owned.versionKey !== key)
    throw new SnapbackError('S3_STORAGE', 'An acquired row has an invalid table or row identity.');
  if (!custody.validated && resourceVersionKey(row) !== owned.versionKey)
      throw new SnapbackError('S3_STORAGE', 'An acquired row does not match its content-addressed version.');
  custody.validated = true;
  return row;
}

// Only resources owned by this module can key reusable decoded envelopes.
// Mutable adapter/caller objects are cloned into custody at the state boundary
// and are never themselves trusted as cache keys.
const ownedStoredResources = new WeakSet<object>();
function ownStoredResource(resource: StoredAcquisitionResource): StoredAcquisitionResource {
  if (ownedStoredResources.has(resource as object)) return resource;
  const owned = ownJson(resource);
  ownedStoredResources.add(owned as object);
  return owned;
}

type StoredEnvelopeCustody = {
  manifest: Manifest;
  schema: Manifest['schema'];
  generation: string;
  schemaHash: string;
  bindings: readonly StoredAcquisitionRow[];
  envelope: DeliveryEnvelopeV1;
};
const storedEnvelopes = new WeakMap<object, StoredEnvelopeCustody>();
function immutableManifestCustody(manifest: Manifest): boolean {
  return Object.isFrozen(manifest) && Object.isFrozen(manifest.schema)
    && Object.isFrozen(manifest.schema.tables) && Object.isFrozen(manifest.programs);
}

export function storedResource(acquisitionId: string, chainKey: string, op: string, args: Args,
  envelopeInput: DeliveryEnvelopeV1): { resource: StoredAcquisitionResource; rows: StoredAcquisitionRow[] } {
  const envelope = ownDeliveryEnvelope(envelopeInput);
  assertOfflineEnvelope(envelope);
  if (!Array.isArray(envelope.data))
    throw new SnapbackError('S3_ACQUISITION_DECLARATION', 'Acquisition page results must be lists so the SDK can compose every page without changing the declared result type.');
  const { rows, ...withoutRows } = envelope;
  const storedRows = rows.map(row => Object.freeze({ versionKey: resourceVersionKey(row), seq: envelope.seq, row }));
  for (const row of storedRows) ownedStoredRows.set(row, { owned: row, validated: true });
  const rowVersionKeys = storedRows.map(row => row.versionKey); Object.freeze(rowVersionKeys);
  const resource: StoredAcquisitionResource = Object.freeze({ acquisitionId, key: queryKey(op, args), chainKey, op,
    args: ownJson(args), rowVersionKeys, envelope: Object.freeze(withoutRows) });
  ownedStoredResources.add(resource);
  return {
    resource,
    rows: storedRows,
  };
}

export function envelopeFromStored(resource: StoredAcquisitionResource,
  rows: ReadonlyMap<string, StoredAcquisitionRow>, manifest: Manifest): DeliveryEnvelopeV1 {
  const bindings: StoredAcquisitionRow[] = [];
  for (const key of resource.rowVersionKeys) {
    const row = rows.get(key);
    if (!row) {
      // Preserve corruption precedence from the original single-pass rebuild:
      // an earlier dishonest binding wins over a later missing row.
      bindings.forEach((bound, index) => checkedStoredRow(resource.rowVersionKeys[index]!, bound, manifest));
      throw new SnapbackError('S3_STORAGE', 'An acquired resource has a missing row version.');
    }
    bindings.push(row);
  }
  const cached = storedEnvelopes.get(resource as object);
  if (cached && cached.manifest === manifest && cached.schema === manifest.schema
    && cached.generation === manifest.generation && cached.schemaHash === manifest.schemaHash
    && cached.bindings.length === bindings.length && cached.bindings.every((row, index) => row === bindings[index]))
    return cached.envelope;
  const envelope = ownDeliveryEnvelope({ ...resource.envelope, rows: bindings.map((row, index) =>
    checkedStoredRow(resource.rowVersionKeys[index]!, row, manifest)) });
  assertOfflineEnvelope(envelope);
  if (ownedStoredResources.has(resource as object) && immutableManifestCustody(manifest)
    && bindings.every(row => ownedStoredRows.get(row as object)?.owned === row)) {
    storedEnvelopes.set(resource as object, { manifest, schema: manifest.schema, generation: manifest.generation,
      schemaHash: manifest.schemaHash, bindings: Object.freeze([...bindings]), envelope });
  }
  return envelope;
}

function assertOfflineEnvelope(envelope: DeliveryEnvelopeV1): void {
  if (envelope.connected || envelope.readTime !== undefined)
    throw new SnapbackError('S3_ACQUISITION_INCOMPLETE', 'Connected or clock-sensitive pages cannot form a durable offline dataset.');
}

export function restoreAcquiredPool(manifest: Manifest, session: Session, acquisition: StoredAcquisition,
  allRows: readonly StoredAcquisitionRow[], allResources: readonly StoredAcquisitionResource[]): FactPool | undefined {
  if (acquisition.status !== 'ready' || acquisition.seq === undefined
    || acquisition.principal !== session.principal.id || acquisition.authEpoch !== session.authEpoch
    || acquisition.generation !== manifest.generation || acquisition.schemaHash !== manifest.schemaHash) return;
  const rows = new Map(allRows.map(input => {
    const row = ownStoredRow(input);
    return [row.versionKey, row] as const;
  }));
  const wanted = new Set(acquisition.resourceKeys);
  const resources = allResources.filter(resource => resource.acquisitionId === acquisition.id && wanted.has(resource.key))
    .map(ownStoredResource);
  if (resources.length !== wanted.size) throw new SnapbackError('S3_STORAGE', 'An acquired dataset has a missing resource.');
  const pool = new FactPool(manifest, session);
  pool.admit(resources.map(resource => ({ key: resource.key, op: resource.op, args: resource.args,
    envelope: envelopeFromStored(resource, rows, manifest) })));
  if (pool.seq !== acquisition.seq) throw new SnapbackError('S3_STORAGE', 'An acquired dataset has inconsistent sequence evidence.');
  return pool;
}

export function acquisitionState(state: StoredState, id: string): {
  acquisition?: StoredAcquisition;
  rows: Map<string, StoredAcquisitionRow>;
  resources: Map<string, StoredAcquisitionResource>;
} {
  const acquisition = state.acquisitions?.find(item => item.id === id);
  const wanted = new Set(acquisition?.resourceKeys ?? []);
  return { acquisition,
    rows: new Map((state.acquisitionRows ?? []).map(input => {
      const row = ownStoredRow(input);
      return [row.versionKey, row] as const;
    })),
    resources: new Map((state.acquisitionResources ?? []).filter(resource => resource.acquisitionId === id && wanted.has(resource.key))
      .map(input => {
        const resource = ownStoredResource(input);
        return [resource.key, resource] as const;
      })) };
}

export function chainValue<T>(chain: AcquisitionDeclaration, resources: ReadonlyMap<string, StoredAcquisitionResource>,
  rows: ReadonlyMap<string, StoredAcquisitionRow>, manifest: Manifest): T {
  const values: unknown[] = [];
  const seen = new Set<string>();
  let args = chain.args;
  for (;;) {
    const key = queryKey(chain.op, args);
    if (seen.has(key)) throw new SnapbackError('S3_PROTOCOL', 'An acquisition cursor repeated a page.');
    seen.add(key);
    const resource = resources.get(key);
    if (!resource || resource.chainKey !== chain.key) throw new SnapbackError('S3_ACQUISITION_INCOMPLETE', 'An acquisition chain is incomplete.');
    const envelope = envelopeFromStored(resource, rows, manifest);
    if (envelope.state === 'denied') throw new SnapbackError(envelope.rule ?? 'S3_FORBIDDEN', 'The acquired dataset is no longer authorized.');
    if (envelope.state === 'partial' || envelope.state === 'capped' && envelope.next === null)
      throw new SnapbackError('S3_ACQUISITION_INCOMPLETE', 'A page ended without complete acquisition evidence.');
    const value = expandRows(envelope);
    if (!Array.isArray(value))
      throw new SnapbackError('S3_ACQUISITION_DECLARATION', 'Acquisition page results must be lists so the SDK can compose every page without changing the declared result type.');
    values.push(...value);
    if (envelope.next === null) break;
    args = ownJson({ ...args, [chain.cursor]: envelope.next });
  }
  return values as T;
}

export function canonicalDeclarations(declarations: readonly AcquisitionDeclaration[]): string {
  return canonicalJson([...declarations].map(item => ({ key: item.key, op: item.op, args: item.args, cursor: item.cursor }))
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))));
}
