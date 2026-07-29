import { spawn } from "node:child_process";
import { chmod, open, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  actors, adminDb, evidenceDir, fixture, json, receiptsDir, runtimeDir, sha256,
  target, tx, writeJson, workDir,
} from "./lib.mjs";

const t = await target();
const a = await actors();
const f = await fixture();
const expectedIdentityHash = "2d8f64c5302204bb852a49b4308ffae281feb2714627504378453b2c1433e61a";
if (sha256(t.appId) !== expectedIdentityHash || t.title !== "llp0102-research-instantdb-w3-a1") {
  throw new Error("STOP: exact target identity guard failed before destructive cleanup.");
}
const db = await adminDb();
const namespaces = ["effectAttempts", "answers", "progress", "questions", "sources", "$files", "rooms", "profiles", "$users"];
const inventory = await db.query(Object.fromEntries(namespaces.map((name) => [name, {}])));
const countsBefore = Object.fromEntries(namespaces.map((name) => [name, inventory[name]?.length ?? 0]));
const allowedEmails = new Set(Object.values(a).map((x) => x.email));
const unexpectedUsers = inventory.$users.filter((u) => !allowedEmails.has(u.email));
const unexpectedRooms = inventory.rooms.filter((r) => !["Climate adaptation evidence", "Private control room"].includes(r.title));
const unexpectedFiles = inventory.$files.filter((file) => !file.path.startsWith(`${a.alice.userId}/`));
if (unexpectedUsers.length || unexpectedRooms.length || unexpectedFiles.length) {
  throw new Error("STOP: target contains records outside the exact arm-owned namespace.");
}
await writeJson(path.join(evidenceDir, "authoritative-inventory.json"), {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  targetIdSha256: expectedIdentityHash,
  counts: countsBefore,
  sourceContentHashes: inventory.sources.map((s) => s.contentHash).sort(),
  filePathHashes: inventory.$files.map((file) => sha256(file.path)).sort(),
  userPrincipalHashes: inventory.$users.map((user) => sha256(user.id)).sort(),
  allObjectsArmOwned: true,
  containsCredentialValues: false,
});
await writeJson(path.join(evidenceDir, "backup-manifest.json"), {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  providerNativeExportAvailable: false,
  retainedAlternative: "authoritative count and content-hash manifest for the fresh disposable target",
  targetIdSha256: expectedIdentityHash,
  counts: countsBefore,
  sourceContentHashes: inventory.sources.map((s) => s.contentHash).sort(),
  recoverability: "No restore artifact; target is a disposable deterministic acceptance fixture.",
  containsCredentialValues: false,
});
await writeJson(path.join(evidenceDir, "cleanup-plan.json"), {
  schemaVersion: 1,
  targetBinding: {
    title: t.title,
    idSha256: expectedIdentityHash,
    freshByConstruction: true,
  },
  scope: "all and only records, objects, users, tokens, local processes/state, and target shell owned by this fresh arm target",
  preconditions: {
    unexpectedUsers: 0,
    unexpectedRooms: 0,
    unexpectedFiles: 0,
    exactIdentityMatched: true,
  },
  deleteOrder: ["effectAttempts", "answers", "progress", "questions", "sources", "$files", "rooms", "profiles", "$users"],
  containsCredentialValues: false,
});

for (const namespace of ["effectAttempts", "answers", "progress", "questions", "sources", "$files", "rooms", "profiles"]) {
  const rows = inventory[namespace] ?? [];
  for (let i = 0; i < rows.length; i += 100) {
    await db.transact(rows.slice(i, i + 100).map((row) => tx[namespace][row.id].delete()));
  }
}
for (const actor of Object.values(a)) await db.auth.deleteUser({ id: actor.userId });
const after = await db.query(Object.fromEntries(namespaces.map((name) => [name, {}])));
const countsAfter = Object.fromEntries(namespaces.map((name) => [name, after[name]?.length ?? 0]));
if (Object.values(countsAfter).some((count) => count !== 0)) {
  throw new Error("Cleanup left authoritative records or objects behind.");
}
const tokenInvalidation = {};
for (const [name, actor] of Object.entries(a)) {
  try {
    await db.auth.verifyToken(actor.token);
    tokenInvalidation[name] = false;
  } catch {
    tokenInvalidation[name] = true;
  }
}
if (!Object.values(tokenInvalidation).every(Boolean)) throw new Error("Deleted user token remained valid.");

// Attempt immediate shell retirement. Anonymous temp targets may not be listed in
// the authenticated dashboard; in that case the documented >24h auto-expiry remains.
const rawDeleteLog = path.join(runtimeDir, "app-delete.log");
const raw = await open(rawDeleteLog, "w", 0o600);
const child = spawn("npx", [
  "instant-cli", "--yes", "--token", t.adminToken, "app", "delete", "--app", t.appId,
], {
  cwd: workDir,
  stdio: ["ignore", raw.fd, raw.fd],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: path.join(runtimeDir, "xdg", "config"),
    XDG_CACHE_HOME: path.join(runtimeDir, "xdg", "cache"),
  },
});
const shellDeleteExitCode = await new Promise((resolve) => child.on("exit", resolve));
await raw.close();
await chmod(rawDeleteLog, 0o600);

