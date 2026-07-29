import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { localConfig } from "./local-config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const arm = path.resolve(work, "..");
const receipts = path.join(arm, "receipts");
const scenariosDir = path.join(receipts, "scenarios");
const state = JSON.parse(await readFile(path.join(work, "run-state.json"), "utf8"));
const config = localConfig();
const passphrase = `${randomBytes(24).toString("base64url")}aA1!`;
const started = performance.now();
const startedAt = new Date().toISOString();
const results = {};
const milestones = {
  firstLocalReadMs: null,
  firstAuthoritativeMutationMs: null,
  firstRealtimeTransitionMs: null,
  localAcceptanceMs: null,
  hostedUrlMs: null,
  acceptanceCompletionMs: null
};

await mkdir(scenariosDir, { recursive: true });
await waitFor(async () => {
  try {
    return (await fetch(`${config.apiUrl}/auth/v1/health`)).ok;
  } catch {
    return false;
  }
}, 20000);
const seed = JSON.parse(execFileSync(process.execPath, [path.join(here, "seed.mjs")], {
  cwd: work,
  env: { ...process.env, PARTY_TEST_PASSPHRASE: passphrase },
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
}));
const admin = createClient(config.apiUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const anon = createClient(config.apiUrl, config.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const actors = Object.fromEntries(await Promise.all(
  ["alice", "bob", "mallory", "carol", "dave", "erin"].map(async (name) => [name, await actor(name)])
));

const target = {
  projectId: state.projectId,
  namespace: state.namespace,
  apiUrlHash: sha256(config.apiUrl),
  dbUrlHash: sha256(config.dbUrl),
  identityHash: sha256(`${state.projectId}|${config.apiUrl}|${config.dbUrl}`),
  profile: "official Supabase CLI Docker stack",
  versions: { client: "2.111.0", cli: "2.110.0", postgres: "17" }
};
await writeJson("target-identity.json", target);
await writeJson("seed.json", seed);

await scenario("PARTY-01-SEED", async () => {
  const expected = {
    profiles: 6,
    events: 3,
    event_members: 7,
    invitations: 4,
    rsvps: 0,
    wall_posts: 0,
    reminder_schedules: 0,
    notification_attempts: 0,
    provider_deliveries: 0
  };
  const counts = await authoritativeCounts(Object.keys(expected));
  for (const [table, count] of Object.entries(expected)) must(counts[table] === count, `${table}: ${counts[table]} != ${count}`);
  const members = await admin.from("event_members").select("user_id,role").eq("event_id", seed.events.primary);
  must(!members.error && members.data.length === 3, members.error?.message ?? "primary member seed mismatch");
  const roles = Object.fromEntries(members.data.map((row) => [sha256(row.user_id), row.role]));
  must(roles[seed.personas.alice.idHash] === "host", "Alice host missing");
  must(roles[seed.personas.carol.idHash] === "cohost", "Carol cohost missing");
  must(roles[seed.personas.bob.idHash] === "guest", "Bob guest missing");
  milestones.firstLocalReadMs ??= elapsed();
  return { targetIdentity: target, counts, eventIds: hashValues(seed.events), personas: seed.personas };
});

await scenario("PARTY-02-PUBLIC-PRIVATE", async () => {
  const preview = await anon.from("public_event_previews")
    .select("id,slug,title,summary,venue_public,starts_at,art_path")
    .eq("slug", "summer-rooftop").single();
  must(!preview.error && preview.data.title === "Summer Rooftop", preview.error?.message ?? "public preview missing");
  const serialized = JSON.stringify(preview.data);
  must(!serialized.includes("private_notes") && !serialized.includes("0102"), "private field leaked through preview");
  const direct = await anon.from("events").select("*").eq("id", seed.events.primary);
  must(Boolean(direct.error), "anonymous direct events table read unexpectedly succeeded");
  const privatePreview = await anon.from("public_event_previews").select("id").eq("slug", "host-planning");
  must(!privatePreview.error && privatePreview.data.length === 0, "private event leaked into public view");
  return {
    anonymousRead: { slug: preview.data.slug, idHash: sha256(preview.data.id) },
    fieldBoundary: Object.keys(preview.data).sort(),
    negativePrivateRead: { directTableRejected: true, privatePreviewRows: 0 }
  };
});

await scenario("PARTY-03-INVITE-RSVP", async () => {
  const invite = await actors.bob.client.from("invitations")
    .select("id,status,created_by").eq("event_id", seed.events.primary).eq("invitee_id", actors.bob.userId).single();
  must(!invite.error && invite.data.status === "accepted", invite.error?.message ?? "Bob invite missing");
  const transitions = [];
  for (const [response, plus] of [["yes", 1], ["maybe", 0], ["no", 0], ["yes", 1]]) {
    const result = await actors.bob.client.rpc("set_rsvp", {
      target_event: seed.events.primary,
      new_response: response,
      new_plus_one: plus
    });
    must(!result.error, result.error?.message);
    transitions.push({ response: result.data.response, plusOne: result.data.plus_one, revision: result.data.revision });
  }
  milestones.firstAuthoritativeMutationMs ??= elapsed();
  const authority = await admin.from("rsvps").select("*")
    .eq("event_id", seed.events.primary).eq("user_id", actors.bob.userId).single();
  must(!authority.error && authority.data.response === "yes" && authority.data.plus_one === 1, authority.error?.message ?? "RSVP did not settle");
  return {
    invitationAttribution: { idHash: sha256(invite.data.id), createdByHash: sha256(invite.data.created_by) },
    transitions,
    authoritativeState: { response: authority.data.response, plusOne: authority.data.plus_one, revision: authority.data.revision }
  };
});

await scenario("PARTY-04-ROLES", async () => {
  const original = await admin.from("events").select("title,summary,revision").eq("id", seed.events.primary).single();
  must(!original.error, original.error?.message);
  const host = await actors.alice.client.from("events").update({ title: "Summer Rooftop — hosted", revision: original.data.revision + 1 })
    .eq("id", seed.events.primary).select("title,revision").single();
  must(!host.error, host.error?.message);
  const cohost = await actors.carol.client.from("events").update({ summary: "Cohost-approved production event." })
    .eq("id", seed.events.primary).select("summary").single();
  must(!cohost.error, cohost.error?.message);
  const guestWrite = await actors.bob.client.from("events").update({ title: "Guest takeover" }).eq("id", seed.events.primary).select();
  must(Boolean(guestWrite.error) || guestWrite.data.length === 0, "guest changed host-controlled event");
  const outsiderRead = await actors.mallory.client.from("events").select("id").eq("id", seed.events.primary);
  must(!outsiderRead.error && outsiderRead.data.length === 0, outsiderRead.error?.message ?? "outsider event leak");
  const outsiderWrite = await actors.mallory.client.from("wall_posts").insert({
    id: randomUUID(), event_id: seed.events.primary, author_id: actors.mallory.userId, body: "intrusion"
  });
  must(Boolean(outsiderWrite.error), "outsider wall post unexpectedly succeeded");
  await admin.from("events").update({ title: original.data.title, summary: original.data.summary, revision: original.data.revision }).eq("id", seed.events.primary);
  return {
    positiveRoleMatrix: { hostEdit: true, cohostEdit: true, guestRsvp: true },
    negativeRoleMatrix: { guestHostControl: false, outsiderReadRows: 0, outsiderWriteRejected: true }
  };
});

await scenario("PARTY-05-GUEST-LIST", async () => {
  const before = await actors.bob.client.from("event_members").select("user_id,role").eq("event_id", seed.events.primary);
  must(!before.error && before.data.length === 3, before.error?.message ?? "visible guest list missing");
  const delivery = subscribeCollect(actors.bob.client, "events", `id=eq.${seed.events.primary}`);
  await delivery.ready;
  const attempts = [];
  let delivered = false;
  for (let attempt = 1; attempt <= 3 && !delivered; attempt += 1) {
    const beforeCount = delivery.values.length;
    const changed = await actors.alice.client.rpc("set_guest_list_visibility", {
      target_event: seed.events.primary,
      visible: false
    });
    must(!changed.error, changed.error?.message);
    delivered = await waitForMaybe(
      () => delivery.values.slice(beforeCount).some((payload) => payload.new?.guest_list_visible === false),
      3000
    );
    attempts.push({ attempt, delivered });
    if (!delivered) {
      const restored = await actors.alice.client.rpc("set_guest_list_visibility", {
        target_event: seed.events.primary,
        visible: true
      });
      must(!restored.error, restored.error?.message);
      await sleep(750);
    }
  }
  must(delivered, "already-connected Bob missed all guest-list policy transitions");
  const after = await actors.bob.client.from("event_members").select("user_id,role").eq("event_id", seed.events.primary);
  must(!after.error && after.data.length === 1 && after.data[0].user_id === actors.bob.userId, after.error?.message ?? "guest list policy did not narrow");
  const publicStillVisible = await anon.from("public_event_previews").select("id").eq("id", seed.events.primary);
  must(!publicStillVisible.error && publicStillVisible.data.length === 1, "public preview changed with guest-list policy");
  await actors.alice.client.rpc("set_guest_list_visibility", { target_event: seed.events.primary, visible: true });
  await delivery.close();
  return {
    policyTransition: { from: true, to: false, restoredAfterProof: true },
    actorSpecificReads: { before: before.data.length, after: after.data.length, publicPreview: 1 },
    alreadyConnectedClient: { attempts, transport: "Supabase Realtime Postgres Changes" }
  };
});

await scenario("PARTY-06-CAPACITY", async () => {
  const [dave, erin] = await Promise.all([
    actors.dave.client.rpc("set_rsvp", { target_event: seed.events.capacity, new_response: "yes", new_plus_one: 0 }),
    actors.erin.client.rpc("set_rsvp", { target_event: seed.events.capacity, new_response: "yes", new_plus_one: 0 })
  ]);
  const outcomes = [dave, erin].map((result) => result.error ? "rejected" : "committed");
  must(outcomes.filter((value) => value === "committed").length === 1, `capacity outcomes ${outcomes}`);
  const authority = await admin.from("rsvps").select("user_id,plus_one")
    .eq("event_id", seed.events.capacity).eq("response", "yes");
  must(!authority.error && authority.data.length === 1, authority.error?.message ?? "capacity overbooked");
  return {
    twoActorBarrier: { actors: ["dave", "erin"], outcomes },
    settlement: { loserCode: (dave.error ?? erin.error)?.code, loserMessage: (dave.error ?? erin.error)?.message },
    authoritativeCount: { capacity: 1, occupiedSeats: seats(authority.data) }
  };
});

await scenario("PARTY-07-LIVE-BURST", async () => {
  const postIds = Array.from({ length: 10 }, () => randomUUID());
  const postChannel = subscribeMany(actors.bob.client, "wall_posts", seed.events.primary, postIds.length);
  const rsvpChannel = subscribeMany(actors.carol.client, "rsvps", seed.events.primary, 2);
  await Promise.all([postChannel.ready, rsvpChannel.ready]);
  for (let index = 0; index < postIds.length; index += 1) {
    const actor = index % 2 === 0 ? actors.alice : actors.bob;
    const inserted = await actor.client.from("wall_posts").insert({
      id: postIds[index],
      event_id: seed.events.primary,
      author_id: actor.userId,
      body: `Burst post ${index + 1}`
    });
    must(!inserted.error, inserted.error?.message);
  }
  await actors.bob.client.rpc("set_rsvp", { target_event: seed.events.primary, new_response: "maybe", new_plus_one: 0 });
  await actors.bob.client.rpc("set_rsvp", { target_event: seed.events.primary, new_response: "yes", new_plus_one: 1 });
  const [postPayloads, rsvpPayloads] = await Promise.all([postChannel.payloads, rsvpChannel.payloads]);
  await Promise.all([postChannel.close(), rsvpChannel.close()]);
  const [posts, rsvps] = await Promise.all([
    admin.from("wall_posts").select("id", { count: "exact" }).eq("event_id", seed.events.primary),
    admin.from("rsvps").select("response,plus_one").eq("event_id", seed.events.primary)
  ]);
  must(!posts.error && posts.count === 10, posts.error?.message ?? "burst authoritative count wrong");
  must(!rsvps.error && seats(rsvps.data) === 2, rsvps.error?.message ?? "RSVP total wrong");
  milestones.firstRealtimeTransitionMs ??= elapsed();
  return {
    secondClient: { wallDeliveries: postPayloads.length, rsvpDeliveries: rsvpPayloads.length },
    transportAttribution: "native Supabase Realtime WebSocket Postgres Changes; no polling",
    authoritativeCount: { wallPosts: posts.count, yesSeats: seats(rsvps.data) }
  };
});

await scenario("PARTY-08-ASSET", async () => {
  const bytes = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc000000301010018dd8d180000000049454e44ae426082", "hex");
  const objectPath = `${seed.events.primary}/hero.png`;
  const uploaded = await actors.alice.client.storage.from("event-art").upload(objectPath, bytes, {
    contentType: "image/png",
    upsert: false
  });
  must(!uploaded.error, uploaded.error?.message);
  const updated = await actors.alice.client.from("events").update({ art_path: objectPath }).eq("id", seed.events.primary);
  must(!updated.error, updated.error?.message);
  const allowed = await actors.bob.client.storage.from("event-art").download(objectPath);
  must(!allowed.error, allowed.error?.message);
  const allowedBytes = Buffer.from(await allowed.data.arrayBuffer());
  must(sha256(allowedBytes) === sha256(bytes), "authorized asset hash mismatch");
  const denied = await actors.mallory.client.storage.from("event-art").download(objectPath);
  must(Boolean(denied.error), "outsider downloaded private event art");
  const removed = await actors.alice.client.storage.from("event-art").remove([objectPath]);
  must(!removed.error, removed.error?.message);
  const absent = await admin.storage.from("event-art").list(seed.events.primary, { search: "hero.png" });
  must(!absent.error && absent.data.length === 0, absent.error?.message ?? "asset remained after delete");
  await admin.from("events").update({ art_path: null }).eq("id", seed.events.primary);
  return {
    objectIdentity: { bucket: "event-art", pathHash: sha256(objectPath) },
    authorization: { uploader: "alice", downloader: "bob", outsiderDenied: true, deleter: "alice" },
    contentHash: sha256(bytes),
    deleteProof: { remainingExactObjects: 0 }
  };
});

await scenario("PARTY-09-SCHEDULE", async () => {
  const scheduleId = randomUUID();
  const dedupe = `reminder:${scheduleId}`;
  const created = await actors.alice.client.rpc("create_reminder", {
    target_event: seed.events.primary,
    target_id: scheduleId,
    target_run_at: new Date(Date.now() - 1000).toISOString(),
    target_dedupe: dedupe
  });
  must(!created.error, created.error?.message);
  const job = JSON.parse(sqlValue(
    "select row_to_json(x) from (select jobid,jobname,schedule,command from cron.job where jobname='llp0102-partiful-supabase-reminders') x"
  ));
  must(job.jobname === "llp0102-partiful-supabase-reminders", "pg_cron job missing");
  const attempt = await waitFor(async () => {
    const result = await admin.from("notification_attempts").select("*")
      .eq("schedule_id", scheduleId).eq("dedupe_key", dedupe).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }, 15000);
  const ran = await admin.from("reminder_schedules").select("*").eq("id", scheduleId).single();
  must(!ran.error && ran.data.status === "ran", ran.error?.message ?? "scheduled reminder did not run");
  await sleep(6000);
  const duplicates = await admin.from("notification_attempts").select("*", { count: "exact", head: true }).eq("dedupe_key", dedupe);
  must(!duplicates.error && duplicates.count === 1, duplicates.error?.message ?? "scheduled reminder duplicated");
  return {
    scheduleIdentity: { idHash: sha256(scheduleId), cronJob: job },
    runReceipt: { state: attempt.state, providerReceipt: attempt.provider_receipt },
    dedupeKeyHash: sha256(dedupe),
    idempotentAttemptCount: duplicates.count
  };
});

await scenario("PARTY-10-EFFECT-RETRY", async () => {
  const dedupe = `known:${randomUUID()}`;
  const first = await actors.alice.client.functions.invoke("notify", {
    body: { eventId: seed.events.primary, dedupeKey: dedupe, fault: "none" },
    headers: { Authorization: `Bearer ${actors.alice.accessToken}` }
  });
  must(
    !first.error && first.data.state === "succeeded" && first.data.attemptNo === 1,
    first.error ? `${first.error.message}: ${await functionError(first.error)}` : JSON.stringify(first.data)
  );
  const second = await actors.alice.client.functions.invoke("notify", {
    body: { eventId: seed.events.primary, dedupeKey: dedupe, fault: "none" },
    headers: { Authorization: `Bearer ${actors.alice.accessToken}` }
  });
  must(!second.error && second.data.deduplicated === true && second.data.attemptNo === 1, second.error?.message ?? JSON.stringify(second.data));
  const [ledger, provider] = await Promise.all([
    admin.from("notification_attempts").select("*").eq("dedupe_key", dedupe).order("attempt_no"),
    admin.from("provider_deliveries").select("*").eq("dedupe_key", dedupe).single()
  ]);
  must(!ledger.error && ledger.data.length === 1, ledger.error?.message ?? "effect ledger duplicated");
  must(!provider.error && provider.data.delivery_count === 1, provider.error?.message ?? "provider duplicated");
  return {
    attemptLedger: ledger.data.map(({ attempt_no, state, response_code }) => ({ attemptNo: attempt_no, state, responseCode: response_code })),
    providerBoundary: { edgeFunction: "notify -> provider-fake HTTP", receiptHash: sha256(provider.data.receipt), deliveryCount: provider.data.delivery_count },
    terminalSettlement: { retryDeduplicated: true, state: "succeeded" }
  };
});

await scenario("PARTY-11-EFFECT-AMBIGUOUS", async () => {
  const dedupe = `ambiguous:${randomUUID()}`;
  const first = await actors.alice.client.functions.invoke("notify", {
    body: { eventId: seed.events.primary, dedupeKey: dedupe, fault: "ambiguous-after-accept" },
    headers: { Authorization: `Bearer ${actors.alice.accessToken}` }
  });
  must(
    !first.error && first.data.state === "ambiguous" && first.data.attemptNo === 1,
    first.error ? `${first.error.message}: ${await functionError(first.error)}` : JSON.stringify(first.data)
  );
  const second = await actors.alice.client.functions.invoke("notify", {
    body: { eventId: seed.events.primary, dedupeKey: dedupe, fault: "none" },
    headers: { Authorization: `Bearer ${actors.alice.accessToken}` }
  });
  must(!second.error && second.data.state === "succeeded" && second.data.reconciled === true && second.data.attemptNo === 2, second.error?.message ?? JSON.stringify(second.data));
  const [ledger, provider] = await Promise.all([
    admin.from("notification_attempts").select("*").eq("dedupe_key", dedupe).order("attempt_no"),
    admin.from("provider_deliveries").select("*").eq("dedupe_key", dedupe).single()
  ]);
  must(!ledger.error && ledger.data.map(({ state }) => state).join(",") === "ambiguous,succeeded", ledger.error?.message ?? "ambiguous ledger wrong");
  must(!provider.error && provider.data.delivery_count === 1, provider.error?.message ?? "ambiguous retry duplicated provider delivery");
  return {
    faultInjection: "provider accepted delivery; caller deliberately discarded response certainty",
    attemptLedger: ledger.data.map(({ attempt_no, state, fault }) => ({ attemptNo: attempt_no, state, fault })),
    ambiguousState: { retained: true, reconciledByProviderStatus: true, providerDeliveryCount: 1 }
  };
});

await scenario("PARTY-12-REVOCATION", async () => {
  const exactPostId = randomUUID();
  const channel = subscribeMaybe(actors.bob.client, "wall_posts", seed.events.primary, exactPostId, 2500);
  await channel.ready;
  const revoked = await actors.alice.client.from("event_members")
    .update({ revoked_at: new Date().toISOString() })
    .eq("event_id", seed.events.primary).eq("user_id", actors.bob.userId).select("user_id,revoked_at").single();
  must(!revoked.error, revoked.error?.message);
  const inserted = await actors.alice.client.from("wall_posts").insert({
    id: exactPostId,
    event_id: seed.events.primary,
    author_id: actors.alice.userId,
    body: "Protected post after Bob revocation"
  });
  must(!inserted.error, inserted.error?.message);
  const delivered = await channel.payload;
  await channel.close();
  must(delivered === null, "revoked Bob received a protected realtime row");
  const bobRead = await actors.bob.client.from("wall_posts").select("id").eq("id", exactPostId);
  must(!bobRead.error && bobRead.data.length === 0, bobRead.error?.message ?? "revoked Bob read protected row");
  const retained = await Promise.all([
    admin.from("wall_posts").select("*", { count: "exact", head: true }).eq("event_id", seed.events.primary),
    admin.from("rsvps").select("*", { count: "exact", head: true }).eq("event_id", seed.events.primary).eq("user_id", actors.bob.userId)
  ]);
  must(retained.every((result) => !result.error), "retained store inspection failed");
  return {
    authorityChange: { actor: "bob", revokedAt: revoked.data.revoked_at },
    negativeDelivery: { exactPostDelivered: false, protectedReadRows: 0 },
    retainedStoreInspection: { wallPosts: retained[0].count, bobRsvps: retained[1].count, policy: "durable data retained for host; access revoked" }
  };
});

results["PARTY-13-DEPLOY"] = {
  status: "unavailable-remote-dependency",
  note: "No isolated hosted Supabase project credential was available; local secret/config, Edge Function boundary, logs, and target identity were inspected without claiming hosted delivery.",
  evidence: {
    localTargetIdentityHash: target.identityHash,
    localSecretBoundary: "Edge Runtime received automatic server-side service credential; UI received only anon key.",
    localEffectBoundary: "notify Edge Function -> provider-fake HTTP Edge Function -> Postgres attempt/provider ledgers",
    hostedUrl: null,
    hostedRegion: null,
    hostedLogs: null,
    hostedRollback: null
  }
};
await writeScenario("PARTY-13-DEPLOY", results["PARTY-13-DEPLOY"]);

await scenario("PARTY-14-PERFORMANCE", async () => {
  const performanceReceipt = await measurePerformance();
  await writeJson("performance.json", performanceReceipt);
  return performanceReceipt;
});

milestones.localAcceptanceMs = elapsed();
milestones.acceptanceCompletionMs = elapsed();
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  startedAt,
  expectedCheckCount: 15,
  completedCheckCount: Object.keys(results).length + 1,
  results,
  milestones,
  cleanupPending: true,
  result: "incomplete-until-cleanup"
};
await writeJson("acceptance.json", summary);
await Promise.all(Object.values(actors).map(({ client }) => client.removeAllChannels()));
await Promise.all(Object.values(actors).map(({ client }) => client.auth.signOut({ scope: "local" })));
console.log(JSON.stringify({
  ok: Object.values(results).every(({ status }) => ["pass", "unavailable-remote-dependency"].includes(status)),
  completedBeforeCleanup: Object.keys(results).length,
  statuses: Object.fromEntries(Object.entries(results).map(([id, result]) => [id, result.status])),
  milestones
}, null, 2));

async function actor(name) {
  const client = createClient(config.apiUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 100 } }
  });
  const signed = await client.auth.signInWithPassword({
    email: `${name}.partiful.supabase@llp0102.local`,
    password: passphrase
  });
  if (signed.error) throw signed.error;
  return { client, userId: signed.data.user.id, accessToken: signed.data.session.access_token };
}

