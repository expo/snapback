import assert from 'node:assert/strict';
import {mkdir, rename, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {createExternalSessionClient} from '@expo/snapback-client';

import {
  LARGE_FIXTURE_ID,
  MANIFEST_ID,
  canonicalJson,
  readAndVerifyOverlay,
  readCsvTable,
  taggedDigest,
  verifyLargeFixtureShards,
  type JsonValue,
  type LargeOverlayEnvelope,
} from './build-large-overlay.mts';
import {mintDevSession} from './load-fixture.mts';

type SourceRow = Record<string, JsonValue>;
type RuntimeRow = Record<string, JsonValue>;

const CONTROL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = resolve(CONTROL_ROOT, '../../..');
const DEFAULT_RECEIPT = join(
  REPOSITORY_ROOT,
  'demos/zerobugs/manifest/large-seed42-v1.receipt.json',
);
const DEFAULT_OVERLAY = join(
  CONTROL_ROOT,
  '.snapback/large-fixture/large-overlay-v1.json',
);
const DEFAULT_READY = join(CONTROL_ROOT, '.snapback/dev.ready.json');
const DEFAULT_CHECKPOINT = join(
  CONTROL_ROOT,
  '.snapback/large-fixture/large-ingest.checkpoint.json',
);

export const MAX_LARGE_BATCH_ROWS = 900;
// Per-table row caps below the 900 ceiling. issueSearchDocument rows carry
// concatenated title/description/comment text, and the seam echoes committed
// rows back through a v.json() result whose generated contract is bounded at
// 1 MiB; a 900-row echo measured over that ceiling while 500 rows measure
// ~630 KiB against the frozen overlay. The handler's largeFixturePlan()
// carries the same cap — the two declarations must stay in lockstep.
export const LARGE_BATCH_ROW_CAPS: Partial<Record<string, number>> = {
  issueSearchDocument: 500,
};
export function largeBatchRowCap(table: string): number {
  return LARGE_BATCH_ROW_CAPS[table] ?? MAX_LARGE_BATCH_ROWS;
}
export const LARGE_LOAD_ORDER = [
  'user',
  'project',
  'label',
  'issue',
  'issueLabel',
  'comment',
  'emoji',
  'viewState',
  'userPref',
  'issueNotifications',
  'projectUserRead',
  'issueListRead',
  'issueLabelRead',
  'issueSearchDocument',
  'searchEpoch',
] as const;
export type LargeTableName = (typeof LARGE_LOAD_ORDER)[number];

const GENERATED_TABLES = new Set<LargeTableName>([
  'user', 'project', 'label', 'issue', 'issueLabel', 'comment',
]);
const OVERLAY_SOURCE_TABLES = new Set<LargeTableName>([
  'issue', 'comment', 'emoji', 'viewState', 'userPref', 'issueNotifications',
]);
const PROJECTION_TABLES = new Set<LargeTableName>([
  'projectUserRead', 'issueListRead', 'issueLabelRead',
  'issueSearchDocument', 'searchEpoch',
]);

const TARGET_BY_REFERENCE: Partial<Record<LargeTableName, Record<string, LargeTableName>>> = {
  label: {projectID: 'project'},
  issue: {projectID: 'project', creatorID: 'user', assigneeID: 'user'},
  issueLabel: {labelID: 'label', issueID: 'issue', projectID: 'project'},
  comment: {issueID: 'issue', creatorID: 'user'},
  emoji: {creatorID: 'user'},
  viewState: {issueID: 'issue', userID: 'user'},
  userPref: {userID: 'user'},
  issueNotifications: {userID: 'user', issueID: 'issue'},
  projectUserRead: {projectID: 'project', userID: 'user'},
  issueListRead: {
    issueID: 'issue', projectID: 'project', creatorID: 'user', assigneeID: 'user',
  },
  issueLabelRead: {projectID: 'project', issueID: 'issue', labelID: 'label'},
  issueSearchDocument: {issueID: 'issue', projectID: 'project'},
  searchEpoch: {projectID: 'project'},
};

export interface LargeBatchMath {
  rowsByTable: Record<LargeTableName, number>;
  batchesByTable: Record<LargeTableName, number>;
  totalRows: number;
  totalBatches: number;
}

export interface LargeIngestSeamAudit {
  compatible: boolean;
  requiredProtocol: string;
  blockers: Array<{id: string; owner: string; detail: string}>;
}

interface IngestBatch {
  batchIndex: number;
  table: LargeTableName;
  rows: SourceRow[];
  rowCount: number;
}

interface Checkpoint {
  schemaVersion: 'zerobugs-large-ingest-checkpoint.v1';
  fixtureId: string;
  overlayDigest: string;
  lastVerifiedBatchIndex: number;
  verifiedRows: number;
  batches: number;
}

function fail(message: string): never {
  throw new Error(`ZBUGS_LARGE_FIXTURE_LOAD_FAILED: ${message}`);
}

function gap(message: string, audit?: LargeIngestSeamAudit): never {
  const error = new Error(`ZBUGS_LARGE_INGEST_SEAM_GAP: ${message}`);
  Object.assign(error, {code: 'ZBUGS_LARGE_INGEST_SEAM_GAP', audit});
  throw error;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredString(value: JsonValue | undefined, location: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${location} is required`);
  return value;
}

function sourceIdentity(table: LargeTableName, row: SourceRow): string {
  if (typeof row._id === 'string') return row._id;
  if (typeof row.id === 'string') return row.id;
  if (table === 'issueLabel' || table === 'issueLabelRead') {
    return `${requiredString(row.labelID, `${table}.labelID`)}\0${requiredString(row.issueID, `${table}.issueID`)}`;
  }
  if (table === 'viewState' || table === 'issueNotifications') {
    return `${requiredString(row.userID, `${table}.userID`)}\0${requiredString(row.issueID, `${table}.issueID`)}`;
  }
  if (table === 'userPref') {
    return `${requiredString(row.userID, 'userPref.userID')}\0${requiredString(row.key, 'userPref.key')}`;
  }
  if (table === 'projectUserRead') {
    return `${requiredString(row.projectID, 'projectUserRead.projectID')}\0${requiredString(row.userID, 'projectUserRead.userID')}`;
  }
  if (table === 'searchEpoch') {
    return `${requiredString(row.projectID, 'searchEpoch.projectID')}\0${requiredString(row.visibility, 'searchEpoch.visibility')}`;
  }
  fail(`${table} row has no deterministic source identity`);
}

function integer(value: string, location: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(`${location} is not a safe integer`);
  return parsed;
}

function numberValue(value: string, location: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${location} is not finite`);
  return parsed;
}

function booleanValue(value: string, location: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(`${location} must be true or false`);
}

function csvSourceRow(table: LargeTableName, row: Record<string, string>): SourceRow {
  if (table === 'user') {
    return {
      id: row.id,
      login: row.login,
      ...(row.name ? {name: row.name} : {}),
      avatar: row.avatar,
      role: row.role,
      githubID: integer(row.githubID, `user ${row.id}.githubID`),
      ...(row.email ? {email: row.email} : {}),
    };
  }
  if (table === 'project') {
    return {
      id: row.id,
      name: row.name,
      lowerCaseName: row.lowerCaseName,
      supportsSearch: true,
    };
  }
  if (table === 'label') return {id: row.id, name: row.name, projectID: row.projectID};
  if (table === 'issue') {
    return {
      id: row.id,
      title: row.title,
      open: booleanValue(row.open, `issue ${row.id}.open`),
      modified: numberValue(row.modified, `issue ${row.id}.modified`),
      created: numberValue(row.created, `issue ${row.id}.created`),
      creatorID: row.creatorID,
      ...(row.assigneeID ? {assigneeID: row.assigneeID} : {}),
      description: row.description,
      visibility: row.visibility,
      projectID: row.projectID,
    };
  }
  if (table === 'comment') {
    return {
      id: row.id,
      issueID: row.issueID,
      created: numberValue(row.created, `comment ${row.id}.created`),
      body: row.body,
      creatorID: row.creatorID,
    };
  }
  if (table === 'issueLabel') {
    return {labelID: row.labelID, issueID: row.issueID, projectID: row.projectID};
  }
  fail(`cannot compile CSV row for ${table}`);
}

function rowCounts(envelope: LargeOverlayEnvelope, receiptCounts: Record<string, number>): Record<LargeTableName, number> {
  const rows = envelope.payload.rows;
  const projections = envelope.payload.projections;
  return {
    user: receiptCounts.user,
    project: receiptCounts.project,
    label: receiptCounts.label,
    issue: receiptCounts.issue + rows.issue.length,
    issueLabel: receiptCounts.issueLabel,
    comment: receiptCounts.comment + rows.comment.length,
    emoji: rows.emoji.length,
    viewState: rows.viewState.length,
    userPref: rows.userPref.length,
    issueNotifications: rows.issueNotifications.length,
    projectUserRead: projections.projectUserRead.length,
    issueListRead: projections.issueListRead.length,
    issueLabelRead: projections.issueLabelRead.length,
    issueSearchDocument: projections.issueSearchDocument.length,
    searchEpoch: projections.searchEpoch.length,
  };
}

export function largeBatchMath(
  envelope: LargeOverlayEnvelope,
  receiptCounts: Record<string, number>,
): LargeBatchMath {
  const rowsByTable = rowCounts(envelope, receiptCounts);
  const batchesByTable = Object.fromEntries(LARGE_LOAD_ORDER.map(table => [
    table,
    Math.ceil(rowsByTable[table] / largeBatchRowCap(table)),
  ])) as Record<LargeTableName, number>;
  return {
    rowsByTable,
    batchesByTable,
    totalRows: Object.values(rowsByTable).reduce((sum, count) => sum + count, 0),
    totalBatches: Object.values(batchesByTable).reduce((sum, count) => sum + count, 0),
  };
}

export async function auditLargeIngestSeam(): Promise<LargeIngestSeamAudit> {
  const argsPath = join(
    CONTROL_ROOT,
    'snapback/generated/operations/fixtureIngestBatch.args.schema.json',
  );
  const functionsPath = join(CONTROL_ROOT, 'snapback/functions.mjs');
  const apiPath = join(CONTROL_ROOT, 'snapback/generated/api.mjs');
  const [argsSchema, source, apiSource] = await Promise.all([
    readFile(argsPath, 'utf8').then((text: string) => JSON.parse(text) as {properties?: Record<string, unknown>}),
    readFile(functionsPath, 'utf8'),
    readFile(apiPath, 'utf8'),
  ]);
  const properties = new Set(Object.keys(argsSchema.properties ?? {}));
  const blockers: LargeIngestSeamAudit['blockers'] = [];
  for (const field of ['fixtureId', 'overlayDigest', 'batchIndex', 'rowCount', 'batchDigest']) {
    if (!properties.has(field)) blockers.push({
      id: `ingest-args-${field}`,
      owner: 'control acceptance-ingest seam',
      detail: `fixtureIngestBatch has no ${field} argument, so a committed batch cannot be idempotently recognized after a crash.`,
    });
  }
  if (!apiSource.includes('fixtureIngestSummary')) blockers.push({
    id: 'ingest-summary-missing',
    owner: 'control acceptance-ingest seam',
    detail: 'No fixtureIngestSummary operation can reconcile committed per-table row counts and batch digests.',
  });
  if (!source.includes("status: 'inserted'") || !source.includes("status: 'already-ingested'")) blockers.push({
    id: 'ingest-idempotent-receipt-missing',
    owner: 'control acceptance-ingest seam',
      detail: 'The mutation returns only inserted/ids and cannot distinguish a new commit from a verified replay.',
  });
  if (
    !source.includes("fixtureId: 'large-seed42-v1'")
    || !source.includes('totalRows: 5_549_113')
    || !source.includes('totalBatches: 6_176')
    || !source.includes("return index < 10 ? 'crew' : 'user'")
  ) blockers.push({
    id: 'ingest-large-user-contract-missing',
    owner: 'control acceptance-ingest seam',
    detail: 'The additive receipt-bound 100-user/6,176-batch large contract is absent or stale.',
  });
  if (
    !source.includes(".withIndex('by_fixture_overlay_batch')")
    || !source.includes(".gt('batchIndex', afterBatch)")
    || !source.includes('.take(64)')
  ) blockers.push({
    id: 'ingest-summary-not-full',
    owner: 'control acceptance-ingest seam',
    detail: 'The summary does not page through the complete batch ledger.',
  });
  if (
    !source.includes('if (!metadata)')
    || !source.includes('return {inserted: args.rows.length, ids}')
    || !source.includes('users.length > 14')
    || !source.includes('users.length !== 14')
  ) blockers.push({
    id: 'ingest-normal-contract-not-preserved',
    owner: 'control acceptance-ingest seam',
    detail: 'The frozen normal two-argument ingest path or exact 14-user gates are not visibly preserved.',
  });
  return {
    compatible: blockers.length === 0,
    requiredProtocol: 'zerobugs-large-ingest.v1: one atomic ledger row per deterministic batch; same-digest replay returns status=already-ingested plus aligned ids/rows; final summary reconciles every table; searchEpoch is last',
    blockers,
  };
}

async function* tableSourceRows(
  table: LargeTableName,
  shardsByTable: Record<string, string[]>,
  overlay: LargeOverlayEnvelope,
): AsyncGenerator<SourceRow> {
  if (GENERATED_TABLES.has(table)) {
    for await (const row of readCsvTable(shardsByTable[table], table as never)) {
      yield csvSourceRow(table, row);
    }
  }
  if (OVERLAY_SOURCE_TABLES.has(table)) {
    for (const row of overlay.payload.rows[table] ?? []) yield row;
  }
  if (PROJECTION_TABLES.has(table)) {
    for (const row of overlay.payload.projections[table] ?? []) yield row;
  }
}

async function* fixtureBatches(
  shardsByTable: Record<string, string[]>,
  overlay: LargeOverlayEnvelope,
): AsyncGenerator<IngestBatch> {
  let batchIndex = 0;
  for (const table of LARGE_LOAD_ORDER) {
    const rowCap = largeBatchRowCap(table);
    let rows: SourceRow[] = [];
    for await (const row of tableSourceRows(table, shardsByTable, overlay)) {
      rows.push(row);
      if (rows.length === rowCap) {
        yield {
          batchIndex,
          table,
          rows,
          rowCount: rows.length,
        };
        batchIndex += 1;
        rows = [];
      }
    }
    if (rows.length > 0) {
      yield {
        batchIndex,
        table,
        rows,
        rowCount: rows.length,
      };
      batchIndex += 1;
    }
  }
}

function prepareRuntimeRows(
  table: LargeTableName,
  rows: readonly SourceRow[],
  sourceToRuntime: Record<LargeTableName, Map<string, string>>,
): RuntimeRow[] {
  return rows.map(row => {
    const prepared: RuntimeRow = {};
    for (const [field, value] of Object.entries(row)) {
      if (field === '_id') continue;
      const target = TARGET_BY_REFERENCE[table]?.[field];
      if (target && typeof value === 'string') {
        // `emoji.subjectID` is polymorphic and handled after the ordinary map.
        const runtime = sourceToRuntime[target].get(value);
        if (!runtime) fail(`${table}.${field} references unloaded ${target} source id ${value}`);
        prepared[field] = runtime;
      } else {
        prepared[field] = value;
      }
    }
    if (table === 'emoji') {
      const subject = requiredString(row.subjectID, 'emoji.subjectID');
      const runtime = sourceToRuntime.issue.get(subject) ?? sourceToRuntime.comment.get(subject);
      if (!runtime) fail(`emoji.subjectID references unloaded issue/comment source id ${subject}`);
      prepared.subjectID = runtime;
    }
    return prepared;
  });
}

function normalizeReturnedRows(
  table: LargeTableName,
  returned: readonly RuntimeRow[],
  runtimeToSource: Record<LargeTableName, Map<string, string>>,
): SourceRow[] {
  return returned.map(row => {
    const runtimeID = requiredString(row._id, `${table} returned _id`);
    const identity = runtimeToSource[table].get(runtimeID);
    if (!identity) fail(`${table} returned unknown runtime id ${runtimeID}`);
    const normalized: SourceRow = {_id: identity};
    for (const [field, value] of Object.entries(row)) {
      if (field === '_id' || field === '_version' || field === '_createdAt' || field === '_updatedAt') continue;
      if (value === null) continue;
      const target = TARGET_BY_REFERENCE[table]?.[field];
      if (target && typeof value === 'string') {
        const source = runtimeToSource[target].get(value);
        if (!source) fail(`${table}.${field} returned unknown ${target} runtime id ${value}`);
        normalized[field] = source;
      } else if (table === 'emoji' && field === 'subjectID' && typeof value === 'string') {
        const source = runtimeToSource.issue.get(value) ?? runtimeToSource.comment.get(value);
        if (!source) fail(`emoji.subjectID returned unknown issue/comment runtime id ${value}`);
        normalized[field] = source;
      } else {
        normalized[field] = value;
      }
    }
    return normalized;
  });
}

function comparableSourceRow(table: LargeTableName, row: SourceRow): SourceRow {
  return {_id: sourceIdentity(table, row), ...Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== '_id'),
  )};
}

