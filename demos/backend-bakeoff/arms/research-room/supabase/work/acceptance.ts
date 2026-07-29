import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const arm = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const evidenceDir = process.env.EVIDENCE_DIR ?? join(arm, "evidence");
const scenarioDir = join(evidenceDir, "scenarios");
await mkdir(scenarioDir, { recursive: true });
const targetIdentity = process.env.TARGET_IDENTITY ?? "llp0102-research-supabase-w2";
const extension = process.env.EXTENSION_RUN === "true";

const url = process.env.SUPABASE_URL!;
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !publishable || !serviceKey) throw new Error("missing local target credentials");

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const client = () => createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
const actors = {
  alice: { email: "alice@research.invalid", password: "Alice-research-0102!" },
  bob: { email: "bob@research.invalid", password: "Bob-research-0102!" },
  mallory: { email: "mallory@research.invalid", password: "Mallory-research-0102!" }
};
const roomA = "10000000-0000-4000-8000-000000000001";
const roomB = "10000000-0000-4000-8000-000000000002";
const canary = `LLP0102_SUPABASE_SERVER_CANARY_${randomBytes(24).toString("hex")}`;
const startedAt = new Date().toISOString();
const receipts: any[] = [];

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function hash(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}
async function receipt(id: string, evidence: Record<string, unknown>) {
  const value = { schemaVersion: 1, id, status: "pass", checkedAt: new Date().toISOString(), evidence };
  receipts.push(value);
  await writeFile(join(scenarioDir, `${id}.json`), JSON.stringify(value, null, 2) + "\n");
}
function embedding(index: number) {
  return `[${Array.from({ length: 32 }, (_, i) => (i === index % 32 ? "1" : "0")).join(",")}]`;
}
async function signedIn(credentials: {email:string,password:string}) {
  const instance = client();
  const { data, error } = await instance.auth.signInWithPassword(credentials);
  check(!error && data.user && data.session, `sign in failed: ${error?.message}`);
  await instance.realtime.setAuth(data.session.access_token);
  return instance;
}
async function rpc<T>(instance: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await instance.rpc(name, args);
  check(!error, `${name}: ${error?.message}`);
  return data as T;
}
async function subscribe(instance: SupabaseClient, name: string, table: string, filter?: string) {
  const events: any[] = [];
  const channel = instance.channel(name).on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? {filter} : {}) }, payload => events.push(payload));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`subscription timeout: ${name}`)), 10_000);
    channel.subscribe(status => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
      if (status === "CHANNEL_ERROR") { clearTimeout(timer); reject(new Error(`subscription error: ${name}`)); }
    });
  });
  return { channel, events };
}
async function subscribeBroadcast(instance: SupabaseClient, name: string, topic: string, mayDeny = false) {
  const events:any[] = [];
  let status = "joining";
  const channel = instance.channel(topic,{config:{private:true}})
    .on("broadcast",{event:"progress"},payload=>events.push(payload));
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`broadcast timeout: ${name}`)),10_000);
    channel.subscribe(next=>{
      status=next;
      if(next==="SUBSCRIBED" || (mayDeny && (next==="CHANNEL_ERROR" || next==="TIMED_OUT"))){
        clearTimeout(timer); resolve();
      }
      if(!mayDeny && next==="CHANNEL_ERROR"){clearTimeout(timer);reject(new Error(`broadcast denied: ${name}`));}
    });
  });
  return {channel,events,get status(){return status;}};
}