async function scenario(id, operation) {
  try {
    const evidence = await operation();
    results[id] = { status: "pass", note: "", evidence };
    await writeScenario(id, results[id]);
  } catch (error) {
    results[id] = { status: "fail", note: String(error), evidence: {} };
    await writeScenario(id, results[id]);
    await writeJson("acceptance.partial.json", { schemaVersion: 1, startedAt, failedAt: new Date().toISOString(), results, milestones });
    throw error;
  }
}

function subscribeCollect(client, table, filter) {
  let readyResolve;
  const values = [];
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const channel = client.channel(`${table}-${randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table, filter }, (value) => values.push(value))
    .subscribe((status) => { if (status === "SUBSCRIBED") readyResolve(); });
  return { ready, values, close: () => client.removeChannel(channel) };
}

function subscribeMany(client, table, eventId, expected) {
  let readyResolve;
  let payloadResolve;
  const values = [];
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const payloads = new Promise((resolve, reject) => {
    payloadResolve = resolve;
    setTimeout(() => reject(new Error(`${table} burst realtime timeout ${values.length}/${expected}`)), 12000);
  });
  const channel = client.channel(`${table}-${randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table, filter: `event_id=eq.${eventId}` }, (value) => {
      values.push(value);
      if (values.length >= expected) payloadResolve(values);
    })
    .subscribe((status) => { if (status === "SUBSCRIBED") readyResolve(); });
  return { ready, payloads, close: () => client.removeChannel(channel) };
}

