#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertAcquisitionSequence, assertClientDatabase, assertRequestChain,
  offlineBodies } from "./harness-proof.mjs";
import { comparePackagePayload, extractArchivePayload, verifyInstalledPackage } from "./package-binding.mjs";

const retainedEvidence = resolve(process.argv[2]);
const appRoot = resolve(process.argv[3]);
const archivePath = resolve(process.argv[4]);
const auditRoot = resolve(process.argv[5]);
const expectedArchiveSha256 = process.argv[6];
const partialEvidence = process.argv[7] ? resolve(process.argv[7]) : null;
await mkdir(auditRoot, { recursive: true });

const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const clone = value => structuredClone(value);
const sha256File = async path => createHash("sha256").update(await readFile(path)).digest("hex");
const cases = [];

async function rejection(name, run) {
  try { await run(); }
  catch (error) {
    cases.push({ name, outcome: "rejected", error: error instanceof Error ? error.message : String(error) });
    return;
  }
  throw new Error(`negative control ${name} was accepted`);
}

function mutateJsonRow(database, table, predicate, mutate) {
  const row = database[table].find(predicate);
  if (!row) throw new Error(`control could not find ${table} row`);
  const value = JSON.parse(row.value);
  mutate(value);
  row.value = JSON.stringify(value);
}

const resultPath = join(retainedEvidence, "result.json");
const queuedPath = join(retainedEvidence, "after-first-termination-client-sqlite.json");
const settledPath = join(retainedEvidence, "after-second-termination-client-sqlite.json");
const finalPath = join(retainedEvidence, "after-final-termination-client-sqlite.json");
const [result, queuedDatabase, settledDatabase, finalDatabase] = await Promise.all([
  readJson(resultPath), readJson(queuedPath), readJson(settledPath), readJson(finalPath),
]);
const ids = result.operationIds;
const queued = assertClientDatabase(queuedDatabase, ids, offlineBodies, "queued", "retained queued");
const settled = assertClientDatabase(settledDatabase, ids, offlineBodies, "committed", "retained settled",
  ["acquiring"], queued.requests);
const final = assertClientDatabase(finalDatabase, ids, offlineBodies, "committed", "retained final",
  ["acquiring"], queued.requests);
const acquisition = assertAcquisitionSequence([queued, settled, final]);
const terminals = assertRequestChain({ proofs: [queued, { ...queued, label: "retained queued reopen surrogate" }, settled, final],
  replayRequests: result.replayRequests, serverAudit: result.serverAudit,
  settledOperations: result.reports.settled.details.operations, finalOperations: result.reports.final.details.operations });
cases.push({ name: "retained-actual-positive", outcome: "accepted", acquisition,
  requestDigests: terminals.map(row => ({ intent: row.intent, requestDigest: row.request_digest, seq: row.seq })) });

if (partialEvidence) {
  const freshQueuedPath = join(partialEvidence, "after-first-termination-client-sqlite.json");
  const freshReopenedPath = join(partialEvidence, "after-offline-reopen-client-sqlite.json");
  const [freshQueuedDatabase, freshReopenedDatabase] = await Promise.all([
    readJson(freshQueuedPath), readJson(freshReopenedPath),
  ]);
  const freshIds = freshQueuedDatabase.operations.map(row => row.id);
  const freshQueued = assertClientDatabase(freshQueuedDatabase, freshIds, offlineBodies, "queued", "fresh partial queued");
  const freshReopened = assertClientDatabase(freshReopenedDatabase, freshIds, offlineBodies, "queued",
    "fresh partial reopened", ["ready", "acquiring"], freshQueued.requests);
  cases.push({ name: "fresh-partial-ready-reopen-positive", outcome: "accepted",
    acquisition: assertAcquisitionSequence([freshQueued, freshReopened]),
    inputs: { queuedSha256: await sha256File(freshQueuedPath), reopenedSha256: await sha256File(freshReopenedPath) } });
}

const extraction = join(auditRoot, "archive-payload");
const archivePackageRoot = await extractArchivePayload(archivePath, extraction);
const packageBinding = await verifyInstalledPackage({ archivePath, archivePackageRoot, appRoot,
  expectedArchiveSha256, label: "audit actual installed package" });
cases.push({ name: "installed-package-positive", outcome: "accepted", archiveSha256: packageBinding.archiveSha256,
  installedManifestSha256: packageBinding.manifestSha256, files: packageBinding.files,
  resolvedEntry: packageBinding.resolvedEntry });

await rejection("corrupted-checkpoint-authority", () => {
  const changed = clone(settledDatabase);
  mutateJsonRow(changed, "acquisitions", row => row.key === "native-room-history", value => { value.principal = "dev:bob"; });
  assertClientDatabase(changed, ids, offlineBodies, "committed", "authority control", ["acquiring"], queued.requests);
});

await rejection("corrupted-acquisition-row-link", () => {
  const changed = clone(settledDatabase);
  mutateJsonRow(changed, "acquisitionResources", () => true,
    value => { value.rowVersionKeys[0] = "0".repeat(64); });
  assertClientDatabase(changed, ids, offlineBodies, "committed", "row-link control", ["acquiring"], queued.requests);
});

await rejection("changed-non-body-argument", () => {
  const replayRequests = clone(result.replayRequests);
  replayRequests[0].args.clientTag = "changed-with-same-body";
  assertRequestChain({ proofs: [queued, queued, settled, final], replayRequests, serverAudit: result.serverAudit,
    settledOperations: result.reports.settled.details.operations, finalOperations: result.reports.final.details.operations });
});

await rejection("changed-plan-hash", () => {
  const replayRequests = clone(result.replayRequests);
  replayRequests[0].planHash = "f".repeat(64);
  assertRequestChain({ proofs: [queued, queued, settled, final], replayRequests, serverAudit: result.serverAudit,
    settledOperations: result.reports.settled.details.operations, finalOperations: result.reports.final.details.operations });
});

await rejection("mismatched-terminal", () => {
  const serverAudit = clone(result.serverAudit);
  const terminal = serverAudit.terminals.find(row => row.intent === ids[0]);
  terminal.response.seq += 1;
  assertRequestChain({ proofs: [queued, queued, settled, final], replayRequests: result.replayRequests, serverAudit,
    settledOperations: result.reports.settled.details.operations, finalOperations: result.reports.final.details.operations });
});

await rejection("mismatched-installed-package", () => {
  const changed = clone(packageBinding.installedManifest);
  const entry = changed.find(item => item.path === packageBinding.resolvedEntryRelative);
  entry.sha256 = "0".repeat(64);
  comparePackagePayload(packageBinding.archiveManifest, changed, "installed package mismatch control");
});

const audit = { ok: true, at: new Date().toISOString(), retainedEvidence,
  inputs: { resultSha256: await sha256File(resultPath), queuedSha256: await sha256File(queuedPath),
    settledSha256: await sha256File(settledPath), finalSha256: await sha256File(finalPath),
    archiveSha256: await sha256File(archivePath) },
  note: "The retained run has no reopened SQLite capture; its queued capture is used only as the positive request-chain surrogate. The fresh witness must capture the reopened database before replay.",
  cases };
await writeFile(join(auditRoot, "integrity-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, cases: cases.map(item => ({ name: item.name, outcome: item.outcome })) }, null, 2)}\n`);
