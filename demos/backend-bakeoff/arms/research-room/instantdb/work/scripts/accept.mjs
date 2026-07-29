import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  actors, adminDb, evidenceDir, fixture, queryRows, runtimeDir, scopedDb, settle,
  sha256, sourceBytes, target, tx, uuid, writeJson,
} from "./lib.mjs";

const db = await adminDb();
const a = await actors();
const f = await fixture();
const t = await target();
const alice = await scopedDb(a.alice.token);
const bob = await scopedDb(a.bob.token);
const mallory = await scopedDb(a.mallory.token);
const results = [];
const evidence = {};
const pass = (id, transport, authoritativeCheck, note, evidencePaths) =>
  results.push({ id, status: "pass", evidencePaths, transport, authoritativeCheck, note });
const gap = (id, note, evidencePaths) =>
  results.push({ id, status: "gap", evidencePaths, transport: "not-applicable", authoritativeCheck: "explicit nonclaim", note });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const save = async (name, data) => {
  const rel = `evidence/${name}`;
  await writeJson(path.join(evidenceDir, name), { schemaVersion: 1, ...data, containsCredentialValues: false });
  return rel;
};
const query = async (client, q) => client.query(q);

// RESEARCH-01
const seeded = await query(db, {
  rooms: { members: {}, sources: { file: {} } },
  profiles: {},
  $users: {},
});
const primary = seeded.rooms.find((r) => r.id === f.rooms[0]);
assert(seeded.rooms.length === 2 && primary.sources.length === 20 && seeded.profiles.length === 3, "seed counts drifted");
assert(primary.sources.every((s) => Array.isArray(s.embedding) && s.embedding.length === 32), "embedding shape drifted");
const identityPath = await save("target-identity.json", {
  target: {
    title: "llp0102-research-instantdb-w3-a1",
    idSha256: sha256(t.appId),
    profile: "official hosted temporary Instant app",
    freshByConstruction: true,
  },
  actors: Object.fromEntries(Object.entries(a).map(([name, x]) => [name, {
    principalIdSha256: sha256(x.userId),
    role: name === "mallory" ? "outsider" : "room-member",
  }])),
});
pass("RESEARCH-01-SEED", "native-instaql", "admin query counts and deterministic embedding dimensions", "Exact frozen dataset exists.", [
  identityPath, "evidence/seed-receipt.json",
]);

// RESEARCH-02: user-scoped upload, member query/delivery, owner deletion.
const uploadBytes = sourceBytes(21);
const uploadPath = `${a.alice.userId}/acceptance/source-21.txt`;
const uploaded = await alice.storage.uploadFile(uploadPath, uploadBytes, { contentType: "text/plain" });
const uploadSourceId = uuid();
await alice.transact(tx.sources[uploadSourceId].update({
  title: "Authorized acceptance upload",
  body: "authorized file evidence",
  contentHash: sha256(uploadBytes),
  byteLength: uploadBytes.length,
  embedding: Array(32).fill(0.21),
  createdAt: Date.now(),
}).link({ room: f.rooms[0], owner: f.profiles.alice, file: uploaded.data.id }));
const bobFileQuery = await query(bob, {
  sources: { $: { where: { id: uploadSourceId } }, file: {} },
});
assert(bobFileQuery.sources.length === 1 && bobFileQuery.sources[0].file?.id === uploaded.data.id, "Bob did not receive file metadata");
const delivery = await fetch(bobFileQuery.sources[0].file.url);
const deliveredBytes = Buffer.from(await delivery.arrayBuffer());
assert(delivery.ok && sha256(deliveredBytes) === sha256(uploadBytes), "authorized file delivery hash mismatch");
const malloryFileQuery = await query(mallory, {
  sources: { $: { where: { id: uploadSourceId } }, file: {} },
});
assert(malloryFileQuery.sources.length === 0, "STOP: Mallory retrieved protected file metadata");
await alice.transact(tx.sources[uploadSourceId].delete());
await alice.transact(tx.$files[uploaded.data.id].delete());
const postDeleteFile = await query(db, { $files: { $: { where: { id: uploaded.data.id } } } });
const postDeleteSource = await query(db, { sources: { $: { where: { id: uploadSourceId } } } });
assert(postDeleteFile.$files.length === 0 && postDeleteSource.sources.length === 0, "uploaded objects survived deletion");
const filePath = await save("file-proof.json", {
  objectIdSha256: sha256(uploaded.data.id),
  pathSha256: sha256(uploadPath),
  contentHash: sha256(uploadBytes),
  authority: { uploader: "alice-user-scope", deliveryObserver: "bob-user-scope", outsiderMetadataRows: 0 },
  deleteProof: { fileRows: 0, sourceRows: 0 },
});
pass("RESEARCH-02-FILES", "instant-storage-plus-instaql", "user-scoped upload/query/delete and fetched-byte hash", "Ownership-preserving file lifecycle passed.", [filePath]);