function subscribeMaybe(client, table, eventId, exactId, waitMs) {
  let readyResolve;
  let payloadResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const payload = new Promise((resolve) => {
    payloadResolve = resolve;
    setTimeout(() => resolve(null), waitMs);
  });
  const channel = client.channel(`${table}-${randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table, filter: `event_id=eq.${eventId}` }, (value) => {
      if (value.new?.id === exactId) payloadResolve(value);
    })
    .subscribe((status) => { if (status === "SUBSCRIBED") readyResolve(); });
  return { ready, payload, close: () => client.removeChannel(channel) };
}

async function measurePerformance() {
  const shapes = {
    contention: [],
    burst: [],
    asset: [],
    realtime: [],
    build: []
  };
  for (let sample = 0; sample < 9; sample += 1) {
    const eventId = randomUUID();
    await admin.from("events").insert({
      id: eventId,
      arm_namespace: state.namespace,
      host_id: actors.alice.userId,
      slug: `perf-${sample}-${eventId.slice(0, 8)}`,
      title: "Performance capacity",
      summary: "Isolated sample",
      venue_public: "Test",
      private_notes: "Test",
      is_public: false,
      capacity: 1,
      guest_list_visible: true,
      starts_at: "2026-08-20T00:00:00Z"
    });
    await admin.from("event_members").insert([
      { event_id: eventId, user_id: actors.alice.userId, role: "host" },
      { event_id: eventId, user_id: actors.dave.userId, role: "guest" },
      { event_id: eventId, user_id: actors.erin.userId, role: "guest" }
    ]);
    let before = performance.now();
    await Promise.all([
      actors.dave.client.rpc("set_rsvp", { target_event: eventId, new_response: "yes", new_plus_one: 0 }),
      actors.erin.client.rpc("set_rsvp", { target_event: eventId, new_response: "yes", new_plus_one: 0 })
    ]);
    const contentionMs = performance.now() - before;
    const authority = await admin.from("rsvps").select("user_id").eq("event_id", eventId).eq("response", "yes");
    must(!authority.error && authority.data.length === 1, "performance capacity sample overbooked");
    await admin.from("events").delete().eq("id", eventId);

    const burstRows = Array.from({ length: 10 }, (_, index) => ({
      id: randomUUID(), event_id: seed.events.primary, author_id: actors.alice.userId, body: `Performance burst ${sample}-${index}`
    }));
    before = performance.now();
    const burst = await actors.alice.client.from("wall_posts").insert(burstRows);
    must(!burst.error, burst.error?.message);
    const burstMs = performance.now() - before;
    await admin.from("wall_posts").delete().in("id", burstRows.map(({ id }) => id));

    const bytes = Buffer.from(`asset-${sample}-${"x".repeat(1024)}`);
    const objectPath = `${seed.events.primary}/perf-${sample}.png`;
    before = performance.now();
    const upload = await actors.alice.client.storage.from("event-art").upload(objectPath, bytes, { contentType: "image/png" });
    must(!upload.error, upload.error?.message);
    const download = await actors.carol.client.storage.from("event-art").download(objectPath);
    must(!download.error, download.error?.message);
    await actors.alice.client.storage.from("event-art").remove([objectPath]);
    const assetMs = performance.now() - before;

    const postId = randomUUID();
    const subscription = subscribeMaybe(actors.carol.client, "wall_posts", seed.events.primary, postId, 8000);
    await subscription.ready;
    before = performance.now();
    const post = await actors.alice.client.from("wall_posts").insert({
      id: postId, event_id: seed.events.primary, author_id: actors.alice.userId, body: `Realtime perf ${sample}`
    });
    must(!post.error, post.error?.message);
    const payload = await subscription.payload;
    must(payload !== null, "performance realtime sample missed");
    const realtimeMs = performance.now() - before;
    await subscription.close();
    await admin.from("wall_posts").delete().eq("id", postId);

    if (sample >= 2) {
      shapes.contention.push(round(contentionMs));
      shapes.burst.push(round(burstMs));
      shapes.asset.push(round(assetMs));
      shapes.realtime.push(round(realtimeMs));
    }
  }
  for (let sample = 0; sample < 9; sample += 1) {
    const before = performance.now();
    execFileSync("npm", ["run", "build"], {
      cwd: work,
      env: { ...process.env, SUPABASE_PROJECT_DIR: state.runtimeProjectDir },
      stdio: ["ignore", "ignore", "pipe"]
    });
    if (sample >= 2) shapes.build.push(round(performance.now() - before));
  }
  return {
    scope: "official local Supabase stack on one Mac; not hosted latency",
    warmups: 2,
    recordedSamples: 7,
    unit: "milliseconds",
    dataset: { events: 3, primaryMembers: 3, burstPosts: 10, assetBytes: 1032 },
    paths: Object.fromEntries(Object.entries(shapes).map(([name, samples]) => [name, stats(samples)])),
    deploy: { status: "unavailable-remote-dependency", localEquivalent: "Supabase CLI start/reset plus Edge Runtime" },
    costWindow: { actualProviderChargeUsd: 0, hostedUsage: "unavailable" }
  };
}

async function authoritativeCounts(tables) {
  const counts = {};
  for (const table of tables) {
    const result = await admin.from(table).select("*", { count: "exact", head: true });
    if (result.error) throw result.error;
    counts[table] = result.count;
  }
  return counts;
}

function sqlValue(statement) {
  const container = `supabase_db_${state.projectId}`;
  return execFileSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-Atc", statement], {
    encoding: "utf8"
  }).trim();
}

async function waitFor(operation, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await operation();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

async function waitForMaybe(operation, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await operation()) return true;
    await sleep(100);
  }
  return false;
}

function seats(rows) {
  return rows.filter(({ response }) => response === undefined || response === "yes")
    .reduce((sum, row) => sum + 1 + Number(row.plus_one ?? 0), 0);
}

function stats(samples) {
  const ordered = [...samples].sort((a, b) => a - b);
  return {
    samples,
    median: ordered[Math.floor(ordered.length / 2)],
    nearestRankP95: ordered[Math.ceil(0.95 * ordered.length) - 1]
  };
}

function hashValues(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, sha256(value)]));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function functionError(error) {
  try {
    return await error.context?.text();
  } catch {
    return String(error);
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function elapsed() {
  return Math.round(performance.now() - started);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeScenario(id, value) {
  await writeFile(path.join(scenariosDir, `${id}.json`), `${JSON.stringify({ id, checkedAt: new Date().toISOString(), ...value }, null, 2)}\n`);
}

async function writeJson(name, value) {
  await writeFile(path.join(receipts, name), `${JSON.stringify(value, null, 2)}\n`);
}