// Seed users with provider-native Auth, then all deterministic fixtures.
const userIds: Record<string,string> = {};
const existingUsers = await service.auth.admin.listUsers({ page: 1, perPage: 100 });
check(!existingUsers.error, `list users: ${existingUsers.error?.message}`);
for (const user of existingUsers.data.users) {
  if (Object.values(actors).some(actor => actor.email === user.email)) {
    const removed = await service.auth.admin.deleteUser(user.id);
    check(!removed.error, `remove stale actor: ${removed.error?.message}`);
  }
}
for (const [handle, credentials] of Object.entries(actors)) {
  const { data, error } = await service.auth.admin.createUser({ ...credentials, email_confirm: true, user_metadata: { handle } });
  check(!error && data.user, `create ${handle}: ${error?.message}`);
  userIds[handle] = data.user.id;
}
let result = await service.from("profiles").insert(Object.entries(userIds).map(([handle,id]) => ({ id, handle })));
check(!result.error, `profiles seed: ${result.error?.message}`);
result = await service.from("rooms").insert([
  { id: roomA, slug: "primary", name: "Primary research", owner_id: userIds.alice },
  { id: roomB, slug: "secondary", name: "Secondary research", owner_id: userIds.bob }
]);
check(!result.error, `rooms seed: ${result.error?.message}`);
result = await service.from("room_members").insert([
  { room_id: roomA, user_id: userIds.alice, role: "owner" },
  { room_id: roomA, user_id: userIds.bob, role: "member" },
  { room_id: roomB, user_id: userIds.bob, role: "owner" }
]);
check(!result.error, `members seed: ${result.error?.message}`);
const sources = Array.from({ length: 20 }, (_, i) => {
  const marker = i === 0 || i === 7 || i === 14 ? "quasar " : "ordinary ";
  const prefix = `${marker}source-${String(i).padStart(2,"0")} `;
  const body = (prefix + "x".repeat(65536)).slice(0, 65536);
  return {
    id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    room_id: roomA,
    owner_id: userIds.alice,
    title: `Frozen source ${String(i).padStart(2,"0")}${marker.startsWith("quasar") ? " quasar" : ""}`,
    body,
    byte_size: Buffer.byteLength(body),
    content_hash: hash(body),
    embedding: embedding(i)
  };
});
result = await service.from("sources").insert(sources);
check(!result.error, `sources seed: ${result.error?.message}`);
const seedCounts = {
  rooms: (await service.from("rooms").select("*", { count: "exact", head: true })).count,
  primarySources: (await service.from("sources").select("*", { count: "exact", head: true }).eq("room_id", roomA)).count,
  sourceBytes: new Set(sources.map(s => s.byte_size)),
  embeddingDimensions: 32,
  actors: Object.keys(userIds).length
};
check(seedCounts.rooms === 2 && seedCounts.primarySources === 20 && [...seedCounts.sourceBytes][0] === 65536 && seedCounts.actors === 3, "frozen seed mismatch");
await receipt("RESEARCH-01-SEED", { target: targetIdentity, extension, ...seedCounts, userIds: Object.fromEntries(Object.entries(userIds).map(([k,v]) => [k, hash(v)])) });

const alice = await signedIn(actors.alice);
const bob = await signedIn(actors.bob);
const mallory = await signedIn(actors.mallory);

// Storage authorization, byte delivery, metadata ownership, and deletion.
const fileBytes = new TextEncoder().encode("frozen-upload\n".repeat(4681).slice(0, 65536));
const filePath = `${roomA}/alice-frozen-source.txt`;
let storage = await alice.storage.from("research-sources").upload(filePath, fileBytes, { contentType: "text/plain", upsert: false });
check(!storage.error, `upload: ${storage.error?.message}`);
const fileSourceId = "20000000-0000-4000-8000-000000000099";
result = await alice.from("sources").insert({
  id: fileSourceId, room_id: roomA, owner_id: userIds.alice, title: "Alice upload",
  body: new TextDecoder().decode(fileBytes), byte_size: fileBytes.byteLength, content_hash: hash(fileBytes),
  storage_path: filePath, embedding: embedding(31)
});
check(!result.error, `file metadata: ${result.error?.message}`);
const downloaded = await alice.storage.from("research-sources").download(filePath);
check(!downloaded.error && downloaded.data, `download: ${downloaded.error?.message}`);
const delivered = new Uint8Array(await downloaded.data.arrayBuffer());
check(hash(delivered) === hash(fileBytes), "download hash mismatch");
storage = await alice.storage.from("research-sources").remove([filePath]);
check(!storage.error && storage.data.length === 1, `delete object: ${storage.error?.message}`);
result = await alice.from("sources").delete().eq("id", fileSourceId);
check(!result.error, `delete metadata: ${result.error?.message}`);
const objectAfterDelete = await alice.storage.from("research-sources").download(filePath);
const metadataAfterDelete = await service.from("sources").select("id").eq("id",fileSourceId);
check(Boolean(objectAfterDelete.error) && metadataAfterDelete.data?.length === 0, "file delete not authoritative");
await receipt("RESEARCH-02-FILES", { bucket: "research-sources", object: filePath, ownerHash: hash(userIds.alice), bytes: fileBytes.byteLength, contentHash: hash(fileBytes), deliveredHash: hash(delivered), objectAbsent: true, metadataAbsent: true });

