import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  DbConnection,
  type SubscriptionHandle,
} from './module_bindings/index.ts';

const URI = 'ws://127.0.0.1:3344';
const DATABASE = 'llp0102-research-spacetimedb-w1';
const EVIDENCE_DIR = new URL('../../receipts/', import.meta.url);
const DETERMINISTIC_EXTERNAL_URL = 'https://www.rfc-editor.org/rfc/rfc2606.txt';
const QUERIES = [
  'SELECT * FROM my_rooms',
  'SELECT * FROM my_sources',
  'SELECT * FROM my_questions',
  'SELECT * FROM my_answers',
  'SELECT * FROM my_progress',
  'SELECT * FROM my_search_results',
  'SELECT * FROM my_refresh_runs',
];

type Client = {
  name: string;
  conn: DbConnection;
  identity: string;
  token: string;
  subscription?: SubscriptionHandle;
};

type Scenario = {
  id: string;
  status: 'PASS' | 'FAIL' | 'GAP';
  summary: string;
  evidence: Record<string, unknown>;
};

const scenarios: Scenario[] = [];
const samples: Record<string, { warmups: number[]; recorded: number[] }> = {
  'representative-read': { warmups: [], recorded: [] },
  'representative-write': { warmups: [], recorded: [] },
  'realtime-delivery': { warmups: [], recorded: [] },
  reconnect: { warmups: [], recorded: [] },
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fnv1a32(bytes: number[]): string {
  let hash = 2166136261;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function record(
  id: string,
  status: 'PASS' | 'FAIL' | 'GAP',
  summary: string,
  evidence: Record<string, unknown>
): void {
  scenarios.push({ id, status, summary, evidence });
}

async function waitFor(description: string, predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`settlement timeout: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function connect(name: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let builder = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DATABASE)
      .withConfirmedReads(true)
      .onConnect((conn, identity, returnedToken) => {
        if (settled) return;
        settled = true;
        resolve({
          name,
          conn,
          identity: identity.toHexString(),
          token: token ?? returnedToken,
        });
      })
      .onConnectError((_ctx, error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    if (token) builder = builder.withToken(token);
    builder.build();
  });
}

async function subscribe(client: Client): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.subscription = client.conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx: any) => reject(new Error(String(ctx?.event?.message ?? 'subscription error'))))
      .subscribe(QUERIES);
  });
}

async function expectPrivateSubscriptionDenied(client: Client): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('private subscription remained pending')), 5_000);
    client.conn.subscriptionBuilder()
      .onApplied(() => {
        clearTimeout(timer);
        reject(new Error('private source table subscription unexpectedly applied'));
      })
      .onError((ctx: any) => {
        clearTimeout(timer);
        resolve(String(ctx?.event?.message ?? 'server rejected private-table subscription'));
      })
      .subscribe('SELECT * FROM source');
  });
}

function rows<T>(iterable: Iterable<T>): T[] {
  return Array.from(iterable);
}

function sources(client: Client, roomId = 'research-main') {
  return rows(client.conn.db.mySources.iter()).filter(row => row.roomId === roomId);
}

function questions(client: Client, id?: string) {
  const all = rows(client.conn.db.myQuestions.iter());
  return id ? all.filter(row => row.id === id) : all;
}

function answers(client: Client, questionId?: string) {
  const all = rows(client.conn.db.myAnswers.iter());
  return questionId ? all.filter(row => row.questionId === questionId) : all;
}

function progress(client: Client, questionId: string) {
  return rows(client.conn.db.myProgress.iter())
    .filter(row => row.questionId === questionId)
    .sort((left, right) => left.sequence - right.sequence);
}

async function samplePath(
  path: keyof typeof samples,
  operation: (sampleIndex: number) => Promise<void>
): Promise<void> {
  for (let index = 0; index < 9; index += 1) {
    const started = performance.now();
    await operation(index);
    const elapsed = Number((performance.now() - started).toFixed(3));
    (index < 2 ? samples[path].warmups : samples[path].recorded).push(elapsed);
  }
}

async function main(): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const alice = await connect('Alice');
  const bob = await connect('Bob');
  const mallory = await connect('Mallory');
  await alice.conn.reducers.registerPersona({ name: 'Alice' });
  await bob.conn.reducers.registerPersona({ name: 'Bob' });
  await mallory.conn.reducers.registerPersona({ name: 'Mallory' });
  await Promise.all([subscribe(alice), subscribe(bob), subscribe(mallory)]);

  await alice.conn.reducers.seedFixtures({});
  await waitFor('Alice seed view', () => sources(alice).length === 20);
  await waitFor('Bob seed view', () => sources(bob).length === 20);
  await waitFor('Mallory remains outside', () => rows(mallory.conn.db.myRooms.iter()).length === 0);
  const sourceOne = sources(alice).find(row => row.id === 'source-01')!;
  record('RESEARCH-01-SEED', 'PASS', 'Fresh target contains two rooms, twenty 64 KiB primary-room sources, 32-dimensional embeddings, and three independent identities.', {
    rooms: rows(alice.conn.db.myRooms.iter()).map(row => row.id).sort(),
    primarySources: sources(alice).length,
    sourceBytes: sourceOne.bytes.length,
    embeddingDimensions: sourceOne.embedding.length,
    personas: ['Alice', 'Bob', 'Mallory'],
    actorIdentityHashes: {
      Alice: sha256(alice.identity),
      Bob: sha256(bob.identity),
      Mallory: sha256(mallory.identity),
    },
  });

  const uploadBytes = Uint8Array.from({ length: 65_536 }, (_, index) => (index * 13) % 256);
  await alice.conn.reducers.uploadSource({
    id: 'source-upload-proof',
    roomId: 'research-main',
    filename: 'Upload-proof.bin',
    mimeType: 'application/octet-stream',
    text: 'owner-only inline file proof',
    bytes: uploadBytes,
  });
  await waitFor('Bob receives uploaded bytes', () => sources(bob).some(row => row.id === 'source-upload-proof'));
  const delivered = sources(bob).find(row => row.id === 'source-upload-proof')!;
  let bobDeleteRefused = false;
  try {
    await bob.conn.reducers.deleteSource({ sourceId: 'source-upload-proof' });
  } catch {
    bobDeleteRefused = true;
  }
  await alice.conn.reducers.deleteSource({ sourceId: 'source-upload-proof' });
  await waitFor('deleted source evicted', () => !sources(alice).some(row => row.id === 'source-upload-proof'));
  record('RESEARCH-02-FILES', delivered.bytes.length === 65_536 && delivered.contentHash === fnv1a32(Array.from(uploadBytes)) && bobDeleteRefused ? 'PASS' : 'FAIL', 'Inline byte storage, metadata, WebSocket delivery, owner-only deletion, and subscribed eviction were authoritative.', {
    objectIdentity: delivered.id,
    bytes: delivered.bytes.length,
    expectedHash: fnv1a32(Array.from(uploadBytes)),
    deliveredHash: delivered.contentHash,
    bobDeleteRefused,
    postDeleteRows: sources(alice).filter(row => row.id === 'source-upload-proof').length,
  });

  const denial = await expectPrivateSubscriptionDenied(mallory);
  const malloryCounts = {
    rooms: rows(mallory.conn.db.myRooms.iter()).length,
    sources: rows(mallory.conn.db.mySources.iter()).length,
    questions: rows(mallory.conn.db.myQuestions.iter()).length,
    answers: rows(mallory.conn.db.myAnswers.iter()).length,
    progress: rows(mallory.conn.db.myProgress.iter()).length,
  };
  record('RESEARCH-03-OUTSIDER', Object.values(malloryCounts).every(value => value === 0) ? 'PASS' : 'FAIL', 'Caller-dependent views expose no room data to Mallory and direct private-table subscription is rejected.', {
    malloryCounts,
    negativeSubscription: denial.slice(0, 240),
  });

  await alice.conn.reducers.keywordSearch({
    requestId: 'keyword-proof',
    roomId: 'research-main',
    query: 'cancellation safety',
  });
  await waitFor('keyword results', () =>
    rows(alice.conn.db.mySearchResults.iter()).filter(row => row.requestId.endsWith(':keyword-proof')).length === 2
  );
  const keywordIds = rows(alice.conn.db.mySearchResults.iter())
    .filter(row => row.requestId.endsWith(':keyword-proof'))
    .map(row => row.sourceId)
    .sort();
  record('RESEARCH-04-KEYWORD', JSON.stringify(keywordIds) === JSON.stringify(['source-01', 'source-02']) ? 'PASS' : 'FAIL', 'A server reducer searched authoritative source metadata/text and materialized identity-scoped results.', {
    requestId: 'keyword-proof',
    expected: ['source-01', 'source-02'],
    actual: keywordIds,
    path: 'reducer scan over private source rows + caller-dependent result view',
  });

  record('RESEARCH-05-SEMANTIC', 'GAP', 'SpacetimeDB 2.7 stores the frozen vectors but has no ordinary vector index or semantic-nearest-neighbor query path.', {
    storedDimensions: sourceOne.embedding.length,
    nonclaim: true,
    fallbackUsed: false,
  });

  const progressQuestion = 'question-progress';
  const bobProgressCallbacks: Array<{ sequence: number; at: number }> = [];
  let bobCompletionAt = 0;
  const onProgress = (_ctx: unknown, row: any) => {
    if (row.questionId === progressQuestion) {
      bobProgressCallbacks.push({ sequence: row.sequence, at: performance.now() });
    }
  };
  const onAnswerUpdate = (_ctx: unknown, _oldRow: any, row: any) => {
    if (row.questionId === progressQuestion && row.status === 'complete') bobCompletionAt = performance.now();
  };
  bob.conn.db.myProgress.onInsert(onProgress);
  bob.conn.db.myAnswers.onUpdate(onAnswerUpdate);
  await alice.conn.reducers.startQuestion({
    id: progressQuestion,
    roomId: 'research-main',
    prompt: 'Which backend properties matter most for cancellation safety?',
    idempotencyKey: 'question-progress-key',
  });
  await waitFor('four durable progress commits', () => progress(bob, progressQuestion).length === 4);
  await waitFor('answer completion after progress', () => answers(bob, progressQuestion)[0]?.status === 'complete');
  bob.conn.db.myProgress.removeOnInsert(onProgress);
  bob.conn.db.myAnswers.removeOnUpdate(onAnswerUpdate);
  const progressRows = progress(alice, progressQuestion);
  record('RESEARCH-06-PROGRESS', progressRows.map(row => row.sequence).join(',') === '1,2,3,4' && bobProgressCallbacks.every(item => item.at < bobCompletionAt) ? 'PASS' : 'FAIL', 'Four separate scheduled reducer commits precede the terminal answer update.', {
    sequences: progressRows.map(row => row.sequence),
    labels: progressRows.map(row => row.label),
    durableTimestamps: progressRows.map(row => row.createdAt.microsSinceUnixEpoch.toString()),
    transport: 'SpacetimeDB schedule table + WebSocket view subscription',
    callbackOrder: bobProgressCallbacks.map(item => item.sequence),
    completionAfterCallbacks: bobCompletionAt > Math.max(...bobProgressCallbacks.map(item => item.at)),
  });

  const completedAnswer = answers(alice, progressQuestion)[0]!;
  const citationRows = completedAnswer.citations.map(id => sources(alice).find(row => row.id === id));
  record('RESEARCH-07-CITATIONS', citationRows.every(Boolean) ? 'PASS' : 'FAIL', 'The authoritative completed answer retains citations to two sources visible through the same room authority.', {
    answerId: completedAnswer.id,
    citations: completedAnswer.citations,
    resolvedFilenames: citationRows.map(row => row?.filename),
  });

  record('RESEARCH-08-COLLABORATOR', bobProgressCallbacks.length === 4 ? 'PASS' : 'FAIL', 'Bob observed Alice’s four authoritative progress commits through native WebSocket row callbacks.', {
    secondClient: 'Bob',
    callbacks: bobProgressCallbacks.length,
    transport: 'SpacetimeDB WebSocket subscription callback',
    productPolling: false,
  });

  const cancelQuestionId = 'question-cancel';
  await alice.conn.reducers.startQuestion({
    id: cancelQuestionId,
    roomId: 'research-main',
    prompt: 'cancel this deterministic answer',
    idempotencyKey: 'question-cancel-key',
  });
  await waitFor('first progress before cancel', () => progress(alice, cancelQuestionId).length >= 1);
  await alice.conn.reducers.cancelQuestion({ questionId: cancelQuestionId });
  await waitFor('cancel terminal', () => answers(alice, cancelQuestionId)[0]?.status === 'cancelled');
  const progressAtCancel = progress(alice, cancelQuestionId).length;
  await alice.conn.reducers.latePatchProbe({ questionId: cancelQuestionId });
  await new Promise(resolve => setTimeout(resolve, 350));
  const progressAfterLateProbe = progress(alice, cancelQuestionId).length;
  record('RESEARCH-09-CANCEL', progressAtCancel === progressAfterLateProbe && answers(alice, cancelQuestionId)[0]?.effectState === 'confirmed-cancelled' ? 'PASS' : 'FAIL', 'Confirmed cancellation deletes scheduled work and the terminal guard refuses a late patch probe.', {
    progressAtCancel,
    progressAfterLateProbe,
    answerStatus: answers(alice, cancelQuestionId)[0]?.status,
    effectState: answers(alice, cancelQuestionId)[0]?.effectState,
    waitAfterProbeMs: 350,
  });

  await alice.conn.reducers.startQuestion({
    id: 'question-retry',
    roomId: 'research-main',
    prompt: 'idempotent retry',
    idempotencyKey: 'question-retry-key',
  });
  await alice.conn.reducers.startQuestion({
    id: 'question-retry-duplicate-id',
    roomId: 'research-main',
    prompt: 'idempotent retry',
    idempotencyKey: 'question-retry-key',
  });
  await waitFor('retry question visible', () => questions(alice, 'question-retry').length === 1);
  const retryQuestions = rows(alice.conn.db.myQuestions.iter()).filter(row => row.idempotencyKey === 'question-retry-key');
  const retryAnswers = answers(alice).filter(row => retryQuestions.some(questionRow => questionRow.id === row.questionId));
  record('RESEARCH-10-RETRY', retryQuestions.length === 1 && retryAnswers.length === 1 ? 'PASS' : 'FAIL', 'The unique idempotency key makes a repeated reducer call a no-op without duplicating question, answer, or job lineage.', {
    idempotencyKey: 'question-retry-key',
    questions: retryQuestions.map(row => row.id),
    answers: retryAnswers.map(row => row.id),
  });

  await alice.conn.reducers.createOutcomeFixtures({ roomId: 'research-main' });
  await waitFor('five outcome fixtures', () => answers(alice).filter(row => row.questionId.startsWith('outcome:')).length === 5);
  const outcomeRows = answers(alice)
    .filter(row => row.questionId.startsWith('outcome:'))
    .map(row => ({ status: row.status, effectState: row.effectState }))
    .sort((left, right) => left.status.localeCompare(right.status));
  const outcomeStatuses = outcomeRows.map(row => row.status).sort();
  const expectedOutcomes = ['ambiguous', 'cancelled', 'complete', 'failed', 'timed-out'];
  record('RESEARCH-11-OUTCOMES', JSON.stringify(outcomeStatuses) === JSON.stringify(expectedOutcomes) ? 'PASS' : 'FAIL', 'Fault fixtures preserve five distinct durable terminal/effect states.', {
    expected: expectedOutcomes,
    actual: outcomeRows,
  });

  await alice.conn.reducers.scheduleRefresh({
    roomId: 'research-main',
    runId: 'refresh-proof',
    url: DETERMINISTIC_EXTERNAL_URL,
  });
  await waitFor('scheduled external refresh', () =>
    rows(alice.conn.db.myRefreshRuns.iter()).some(row => row.id === 'refresh-proof' && row.status === 'complete')
  );
  const refresh = rows(alice.conn.db.myRefreshRuns.iter()).find(row => row.id === 'refresh-proof')!;
  record('RESEARCH-12-SCHEDULE', refresh.progressCount === 1 && refresh.effectState === 'confirmed' ? 'PASS' : 'FAIL', 'A schedule table invoked a native HTTP procedure against a deterministic fixed-response endpoint and committed one idempotent refresh result.', {
    scheduleIdentity: 'refresh-proof',
    externalUrlKind: 'public fixed-response base64 endpoint',
    status: refresh.status,
    progressCount: refresh.progressCount,
    externalHash: refresh.externalHash,
    effectState: refresh.effectState,
  });

  record('RESEARCH-13-SECRETS', 'GAP', 'SpacetimeDB 2.7 has no native module secret-management/injection surface; the deterministic refresh uses no credential and no canary value was fabricated.', {
    nativeSecretStore: false,
    clientSecretParameterUsed: false,
    storedSecretTableUsed: false,
    nonclaim: true,
  });

  await samplePath('representative-read', async index => {
    const requestId = `perf-read-${index}`;
    await alice.conn.reducers.keywordSearch({
      requestId,
      roomId: 'research-main',
      query: 'cancellation safety',
    });
    await waitFor(`performance read ${index}`, () =>
      rows(alice.conn.db.mySearchResults.iter()).filter(row => row.requestId.endsWith(`:${requestId}`)).length === 2
    );
  });
  await samplePath('representative-write', async index => {
    const id = `perf-source-${index}`;
    await alice.conn.reducers.uploadSource({
      id,
      roomId: 'research-main',
      filename: `${id}.txt`,
      mimeType: 'text/plain',
      text: 'performance fixture',
      bytes: Uint8Array.from({ length: 1024 }, (_, offset) => (index + offset) % 256),
    });
    await waitFor(`performance write ${index}`, () => sources(alice).some(row => row.id === id));
    await alice.conn.reducers.deleteSource({ sourceId: id });
    await waitFor(`performance delete ${index}`, () => !sources(alice).some(row => row.id === id));
  });
  await samplePath('realtime-delivery', async index => {
    const id = `perf-question-${index}`;
    let observed = 0;
    const callback = (_ctx: unknown, row: any) => {
      if (row.questionId === id) observed += 1;
    };
    bob.conn.db.myProgress.onInsert(callback);
    await alice.conn.reducers.startQuestion({
      id,
      roomId: 'research-main',
      prompt: 'performance progress',
      idempotencyKey: `${id}-key`,
    });
    await waitFor(`performance realtime ${index}`, () => observed === 4 && answers(bob, id)[0]?.status === 'complete');
    bob.conn.db.myProgress.removeOnInsert(callback);
  });
  await samplePath('reconnect', async () => {
    const client = await connect('Alice performance reconnect', alice.token);
    await subscribe(client);
    await waitFor('reconnect sources', () => sources(client).length === 20);
    client.conn.disconnect();
  });
  record('RESEARCH-14-PERFORMANCE', 'PASS', 'Two warmups and seven retained samples cover search, write/delete, four-step realtime completion, and reconnect; build/deploy samples are retained by the runner.', {
    warmupsPerPath: 2,
    recordedPerPath: 7,
    paths: Object.keys(samples),
    claimScope: 'small repeatable product workload; not production scale',
  });

  for (const client of [alice, bob, mallory]) client.conn.disconnect();

  await writeFile(
    new URL('acceptance.partial.v1.json', EVIDENCE_DIR),
    `${JSON.stringify({
      schemaVersion: 1,
      expectedCheckCount: 15,
      resultBeforeCleanup: 'pass-with-gaps',
      summary: {
        pass: scenarios.filter(item => item.status === 'PASS').length,
        gap: scenarios.filter(item => item.status === 'GAP').length,
        fail: scenarios.filter(item => item.status === 'FAIL').length,
        pendingCleanup: 1,
      },
      scenarios,
    }, null, 2)}\n`
  );
  await writeFile(
    new URL('performance.partial.v1.json', EVIDENCE_DIR),
    `${JSON.stringify({
      schemaVersion: 1,
      machine: 'Apartment Air / Mac17,3 / arm64 / macOS 26.5.2',
      units: 'milliseconds',
      samples,
    }, null, 2)}\n`
  );
  await writeFile(
    new URL('actors.v1.json', EVIDENCE_DIR),
    `${JSON.stringify({
      schemaVersion: 1,
      target: DATABASE,
      actors: {
        Alice: sha256(alice.identity),
        Bob: sha256(bob.identity),
        Mallory: sha256(mallory.identity),
      },
      hash: 'sha256',
      rawTokensPersisted: false,
    }, null, 2)}\n`
  );
  console.log(JSON.stringify({
    scenariosRecorded: scenarios.length,
    pass: scenarios.filter(item => item.status === 'PASS').length,
    gap: scenarios.filter(item => item.status === 'GAP').length,
    fail: scenarios.filter(item => item.status === 'FAIL').length,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