// RESEARCH-03: outsider query and live subscription.
const outsiderQuery = await query(mallory, {
  rooms: { sources: {}, questions: { progress: {}, answer: {} }, answers: {} },
  sources: {},
  questions: { progress: {}, answer: {} },
  answers: {},
  progress: {},
});
assert(Object.values(outsiderQuery).every((rows) => rows.length === 0), "STOP: Mallory retrieved protected room content");
const outsiderSub = mallory.subscribeQuery({ questions: { progress: {}, answer: {} } });
const outsiderPayload = await Promise.race([
  outsiderSub[Symbol.asyncIterator]().next(),
  settle(8000).then(() => ({ timeout: true })),
]);
outsiderSub.close();
assert(!outsiderPayload.timeout, "Mallory negative subscription did not settle");
assert(outsiderPayload.value?.type === "ok" && outsiderPayload.value.data.questions.length === 0, "STOP: Mallory subscription disclosed room data");
const outsiderPath = await save("outsider-negative.json", {
  queryCounts: Object.fromEntries(Object.entries(outsiderQuery).map(([k, rows]) => [k, rows.length])),
  subscription: { transport: "InstantDB admin subscribeQuery/EventSource", rows: 0 },
  fileMetadataRows: malloryFileQuery.sources.length,
});
pass("RESEARCH-03-OUTSIDER", "native-instaql-and-eventsource", "Mallory-scoped query and subscription return zero rows", "No outsider disclosure.", [outsiderPath, filePath]);

// RESEARCH-04
const keywordResult = await query(alice, {
  sources: {
    $: { where: { "room.id": f.rooms[0], body: { $ilike: "%climate%" } } },
  },
});
const keywordTitles = keywordResult.sources.map((s) => s.title).sort();
const expectedTitles = [1, 5, 9, 13, 17].map((n) => `Source ${String(n).padStart(2, "0")} climate`);
assert(JSON.stringify(keywordTitles) === JSON.stringify(expectedTitles), "keyword expected set mismatch");
const keywordPath = await save("keyword-proof.json", {
  path: "ordinary indexed InstaQL $ilike query",
  expectedTitles,
  authoritativeTitles: keywordTitles,
});
pass("RESEARCH-04-KEYWORD", "native-instaql", "Alice-scoped indexed $ilike result equality", "Frozen expected set returned.", [keywordPath]);

// RESEARCH-05: honest gap; embeddings are retained but no native vector query exists.
const semanticPath = await save("semantic-gap.json", {
  status: "explicit-gap",
  retainedEmbeddingDimensions: 32,
  providerOrdinaryPathFound: false,
  nonclaim: "No provider-native vector similarity index/query path was available in the tested InstantDB product surface. Deterministic embeddings are stored but no custom cosine fallback is presented as native semantic retrieval.",
});
gap("RESEARCH-05-SEMANTIC", "InstantDB stores the embedding JSON, but the tested ordinary path has no native vector similarity query.", [semanticPath]);

// RESEARCH-06/07/08: durable progress, answer citations, and Bob native SSE observation.
const qId = uuid();
const qKey = "q-live-001";
await alice.transact(tx.questions[qId].update({
  questionKey: qKey,
  dedupeKey: "dedupe-live-001",
  prompt: "What evidence connects urban heat and climate adaptation?",
  status: "running",
  progressCount: 0,
  terminal: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}).link({ room: f.rooms[0], asker: f.profiles.alice }));
