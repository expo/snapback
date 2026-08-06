import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {createExternalSessionClient} from '@expo/snapback-client';

type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {[key: string]: JsonValue};
export type FixtureRow = Record<string, JsonValue> & {_id: string};

export const SOURCE_TABLES = [
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
] as const;

export const SUPPORT_TABLES = [
  'identityBinding',
  'projectUserRead',
  'issueListRead',
  'issueLabelRead',
  'issueSearchDocument',
  'searchEpoch',
] as const;

export const LOAD_ORDER = [...SOURCE_TABLES, ...SUPPORT_TABLES] as const;
export const MAX_FIXTURE_BATCH_ROWS = 900;

export type TableName = (typeof LOAD_ORDER)[number];
export type FixtureTables = Record<TableName, FixtureRow[]>;

const CONTROL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_ROOT = join(CONTROL_ROOT, 'fixtures/normal-seed-v1');
const DIGEST_PATH = join(CONTROL_ROOT, 'tests/fixtures/fixture-digests.json');
const DEFAULT_READY_FILE = join(CONTROL_ROOT, '.snapback/dev.ready.json');
const DEFAULT_EMAIL = 'fixture-loader@zerobugs.acceptance.invalid';
const execFileAsync = promisify(execFile);

const REFERENCE_FIELDS: Record<TableName, readonly string[]> = {
  user: [],
  project: [],
  label: ['projectID'],
  issue: ['projectID', 'creatorID', 'assigneeID'],
  issueLabel: ['labelID', 'issueID', 'projectID'],
  comment: ['issueID', 'creatorID'],
  emoji: ['subjectID', 'creatorID'],
  viewState: ['issueID', 'userID'],
  userPref: ['userID'],
  issueNotifications: ['userID', 'issueID'],
  identityBinding: ['userID'],
  projectUserRead: ['projectID', 'userID'],
  issueListRead: ['issueID', 'projectID', 'creatorID', 'assigneeID'],
  issueLabelRead: ['projectID', 'issueID', 'labelID'],
  issueSearchDocument: ['issueID', 'projectID'],
  searchEpoch: ['projectID'],
};