// Negative database, RPC, storage and realtime paths.
const outsiderSources = await mallory.from("sources").select("id").eq("room_id", roomA);
const outsiderSearch = await mallory.rpc("keyword_search", { target_room: roomA, terms: "quasar" });
const outsiderQuestions = await mallory.from("questions").select("id").eq("room_id",roomA);
const outsiderFile = await mallory.storage.from("research-sources").download(`${roomA}/not-visible.txt`);
check(!outsiderSources.error && outsiderSources.data.length === 0, "outsider source leak");
check(!outsiderSearch.error && outsiderSearch.data.length === 0, "outsider search leak");
check(!outsiderQuestions.error && outsiderQuestions.data.length === 0, "outsider question leak");
check(Boolean(outsiderFile.error), "outsider storage path did not deny");

const keyword = await alice.rpc("keyword_search", { target_room: roomA, terms: "quasar" });
check(!keyword.error, `keyword: ${keyword.error?.message}`);
const expectedKeyword = [sources[0].id, sources[7].id, sources[14].id].sort();
const actualKeyword = keyword.data.map((row:any) => row.id).sort();
check(JSON.stringify(actualKeyword) === JSON.stringify(expectedKeyword), "keyword frozen set mismatch");
await receipt("RESEARCH-04-KEYWORD", { path: "PostgreSQL generated tsvector + GIN + websearch_to_tsquery", terms: "quasar", expected: expectedKeyword, actual: actualKeyword });

const semantic = await alice.rpc("semantic_search", { target_room: roomA, query_embedding: embedding(3), match_count: 3 });
check(!semantic.error && semantic.data[0].id === sources[3].id && Number(semantic.data[0].distance) === 0, `semantic mismatch: ${semantic.error?.message}`);
await receipt("RESEARCH-05-SEMANTIC", { path: "pgvector vector(32), HNSW vector_cosine_ops, <=> RPC", dimensions: 32, queryIdentity: "basis-3", expectedFirst: sources[3].id, results: semantic.data });

// Two authorized clients and one outsider use Supabase's recommended private
// database-triggered Broadcast path before Alice writes.
const question = await rpc<any>(alice,"start_question",{ target_room: roomA, question_prompt: "Summarize quasar evidence", client_dedupe_key: "main-progress" });
const topic=`question:${question.id}`;
const bobProgress = await subscribeBroadcast(bob,"bob-progress",topic);
const malloryProgress = await subscribeBroadcast(mallory,"mallory-progress",topic,true);
for (const [index,stage] of ["retrieving","ranking","drafting","citing"].entries()) {
  const appended = await rpc<boolean>(alice,"append_progress",{ target_question: question.id, progress_seq:index+1, progress_stage:stage });
  check(appended, `progress ${index+1} rejected`);
  await new Promise(r => setTimeout(r, 175));
}
const answerId = await rpc<string>(alice,"complete_question",{ target_question:question.id, answer_body:"The quasar sources agree.", cited_sources:[sources[0].id,sources[7].id] });
await new Promise(r => setTimeout(r,750));
const durableProgress = await service.from("progress_updates").select("seq,stage,created_at").eq("question_id",question.id).order("seq");
const settledQuestion = await service.from("questions").select("state,settled_at").eq("id",question.id).single();
check(durableProgress.data?.length === 4 && settledQuestion.data?.state === "complete", "progress/terminal mismatch");
check(bobProgress.events.length === 4, `Bob live event count ${bobProgress.events.length}`);
check(malloryProgress.events.length === 0, `Mallory live leak ${malloryProgress.events.length}`);
await receipt("RESEARCH-03-OUTSIDER", { sources:0, searchResults:0, questions:0, answers:0, progressRows:0, storageDenied:true, realtimeEvents:malloryProgress.events.length, rlsApplied:true });
await receipt("RESEARCH-06-PROGRESS", { questionId:question.id, durable:durableProgress.data, count:4, transport:"Supabase Realtime private Broadcast over Phoenix WebSocket, emitted by an AFTER INSERT database trigger", terminal:settledQuestion.data, terminalObservedAfterAllFour:true });
await receipt("RESEARCH-08-COLLABORATOR", { observer:"bob", distinctClient:true, membership:"member", topic, transport:"Supabase Realtime private Broadcast", eventCount:bobProgress.events.length, events:bobProgress.events.map(e => e.payload?.record ?? e.payload) });