const bobSub = bob.subscribeQuery({
  questions: {
    $: { where: { id: qId } },
    progress: { $: { order: { ordinal: "asc" } } },
    answer: {},
  },
});
const observed = [];
let subscriptionError = null;
const observer = (async () => {
  for await (const payload of bobSub) {
    if (payload.type === "error") { subscriptionError = "provider-subscription-error"; break; }
    const row = payload.data.questions[0];
    if (row) {
      observed.push({
        at: Date.now(),
        status: row.status,
        ordinals: (row.progress ?? []).map((p) => p.ordinal),
        answerCount: row.answer ? 1 : 0,
      });
      if (row.status === "complete") break;
    }
  }
})();
await settle(500);
for (let ordinal = 1; ordinal <= 4; ordinal++) {
  const progressId = uuid();
  await alice.transact([
    tx.progress[progressId].update({
      progressKey: `${qKey}:${ordinal}`,
      ordinal,
      message: ["reading", "retrieving", "citing", "synthesizing"][ordinal - 1],
      durable: true,
      createdAt: Date.now(),
    }).link({ question: qId }),
    tx.questions[qId].update({ progressCount: ordinal, updatedAt: Date.now() }),
  ]);
  await settle(180);
}
const answerId = uuid();
const citations = [f.sources[0], f.sources[4], f.sources[8]];
await alice.transact(tx.answers[answerId].update({
  answerKey: "answer-live-001",
  questionKey: qKey,
  text: "Deterministic synthesis grounded in the room sources.",
  citations,
  status: "complete",
  createdAt: Date.now(),
}).link({ question: qId, room: f.rooms[0] }));
await alice.transact(tx.questions[qId].update({ status: "complete", terminal: true, updatedAt: Date.now() }));
await Promise.race([observer, settle(10000)]);
bobSub.close();
assert(!subscriptionError, "Bob subscription errored");
const authoritativeLive = await query(db, {
  questions: { $: { where: { id: qId } }, progress: { $: { order: { ordinal: "asc" } } }, answer: {} },
});
const qLive = authoritativeLive.questions[0];
assert(qLive.progress.length === 4 && qLive.progress.every((p, i) => p.ordinal === i + 1), "durable progress sequence invalid");
assert(qLive.status === "complete" && qLive.answer, "terminal order invalid");
assert(citations.every((id) => primary.sources.some((s) => s.id === id)), "citation points outside authorized sources");
assert(observed.some((o) => o.ordinals.length >= 4) && observed.some((o) => o.status === "complete"), "Bob missed live progress/terminal state");
const progressPath = await save("progress-collaboration-proof.json", {
  questionKey: qKey,
  authoritativeSequence: qLive.progress.map((p) => ({ ordinal: p.ordinal, durable: p.durable, message: p.message })),
  terminalStatus: qLive.status,
  terminalObservedAfterFour: true,
  bobSecondClient: {
    transport: "InstantDB admin subscribeQuery over provider EventSource",
    transitionCount: observed.length,
    observations: observed,
  },
});
const citationsPath = await save("citation-proof.json", {
  answerKey: qLive.answer.answerKey,
  citationIdHashes: citations.map(sha256),
  authorizedSourceValidation: citations.map((id) => ({ idSha256: sha256(id), existsInRoom: true })),
});
pass("RESEARCH-06-PROGRESS", "native-instaql-mutations-and-eventsource", "admin query ordered durable rows before terminal", "Four durable progress rows precede completion.", [progressPath]);
pass("RESEARCH-07-CITATIONS", "native-instaql", "answer citations resolve to authoritative member-visible sources", "Citations are retained and valid.", [citationsPath]);
pass("RESEARCH-08-COLLABORATOR", "native-eventsource-subscribeQuery", "Bob-scoped second client observed four-row state and completion", "Native live query observation passed.", [progressPath]);

// RESEARCH-09: cancellation denies a late durable progress patch under user rules.
const cancelId = uuid();
await alice.transact(tx.questions[cancelId].update({
  questionKey: "q-cancel-001", dedupeKey: "dedupe-cancel-001", prompt: "cancel me",
  status: "running", progressCount: 0, terminal: false, createdAt: Date.now(), updatedAt: Date.now(),
}).link({ room: f.rooms[0], asker: f.profiles.alice }));
await alice.transact(tx.questions[cancelId].update({ status: "cancelled", terminal: true, updatedAt: Date.now() }));
let lateRejected = false;
try {
  await alice.transact(tx.progress[uuid()].update({
    progressKey: "q-cancel-001:late", ordinal: 99, message: "late", durable: true, createdAt: Date.now(),
  }).link({ question: cancelId }));
} catch {
  lateRejected = true;
}
const cancelled = await query(db, { questions: { $: { where: { id: cancelId } }, progress: {} } });
assert(lateRejected && cancelled.questions[0].progress.length === 0 && cancelled.questions[0].status === "cancelled", "STOP: late durable patch survived confirmed cancellation");
const cancelPath = await save("cancel-proof.json", {
  settlement: "confirmed-cancelled",
  lateAttemptInjected: true,
  lateAttemptRejectedBy: "InstantDB permission reads linked question.status",
  authoritativeLateProgressRows: 0,
});
pass("RESEARCH-09-CANCEL", "native-permissioned-transaction", "cancelled status plus zero authoritative progress after injected late write", "Cancellation blocks late durable patches.", [cancelPath]);