async function writeCheckpoint(path: string, checkpoint: Checkpoint): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await mkdir(dirname(path), {recursive: true});
  await writeFile(temporary, `${canonicalJson(checkpoint as unknown as JsonValue)}\n`, {mode: 0o600});
  await rename(temporary, path);
}

function newMaps(): Record<LargeTableName, Map<string, string>> {
  return Object.fromEntries(LARGE_LOAD_ORDER.map(table => [table, new Map<string, string>()])) as Record<
    LargeTableName,
    Map<string, string>
  >;
}

export async function loadLargeFixture(options: {
  fixtureRoot: string;
  receiptPath?: string;
  overlayPath?: string;
  readyFile?: string;
  checkpointPath?: string;
  progressEvery?: number;
}): Promise<Record<string, JsonValue>> {
  const receiptPath = resolve(options.receiptPath ?? DEFAULT_RECEIPT);
  const overlayPath = resolve(options.overlayPath ?? DEFAULT_OVERLAY);
  const verified = await verifyLargeFixtureShards(resolve(options.fixtureRoot), receiptPath);
  const overlay = await readAndVerifyOverlay(overlayPath);
  if (overlay.payload.profileMode !== 'authoritative-large') {
    fail('synthetic stand-in overlays cannot be ingested as large-seed42-v1');
  }
  if (
    overlay.payload.fixtureId !== LARGE_FIXTURE_ID
    || overlay.payload.manifestId !== MANIFEST_ID
    || overlay.payload.sourceReceiptDigest !== verified.receiptDigest
    || overlay.payload.sourceOverallDigest !== verified.receipt.overallDigest
  ) fail('overlay identity does not match the verified large fixture receipt');

  // This check is intentionally before session mint and before the first
  // mutation. The current normal-fixture seam cannot leave a partially loaded
  // million-row database and call that a resumable attempt.
  const audit = await auditLargeIngestSeam();
  if (!audit.compatible) {
    gap(
      `${audit.blockers.length} incompatible acceptance-ingest conditions; no server mutation attempted`,
      audit,
    );
  }

  const math = largeBatchMath(overlay, verified.receipt.counts);
  const progressEvery = options.progressEvery ?? Number(process.env.ZBUGS_LARGE_PROGRESS_EVERY ?? 50);
  if (!Number.isSafeInteger(progressEvery) || progressEvery <= 0) fail('progressEvery must be positive');
  const checkpointPath = resolve(options.checkpointPath ?? DEFAULT_CHECKPOINT);
  const readyFile = resolve(options.readyFile ?? DEFAULT_READY);
  const session = await mintDevSession(readyFile);
  const client = createExternalSessionClient(session.baseUrl, {
    bearerToken: session.token,
    clientStoreId: 'zerobugs-large-fixture-loader',
    rqsStore: null,
  });
  const generatedApiPath = join(CONTROL_ROOT, 'snapback/generated/api.mjs');
  const {default: api} = await import(pathToFileURL(generatedApiPath).href);
  if (!api.fixtureIngestBatch || !api.fixtureIngestSummary) {
    gap('generated API lost a seam that passed the source preflight');
  }

  const sourceToRuntime = newMaps();
  const runtimeToSource = newMaps();
  const observedCounts = Object.fromEntries(LARGE_LOAD_ORDER.map(table => [table, 0])) as Record<LargeTableName, number>;
  let verifiedRows = 0;
  let verifiedBatches = 0;
  let insertedBatches = 0;
  let replayedBatches = 0;
  const started = performance.now();
  try {
    for await (const batch of fixtureBatches(verified.shardsByTable, overlay)) {
      const prepared = prepareRuntimeRows(batch.table, batch.rows, sourceToRuntime);
      const batchDigest = taggedDigest({
        fixtureId: LARGE_FIXTURE_ID,
        overlayDigest: overlay.contentDigest,
        batchIndex: batch.batchIndex,
        table: batch.table,
        rows: prepared,
      });
      const response = await client.mutate(api.fixtureIngestBatch, {
        args: {
          fixtureId: LARGE_FIXTURE_ID,
          overlayDigest: overlay.contentDigest,
          batchIndex: batch.batchIndex,
          table: batch.table,
          rowCount: batch.rowCount,
          batchDigest,
          rows: prepared,
        },
      });
      const result = response.result as {
        status?: string;
        fixtureId?: string;
        overlayDigest?: string;
        batchIndex?: number;
        table?: string;
        rowCount?: number;
        batchDigest?: string;
        ids?: unknown[];
        rows?: unknown[];
      };
      if (
        (result.status !== 'inserted' && result.status !== 'already-ingested')
        || result.fixtureId !== LARGE_FIXTURE_ID
        || result.overlayDigest !== overlay.contentDigest
        || result.batchIndex !== batch.batchIndex
        || result.table !== batch.table
        || result.rowCount !== batch.rowCount
        || result.batchDigest !== batchDigest
        || !Array.isArray(result.ids)
        || result.ids.length !== batch.rowCount
        || result.ids.some(id => typeof id !== 'string')
        || !Array.isArray(result.rows)
        || result.rows.length !== batch.rowCount
      ) fail(`batch ${batch.batchIndex} returned an invalid atomic ingest receipt`);

      for (let index = 0; index < batch.rows.length; index += 1) {
        const identity = sourceIdentity(batch.table, batch.rows[index]);
        const runtimeID = result.ids[index] as string;
        const previousRuntime = sourceToRuntime[batch.table].get(identity);
        const previousSource = runtimeToSource[batch.table].get(runtimeID);
        if (previousRuntime && previousRuntime !== runtimeID) {
          fail(`${batch.table} source identity ${identity} remapped across a replay`);
        }
        if (previousSource && previousSource !== identity) {
          fail(`${batch.table} runtime id ${runtimeID} maps to two source identities`);
        }
        sourceToRuntime[batch.table].set(identity, runtimeID);
        runtimeToSource[batch.table].set(runtimeID, identity);
      }
      const normalized = normalizeReturnedRows(
        batch.table,
        result.rows as RuntimeRow[],
        runtimeToSource,
      );
      const expected = batch.rows.map(row => comparableSourceRow(batch.table, row));
      if (canonicalJson(normalized) !== canonicalJson(expected)) {
        fail(`batch ${batch.batchIndex} row mismatch after inverse remap`);
      }
      observedCounts[batch.table] += batch.rowCount;
      verifiedRows += batch.rowCount;
      verifiedBatches += 1;
      if (result.status === 'inserted') insertedBatches += 1;
      else replayedBatches += 1;
      if (verifiedBatches % progressEvery === 0 || verifiedBatches === math.totalBatches) {
        // The server ledger is the exactly-once authority. This ignored local
        // carrier is only a progress hint, so checkpoint at the same bounded
        // cadence as output instead of adding one fsync/rename per commit.
        await writeCheckpoint(checkpointPath, {
          schemaVersion: 'zerobugs-large-ingest-checkpoint.v1',
          fixtureId: LARGE_FIXTURE_ID,
          overlayDigest: overlay.contentDigest,
          lastVerifiedBatchIndex: batch.batchIndex,
          verifiedRows,
          batches: verifiedBatches,
        });
        process.stdout.write(`${JSON.stringify({
          status: 'progress',
          batch: verifiedBatches,
          batches: math.totalBatches,
          rows: verifiedRows,
          table: batch.table,
          replay: result.status === 'already-ingested',
          insertedBatches,
          replayedBatches,
          elapsedMs: Math.round(performance.now() - started),
        })}\n`);
      }
    }
    assert.equal(verifiedBatches, math.totalBatches, 'exact deterministic batch count');
    assert.equal(verifiedRows, math.totalRows, 'exact deterministic row count');
    assert.deepEqual(observedCounts, math.rowsByTable, 'per-table row counts');
    const summaryResponse = await client.query(api.fixtureIngestSummary, {
      args: {fixtureId: LARGE_FIXTURE_ID, overlayDigest: overlay.contentDigest},
    });
    const summaryEnvelope = summaryResponse as unknown as {
      rows?: Array<Record<string, JsonValue>>;
      result?: Record<string, JsonValue>;
    };
    const summary = summaryEnvelope.rows?.[0]
      ?? summaryEnvelope.result
      ?? summaryResponse as unknown as Record<string, JsonValue>;
    if (
      summary.fixtureId !== LARGE_FIXTURE_ID
      || summary.overlayDigest !== overlay.contentDigest
      || summary.batches !== math.totalBatches
      || summary.rows !== math.totalRows
      || canonicalJson(summary.rowsByTable) !== canonicalJson(math.rowsByTable)
      || summary.completed !== true
      || summary.finalTable !== 'searchEpoch'
    ) fail('final server ingest summary does not reconcile the deterministic plan');
    return {
      status: 'ok',
      fixtureId: LARGE_FIXTURE_ID,
      overlayDigest: overlay.contentDigest,
      baseDigest: verified.receipt.overallDigest,
      principal: `sha256:${taggedDigest(session.principal).slice('sha256:'.length)}`,
      rows: verifiedRows,
      batches: verifiedBatches,
      insertedBatches,
      replayedBatches,
      rowsByTable: observedCounts,
      elapsedMs: Math.round(performance.now() - started),
      checkpoint: 'local ignored .snapback carrier; server ledger is authoritative',
    };
  } finally {
    await client.closeAuth();
  }
}