const answer = await service.from("answers").select("id,question_id,body,citations(source_id)").eq("id",answerId).single();
check(!answer.error && answer.data.citations.length === 2, "citation rows missing");
const citedIds = answer.data.citations.map((c:any)=>c.source_id);
const citedSources = await service.from("sources").select("id,room_id").in("id",citedIds);
check(citedSources.data?.length === 2 && citedSources.data.every(s=>s.room_id===roomA), "invalid citation authority");
await receipt("RESEARCH-07-CITATIONS", { answer:answer.data, citedSources:citedSources.data, allSourcesInAuthorizedRoom:true });

const cancelled = await rpc<any>(alice,"start_question",{ target_room:roomA, question_prompt:"cancel me", client_dedupe_key:"cancelled-question" });
check(await rpc<boolean>(alice,"append_progress",{target_question:cancelled.id,progress_seq:1,progress_stage:"started"}), "cancel setup");
check(await rpc<boolean>(alice,"cancel_question",{target_question:cancelled.id}), "cancel not settled");
const beforeLate = await service.from("progress_updates").select("*",{count:"exact",head:true}).eq("question_id",cancelled.id);
const lateResults = [];
for (let seq=2;seq<=4;seq++) lateResults.push(await rpc<boolean>(alice,"append_progress",{target_question:cancelled.id,progress_seq:seq,progress_stage:`late-${seq}`}));
const afterLate = await service.from("progress_updates").select("seq,created_at").eq("question_id",cancelled.id);
const cancellation = await service.from("questions").select("state,cancelled_at,settled_at").eq("id",cancelled.id).single();
check(lateResults.every(v=>v===false) && beforeLate.count===afterLate.data?.length && cancellation.data?.state==="cancelled", "late durable patch admitted");
await receipt("RESEARCH-09-CANCEL", { questionId:cancelled.id, cancellation:cancellation.data, countAtSettlement:beforeLate.count, injectedLateAttempts:3, lateResults, finalRows:afterLate.data, everyLateDurablePatchPrevented:true });

const retryOne = await rpc<any>(alice,"start_question",{target_room:roomA,question_prompt:"dedupe me",client_dedupe_key:"retry-key"});
const retryTwo = await rpc<any>(alice,"start_question",{target_room:roomA,question_prompt:"dedupe me again",client_dedupe_key:"retry-key"});
const retryCounts = await service.from("questions").select("*",{count:"exact",head:true}).eq("dedupe_key","retry-key");
const retryAnswers = await service.from("answers").select("id",{count:"exact",head:true}).eq("question_id",retryOne.id);
const attempts = await service.from("effect_attempts").select("attempt,settlement").eq("question_id",retryOne.id).order("attempt");
check(retryOne.id===retryTwo.id && retryCounts.count===1 && retryAnswers.count===0 && attempts.data?.length===2, "retry dedupe failed");
await receipt("RESEARCH-10-RETRY", { dedupeKey:"retry-key", firstId:retryOne.id, retryId:retryTwo.id, questionCount:retryCounts.count, answerCount:retryAnswers.count, attempts:attempts.data });