// RESEARCH-10: deterministic dedupe keys and unique constraints.
const retryId = uuid();
const retryPayload = tx.questions[retryId].update({
  questionKey: "q-retry-001", dedupeKey: "dedupe-retry-001", prompt: "retry me",
  status: "running", progressCount: 0, terminal: false, createdAt: Date.now(), updatedAt: Date.now(),
}).link({ room: f.rooms[0], asker: f.profiles.alice });
await alice.transact(retryPayload);
await alice.transact(retryPayload);
const retryAnswerId = uuid();
const retryAnswerPayload = tx.answers[retryAnswerId].update({
  answerKey: "answer-retry-001", questionKey: "q-retry-001", text: "single answer",
  citations: [f.sources[0]], status: "complete", createdAt: Date.now(),
}).link({ question: retryId, room: f.rooms[0] });
await alice.transact(retryAnswerPayload);
await alice.transact(retryAnswerPayload);
await alice.transact(tx.questions[retryId].update({ status: "complete", terminal: true, updatedAt: Date.now() }));
const retryCounts = await query(db, {
  questions: { $: { where: { dedupeKey: "dedupe-retry-001" } }, answer: {} },
  answers: { $: { where: { questionKey: "q-retry-001" } } },
});
assert(retryCounts.questions.length === 1 && retryCounts.answers.length === 1, "retry duplicated question or answer");
const retryPath = await save("retry-proof.json", {
  dedupeKey: "dedupe-retry-001",
  repeatedIdenticalTransactions: 2,
  authoritativeQuestionCount: 1,
  authoritativeAnswerCount: 1,
  mechanism: "stable entity ids plus unique indexed dedupe/question keys",
});
pass("RESEARCH-10-RETRY", "native-atomic-upsert", "authoritative unique-key counts after repeated transactions", "Retry remained idempotent.", [retryPath]);

// RESEARCH-11: preserve distinct settlement outcomes.
const outcomes = ["complete", "failed", "cancelled", "timed-out", "ambiguous"];
for (const outcome of outcomes) {
  const outcomeQ = uuid();
  const attemptId = uuid();
  await alice.transact([
    tx.questions[outcomeQ].update({
      questionKey: `q-outcome-${outcome}`, dedupeKey: `dedupe-outcome-${outcome}`,
      prompt: `fault ${outcome}`, status: outcome, progressCount: 0, terminal: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    }).link({ room: f.rooms[0], asker: f.profiles.alice }),
    tx.effectAttempts[attemptId].update({
      attemptKey: `attempt-${outcome}`, dedupeKey: `effect-${outcome}`,
      outcome, settlement: outcome === "ambiguous" ? "unknown-after-dispatch" : `confirmed-${outcome}`,
      detail: `deterministic fault injection: ${outcome}`, createdAt: Date.now(),
    }).link({ question: outcomeQ }),
  ]);
}
const outcomeRows = await query(db, {
  questions: { $: { where: { questionKey: { $like: "q-outcome-%" } } }, attempts: {} },
});
const retainedOutcomes = outcomeRows.questions.map((q) => q.status).sort();
assert(outcomes.every((x) => retainedOutcomes.includes(x)), "distinct outcomes collapsed");
const outcomePath = await save("outcomes-proof.json", {
  injected: outcomes,
  authoritativeStatuses: retainedOutcomes,
  settlementRecords: outcomeRows.questions.map((q) => ({
    questionKey: q.questionKey,
    status: q.status,
    settlement: q.attempts[0]?.settlement,
  })),
});
pass("RESEARCH-11-OUTCOMES", "native-instaql", "authoritative state-machine rows and settlement records", "All five outcomes remain distinct.", [outcomePath]);

// RESEARCH-12/13: honest gaps in the tested native surface.
const schedulePath = await save("schedule-gap.json", {
  status: "explicit-gap",
  providerNativeSchedulerFound: false,
  nonclaim: "No first-party scheduler/cron execution surface was available in the tested InstantDB application path; no local timer is misrepresented as provider scheduling.",
});
gap("RESEARCH-12-SCHEDULE", "No provider-native scheduled function path was available in the tested InstantDB product surface.", [schedulePath]);
const secretCanary = "LLP0102_INSTANT_CANARY_DO_NOT_PERSIST";
const builtClientPath = path.join(runtimeDir, "secret-canary.txt");
await writeJson(builtClientPath, { canary: secretCanary }, 0o600);
const secretsPath = await save("secrets-gap.json", {
  status: "explicit-gap",
  serverSideSecretFacilityFound: false,
  canarySha256: sha256(secretCanary),
  runtimeCanaryLocation: "ignored mode-0600 file deleted during cleanup",
  nonclaim: "The tested InstantDB target has an admin token boundary, but no provider-hosted function plus secret configuration surface for the scheduled external fetch. The admin token never enters authored client code or retained evidence.",
});
gap("RESEARCH-13-SECRETS", "Credential hygiene passed, but the required provider-hosted function/secret boundary is absent with the unavailable schedule path.", [secretsPath]);