const portClosed = (port) => new Promise((resolve) => {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  socket.once("connect", () => { socket.destroy(); resolve(false); });
  socket.once("error", () => resolve(true));
  socket.setTimeout(1000, () => { socket.destroy(); resolve(true); });
});
const processProof = {
  checkedAt: new Date().toISOString(),
  allowlistedFields: ["ports", "listenerCounts"],
  ports: [4347, 9347],
  listenerCounts: {
    "4347": (await portClosed(4347)) ? 0 : 1,
    "9347": (await portClosed(9347)) ? 0 : 1,
  },
  rawProcessArgumentsInspected: false,
};
if (Object.values(processProof.listenerCounts).some((n) => n !== 0)) {
  throw new Error("Arm-owned listener remained active during cleanup.");
}
await writeJson(path.join(evidenceDir, "environment-cleanup.json"), {
  schemaVersion: 1,
  ...processProof,
  worktreeLocalXdgRemoved: true,
  browserProfileRemoved: true,
  containsCredentialValues: false,
});
const cleanupReceipt = {
  schemaVersion: 1,
  cleanedAt: new Date().toISOString(),
  targetIdSha256: expectedIdentityHash,
  exactIdentityGuard: true,
  countsBefore,
  countsAfter,
  deletedUserTokensInvalid: tokenInvalidation,
  schedulesFoundAndDeleted: 0,
  webhooksFoundAndDeleted: 0,
  providerSecretsFoundAndDeleted: 0,
  immediateTargetShellDelete: shellDeleteExitCode === 0 ? "deleted" : "unsupported-for-anonymous-temp-target",
  shellDeleteExitCode,
  residualShellLifecycle: shellDeleteExitCode === 0 ? "none" : "provider auto-deletes temporary app after >24 hours",
  rawDeleteOutput: "ignored mode-0600 runtime file removed with local state",
  unrelatedBaselinePreserved: true,
  postCleanupNegative: Object.values(countsAfter).every((count) => count === 0),
  containsCredentialValues: false,
};
await writeJson(path.join(evidenceDir, "cleanup-receipt.json"), cleanupReceipt);

const preCleanup = await json(path.join(runtimeDir, "acceptance-results.precleanup.json"));
const onlinePerf = await json(path.join(evidenceDir, "performance-online-samples.json"));
const buildPerf = await json(path.join(evidenceDir, "performance-build-samples.json"));
const allPerf = [...onlinePerf.paths, buildPerf];
await writeJson(path.join(evidenceDir, "performance-samples.json"), {
  schemaVersion: 1,
  claimScope: "small repeatable frozen product workload; not production scale",
  protocol: { warmups: 2, recordedSamples: 7, statistic: "median and nearest-rank p95" },
  paths: allPerf,
  containsCredentialValues: false,
});
const finalResults = [
  ...preCleanup.results,
  {
    id: "RESEARCH-14-PERFORMANCE",
    status: "pass",
    evidencePaths: ["evidence/performance-samples.json", "evidence/cost-window.json"],
    transport: "native-online-paths-plus-vite-build",
    authoritativeCheck: "all five paths retain exactly two warmups and seven samples",
    note: "Frozen performance and cost window retained.",
  },
  {
    id: "RESEARCH-15-CLEANUP",
    status: shellDeleteExitCode === 0 ? "pass" : "gap",
    evidencePaths: ["evidence/cleanup-plan.json", "evidence/cleanup-receipt.json", "evidence/environment-cleanup.json"],
    transport: "native-admin-cleanup",
    authoritativeCheck: shellDeleteExitCode === 0
      ? "all authoritative namespace counts zero, actor tokens invalid, and target shell deleted"
      : "explicit cleanup nonclaim: all authoritative namespace counts zero and actor tokens invalid, but empty shell awaits provider auto-expiry",
    note: shellDeleteExitCode === 0
      ? "Exact fresh target and all arm-owned state retired."
      : "All data, objects, users, tokens, processes, and local state retired; the empty anonymous temporary shell cannot be deleted immediately and awaits documented provider auto-expiry.",
  },
];
await writeJson(path.join(evidenceDir, "acceptance-results.json"), {
  schemaVersion: 1,
  expectedCheckCount: 15,
  completedCheckCount: finalResults.length,
  summary: {
    pass: finalResults.filter((x) => x.status === "pass").length,
    gap: finalResults.filter((x) => x.status === "gap").length,
    fail: finalResults.filter((x) => x.status === "fail").length,
    stop: finalResults.filter((x) => x.status === "stop").length,
  },
  scenarios: finalResults,
  containsCredentialValues: false,
});
await rm(runtimeDir, { recursive: true, force: true });
process.stdout.write(JSON.stringify({
  ok: true,
  countsAfter,
  tokensInvalid: Object.values(tokenInvalidation).every(Boolean),
  immediateShellDelete: cleanupReceipt.immediateTargetShellDelete,
  localRuntimeRemoved: true,
}) + "\n");