function fail(message: string): never {
  throw new Error(`ZBUGS_FIXTURE_LOAD_FAILED: ${message}`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('canonical JSON received a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  }
  const members = Object.entries(value)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${members.join(',')}}`;
}

export function taggedDigest(value: JsonValue): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function rowIdentity(row: FixtureRow): string {
  return typeof row.id === 'string' ? row.id : row._id;
}

function sortedRows(rows: FixtureRow[]): FixtureRow[] {
  return [...rows].sort((left, right) => compareText(rowIdentity(left), rowIdentity(right)));
}

export function fixtureLoadPlan(
  tables: FixtureTables,
): Array<{table: TableName; rows: FixtureRow[]}> {
  const plan: Array<{table: TableName; rows: FixtureRow[]}> = [];
  for (const table of LOAD_ORDER) {
    const rows = tables[table];
    for (let offset = 0; offset < rows.length; offset += MAX_FIXTURE_BATCH_ROWS) {
      plan.push({table, rows: rows.slice(offset, offset + MAX_FIXTURE_BATCH_ROWS)});
    }
  }
  return plan;
}

export function prepareFixtureRows(
  table: TableName,
  rows: FixtureRow[],
  placeholderToActual: ReadonlyMap<string, string>,
): Array<Record<string, JsonValue>> {
  return rows.map(row => {
    const prepared: Record<string, JsonValue> = {};
    for (const [field, value] of Object.entries(row)) {
      if (field === '_id') continue;
      if (REFERENCE_FIELDS[table].includes(field) && typeof value === 'string') {
        const actual = placeholderToActual.get(value);
        if (!actual) fail(`${table}.${field} references unloaded fixture id ${value}`);
        prepared[field] = actual;
      } else {
        prepared[field] = value;
      }
    }
    return prepared;
  });
}

export function normalizeObservedRows(
  table: TableName,
  rows: Array<Record<string, JsonValue>>,
  actualToPlaceholder: ReadonlyMap<string, string>,
): FixtureRow[] {
  return sortedRows(rows.map(row => {
    const actualID = row._id;
    if (typeof actualID !== 'string') fail(`${table} query returned a row without _id`);
    const placeholder = actualToPlaceholder.get(actualID);
    if (!placeholder) fail(`${table} query returned unknown runtime id ${actualID}`);
    const normalized: Record<string, JsonValue> = {_id: placeholder};
    for (const [field, value] of Object.entries(row)) {
      if (field === '_id' || field === '_version' || field === '_createdAt' || field === '_updatedAt') {
        continue;
      }
      // Canonical form: unset optional fields are omitted. The runtime's query
      // surface returns them as explicit null and does not distinguish null
      // from absent, so nulls are dropped before digesting.
      if (value === null) {
        continue;
      }
      if (REFERENCE_FIELDS[table].includes(field) && typeof value === 'string') {
        const reference = actualToPlaceholder.get(value);
        if (!reference) fail(`${table}.${field} returned unknown runtime id ${value}`);
        normalized[field] = reference;
      } else {
        normalized[field] = value;
      }
    }
    return normalized as FixtureRow;
  }));
}

interface FixtureDigests {
  manifestDigests: Record<string, string>;
  actorBindings: Record<string, JsonValue>;
  tables: Record<TableName, {rowCount: number; contentDigest: string}>;
  overall: {rowCount: number; contentDigest: string};
}

export function verifyObservedFixture(
  observed: FixtureTables,
  expected: FixtureTables,
  digests: FixtureDigests,
): {counts: Record<TableName, number>; overallDigest: string} {
  const counts = {} as Record<TableName, number>;
  const observedTableDigests = {} as Record<
    TableName,
    {rowCount: number; contentDigest: string}
  >;
  for (const table of LOAD_ORDER) {
    const rows = sortedRows(observed[table]);
    const expectedRows = sortedRows(expected[table]);
    counts[table] = rows.length;
    const contentDigest = taggedDigest(rows);
    observedTableDigests[table] = {rowCount: rows.length, contentDigest};
    const contract = digests.tables[table];
    if (rows.length !== contract.rowCount || rows.length !== expectedRows.length) {
      fail(
        `${table} count mismatch: observed ${rows.length}, compiled ${expectedRows.length}, contract ${contract.rowCount}`,
      );
    }
    if (contentDigest !== contract.contentDigest) {
      let firstDiff = -1;
      for (let index = 0; index < Math.max(rows.length, expectedRows.length); index += 1) {
        if (canonicalJson(rows[index] ?? null) !== canonicalJson(expectedRows[index] ?? null)) {
          firstDiff = index;
          break;
        }
      }
      const detail = firstDiff === -1
        ? 'rows compare equal pairwise; digest input mismatch is structural'
        : `first differing row index ${firstDiff}\nobserved: ${canonicalJson(rows[firstDiff] ?? null)}\ncompiled: ${canonicalJson(expectedRows[firstDiff] ?? null)}`;
      fail(
        `${table} digest mismatch: observed ${contentDigest}, contract ${contract.contentDigest}\n${detail}`,
      );
    }
    if (canonicalJson(rows) !== canonicalJson(expectedRows)) {
      fail(`${table} rows differ from the compiled fixture despite matching count checks`);
    }
  }
  const overallDigest = taggedDigest({
    manifestDigests: digests.manifestDigests,
    actorBindings: digests.actorBindings,
    tables: observedTableDigests,
  });
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total !== digests.overall.rowCount) {
    fail(`overall row count mismatch: observed ${total}, contract ${digests.overall.rowCount}`);
  }
  if (overallDigest !== digests.overall.contentDigest) {
    fail(
      `overall digest mismatch: observed ${overallDigest}, contract ${digests.overall.contentDigest}`,
    );
  }
  return {counts, overallDigest};
}

async function readJson(path: string): Promise<JsonValue> {
  return JSON.parse(await readFile(path, 'utf8')) as JsonValue;
}

export async function readCompiledFixture(): Promise<{
  tables: FixtureTables;
  digests: FixtureDigests;
}> {
  const tables = {} as FixtureTables;
  for (const table of LOAD_ORDER) {
    tables[table] = (await readJson(join(FIXTURE_ROOT, `${table}.json`))) as FixtureRow[];
  }
  const digests = (await readJson(DIGEST_PATH)) as unknown as FixtureDigests;
  return {tables, digests};
}

async function mintDevSession(readyFile: string): Promise<{
  baseUrl: string;
  token: string;
  principal: string;
}> {
  const ready = await readJson(readyFile) as Record<string, JsonValue>;
  const baseUrl = ready.serverUrl;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    fail(`${readyFile} does not contain serverUrl`);
  }
  const command = process.env.SNAPBACK_RUNTIME_BINARY
    ?? join(CONTROL_ROOT, 'node_modules/.bin/snapback');
  // `session mint` is an admin-gated host-op: it requires the dev server's
  // admin token (SNAPBACK_ADMIN_TOKEN or --token). The readiness descriptor
  // names the managed token carrier; read it here rather than requiring the
  // caller to export secrets.
  const adminTokenFile = ready.adminTokenFile;
  const mintEnv = {...process.env};
  if (!mintEnv.SNAPBACK_ADMIN_TOKEN && typeof adminTokenFile === 'string') {
    mintEnv.SNAPBACK_ADMIN_TOKEN = (await readFile(adminTokenFile, 'utf8')).trim();
  }
  const {stdout} = await execFileAsync(
    command,
    ['session', 'mint', '--email', process.env.SNAPBACK_FIXTURE_EMAIL ?? DEFAULT_EMAIL, '--ready-file', readyFile],
    {cwd: CONTROL_ROOT, env: mintEnv, maxBuffer: 1024 * 1024},
  );
  const envelope = JSON.parse(stdout) as {
    ok?: boolean;
    data?: {token?: string; session?: {userId?: string}};
    diagnostics?: JsonValue[];
  };
  const token = envelope.data?.token;
  const principal = envelope.data?.session?.userId;
  if (envelope.ok !== true || typeof token !== 'string' || typeof principal !== 'string') {
    fail(`snapback session mint refused: ${canonicalJson((envelope as unknown) as JsonValue)}`);
  }
  return {baseUrl, token, principal};
}

export async function loadFixtureAgainstReadyFile(
  readyFile = process.env.SNAPBACK_READY_FILE ?? DEFAULT_READY_FILE,
): Promise<{
  counts: Record<TableName, number>;
  overallDigest: string;
  principal: string;
  batches: number;
}> {
  const {tables, digests} = await readCompiledFixture();
  // Prove the checked-in compiler output matches its contract before sending
  // a single mutation to the owned acceptance server.
  verifyObservedFixture(tables, tables, digests);

  const session = await mintDevSession(resolve(readyFile));
  const client = createExternalSessionClient(session.baseUrl, {
    bearerToken: session.token,
    clientStoreId: 'zerobugs-fixture-loader',
    rqsStore: null,
  });
  const generatedApiPath = join(CONTROL_ROOT, 'snapback/generated/api.mjs');
  const {default: api} = await import(pathToFileURL(generatedApiPath).href);
  const placeholderToActual = new Map<string, string>();
  const actualToPlaceholder = new Map<string, string>();
  const plan = fixtureLoadPlan(tables);

  try {
    for (const batch of plan) {
      const payload = prepareFixtureRows(batch.table, batch.rows, placeholderToActual);
      const response = await client.mutate(api.fixtureIngestBatch, {
        args: {table: batch.table, rows: payload},
      });
      const result = response.result as {inserted?: number; ids?: unknown[]};
      if (
        result?.inserted !== batch.rows.length
        || !Array.isArray(result.ids)
        || result.ids.length !== batch.rows.length
        || result.ids.some(id => typeof id !== 'string')
      ) {
        fail(`${batch.table} ingest returned an invalid id receipt`);
      }
      for (let index = 0; index < batch.rows.length; index += 1) {
        const placeholder = batch.rows[index]._id;
        const actual = result.ids[index] as string;
        if (placeholderToActual.has(placeholder) || actualToPlaceholder.has(actual)) {
          fail(`${batch.table} ingest returned a duplicate fixture/runtime id mapping`);
        }
        placeholderToActual.set(placeholder, actual);
        actualToPlaceholder.set(actual, placeholder);
      }
    }

    const observed = {} as FixtureTables;
    for (const table of LOAD_ORDER) {
      const response = await client.query(api.fixtureInspectTable, {args: {table}});
      observed[table] = normalizeObservedRows(
        table,
        response.rows as Array<Record<string, JsonValue>>,
        actualToPlaceholder,
      );
    }
    const verified = verifyObservedFixture(observed, tables, digests);
    return {...verified, principal: session.principal, batches: plan.length};
  } finally {
    await client.closeAuth();
  }
}

async function main(): Promise<void> {
  const result = await loadFixtureAgainstReadyFile();
  process.stdout.write(`${JSON.stringify({status: 'ok', ...result})}\n`);
}

if (import.meta.main) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