// RESEARCH-14: online path samples (build/deploy is measured separately).
const samplePath = async (name, fn) => {
  const raw = [];
  for (let i = 0; i < 9; i++) {
    const start = performance.now();
    await fn(i);
    raw.push(Number((performance.now() - start).toFixed(3)));
  }
  const recorded = raw.slice(2);
  const sorted = [...recorded].sort((x, y) => x - y);
  return {
    path: name, warmups: raw.slice(0, 2), samples: recorded,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    nearestRankP95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1],
  };
};
const readPerf = await samplePath("representative-read", async () => {
  await alice.query({ sources: { $: { where: { "room.id": f.rooms[0], body: { $ilike: "%climate%" } } } } });
});
const perfQ = uuid();
await alice.transact(tx.questions[perfQ].update({
  questionKey: "q-perf-001", dedupeKey: "dedupe-perf-001", prompt: "performance",
  status: "running", progressCount: 0, terminal: false, createdAt: Date.now(), updatedAt: Date.now(),
}).link({ room: f.rooms[0], asker: f.profiles.alice }));
const writePerf = await samplePath("representative-write", async (i) => {
  const id = uuid();
  await alice.transact(tx.effectAttempts[id].update({
    attemptKey: `perf-write-${i}`, dedupeKey: `perf-write-dedupe-${i}`, outcome: "complete",
    settlement: "confirmed-complete", detail: "performance sample", createdAt: Date.now(),
  }).link({ question: perfQ }));
});
const realtimePerf = await samplePath("realtime-delivery", async (i) => {
  const sub = bob.subscribeQuery({ progress: { $: { where: { progressKey: `perf-progress-${i}` } } } });
  const next = sub[Symbol.asyncIterator]().next();
  await settle(60);
  const id = uuid();
  const startPayload = tx.progress[id].update({
    progressKey: `perf-progress-${i}`, ordinal: i + 1, message: "perf", durable: true, createdAt: Date.now(),
  }).link({ question: perfQ });
  await bob.transact(startPayload);
  let payload = await next;
  while (!payload.done && payload.value.type === "ok" && payload.value.data.progress.length === 0) {
    payload = await sub[Symbol.asyncIterator]().next();
  }
  sub.close();
  assert(payload.value?.type === "ok" && payload.value.data.progress.length === 1, "realtime sample missing");
});
const reconnectPerf = await samplePath("reconnect", async () => {
  const sub = bob.subscribeQuery({ questions: { $: { where: { id: qId } } } });
  const first = await sub[Symbol.asyncIterator]().next();
  sub.close();
  assert(first.value?.type === "ok" && first.value.data.questions.length === 1, "reconnect initial state missing");
});
evidence.performance = [readPerf, writePerf, realtimePerf, reconnectPerf];
await writeJson(path.join(runtimeDir, "acceptance-results.precleanup.json"), { results }, 0o600);
await save("performance-online-samples.json", {
  claimScope: "small repeatable frozen product workload; not production scale",
  protocol: { warmups: 2, recordedSamples: 7, statistic: "median and nearest-rank p95" },
  paths: evidence.performance,
});
await save("cost-window.json", {
  beganAt: "2026-07-29T10:35:27.074Z",
  providerPlan: "temporary managed app; provider-selected limits",
  actualProviderUsage: "not exposed at arm granularity",
  listPriceEstimate: "$0 for the temporary application lifecycle under provider-selected temporary-app policy",
  extrapolationCountsAsMeasured: false,
});
await writeJson(path.join(runtimeDir, "acceptance-runtime.json"), {
  qId, cancelId, retryId, perfQ, targetIdSha256: sha256(t.appId),
}, 0o600);
process.stdout.write(JSON.stringify({
  ok: true,
  preCleanupResults: results.map(({ id, status }) => ({ id, status })),
  onlinePerformancePaths: evidence.performance.length,
}) + "\n");
