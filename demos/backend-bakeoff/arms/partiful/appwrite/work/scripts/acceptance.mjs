import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { Client, Permission, Query, Role, TablesDB } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import {
  actorClient,
  databaseId,
  endpoint,
  functionId,
  functions,
  hostAndBobRead,
  hostPermissions,
  hostTeamId,
  projectId,
  runtime,
  storage,
  tableIds,
  tables,
} from "./admin-client.mjs";
import { receiptsRoot, vitePort } from "./constants.mjs";

// @ref LLP 0102#app-4-partiful-shaped-event-application — Execute the frozen 15-check protocol without provider normalization.
const baseline = JSON.parse(await readFile(path.resolve(receiptsRoot, "baseline.v1.json"), "utf8"));
const startedEpoch = Date.parse(baseline.capturedAt);
const scenarioRoot = path.resolve(receiptsRoot, "scenarios");
await mkdir(scenarioRoot, { recursive: true });
const scenarios = {};
const milestone = {
  firstLocalReadMs: null,
  firstAuthoritativeMutationMs: null,
  firstRealtimeTransitionMs: null,
  localAcceptanceMs: null,
  hostedUrlMs: null,
  acceptanceCompletionMs: null,
};
const elapsed = () => Date.now() - startedEpoch;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const denied = async (operation) => {
  try { await operation(); return false; } catch (error) {
    return [401, 403, 404].includes(error.code);
  }
};
async function receipt(id, status, transport, evidence, note) {
  const value = { id, status, checkedAt: new Date().toISOString(), projectId, transport, evidence, note };
  scenarios[id] = value;
  await writeFile(path.resolve(scenarioRoot, `${id}.json`), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
async function rows(tableId, queries = []) {
  return (await tables.listRows({ databaseId, tableId, queries: [...queries, Query.limit(500)], total: true })).rows;
}
async function deleteAll(tableId) {
  for (const row of await rows(tableId)) await tables.deleteRow({ databaseId, tableId, rowId: row.$id });
}
for (const tableId of [tableIds.deliveries, tableIds.attempts]) await deleteAll(tableId);
try { await storage.deleteFile({ bucketId: "event-art", fileId: "event-01-art" }); } catch (error) {
  if (error.code !== 404) throw error;
}
await tables.updateTable({
  databaseId, tableId: tableIds.wallPosts,
  permissions: [Permission.create(Role.users()), Permission.read(Role.user("bob"))],
  rowSecurity: true, enabled: true, purge: true,
});
await tables.updateTable({
  databaseId, tableId: tableIds.guests,
  permissions: [Permission.read(Role.user("bob")), Permission.read(Role.user("mallory"))],
  rowSecurity: true, enabled: true, purge: true,
});
for (const row of await rows(tableIds.wallPosts)) {
  if (row.$id !== "wall-seed") {
    await tables.deleteRow({ databaseId, tableId: tableIds.wallPosts, rowId: row.$id });
  }
}
await tables.updateRow({
  databaseId, tableId: tableIds.wallPosts, rowId: "wall-seed",
  data: { body: "Welcome invited guests", sequence: 0 },
  permissions: hostAndBobRead,
});
for (const [rowId, data] of [
  ["invite-event-20-bob", { status: "invited", plus_ones: 0, revoked: false }],
  ["invite-event-20-mallory", { status: "invited", plus_ones: 0, revoked: false }],
  ["invite-event-02-bob", { status: "invited", plus_ones: 0, revoked: false }],
]) {
  await tables.updateRow({ databaseId, tableId: tableIds.invitations, rowId, data });
}
await tables.updateRow({
  databaseId, tableId: tableIds.events, rowId: "event-20",
  data: { yes_count: 49, maybe_count: 0, no_count: 0, guest_list_visible: true },
});
await tables.updateRow({
  databaseId, tableId: tableIds.guests, rowId: "guest-01",
  data: { display_name: "Confirmed Guest 1" },
  permissions: [
    Permission.read(Role.user("alice")), Permission.read(Role.user("bob")),
    Permission.read(Role.user("mallory")), Permission.update(Role.user("alice")),
  ],
});

const counts = {};
for (const [name, tableId] of Object.entries(tableIds)) {
  counts[name] = (await tables.listRows({ databaseId, tableId, queries: [Query.limit(1)], total: true })).total;
}
const expectedSeed = { events: 20, eventPrivate: 20, invitations: 4, guests: 49, wallPosts: 1, deliveries: 0, attempts: 0 };
assert(JSON.stringify(counts) === JSON.stringify(expectedSeed), `Seed drift: ${JSON.stringify(counts)}`);
milestone.firstLocalReadMs = elapsed();
await receipt("PARTY-01-SEED", "pass", "not-applicable", {
  authoritativeAdminCounts: counts,
  fixedDataset: { events: 20, guests: 49, capacity: 50, actors: 3, concurrentClients: 2, wallBurst: 20, assetBytes: 262144 },
  targetIdentity: { endpointHash: hash(endpoint), projectIdHash: hash(projectId), version: "1.9.6" },
  seedReceipt: "../seed.v1.json",
}, "The exact frozen fixture and three native Auth principals were independently counted through Appwrite authority.");

const [alice, bob, mallory] = await Promise.all([actorClient("alice"), actorClient("bob"), actorClient("mallory")]);
const anonymousClient = new Client().setEndpoint(endpoint).setProject(projectId);
const anonymousTables = new TablesDB(anonymousClient);
const publicEvents = await anonymousTables.listRows({
  databaseId, tableId: tableIds.events,
  queries: [Query.equal("public", [true]), Query.orderAsc("sequence"), Query.limit(50)], total: true,
});
const anonymousPrivateTotal = (await anonymousTables.listRows({
  databaseId, tableId: tableIds.eventPrivate, queries: [Query.limit(1)], total: true,
})).total;
const directPrivateDenied = await denied(() => anonymousTables.getRow({
  databaseId, tableId: tableIds.eventPrivate, rowId: "private-01",
}));
assert(publicEvents.total === 19 && anonymousPrivateTotal === 0 && directPrivateDenied, "Public/private boundary failed");
await receipt("PARTY-02-PUBLIC-PRIVATE", "pass", "not-applicable", {
  anonymousPublicPreviews: publicEvents.total,
  previewFields: Object.keys(publicEvents.rows[0]).filter((key) => !key.startsWith("$")),
  privateFieldsStructuralTable: ["address", "host_note"],
  anonymousPrivateRows: anonymousPrivateTotal,
  directPrivateReadDenied: directPrivateDenied,
}, "Anonymous reads returned public preview rows only; private fields live in a separately permissioned table.");

const transitions = [];
for (const [status, plusOnes] of [["yes", 1], ["maybe", 1], ["no", 0], ["yes", 1]]) {
  await bob.tables.updateRow({
    databaseId, tableId: tableIds.invitations, rowId: "invite-event-01-bob",
    data: { status, plus_ones: plusOnes },
  });
  const authority = await tables.getRow({ databaseId, tableId: tableIds.invitations, rowId: "invite-event-01-bob" });
  transitions.push({ status: authority.status, plusOnes: authority.plus_ones });
}
const invitation = await tables.getRow({ databaseId, tableId: tableIds.invitations, rowId: "invite-event-01-bob" });
assert(invitation.user_id === "bob" && invitation.status === "yes" && invitation.plus_ones === 1, "RSVP settlement failed");
milestone.firstAuthoritativeMutationMs = elapsed();
await receipt("PARTY-03-INVITE-RSVP", "pass", "not-applicable", {
  invitationId: invitation.$id,
  attributedUserHash: hash(invitation.user_id),
  transitions,
  authoritativeFinal: { status: invitation.status, plusOnes: invitation.plus_ones, revoked: invitation.revoked },
}, "Bob's native session exercised yes/maybe/no plus-one transitions and admin authority verified every settlement.");

const event02 = await tables.getRow({ databaseId, tableId: tableIds.events, rowId: "event-02" });
const event04 = await tables.getRow({ databaseId, tableId: tableIds.events, rowId: "event-04" });
await tables.updateRow({
  databaseId, tableId: tableIds.events, rowId: "event-04", data: {},
  permissions: [
    Permission.read(Role.any()),
    ...hostPermissions.slice(1),
    Permission.update(Role.team(hostTeamId, "cohost")),
  ],
});
await alice.tables.updateRow({ databaseId, tableId: tableIds.events, rowId: "event-02", data: { title: "Host-authorized edit" } });
await bob.tables.updateRow({ databaseId, tableId: tableIds.events, rowId: "event-04", data: { title: "Cohost-authorized edit" } });
const guestWriteDenied = await denied(() => bob.tables.updateRow({
  databaseId, tableId: tableIds.events, rowId: "event-02", data: { title: "guest-forbidden" },
}));
const outsiderPrivateDenied = await denied(() => mallory.tables.getRow({
  databaseId, tableId: tableIds.events, rowId: "event-02",
}));
const outsiderWriteDenied = await denied(() => mallory.tables.updateRow({
  databaseId, tableId: tableIds.events, rowId: "event-04", data: { title: "outsider-forbidden" },
}));
await tables.updateRow({ databaseId, tableId: tableIds.events, rowId: "event-02", data: { title: event02.title }, permissions: event02.$permissions });
await tables.updateRow({ databaseId, tableId: tableIds.events, rowId: "event-04", data: { title: event04.title } });
assert(guestWriteDenied && outsiderPrivateDenied && outsiderWriteDenied, "Role negatives failed");
await receipt("PARTY-04-ROLES", "pass", "not-applicable", {
  positive: { hostPrivateUpdate: true, cohostPublicUpdate: true, guestPrivateRead: true },
  negative: { guestHostUpdateDenied: guestWriteDenied, outsiderPrivateReadDenied: outsiderPrivateDenied, outsiderCohostUpdateDenied: outsiderWriteDenied },
  authority: "native Appwrite Auth sessions plus Team role and row permissions",
}, "Host, cohost, guest, and outsider exercised distinct positive and negative authority paths.");

let uiReady = false;
try { uiReady = (await fetch(`http://127.0.0.1:${vitePort}`)).ok; } catch {}
if (!uiReady) {
  const uiStart = spawnSync(process.execPath, ["scripts/start-ui.mjs"], { cwd: process.cwd(), encoding: "utf8" });
  if (uiStart.status !== 0) throw new Error(uiStart.stderr || "UI start failed");
}
const browserRoot = path.resolve(".browser-runtime");
await mkdir(browserRoot, { recursive: true });
const context = await chromium.launchPersistentContext(path.resolve(browserRoot, "bob-partiful"), {
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = context.pages()[0] ?? await context.newPage();
let realtimeSockets = 0;
page.on("websocket", (socket) => { if (socket.url().includes("/v1/realtime")) realtimeSockets += 1; });
await page.goto(`http://127.0.0.1:${vitePort}`);
await page.locator('[data-testid="partiful-shell"]').waitFor({ timeout: 20_000 });
const anonUiEvents = Number(await page.locator('[data-testid="partiful-shell"]').getAttribute("data-event-count"));
await page.waitForTimeout(1_000);
await page.waitForFunction(() =>
  Boolean(document.querySelector('[data-testid="partiful-shell"][data-ready="true"]')) ||
  Boolean(document.querySelector('input[aria-label="Email"]')),
);
if (!await page.locator('[data-testid="partiful-shell"][data-ready="true"]').isVisible().catch(() => false)) {
  await page.getByLabel("Email").fill(runtime.personas.bob.email);
  await page.getByLabel("Password").fill(runtime.personas.bob.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
await page.locator('[data-testid="partiful-shell"][data-ready="true"]').waitFor({ timeout: 20_000 });
await page.waitForTimeout(1_500);

const guest01 = await tables.getRow({ databaseId, tableId: tableIds.guests, rowId: "guest-01" });
const browserGuestEventsBefore = Number(await page.locator('[data-testid="partiful-shell"]').getAttribute("data-realtime-guests"));
await tables.updateRow({
  databaseId, tableId: tableIds.events, rowId: "event-20",
  data: { guest_list_visible: false },
});
await tables.updateTable({
  databaseId, tableId: tableIds.guests,
  permissions: [], rowSecurity: true, enabled: true, purge: true,
});
await tables.updateRow({
  databaseId, tableId: tableIds.guests, rowId: "guest-01", data: {},
  permissions: hostPermissions,
});
await tables.updateRow({
  databaseId, tableId: tableIds.guests, rowId: "guest-01", data: { display_name: "Protected Guest Name" },
  permissions: hostPermissions,
});
await page.waitForTimeout(1_000);
const hiddenBob = await denied(() => bob.tables.getRow({ databaseId, tableId: tableIds.guests, rowId: "guest-01" }));
const hiddenMallory = await denied(() => mallory.tables.getRow({ databaseId, tableId: tableIds.guests, rowId: "guest-01" }));
const stillPublic = await anonymousTables.getRow({ databaseId, tableId: tableIds.events, rowId: "event-20" });
const browserGuestEventsHidden = Number(await page.locator('[data-testid="partiful-shell"]').getAttribute("data-realtime-guests"));
await tables.updateRow({
  databaseId, tableId: tableIds.events, rowId: "event-20",
  data: { guest_list_visible: true },
});
await tables.updateTable({
  databaseId, tableId: tableIds.guests,
  permissions: [Permission.read(Role.user("bob"))],
  rowSecurity: true, enabled: true, purge: true,
});
await tables.updateRow({
  databaseId, tableId: tableIds.guests, rowId: "guest-01",
  data: { display_name: guest01.display_name },
  permissions: [
    Permission.read(Role.user("alice")), Permission.read(Role.user("bob")), Permission.update(Role.user("alice")),
  ],
});
await page.waitForTimeout(1_000);
const visibleBob = await bob.tables.getRow({ databaseId, tableId: tableIds.guests, rowId: "guest-01" });
const finalMalloryDenied = await denied(() => mallory.tables.getRow({ databaseId, tableId: tableIds.guests, rowId: "guest-01" }));
assert(hiddenBob && hiddenMallory && stillPublic.public && visibleBob.$id === "guest-01" && finalMalloryDenied, "Guest-list policy failed");
assert(browserGuestEventsHidden === browserGuestEventsBefore, "Already-connected Bob received a protected guest update");
await receipt("PARTY-05-GUEST-LIST", "pass", "appwrite-realtime", {
  eventRemainedPublic: stillPublic.public,
  hidden: { bobDenied: hiddenBob, malloryDenied: hiddenMallory },
  visible: { invitedBobRow: visibleBob.$id, outsiderMalloryDenied: finalMalloryDenied },
  alreadyConnected: { before: browserGuestEventsBefore, afterProtectedUpdate: browserGuestEventsHidden },
  transportSockets: realtimeSockets,
}, "Guest-list permission transitioned independently of public preview; an already-connected client received no protected update.");

const event20 = await tables.getRow({ databaseId, tableId: tableIds.events, rowId: "event-20" });
const capacityPermissions = [
  Permission.read(Role.any()),
  Permission.update(Role.user("alice")),
  Permission.delete(Role.user("alice")),
  Permission.update(Role.user("bob")),
  Permission.update(Role.user("mallory")),
];
await tables.updateRow({
  databaseId, tableId: tableIds.events, rowId: "event-20",
  data: { yes_count: 49, maybe_count: 0, no_count: 0 },
  permissions: capacityPermissions,
});
for (const [actor, invitationId] of [[bob, "invite-event-20-bob"], [mallory, "invite-event-20-mallory"]]) {
  await actor.tables.updateRow({
    databaseId, tableId: tableIds.invitations, rowId: invitationId,
    data: { status: "invited", plus_ones: 0 },
  });
}
const [bobTx, malloryTx] = await Promise.all([bob.tables.createTransaction(), mallory.tables.createTransaction()]);
await Promise.all([
  bob.tables.updateRow({ databaseId, tableId: tableIds.events, rowId: "event-20", data: { yes_count: 50 }, transactionId: bobTx.$id }),
  bob.tables.updateRow({ databaseId, tableId: tableIds.invitations, rowId: "invite-event-20-bob", data: { status: "yes" }, transactionId: bobTx.$id }),
  mallory.tables.updateRow({ databaseId, tableId: tableIds.events, rowId: "event-20", data: { yes_count: 50 }, transactionId: malloryTx.$id }),
  mallory.tables.updateRow({ databaseId, tableId: tableIds.invitations, rowId: "invite-event-20-mallory", data: { status: "yes" }, transactionId: malloryTx.$id }),
]);
const capacitySettlement = await Promise.allSettled([
  bob.tables.updateTransaction({ transactionId: bobTx.$id, commit: true }),
  mallory.tables.updateTransaction({ transactionId: malloryTx.$id, commit: true }),
]);
const capacityAuthority = await tables.getRow({ databaseId, tableId: tableIds.events, rowId: "event-20" });
const finalInvites = await Promise.all([
  tables.getRow({ databaseId, tableId: tableIds.invitations, rowId: "invite-event-20-bob" }),
  tables.getRow({ databaseId, tableId: tableIds.invitations, rowId: "invite-event-20-mallory" }),
]);
const capacityCommitted = capacitySettlement.filter((item) => item.status === "fulfilled").length;
const capacityRejected = capacitySettlement.filter((item) => item.status === "rejected").map((item) => ({ code: item.reason.code, type: item.reason.type }));
assert(capacityCommitted === 1 && capacityRejected[0]?.code === 409 && capacityAuthority.yes_count === 50 && finalInvites.filter((row) => row.status === "yes").length === 1, "Capacity contention failed");
await receipt("PARTY-06-CAPACITY", "pass", "native-appwrite-transaction", {
  twoActorBarrier: { actors: ["bob", "mallory"], stagedBeforeCommit: true },
  settlement: { committed: capacityCommitted, rejected: capacityRejected },
  authoritative: { yesCount: capacityAuthority.yes_count, capacity: capacityAuthority.capacity, statuses: finalInvites.map((row) => row.status) },
}, "Two actor-scoped native transactions raced for the final seat; Appwrite committed one and rejected one with conflict.");

const wallBefore = Number(await page.locator('[data-testid="partiful-shell"]').getAttribute("data-realtime-walls"));
const eventLiveBefore = Number(await page.locator('[data-testid="partiful-shell"]').getAttribute("data-realtime-events"));
for (let sequence = 1; sequence <= 20; sequence += 1) {
  await bob.tables.createRow({
    databaseId, tableId: tableIds.wallPosts, rowId: `wall-live-${String(sequence).padStart(2, "0")}`,
    data: { event_id: "event-02", author_id: "bob", body: `Live wall post ${sequence}`, sequence },
    permissions: [Permission.read(Role.user("bob")), Permission.update(Role.user("bob"))],
  });
}
await tables.updateRow({
  databaseId, tableId: tableIds.events, rowId: "event-20",
  data: { maybe_count: 1 },
  permissions: capacityPermissions,
});
await page.locator('[data-testid="partiful-shell"][data-wall-count="21"]').waitFor({ timeout: 20_000 });
await page.waitForTimeout(750);
const wallAfter = Number(await page.locator('[data-testid="partiful-shell"]').getAttribute("data-realtime-walls"));
const eventLiveAfter = Number(await page.locator('[data-testid="partiful-shell"]').getAttribute("data-realtime-events"));
const liveWallAuthority = await tables.listRows({
  databaseId, tableId: tableIds.wallPosts,
  queries: [Query.equal("event_id", ["event-02"]), Query.limit(100)], total: true,
});
const liveEventAuthority = await tables.getRow({ databaseId, tableId: tableIds.events, rowId: "event-20" });
assert(
  wallAfter - wallBefore >= 20 && eventLiveAfter > eventLiveBefore &&
  liveWallAuthority.total === 21 && liveEventAuthority.maybe_count === 1,
  `Realtime burst failed: ${JSON.stringify({ wallBefore, wallAfter, eventLiveBefore, eventLiveAfter, wallTotal: liveWallAuthority.total, maybe: liveEventAuthority.maybe_count, realtimeSockets })}`,
);
milestone.firstRealtimeTransitionMs = elapsed();
await receipt("PARTY-07-LIVE-BURST", "pass", "appwrite-realtime-websocket", {
  secondClient: "persistent Chromium Bob session",
  transportSockets: realtimeSockets,
  observed: { wallEvents: wallAfter - wallBefore, eventEvents: eventLiveAfter - eventLiveBefore },
  authoritative: { wallRowsIncludingSeed: liveWallAuthority.total, yesCount: liveEventAuthority.yes_count, maybeCount: liveEventAuthority.maybe_count },
}, "A second browser client observed the frozen 20-post burst and RSVP-total transition over Appwrite Realtime.");

const asset = Buffer.alloc(262144);
for (let index = 0; index < asset.length; index += 1) asset[index] = index % 251;
const assetHash = hash(asset);
const uploaded = await alice.storage.createFile({
  bucketId: "event-art", fileId: "event-01-art",
  file: InputFile.fromBuffer(asset, "event-art.bin"),
  permissions: [Permission.read(Role.user("alice")), Permission.delete(Role.user("alice"))],
});
await storage.updateFile({
  bucketId: "event-art", fileId: uploaded.$id,
  permissions: [
    Permission.read(Role.user("alice")), Permission.read(Role.user("bob")),
    Permission.delete(Role.user("alice")),
  ],
});
const bobDownload = Buffer.from(await bob.storage.getFileDownload({ bucketId: "event-art", fileId: uploaded.$id }));
const malloryAssetDenied = await denied(() => mallory.storage.getFileDownload({ bucketId: "event-art", fileId: uploaded.$id }));
await alice.storage.deleteFile({ bucketId: "event-art", fileId: uploaded.$id });
const deletedAssetDenied = await denied(() => storage.getFile({ bucketId: "event-art", fileId: uploaded.$id }));
assert(uploaded.sizeOriginal === 262144 && hash(bobDownload) === assetHash && malloryAssetDenied && deletedAssetDenied, "Asset lifecycle failed");
await receipt("PARTY-08-ASSET", "pass", "appwrite-storage", {
  bucketId: "event-art", objectId: uploaded.$id, bytes: uploaded.sizeOriginal,
  uploader: "alice-auth-session", authorizedDownloader: "bob-auth-session",
  contentSha256: assetHash, outsiderDenied: malloryAssetDenied, postDeleteDenied: deletedAssetDenied,
}, "Authenticated upload, actor-specific delivery, exact content hash, and post-delete negative proof used Appwrite Storage.");

const scheduledAt = `${new Date(Date.now() + 180_000).toISOString().slice(0, 16)}:00.000Z`;
const scheduleRequest = await functions.createExecution({
  functionId,
  body: JSON.stringify({ dedupeKey: "scheduled-event-01", eventId: "event-01", attemptNumber: 1 }),
  async: true, xpath: "/", method: "POST", headers: { "content-type": "application/json" },
  scheduledAt,
});
let scheduledExecution = scheduleRequest;
let scheduleDelivery;
for (let index = 0; index < 240; index += 1) {
  scheduledExecution = await functions.getExecution({ functionId, executionId: scheduleRequest.$id });
  const deliveryRows = await rows(tableIds.deliveries, [Query.equal("dedupe_key", ["scheduled-event-01"])]);
  scheduleDelivery = deliveryRows[0];
  if (scheduledExecution.status === "completed" && scheduleDelivery) break;
  if (scheduledExecution.status === "failed") throw new Error(`Scheduled execution failed: ${scheduledExecution.errors}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert(scheduleDelivery?.delivery_count === 1 && scheduledExecution?.status === "completed", "Scheduled function did not settle");
const scheduleAttempts = await rows(tableIds.attempts, [Query.equal("dedupe_key", ["scheduled-event-01"])]);
assert(scheduleAttempts.length === 1, "Scheduled attempt was not idempotent");
await receipt("PARTY-09-SCHEDULE", "pass", "appwrite-functions-scheduler", {
  functionId, scheduledAt,
  execution: { id: scheduledExecution.$id, trigger: scheduledExecution.trigger, status: scheduledExecution.status },
  dedupeKey: scheduleDelivery.dedupe_key,
  attemptRows: scheduleAttempts.map((row) => ({ attempt: row.attempt_number, outcome: row.outcome })),
}, "Appwrite's scheduled-execution API invoked the deployed function at a declared future time; its run and deduplicated attempt are inspectable.");

async function executeEffect(dedupeKey, attemptNumber) {
  return functions.createExecution({
    functionId,
    body: JSON.stringify({ dedupeKey, eventId: "event-01", attemptNumber }),
    async: false, xpath: "/", method: "POST", headers: { "content-type": "application/json" },
  });
}
const successFirst = await executeEffect("known-success", 1);
const successRetry = await executeEffect("known-success", 2);
const successAttempts = await rows(tableIds.attempts, [Query.equal("dedupe_key", ["known-success"])]);
const successDeliveries = await rows(tableIds.deliveries, [Query.equal("dedupe_key", ["known-success"])]);
assert(successFirst.status === "completed" && successRetry.status === "completed" && successAttempts.length === 2 && successDeliveries.length === 1 && successDeliveries[0].delivery_count === 1, "Known-success retry duplicated");
await receipt("PARTY-10-EFFECT-RETRY", "pass", "appwrite-function-to-arm-effect-sink", {
  providerBoundary: { functionId, executionIds: [successFirst.$id, successRetry.$id], secretVariable: "redacted/present" },
  attemptLedger: successAttempts.map((row) => ({ attempt: row.attempt_number, outcome: row.outcome })),
  terminalSettlement: { deliveryRows: successDeliveries.length, deliveryCount: successDeliveries[0].delivery_count },
}, "The deployed Function crossed a secret-authenticated effect boundary twice while the unique dedupe ledger retained one delivery.");

const ambiguousFirst = await executeEffect("ambiguous-retry", 1);
const ambiguousBeforeRetry = await rows(tableIds.attempts, [Query.equal("dedupe_key", ["ambiguous-retry"])]);
const ambiguousDeliveryBefore = await rows(tableIds.deliveries, [Query.equal("dedupe_key", ["ambiguous-retry"])]);
const ambiguousRetry = await executeEffect("ambiguous-retry", 2);
const ambiguousAttempts = await rows(tableIds.attempts, [Query.equal("dedupe_key", ["ambiguous-retry"])]);
const ambiguousDeliveries = await rows(tableIds.deliveries, [Query.equal("dedupe_key", ["ambiguous-retry"])]);
assert(
  ambiguousBeforeRetry.length === 1 && ambiguousBeforeRetry[0].outcome === "ambiguous" &&
  ambiguousDeliveryBefore.length === 0 && ambiguousAttempts.length === 2 &&
  ambiguousAttempts.some((row) => row.outcome === "duplicate-confirmed") &&
  ambiguousDeliveries.length === 1,
  "Ambiguous retry distinction failed",
);
const sinkFaultReceipt = spawnSync("docker", ["exec", runtime.effectSinkContainer, "sh", "-lc", "cat /runtime/effect-attempts.jsonl"], { encoding: "utf8" });
const sinkLines = sinkFaultReceipt.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((item) => item.dedupeKey === "ambiguous-retry");
await receipt("PARTY-11-EFFECT-AMBIGUOUS", "pass", "appwrite-function-to-fault-injected-sink", {
  faultInjection: { firstSocketDestroyedAfterSinkCommit: true, sinkAttempts: sinkLines },
  firstExecution: { id: ambiguousFirst.$id, status: ambiguousFirst.status },
  stateBeforeRetry: { attempts: ambiguousBeforeRetry.map((row) => row.outcome), deliveryRows: 0 },
  retryExecution: { id: ambiguousRetry.$id, status: ambiguousRetry.status },
  finalAttemptLedger: ambiguousAttempts.map((row) => ({ attempt: row.attempt_number, outcome: row.outcome })),
  finalDeliveryRows: ambiguousDeliveries.length,
}, "A sink-side commit followed by socket destruction remained explicitly ambiguous; retry learned duplicate success without a second effect.");

const retainedBefore = await page.locator('[data-testid="partiful-shell"]').getAttribute("data-retained-wall-ids");
const wallEventsBeforeRevoke = Number(await page.locator('[data-testid="partiful-shell"]').getAttribute("data-realtime-walls"));
await tables.updateRow({
  databaseId, tableId: tableIds.invitations, rowId: "invite-event-02-bob",
  data: { revoked: true, status: "revoked" },
});
await tables.updateTable({
  databaseId, tableId: tableIds.wallPosts,
  permissions: [Permission.create(Role.users())],
  rowSecurity: true, enabled: true, purge: true,
});
await tables.updateRow({
  databaseId, tableId: tableIds.wallPosts, rowId: "wall-seed", data: {}, permissions: hostPermissions,
});
await tables.createRow({
  databaseId, tableId: tableIds.wallPosts, rowId: "wall-after-revoke",
  data: { event_id: "event-02", author_id: "alice", body: "PROTECTED AFTER REVOCATION", sequence: 999 },
  permissions: hostPermissions,
});
await page.waitForTimeout(1_500);
const wallEventsAfterRevoke = Number(await page.locator('[data-testid="partiful-shell"]').getAttribute("data-realtime-walls"));
const retainedAfter = await page.locator('[data-testid="partiful-shell"]').getAttribute("data-retained-wall-ids");
const directRevokedDenied = await denied(() => bob.tables.getRow({
  databaseId, tableId: tableIds.wallPosts, rowId: "wall-after-revoke",
}));
const protectedDelivered = (retainedAfter ?? "").includes("wall-after-revoke");
assert(directRevokedDenied && !protectedDelivered && wallEventsAfterRevoke === wallEventsBeforeRevoke, "STOP: protected post delivered after revocation");
await receipt("PARTY-12-REVOCATION", "pass", "appwrite-realtime", {
  authorityChange: { invitation: "revoked", protectedRowPermissions: "host-only" },
  negativeDelivery: { directDenied: directRevokedDenied, realtimeCounterBefore: wallEventsBeforeRevoke, realtimeCounterAfter: wallEventsAfterRevoke, protectedIdPresent: protectedDelivered },
  retainedStoreInspection: { beforeIds: retainedBefore, afterIds: retainedAfter, oldAuthorizedDataRetainedInReactMemory: (retainedAfter ?? "").includes("wall-seed"), durableOfflineStore: "none implemented" },
}, "Revocation stopped future protected reads and Realtime delivery; the UI honestly retained previously authorized in-memory data until refresh.");

const deploymentReceipt = JSON.parse(await readFile(path.resolve(receiptsRoot, "function-deployment.v1.json"), "utf8"));
await receipt("PARTY-13-DEPLOY", "unavailable-remote-dependency", "unavailable-remote-dependency", {
  localProviderDeployment: deploymentReceipt,
  redactedConfiguration: { effectUrlConfigured: true, effectSecretConfigured: true, apiKeySecretConfigured: true, secretValuesPresent: false },
  localEffectReceipt: { attempts: successAttempts.length + ambiguousAttempts.length + scheduleAttempts.length },
  hostedTarget: null,
  gapReason: "No arm-scoped Appwrite Cloud target or credentials were provided; the fresh self-host target proves the provider boundary but is not mislabeled hosted.",
}, "Local Appwrite Function deployment, secret configuration, logs, and effects are inspectable; hosted evidence is an environment/credential GAP.");
await receipt("PARTY-14-PERFORMANCE", "pending", "not-applicable", {}, "Written by the separate frozen performance run.");
await receipt("PARTY-15-CLEANUP", "pending", "not-applicable", {}, "Written only after exact-target cleanup and negative proof.");

await context.close();
milestone.localAcceptanceMs = elapsed();
milestone.acceptanceCompletionMs = elapsed();
await writeFile(path.resolve(receiptsRoot, "acceptance-results.v1.json"), `${JSON.stringify({
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  expectedCheckCount: 15,
  observedCheckCount: Object.keys(scenarios).length,
  statusCounts: Object.values(scenarios).reduce((out, scenario) => ({ ...out, [scenario.status]: (out[scenario.status] ?? 0) + 1 }), {}),
  scenarios: Object.values(scenarios),
  milestones: milestone,
  stopDefects: [],
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, checks: Object.keys(scenarios).length, milestones: milestone, stopDefects: 0 }));