function parseArguments(argv: readonly string[]): {
  fixtureRoot: string;
  receiptPath?: string;
  overlayPath?: string;
  readyFile?: string;
  checkpointPath?: string;
  progressEvery?: number;
  preflightOnly: boolean;
} {
  const values = new Map<string, string>();
  let preflightOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--preflight-only') {
      preflightOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (!name.startsWith('--') || !value || value.startsWith('--')) fail(`${name} requires a value`);
    values.set(name, value);
    index += 1;
  }
  const fixtureRoot = values.get('--fixture-root') ?? process.env.ZBUGS_LARGE_FIXTURE_ROOT;
  if (!fixtureRoot) fail('ZBUGS_LARGE_FIXTURE_ROOT or --fixture-root is required');
  const progress = values.get('--progress-every');
  return {
    fixtureRoot,
    receiptPath: values.get('--receipt') ?? process.env.ZBUGS_LARGE_FIXTURE_RECEIPT,
    overlayPath: values.get('--overlay') ?? process.env.ZBUGS_LARGE_OVERLAY_PATH,
    readyFile: values.get('--ready-file') ?? process.env.SNAPBACK_READY_FILE,
    checkpointPath: values.get('--checkpoint') ?? process.env.ZBUGS_LARGE_CHECKPOINT,
    ...(progress ? {progressEvery: integer(progress, '--progress-every')} : {}),
    preflightOnly,
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const verified = await verifyLargeFixtureShards(
    resolve(options.fixtureRoot),
    resolve(options.receiptPath ?? DEFAULT_RECEIPT),
  );
  const overlay = await readAndVerifyOverlay(resolve(options.overlayPath ?? DEFAULT_OVERLAY));
  const math = largeBatchMath(overlay, verified.receipt.counts);
  const audit = await auditLargeIngestSeam();
  if (options.preflightOnly) {
    process.stdout.write(`${JSON.stringify({
      status: audit.compatible ? 'ok' : 'gap',
      fixtureId: verified.receipt.fixtureId,
      baseDigest: verified.receipt.overallDigest,
      overlayDigest: overlay.contentDigest,
      math,
      seam: audit,
      projectedWallClock: {
        at100msPerBatchMs: math.totalBatches * 100,
        at250msPerBatchMs: math.totalBatches * 250,
        at500msPerBatchMs: math.totalBatches * 500,
      },
    })}\n`);
    if (!audit.compatible) process.exitCode = 1;
    return;
  }
  const result = await loadLargeFixture(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.main) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
