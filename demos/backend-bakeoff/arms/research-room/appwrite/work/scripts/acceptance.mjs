import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  Channel,
  Client as RealtimeClient,
  Realtime,
} from "appwrite";
import { InputFile } from "node-appwrite/file";
import {
  actorClient,
  allRows,
  bucketId,
  databaseId,
  endpoint,
  functionId,
  functions,
  memberRead,
  memberTeamId,
  ownerWrite,
  Permission,
  projectId,
  Query,
  Role,
  runtime,
  storage,
  tableIds,
  tables,
} from "./admin-client.mjs";
import { receiptsRoot } from "./constants.mjs";

// @ref LLP 0102#app-5-collaborative-ai-research-room — Execute the frozen 15-check protocol without provider normalization.
globalThis.window ??= globalThis;
const startedEpoch = Date.parse("2026-07-29T10:33:35Z");
const scenarioRoot = path.resolve(receiptsRoot, "scenarios");
await mkdir(scenarioRoot, { recursive: true });
const scenarios = {};
const milestones = {
  firstLocalReadMs: null,
  firstAuthoritativeMutationMs: null,
  firstRealtimeTransitionMs: null,
  localAcceptanceMs: null,
  hostedUrlMs: null,
  acceptanceCompletionMs: null,
};
const elapsed = () => Date.now() - startedEpoch;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const denied = async (operation) => {
  try {
    await operation();
    return false;
  } catch (error) {
    return [401, 403, 404].includes(error.code);
  }
};
const actorOwnedPermissions = [
  Permission.read(Role.team(memberTeamId)),
  Permission.update(Role.user("alice")),
  Permission.delete(Role.user("alice")),
];
const waitFor = async (predicate, label, limit = 120, delay = 250) => {
  for (let index = 0; index < limit; index += 1) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`timed out waiting for ${label}`);
};
async function receipt(id, status, transport, evidence, note) {
  const value = {
    id,
    status,
    checkedAt: new Date().toISOString(),
    projectId,
    transport,
    evidence,
    note,
  };
  scenarios[id] = value;
  await writeFile(
    path.resolve(scenarioRoot, `${id}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  return value;
}
async function clearTable(tableId) {
  for (const row of await allRows(tableId)) {
    await tables.deleteRow({ databaseId, tableId, rowId: row.$id });
  }
}
for (const tableId of [
  tableIds.questions,
  tableIds.answers,
  tableIds.progress,
  tableIds.refreshRuns,
]) {
  await clearTable(tableId);
}
try {
  await storage.deleteFile({ bucketId, fileId: "source-upload-proof" });
} catch (error) {
  if (error.code !== 404) throw error;
}

const counts = {};
for (const [name, tableId] of Object.entries(tableIds)) {
  counts[name] = (await tables.listRows({
    databaseId,
    tableId,
    queries: [Query.limit(1)],
    total: true,
  })).total;
}
const expectedSeed = {
  rooms: 2,
  memberships: 3,
  sources: 20,
  questions: 0,
  answers: 0,
  progress: 0,
  refreshRuns: 0,
  outcomes: 5,
};
assert(JSON.stringify(counts) === JSON.stringify(expectedSeed), `Seed drift: ${JSON.stringify(counts)}`);
milestones.firstLocalReadMs = elapsed();
await receipt("RESEARCH-01-SEED", "pass", "not-applicable", {
  authoritativeAdminCounts: counts,
  fixedDataset: {
    rooms: 2,
    primarySources: 20,
    sourceBytes: 65536,
    embeddingDimensions: 32,
    actors: 3,
  },
  actorIdentityHashes: Object.fromEntries(
    ["alice", "bob", "mallory"].map((actor) => [actor, hash(actor)]),
  ),
  targetIdentity: {
    endpointHash: hash(endpoint),
    projectIdHash: hash(projectId),
    version: "1.9.6",
  },
}, "The fresh project seed and three native Auth principals were independently counted through Appwrite authority.");

const [alice, bob, mallory] = await Promise.all([
  actorClient("alice"),
  actorClient("bob"),
  actorClient("mallory"),
]);

const uploadBytes = Buffer.alloc(65536, 211);
const uploadHash = hash(uploadBytes);
const uploaded = await alice.storage.createFile({
  bucketId,
  fileId: "source-upload-proof",
  file: InputFile.fromBuffer(uploadBytes, "Upload proof.bin"),
  permissions: actorOwnedPermissions,
});
await alice.tables.createRow({
  databaseId,
  tableId: tableIds.sources,
  rowId: "source-upload-proof",
  data: {
    room_id: "research-main",
    file_id: uploaded.$id,
    filename: "Upload proof.bin",
    content_text: "authenticated upload proof",
    content_hash: uploadHash,
    embedding_json: JSON.stringify(Array.from({ length: 32 }, () => 0.5)),
    owner_id: "alice",
    sequence: 21,
  },
  permissions: actorOwnedPermissions,
});
const downloaded = Buffer.from(await bob.storage.getFileDownload({
  bucketId,
  fileId: uploaded.$id,
}));
const malloryFileDenied = await denied(() => mallory.storage.getFileDownload({
  bucketId,
  fileId: uploaded.$id,
}));
const bobDeleteDenied = await denied(() => bob.storage.deleteFile({
  bucketId,
  fileId: uploaded.$id,
}));
await alice.storage.deleteFile({ bucketId, fileId: uploaded.$id });
await alice.tables.deleteRow({
  databaseId,
  tableId: tableIds.sources,
  rowId: "source-upload-proof",
});
const deletedFileDenied = await denied(() => storage.getFile({
  bucketId,
  fileId: uploaded.$id,
}));
assert(
  downloaded.length === 65536
    && hash(downloaded) === uploadHash
    && malloryFileDenied
    && bobDeleteDenied
    && deletedFileDenied,
  "File lifecycle failed",
);
milestones.firstAuthoritativeMutationMs = elapsed();
await receipt("RESEARCH-02-FILES", "pass", "appwrite-storage", {
  bucketId,
  objectId: uploaded.$id,
  bytes: downloaded.length,
  contentSha256: uploadHash,
  uploader: "alice-native-session",
  authorizedDownloader: "bob-native-session",
  outsiderDenied: malloryFileDenied,
  memberDeleteDenied: bobDeleteDenied,
  ownerDeleteSucceeded: true,
  postDeleteDenied: deletedFileDenied,
}, "Appwrite Storage and TablesDB jointly proved metadata, ownership, authorization, byte delivery, and deletion.");

const malloryCounts = {};
for (const tableId of [
  tableIds.rooms,
  tableIds.memberships,
  tableIds.sources,
  tableIds.questions,
  tableIds.answers,
  tableIds.progress,
]) {
  malloryCounts[tableId] = (await mallory.tables.listRows({
    databaseId,
    tableId,
    queries: [Query.limit(1)],
    total: true,
  })).total;
}
const outsiderSourceDenied = await denied(() => mallory.tables.getRow({
  databaseId,
  tableId: tableIds.sources,
  rowId: "source-01",
}));
assert(
  Object.values(malloryCounts).every((count) => count === 0)
    && outsiderSourceDenied,
  "Outsider authority boundary failed",
);
await receipt("RESEARCH-03-OUTSIDER", "pass", "not-applicable", {
  malloryCounts,
  directSourceReadDenied: outsiderSourceDenied,
  authority: "native Appwrite Auth session plus row-security permissions",
}, "Mallory's independent native session received zero protected rows and a direct source refusal.");

const keyword = await bob.tables.listRows({
  databaseId,
  tableId: tableIds.sources,
  queries: [
    Query.equal("room_id", ["research-main"]),
    Query.search("content_text", "cancellation"),
    Query.orderAsc("sequence"),
    Query.limit(20),
  ],
  total: true,
});
const keywordIds = keyword.rows.map((row) => row.$id);
assert(
  keywordIds.length === 2
    && keywordIds[0] === "source-01"
    && keywordIds[1] === "source-02",
  `Keyword search mismatch: ${JSON.stringify(keywordIds)}`,
);
await receipt("RESEARCH-04-KEYWORD", "pass", "not-applicable", {
  query: "cancellation",
  resultIds: keywordIds,
  path: "Appwrite fulltext index plus native Query.search",
}, "The ordinary Appwrite full-text index returned the two expected authorized sources.");

await receipt("RESEARCH-05-SEMANTIC", "gap", "not-applicable", {
  storedEmbeddingDimensions: 32,
  nativeVectorIndex: false,
  fallbackUsed: false,
  nonclaim: true,
}, "Appwrite 1.9.6 stores the frozen vectors but exposes no ordinary native vector index or nearest-neighbor query path.");

const realtimeClient = new RealtimeClient()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setSession(bob.sessionSecret);
const realtime = new Realtime(realtimeClient);
const progressChannel = Channel.tablesdb(databaseId).table(tableIds.progress).row();
const progressEvents = [];
let firstProgressResolve;
const firstProgress = new Promise((resolve) => {
  firstProgressResolve = resolve;
});
const subscription = await realtime.subscribe(progressChannel, (message) => {
  if (message.payload?.question_id !== "question-progress") return;
  progressEvents.push({
    id: message.payload.$id,
    sequence: message.payload.sequence,
    label: message.payload.label,
    events: message.events,
    observedAt: Date.now(),
  });
  if (progressEvents.length === 1) firstProgressResolve();
});
await new Promise((resolve) => setTimeout(resolve, 750));
await alice.tables.createRow({
  databaseId,
  tableId: tableIds.questions,
  rowId: "question-progress",
  data: {
    room_id: "research-main",
    asker_id: "alice",
    prompt: "What properties make cancellation safe?",
    idempotency_key: "progress-key",
    status: "queued",
    cancelled: false,
  },
  permissions: actorOwnedPermissions,
});
const progressExecutionPromise = alice.functions.createExecution({
  functionId,
  body: JSON.stringify({ operation: "answer", questionId: "question-progress" }),
  async: false,
  xpath: "/",
  method: "POST",
  headers: { "content-type": "application/json" },
});
await Promise.race([
  firstProgress,
  new Promise((_, reject) => setTimeout(() => reject(new Error("No native realtime progress callback")), 15_000)),
]);
const progressExecution = await progressExecutionPromise;
await waitFor(() => progressEvents.length === 4 && progressEvents, "four realtime progress callbacks");
const progressRows = await allRows(tableIds.progress, [
  Query.equal("question_id", ["question-progress"]),
  Query.orderAsc("sequence"),
]);
const progressAnswer = await tables.getRow({
  databaseId,
  tableId: tableIds.answers,
  rowId: "answer-question-progress",
});
assert(
  progressExecution.status === "completed"
    && progressRows.length === 4
    && progressEvents.length === 4
    && progressAnswer.status === "complete",
  "Authoritative streamed progress failed",
);
milestones.firstRealtimeTransitionMs = progressEvents[0].observedAt - startedEpoch;
await receipt("RESEARCH-06-PROGRESS", "pass", "appwrite-realtime-websocket", {
  sequences: progressRows.map((row) => row.sequence),
  labels: progressRows.map((row) => row.label),
  authoritativeCommitIds: progressRows.map((row) => row.$id),
  callbackOrder: progressEvents.map((event) => event.sequence),
  completionAfterCallbacks: progressAnswer.$updatedAt >= progressRows.at(-1).$createdAt,
}, "Four separately committed Appwrite rows arrived over native Realtime before the terminal answer.");

const citations = JSON.parse(progressAnswer.citations_json);
const citedSources = await Promise.all(citations.map((sourceId) => bob.tables.getRow({
  databaseId,
  tableId: tableIds.sources,
  rowId: sourceId,
})));
assert(
  JSON.stringify(citations) === JSON.stringify(["source-01", "source-02"])
    && citedSources.length === 2,
  "Citation resolution failed",
);
await receipt("RESEARCH-07-CITATIONS", "pass", "not-applicable", {
  answerId: progressAnswer.$id,
  citations,
  resolvedFilenames: citedSources.map((source) => source.filename),
}, "The completed authoritative answer retained two citations resolvable through Bob's room authority.");

await receipt("RESEARCH-08-COLLABORATOR", "pass", "appwrite-realtime-websocket", {
  secondClient: "bob",
  callbacks: progressEvents.length,
  callbackEvents: progressEvents.map((event) => event.events),
  productPolling: false,
}, "Bob's independent Auth session observed Alice's four progress commits through Appwrite Realtime.");
subscription.unsubscribe();
realtime.disconnect();

await alice.tables.createRow({
  databaseId,
  tableId: tableIds.questions,
  rowId: "question-cancel",
  data: {
    room_id: "research-main",
    asker_id: "alice",
    prompt: "Cancel this deterministic question",
    idempotency_key: "cancel-key",
    status: "queued",
    cancelled: false,
  },
  permissions: actorOwnedPermissions,
});
const cancelExecution = await alice.functions.createExecution({
  functionId,
  body: JSON.stringify({ operation: "answer", questionId: "question-cancel" }),
  async: true,
  xpath: "/",
  method: "POST",
  headers: { "content-type": "application/json" },
});
await waitFor(async () => {
  const rows = await allRows(tableIds.progress, [Query.equal("question_id", ["question-cancel"])]);
  return rows.length >= 1 ? rows : false;
}, "first cancellable progress row");
await alice.tables.updateRow({
  databaseId,
  tableId: tableIds.questions,
  rowId: "question-cancel",
  data: { status: "cancelled", cancelled: true },
});
await waitFor(async () => {
  const execution = await functions.getExecution({
    functionId,
    executionId: cancelExecution.$id,
  });
  return ["completed", "failed"].includes(execution.status) ? execution : false;
}, "cancelled function settlement");
const cancelRowsBeforeLateProbe = await allRows(tableIds.progress, [
  Query.equal("question_id", ["question-cancel"]),
]);
const cancelAnswer = await tables.getRow({
  databaseId,
  tableId: tableIds.answers,
  rowId: "answer-question-cancel",
});
const lateProbe = await alice.functions.createExecution({
  functionId,
  body: JSON.stringify({ operation: "answer", questionId: "question-cancel" }),
  async: false,
  xpath: "/",
  method: "POST",
  headers: { "content-type": "application/json" },
});
await new Promise((resolve) => setTimeout(resolve, 500));
const cancelRowsAfterLateProbe = await allRows(tableIds.progress, [
  Query.equal("question_id", ["question-cancel"]),
]);
const cancelAnswerAfter = await tables.getRow({
  databaseId,
  tableId: tableIds.answers,
  rowId: "answer-question-cancel",
});
assert(
  cancelAnswer.status === "cancelled"
    && cancelAnswerAfter.status === "cancelled"
    && cancelRowsAfterLateProbe.length === cancelRowsBeforeLateProbe.length
    && lateProbe.status === "completed",
  "Cancellation fence failed",
);
await receipt("RESEARCH-09-CANCEL", "pass", "appwrite-function-and-tablesdb", {
  asyncExecutionId: cancelExecution.$id,
  progressAtCancel: cancelRowsBeforeLateProbe.length,
  progressAfterLateProbe: cancelRowsAfterLateProbe.length,
  terminalStatus: cancelAnswerAfter.status,
  effectState: cancelAnswerAfter.effect_state,
  lateProbeExecutionId: lateProbe.$id,
  waitAfterProbeMs: 500,
}, "Confirmed cancellation persisted a terminal fence; a later function execution produced no durable patch.");

await alice.tables.createRow({
  databaseId,
  tableId: tableIds.questions,
  rowId: "question-retry",
  data: {
    room_id: "research-main",
    asker_id: "alice",
    prompt: "Retry this deterministic question",
    idempotency_key: "retry-key",
    status: "queued",
    cancelled: false,
  },
  permissions: actorOwnedPermissions,
});
const retryFirst = await alice.functions.createExecution({
  functionId,
  body: JSON.stringify({ operation: "answer", questionId: "question-retry" }),
  async: false,
  xpath: "/",
  method: "POST",
  headers: { "content-type": "application/json" },
});
const retrySecond = await alice.functions.createExecution({
  functionId,
  body: JSON.stringify({ operation: "answer", questionId: "question-retry" }),
  async: false,
  xpath: "/",
  method: "POST",
  headers: { "content-type": "application/json" },
});
const retryQuestions = await allRows(tableIds.questions, [Query.equal("idempotency_key", ["retry-key"])]);
const retryAnswers = await allRows(tableIds.answers, [Query.equal("question_id", ["question-retry"])]);
const retryProgress = await allRows(tableIds.progress, [Query.equal("question_id", ["question-retry"])]);
assert(
  retryFirst.status === "completed"
    && retrySecond.status === "completed"
    && retryQuestions.length === 1
    && retryAnswers.length === 1
    && retryProgress.length === 4,
  "Retry idempotency failed",
);
await receipt("RESEARCH-10-RETRY", "pass", "appwrite-function-and-unique-indexes", {
  executionIds: [retryFirst.$id, retrySecond.$id],
  idempotencyKey: "retry-key",
  questionRows: retryQuestions.length,
  answerRows: retryAnswers.length,
  progressRows: retryProgress.length,
}, "A second function execution converged on the existing question, answer, and four-step progress lineage.");

const outcomes = await allRows(tableIds.outcomes, [Query.orderAsc("status")]);
const outcomePairs = outcomes.map((row) => ({
  status: row.status,
  effectState: row.effect_state,
}));
assert(
  JSON.stringify(outcomePairs.map((item) => item.status))
    === JSON.stringify(["ambiguous", "cancelled", "complete", "failed", "timed-out"]),
  "Outcome distinctions failed",
);
await receipt("RESEARCH-11-OUTCOMES", "pass", "not-applicable", {
  outcomes: outcomePairs,
}, "Five durable Appwrite rows preserve complete, failed, cancelled, timed-out, and ambiguous effect states.");

const scheduledAt = `${new Date(Date.now() + 90_000).toISOString().slice(0, 16)}:00.000Z`;
const scheduleRequest = await functions.createExecution({
  functionId,
  body: JSON.stringify({
    operation: "refresh",
    refreshId: "refresh-proof",
    sourceUrl: "https://www.rfc-editor.org/rfc/rfc2606.txt",
  }),
  async: true,
  xpath: "/",
  method: "POST",
  headers: { "content-type": "application/json" },
  scheduledAt,
});
let scheduledExecution = scheduleRequest;
const refreshRun = await waitFor(async () => {
  scheduledExecution = await functions.getExecution({
    functionId,
    executionId: scheduleRequest.$id,
  });
  const rows = await allRows(tableIds.refreshRuns);
  if (scheduledExecution.status === "failed") {
    throw new Error(`Scheduled execution failed: ${scheduledExecution.errors}`);
  }
  return scheduledExecution.status === "completed" && rows.length === 1
    ? rows[0]
    : false;
}, "scheduled refresh", 480, 500);
assert(
  refreshRun.status === "complete"
    && refreshRun.progress_count === 1
    && refreshRun.effect_state === "confirmed",
  "Scheduled refresh failed",
);
await receipt("RESEARCH-12-SCHEDULE", "pass", "appwrite-functions-scheduler", {
  functionId,
  scheduledAt,
  execution: {
    id: scheduledExecution.$id,
    trigger: scheduledExecution.trigger,
    status: scheduledExecution.status,
  },
  refresh: {
    id: refreshRun.$id,
    sourceUrlKind: "stable RFC 2606 public document",
    status: refreshRun.status,
    contentHash: refreshRun.content_hash,
    progressCount: refreshRun.progress_count,
    effectState: refreshRun.effect_state,
  },
}, "Appwrite's scheduled-execution API invoked the deployed function at a declared future time and retained its run.");

const variables = await functions.listVariables({ functionId, total: true });
const variableEvidence = variables.variables.map((variable) => ({
  id: variable.$id,
  key: variable.key,
  secret: variable.secret,
  valueEqualsCanary: variable.value === runtime.researchCanary,
}));
const canaryVariable = variableEvidence.find((variable) => variable.key === "RESEARCH_CANARY");
assert(
  canaryVariable?.secret === true
    && canaryVariable.valueEqualsCanary === false
    && refreshRun.secret_seen === true,
  "Secret variable proof failed",
);
await receipt("RESEARCH-13-SECRETS", "pass", "appwrite-function-secret-variable", {
  variables: variableEvidence,
  functionObservedCanaryPresence: refreshRun.secret_seen,
  canaryValuePersistedInReceipt: false,
  canaryValueLogged: false,
}, "A secret Appwrite Function variable was present at runtime while its value was not readable through the API or retained in evidence.");

milestones.localAcceptanceMs = elapsed();
const summary = {
  schemaVersion: 1,
  expectedCheckCount: 15,
  resultBeforePerformanceAndCleanup: "pass-with-gap",
  summary: { pass: 12, gap: 1, fail: 0, pendingPerformance: 1, pendingCleanup: 1 },
  milestones,
  scenarios: Object.values(scenarios),
  containsSecretValues: false,
};
await writeFile(
  path.resolve(receiptsRoot, "acceptance.partial.v1.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(JSON.stringify({
  ok: true,
  pass: 12,
  gap: 1,
  fail: 0,
  pending: 2,
  milestones,
  secretValuesPrinted: false,
}));