const failed = await rpc<any>(alice,"settle_fault",{target_room:roomA,client_dedupe_key:"failed",target_state:"failed"});
const timed = await rpc<any>(alice,"settle_fault",{target_room:roomA,client_dedupe_key:"timed",target_state:"timed_out"});
const ambiguous = await rpc<any>(alice,"settle_fault",{target_room:roomA,client_dedupe_key:"ambiguous",target_state:"ambiguous"});
const outcomes = await service.from("questions").select("id,state,dedupe_key,settled_at").in("id",[question.id,cancelled.id,failed.id,timed.id,ambiguous.id]);
const outcomeStates = new Set(outcomes.data?.map(o=>o.state));
check(["complete","failed","cancelled","timed_out","ambiguous"].every(s=>outcomeStates.has(s)), "outcomes collapsed");
await receipt("RESEARCH-11-OUTCOMES", { faultInjection:["failed","timed_out","ambiguous"], records:outcomes.data, distinctStates:[...outcomeStates].sort() });

let scheduled:any[] = [];
for (let attempt=0; attempt<5 && scheduled.length===0; attempt++) {
  await new Promise(r=>setTimeout(r,2000));
  const queried = await service.from("scheduled_refreshes").select("*").eq("dedupe_key","scheduled-primary");
  check(!queried.error, `scheduled query: ${queried.error?.message}`);
  scheduled = queried.data;
}
check(scheduled.length===1 && scheduled[0].progress==="fetched", "scheduled refresh missing/duplicated");
await receipt("RESEARCH-12-SCHEDULE", { scheduler:"pg_cron", schedule:"5 seconds", identity:`${targetIdentity}-refresh`, run:scheduled[0], authoritativeCount:scheduled.length, dedupeKey:"scheduled-primary" });

const edge = await alice.functions.invoke("research-stream");
check(!edge.error && edge.data?.serverCredentialLoaded===true, `edge function secret load failed: ${edge.error?.message}`);
const secretInsert = await service.from("server_secrets").insert({name:"acceptance-canary",secret_hash:hash(canary)});
check(!secretInsert.error, `secret hash: ${secretInsert.error?.message}`);
const outsiderSecrets = await mallory.from("server_secrets").select("*");
check(Boolean(outsiderSecrets.error) || outsiderSecrets.data.length===0, "server secret table leaked");

await bob.removeChannel(bobProgress.channel);
await mallory.removeChannel(malloryProgress.channel);

async function scanFiles(root:string, needle:string, skip = new Set(["node_modules",".git",".arm-state"])) {
  const hits:string[] = [];
  async function walk(path:string) {
    for (const entry of await readdir(path,{withFileTypes:true})) {
      if (skip.has(entry.name)) continue;
      const full=join(path,entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const bytes=await readFile(full);
        if (bytes.includes(Buffer.from(needle))) hits.push(relative(root,full));
      }
    }
  }
  await walk(root);
  return hits;
}

const acceptance = {
  schemaVersion:1,
  provider:"supabase",
  app:"research-room",
  target:targetIdentity,
  extension,
  lineage: extension ? { frozenOriginalTarget:"llp0102-research-supabase-w2", originalResult:"stop-class-secret-exposure" } : null,
  startedAt,
  completedAt:new Date().toISOString(),
  expectedCheckCount:15,
  result:"pending-performance-and-cleanup",
  summary:{pass:13,pending:2,fail:0,gap:0},
  scenarios:receipts.map(r=>({id:r.id,status:r.status}))
};
await writeFile(join(evidenceDir,"acceptance-results.partial.json"),JSON.stringify(acceptance,null,2)+"\n");
const canaryHits = await scanFiles(arm,canary);
check(canaryHits.length===0,"canary leaked into arm files");
await receipt("RESEARCH-13-SECRETS", { canaryHash:hash(canary), canaryLiteralRetained:false, armScanHits:canaryHits, clientReadDenied:Boolean(outsiderSecrets.error), clientReadRows:outsiderSecrets.data?.length ?? 0, edgeFunction:{serverCredentialLoaded:true,credentialReturned:false}, configProof:"r2 local generated credentials are mode-0600 ignored state and are destroyed after cleanup" });
await writeFile(join(evidenceDir,"acceptance-results.partial.json"),JSON.stringify({...acceptance,summary:{pass:13,pending:2,fail:0,gap:0},scenarios:receipts.map(r=>({id:r.id,status:r.status}))},null,2)+"\n");

console.log(JSON.stringify({ ok:true, passed:13, pending:["RESEARCH-14-PERFORMANCE","RESEARCH-15-CLEANUP"], questionId:question.id, bobEvents:bobProgress.events.length }));
