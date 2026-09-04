# Panel: LLP 1012 — Local-first v1 (codex gpt-5.6-sol)

**Reviewed:** `llp/1012-local-first-v1.spec.md` as landed at `9ffdf6dd0`, in a read-only capsule exported from that commit, with the engine, wire, client, evaluator, compiler, templates, the design RFCs it implements, the brief, and the rules.
**Family:** codex gpt-5.6-sol
**Provider/runtime:** OpenAI Codex CLI (`codex exec --skip-git-repo-check -m gpt-5.6-sol -c model_reasoning_effort=ultra -s read-only -o`); the model self-reports as "Codex (GPT-5; reasoning effort not exposed)".
**Date:** 2026-09-04
**Redacted:** No — the panelist read the in-repo documents and sources directly in its own capsule; no content left the local machine beyond the model serving the CLI.
**Method:** Round 1, mutually blind, on the identical brief preserved at `llp/reviews/1012-local-first-v1.panel.brief.md`. The read-only sandbox refused its file write, so the review is the CLI's captured last message, verbatim, including that note. The orchestrating session authored LLP 1012 and is not a reviewer; it verified every engine claim below against the tree before the synthesis (`1012-local-first-v1.panel.synthesis.md`).

---

## Round 1 review (verbatim)

The review is complete, but I could not create `/Users/ccheever/projects/snapback-1012-panel/out/codex.md`: the enforced read-only sandbox rejected the write, and approvals are disabled.

Reviewer: Codex (GPT-5; reasoning effort not exposed) · Date: 2026-09-04 · Method: blind round-1, read-only capsule at 9ffdf6dd0

# Verdict

**NOT READY.** The direction is strong, and I do not dispute the thirteen rulings. The implementing spec has five correctness blockers: no exactly-once replay settlement, no implemented or specified OCC comparison, no authoritative negative fact for a row disappearing from a range, an under-bounded/under-bound resume digest, and an unenforceable server-side intent-age test.

# Blocking findings

## B1 — Lost-response replay has no idempotency boundary

**Text:** “a transport failure mid-replay leaves the intent `queued`.”

**Evidence:** Section 7 gives the local intent an `id`, but never puts it on the mutation wire or defines a server settlement ledger. The current route accepts only `{op,args}` (`snapback2/crates/snapback2/src/serve.rs:402-410`), `Action::Execute` has no intent identity (`snapback2/crates/snapback2/src/writer.rs:104-119`), and each mutation reserves fresh server IDs (`snapback2/crates/snapback2/src/writer_auth.rs:145-156`). Duplicate-ID failures become `E_CONSTRAINT` (`snapback2/crates/snapback2-core/src/engine/mod.rs:1475-1483`).

**Why it matters:** After commit plus lost response, replay can apply an update/effect twice or turn a successful insert into a rejection. Pinned row IDs cannot recover the original result.

**Resolution:** Add stable `intentId` to replay. Atomically persist `(principal, intentId, exact op/args/context identity, committed-or-rejected response)` with the mutation; exact retries return that response without execution. Specify mismatch refusal, client settlement durability, ACK/GC, and retention at least as long as the 30-day replay window.

## B2 — “Server OCC over the authoritative trace” does not exist in the invoked path

**Text:** “An offline edit to a row someone else edited comes back `rejected`.”

**Evidence:** I could not verify any OCC comparison in code. The request carries no base sequence, version, or prior trace (`snapback2/crates/snapback2/src/serve.rs:402-410`). The engine receives only program, certificate, and current context, reads current `commit_seq`, opens a transaction, and executes against current rows (`snapback2/crates/snapback2-core/src/engine/mod.rs:699-756`).

**Why it matters:** Serialized fresh execution is not optimistic concurrency control. An edit normally overwrites the newer value unless Quarry authors an explicit comparison.

**Resolution:** Either specify a generic replay precondition—what client artifact is compared, what keys/versions it covers, and its stable rejection—or state that v1 uses app-authored compare-and-set/`require` and remove the OCC claim. The ruling is not implementable until one meaning is chosen.

## B3 — Range receipts cannot revoke an individual formerly delivered row

**Text:** “an expired message is an absence on the next resume of every range that held it.”

**Evidence:** Point reads distinguish hidden from absent: a hidden found row returns null without an absence, while a missing row appends an exact absence (`snapback2/crates/snapback2-core/src/engine/runner.rs:658-689`). Ranges do not. Hidden-candidate artifacts are erased (`runner.rs:879-902`), and `ReceiptRange.absence` only says the returned page is empty; uniformly hidden and physically empty ranges are deliberately equivalent (`runner.rs:980-1007`). `ClosureReceipt` has exact absences but no per-range row tombstones (`snapback2/crates/snapback2-core/src/engine/mod.rs:191-231`).

**Why it matters:** Section 5’s fallback retains the deleted row indefinitely under `delivered-history`; it cannot ensure physical purge of expired or revoked messages after sync.

**Resolution:** Add a narrow authoritative negative fact keyed to an already-held `(table,id)`, such as `evictions[]` produced by exact rechecks or a certified delivery-log tombstone. Apply it transactionally. Never infer deletion from range omission.

## B4 — Resume is neither aggregate-bounded nor safe to answer `unchanged`

**Text:** “every held `(op,args)` in one read transaction … `unchanged` when the fresh delivery’s digest equals the client’s.”

**Evidence:** Certificates bound one execution, not a vector of executions (`snapback2/crates/snapback2-core/src/certificate.rs:19-42`). The HTTP body has a 1 MiB byte cap but no operation/work cap (`snapback2/crates/snapback2/src/serve.rs:617-643`). All actions run serially on the sole store-owning thread (`snapback2/crates/snapback2/src/writer.rs:390-428`), and every engine execution currently creates its own transaction (`snapback2/crates/snapback2-core/src/engine/mod.rs:728-756`).

The live digest covers only `(state,result)` (`snapback2/crates/snapback2-core/src/live.rs:17-19`), while receipts contain auth-epoch verdicts (`snapback2/crates/snapback2-core/src/engine/mod.rs:213-231`). The public generation hash is schema-only (`snapback2/crates/snapback2-core/src/registry.rs:88-99`), so it does not distinguish program changes.

**Why it matters:** Same data can require a different receipt, authority, or program. Reusing the old receipt is unsound, while a large resume monopolizes all writes.

**Resolution:** Define a bounded `execute_batch` owner action with an aggregate certificate/work ceiling. Digest state, result, complete receipt/policy, plan hash, schema, digest version, and authority cohort canonically. Return a stable held-entry ID and current bindings even when unchanged. One owner action—not “one read transaction”—is the natural same-sequence unit.

## B5 — The server cannot enforce age from client-authored `issuedAt`

**Text:** “the server enforces … an intent whose `issuedAt` is older than 30 days.”

**Evidence:** The mutation wire does not carry it (`snapback2/packages/snapback2/src/client.ts:405-412`), and execution currently pins `now` and `read_time` from the server clock (`snapback2/crates/snapback2/src/writer_auth.rs:159-169`). Even after adding the field, a client timestamp is not evidence of age.

**Why it matters:** A modified or clock-rolled-back client can bypass the hard trust maximum.

**Resolution:** Each successful resume should mint a server-recorded replay grant with `issuedAt`, `expiresAt <= 30d`, principal/authority binding, and grant ID. Every intent, including no-insert reactions, carries that grant. Client `issuedAt` remains useful for ordering and the local fence, not server enforcement.

# Material findings

## M1 — The delivery-log recipe is invalid Quarry and incomplete

**Text:** `return page { ., message: ... }` and “one subscription, one long range.”

**Evidence:** A shape accepts `*`, `...name`, or a word field; bare `.` cannot parse (`snapback2/packages/compiler/src/quarry/parser.ts:809-834`). The loop is statically multiplied (`snapback2/crates/snapback2-core/src/certificate.rs:896-912`) and its approximately 52 writes, including the current maintained count, fit the 2,048 ceiling (`certificate.rs:31-42`, `:270-277`).

The proposed enum covers only message/edit/delete, while M5–M6 require reactions, receipts, configuration, expiry, and view-once behavior (`benchmarks/briefs/social-messenger.md:558-620`). The current template lacks those message fields (`snapback2/packages/snapback2/templates/chat/snapback/schema.q:58-70`).

**Why it matters:** A full ascending 200-row page subscribed with the same cursor does not advance. Delivery point rows also do not certify the `messages.byConvTime` range used by `thread`; local reexecution requires a matching range receipt (`snapback2/crates/snapback2-core/src/client.rs:93-145`, `:258-272`).

**Resolution:** Change `.` to `*`, define a persisted tail-watermark drain that rotates pages, and expand the projection/event kinds to all required screens. Keep separate stored inbox/thread queries or explicitly make the recipe’s reducer the UI source. It is an app-owned, receipt-scoped projection—not a platform relational replica, but still replicated selected data.

## M2 — ID blocks are only an internal hook

**Text:** “the server allocates the session a bounded id block.”

**Evidence:** `Context.new_ids` is injectable and exhaustion is `E_INPUT` (`snapback2/crates/snapback2-core/src/engine/runner.rs:384-397`); the TypeScript twin matches (`snapback2/packages/evaluator/src/evaluator.ts:650-660`). The store reserves globally unique blocks of 1,024 transactionally (`snapback2/crates/snapback2-core/src/store.rs:292-367`), but ordinary mutation handling allocates them server-side and `_sessions` records no block ownership (`snapback2/crates/snapback2/src/writer_auth.rs:145-156`; `snapback2/crates/snapback2-core/src/store.rs:204-212`).

**Why it matters:** Replay cannot use the hook as exposed, and session renewal, concurrent grants, and outstanding old blocks are undefined.

**Resolution:** Define durable block grants with block ID, principal/authority, range, expiry, and consumption validation. Exhaustion refuses locally before enqueue; device wipe burns unused IDs; concurrent devices receive disjoint grants.

## M3 — The carrier API does not enforce promised atomicity

**Text:** “The intent is written in the same carrier transaction as any prediction.”

**Evidence:** The proposed interface exposes `swap()` and a separate `outbox` object but no root transaction or CAS (`llp/1012-local-first-v1.spec.md:219-229`). The reference `ClientStore` stages by copying an in-memory engine and replacing it after success (`snapback2/crates/snapback2-core/src/client.rs:50-90`), not through an IndexedDB durability protocol.

**Why it matters:** IndexedDB can update multiple object stores atomically only inside one live transaction; asynchronous evaluator work can let that transaction close.

**Resolution:** Specify a primitive such as `commit(expectedGeneration, {rows,ranges,answers,intent,overlay,settlements,evictions})`. Compute the overlay first, then validate the base generation and write everything in one carrier transaction.

## M4 — The witness does not prove the claims it gates

**Text:** “A crash mid-swap leaves the previous generation intact, which the kill witness asserts.”

**Evidence:** Section 10 kills only after drain/open/view and has no barrier inside a swap. The prior ticket correctly says a fresh client in the same process does not prove real process death and requires a real carrier plus unreachable backend (`issues/20260806-expo-file-carrier-process-kill-witness.md:22-37`).

**Why it matters:** Tab discard may be graceful; the pre-kill queued message is omitted from the “both committed” assertion; and the matrix omits lost-response replay, auth-partition wipe, carrier corruption/open failure, hidden-versus-absent, offline reactions, and explicit view-once exclusion.

**Resolution:** Externally kill/restart the browser renderer/profile and simulator app. Add deterministic mid-enqueue and mid-swap barriers; assert all three queued intents exactly once and in order; add the omitted authority, revocation, and view-once cases.

## M5 — Diagnostics and lane custody cross existing boundaries

**Text:** O1 adds `E_RETAIN_POLICY`; O3 consumes a “generation-bound certified program.”

**Evidence:** Compiler codes/families are closed around `E_QUARRY_*` and do not include `offline` (`snapback2/packages/compiler/src/ir.ts:170-188`); routing assigns Quarry/schema errors at source (`snapback2/packages/compiler/src/diagnostics.ts:111-122`). The current manifest exposes only operation kind/args (`snapback2/crates/snapback2/src/writer_ledger.rs:204-226`), while the evaluator ticket requires program plus certificate (`issues/20260830-snapback2-wire-evaluator-into-public-client.md:23-35`).

**Why it matters:** A schema spelling error should not become a runtime/client family, and O3 cannot land solely in evaluator/client as its lane table says.

**Resolution:** Use `E_QUARRY_TYPE`, or a schema-family code, for invalid `retain`; reserve `offline` for carrier/resume/intent failures. Put certified program/certificate wire custody in O1.

# Minor findings

- `maxOfflineAge` versus `fence: { days }` is needless dual naming; prefer one `offline: { store, maxAgeDays, maxAssetBytes }` option.
- `swap(gen: Generation)` overloads server generation, store snapshot, and sequence.
- Specify that server `E_INTENT_EXPIRED` maps to `expired`, not generic `rejected`, and when terminal client records are pruned.
- “Multi-device is free” is too broad until grants, settlement identity, and authority renewal are defined.

# Answers to the 11 questions

1. **Absent versus hidden:** Yes for exact point reads (`snapback2/crates/snapback2-core/src/engine/runner.rs:658-689`); no for an individual row formerly inside a range (`runner.rs:879-902`, `:980-1007`). The fallback leaves deleted delivered history indefinitely. Use explicit negative facts for already-held IDs.

2. **Resume:** It is not aggregate-bounded or digest-honest. For 200 full 200-row pages, it performs roughly 40,400 delivery candidates plus up to 40,000 nested message reads/rule work, serially blocking the owner. Digest equality saves response bytes, not execution. Add held IDs, protocol/digest version, plan/certificate/generation and authority bindings, an aggregate cap/refusal, and replay-grant metadata.

3. **IDs:** The internal injection hook exists, but no replay-facing path or ownership ledger does. Exhaustion should refuse before enqueue; device wipe safely burns unused IDs; two devices are safe only with transactionally disjoint, independently valid grants. Define session renewal and same-token concurrency.

4. **Receipt wire:** It is Serde-serializable (`snapback2/crates/snapback2-core/src/engine/mod.rs:191-232`), and the TS evaluator matches (`snapback2/packages/evaluator/src/types.ts:22-63`). It is not fully program/generation-bound, and closure alone may be 4 MiB (`snapback2/crates/snapback2-core/src/certificate.rs:31-42`). Add plan/certificate, authority, policy, and digest-version bindings; remove duplicate halo/body representation; send full receipt only when its canonical digest changes.

5. **Recipe:** It fails on bare `.`; after `*`, fan-out fits. One range does not cover all required views or the existing thread range. A per-viewer log is a sound named app projection under the ruling, but it carries reducer and revocation obligations that “not a replica” should not obscure.

6. **Outbox/prediction:** The four states plus orthogonal `predicted` flag are minimal. One IndexedDB transaction is achievable, but not through the shown API. FIFO settlement is mechanically honest; a rejected create/send followed by edit/reaction/delete of its pinned ID creates cascading failures users will see as unrelated. Preserve causal parent/order for presentation. The current React hook exposes only boolean `pending`, not `pending[]` (`snapback2/packages/snapback2/src/react.tsx:167-215`).

7. **Fence:** I found no old lifecycle assumption to unwind: core `retention.rs` is an estimator (`snapback2/crates/snapback2-core/src/retention.rs:1-22`). The local trust fence is coherent. The server maximum needs a server-minted grant, and prediction must specify values for modeled `now`, `new_ids`, and `read_time` (`snapback2/crates/snapback2-core/src/engine/mod.rs:16-24`).

8. **Witness:** No. It proves neither mid-swap atomicity nor lost-response exactly-once, and “tab discarded” is not a precise process-kill method. Add kill barriers, all queued-intent assertions, partitioning, carrier failures, hidden/absent/expiry purge, offline reactions, and explicit view-once byte exclusion.

9. **Sequencing:** O2 may develop against an O1 stub but cannot integrate before receipt/resume/grant contracts. O3 depends on program/certificate wire work missing from O1. O4 depends on B3’s eviction fact. O1 needs aggregate-bound, digest/generation/auth, idempotent lost-response, OCC, and grant-expiry tests; O2 carrier conformance; O3 successor/auth/hash corpus tests; O4 atomic row/byte purge tests.

10. **Spellings/diagnostics:** `retain <policy>` is a reasonable table declaration and `/api/resume` a reasonable private SDK route. Consolidate client settings under `offline`. Keep compiler failures in Quarry/schema taxonomy. Make `receipt=1` internal capability negotiation, not an app-facing knob.

11. **Smallest surface:** Keep two retention values, one durable carrier contract, one replay-intent envelope, and one bounded resume route. Delete ambiguous `epoch`, the public receipt toggle, “one read transaction,” and generic OCC wording. Internally expose one transactional commit rather than public `rows/ranges/outbox/assets` sub-surfaces. Add none of the deferred hold-set, delta-log, merge-mode, or local-index mechanisms.

# Strengths

The spec cleanly separates trust expiry from readability, refuses silent memory fallback, keeps prediction orthogonal to settlement, limits retention to two policies, places asset bytes under row custody, and demands real cold-start evidence. Staging stored-answer replay before the twin is excellent risk control. The measurements and explicit non-claims are unusually good.

# Open author question

Does “server OCC” mean a new generic comparison against an offline base artifact, or fresh authoritative execution plus app-authored compare-and-set? The current engine implements only the latter shape; the spec promises the former outcome.

# If I owned O1

I would first land a lost-response test and the narrow protocol it forces: server-minted replay grant, stable `intentId`, pinned ID grant, and atomic settlement replay. In the same envelope I would bind the certified program and receipt digest to plan, schema, authority, and retention policy. Then I would implement aggregate-certified batch resume and explicit held-row eviction facts. `retain` syntax is cheap and should follow executable semantics, not precede them.


---

## Round 2 — proposals (2026-09-04, later the same day; verbatim)

**Method:** round 2 on the brief preserved at `1012-local-first-v1.panel.brief-r2.md`, which carried the orchestrator's verified round-1 synthesis and asked for designs rather than critique, per the author's instruction. codex gpt-5.6-sol, same runner as round 1; the read-only sandbox again refused its file write, so this is the captured last message. Self-reported effort `xhigh`; the CLI was invoked with `ultra`.

Reviewer: codex gpt-5.6-sol (xhigh) · Date: 2026-09-04 · Method: round 2, proposals, read-only capsule at 9ffdf6dd0, after the verified round-1 synthesis.

_Environment note: the managed read-only sandbox refused both normal and escalated writes to `OUT`, so the completed contribution is printed here for capture._

## 1. The purge design

Use the application's immutable, per-recipient delivery log as the positive revocation channel, and use receipt negatives only as a redundant cleanup path. The log carries identifiers, never revocable content:

```q
table deliveries:
  recipient: principal
  conversationId: conversations
  messageId: messages
  kind: enum('put', 'edit', 'purge')
  reason: enum('none', 'deleted', 'expired', 'revoked')
  at: time
  by byRecipientAt: recipient, at, id
  immutable recipient, conversationId, messageId, kind, reason, at
  retain deliveredHistory
  read <- .recipient = viewer
  insert <- exists memberships[.conversationId, viewer]
  update <- deny
  delete <- deny

table messages:
  retain deliveredHistory
```

The template's `send` and `edit` mutations append an event per recipient. `deleteForEveryone`, the caller-invoked expiry mutation, and any authority revocation scrub the authoritative body and append `purge` events in the same transaction. The order key must be server-stamped (`at: now`) and monotone for this certified log shape; the compiler refuses a resume cohort whose order can be supplied by a client. The application drains `first 50` pages to `next: null`, then follows the tail.

The client template registers one pure reducer:

```ts
syncLog(api.delivery.drain, {
  discard: e => e.kind === "purge"
    ? [{ table: "messages", id: e.messageId }]
    : [],
});
```

Applying an event page, deleting the row and leased bytes, recording the purge event, and advancing the watermark is one carrier swap. Reapplying after a crash is harmless. View-once bytes are excluded at view time; a later purge is not relied on to repair a cold-start leak. Cost is one small event per affected recipient and no negative fact per held row. M5 and M6 pass because a synced purge removes the body from held-row search, while view-once content never enters durable custody.

`untilRevoked` now means that a disclosure-safe point absence or a fresh, exhausted uniform extent can release a row, after computing holders across the whole swap. Only certified-uniform scans emit such extents (`snapback2/crates/snapback2-core/src/engine/runner.rs:985-1007`). `deliveredHistory` means delivery itself is the local read lease: omission, a denied re-read, or an auth-epoch change does not make the held row unrenderable; only a positive purge, safe authoritative absence, schema reset, or partition wipe ends it.

No general `evictions[]`, tombstone ledger, or hold set is added. O1 does need retention in the certificate and a safe public-receipt projection: raw point execution distinguishes absent from hidden (`snapback2/crates/snapback2-core/src/engine/runner.rs:671-688`) and raw receipts expose the absence tuple (`snapback2/crates/snapback2-core/src/engine/mod.rs:223-231`), so a point absence is exported only at a certificate-proven uniformly readable site. Rejected alternative: point-absence-only purge makes old-page replay and a disclosure-sensitive fact load-bearing.

## 2. Resume a phone would love

Treat the fully drained delivery log as one **resume cohort**, not hundreds of page descriptors. The compiler derives a cohort only from a certified-uniform, immutable, cursor-ordered query with a server-stamped monotone order key. Its identity binds operation, canonical arguments excluding the cursor, plan/site/index/prefix/order, program generation, and schema hash; the store compacts contiguous exhausted pages into `{cohort, through, validator}`. Unmounted `deliveredHistory` snapshots remain readable and stale; unmounted `untilRevoked` answers are sealed until reopened. The hard cap is one cohort plus 32 mounted descriptors and 64 KiB of request metadata.

```json
POST /api/resume
{
  "protocol": 1,
  "programGeneration": "G1",
  "drain": {
    "cohort": "delivery.v1",
    "through": "c…",
    "validator": "v1.…"
  },
  "mounted": [
    {
      "key": "inbox",
      "op": "chat.inbox",
      "args": {},
      "validator": "v1.…"
    },
    {
      "key": "thread",
      "op": "chat.thread",
      "args": {"id": "c7"},
      "validator": "v1.…"
    }
  ]
}
```

```json
{
  "snapshot": {
    "seq": 8421,
    "programGeneration": "G1",
    "schemaHash": "S1",
    "authority": {"principal": "p1", "authEpoch": 9}
  },
  "drain": {
    "events": [],
    "through": "c…",
    "more": false,
    "validator": "v1.…"
  },
  "mounted": [
    {
      "key": "inbox",
      "notModified": true,
      "validator": "v1.…",
      "attach": "a…"
    },
    {
      "key": "thread",
      "delivery": {
        "state": "complete",
        "data": {},
        "next": null,
        "receipt": {}
      },
      "validator": "v1.…",
      "attach": "b…"
    }
  ],
  "replayGrant": {
    "id": "rg_7",
    "from": 1,
    "count": 8192,
    "expiresAt": 178…
  }
}
```

One `Action::Resume` resolves authority once, pins `(seq, now, generation)`, checks or drains events strictly after `through`, and then executes mounted queries. That matches the actual serialization unit: calls enter one owner through an `mpsc` request (`snapback2/crates/snapback2/src/writer.rs:70-82,423-428`) over an exclusive SQLite connection (`snapback2/crates/snapback2-core/src/store.rs:84-110`). Individual executions may open separate transactions (`snapback2/crates/snapback2-core/src/engine/mod.rs:728-756`), but no owner action interleaves and read-only work observes the pinned seq. Attach tickets adopt the subscriptions already evaluated, avoiding the present subscribe-time execution (`snapback2/crates/snapback2-core/src/live.rs:117-146`).

There is one server-issued validator:

```text
SHA-256("sb2-representation-v1", op, canonical(args), state, data, next,
        publicReceipt, programGeneration, schemaHash, planHash,
        principal, authEpoch)
```

It excludes transport seq and timestamps. Because the current generation hash is schema-only (`snapback2/crates/snapback2-core/src/registry.rs:88-99`), O1 must mint a full certified-program generation. An empty tail scan makes hundreds of drained pages a no-op; normally Clique sends about 1–2 KiB each way and performs that scan plus two or three query executions—roughly single-digit to tens of milliseconds of warm owner time, to be measured. A response is capped at 256 events or 512 KiB; `more:true` continues in another bounded action before mounted queries attach or the outbox drains.

A schema or program-generation mismatch returns `reset:{reason:"generation"}` only. The client seals the old partition, cold-drains into the new generation, and replays an old intent only if its operation compatibility hash still matches; it never mixes receipts. Tabs share one partition under a Web Lock. Rejected alternative: an unbounded `held[]` manifest turns accumulated reading into request amplification and owner-thread stalls.

## 3. Ids and replay, the smallest correct scheme

A successful resume mints a principal-bound `ReplayGrant {grantId, namespace, from, count:8192, mintedAt, expiresAt}`. It is not tied to one auth epoch: a fresh session for the same principal may finish its intents. The compiler adds `maxNewIds` and infers `offlineReplay: append | onlineOnly`; `append` requires every application write site to be `Insert`, a distinction the certificate already records (`snapback2/crates/snapback2-core/src/certificate.rs:118-132`). No Quarry annotation is added.

Each enqueue atomically consumes a fixed slice of `1 + maxNewIds`: the first ID names the intent and the rest are its deterministic `newId()` envelope. The client can therefore hand a parent's pinned result ID to a later intent.

```json
POST /api/mutation
{
  "op": "send",
  "args": {"conversationId": "c1", "body": "hi"},
  "replay": {
    "grant": "rg_7",
    "offset": 104,
    "count": 52,
    "intentId": "rg_7:104",
    "planHash": "p…"
  }
}
```

The server first looks up `(principal, intentId)`. Equal canonical request bytes return the stored terminal response, even after grant expiry; unequal bytes refuse `E_INTENT_REUSE`. On a miss it validates current principal and plan, server-recorded grant age, slice bounds, and the next unused offset. It derives the IDs and injects them into `Context.new_ids` where the served path currently overwrites that field with a fresh reservation (`snapback2/crates/snapback2/src/writer_auth.rs:145-156`). Application writes, commit record, grant advancement, and `_client_intents(requestDigest, terminalResponse)` settle in the same transaction; the engine already makes data and its commit record atomic (`snapback2/crates/snapback2-core/src/engine/mod.rs:865-884`). A post-commit 503 retry therefore cannot execute twice.

The v1 server-side conflict check is deliberately small: pinned IDs must be absent, then the mutation runs against current authority, rules, constraints, and fan-out. Offline Update/Upsert/Delete is not queued; it refuses locally as `E_OFFLINE_REPLAY_UNSAFE` with “reconnect, or model this action as an immutable event.” This is honest OCC for the bar's inserts without inventing row versions.

If the grant is exhausted, no outbox row or prediction is written and the client asks for a grant online. A wiped device loses unsent local intents and unused IDs become holes; a committed send returns through the log. Two devices receive disjoint grants and promise only per-device FIFO. If a parent is rejected, its child is still sent; the child's own `ref`/`require` either rejects it or its authored semantics allow it. Rejected alternative: UUIDv7 still needs both server evidence of age and an intent ledger, while adding a second ID form.

## 4. Make it feel like WhatsApp

### 1. `useDrain`: downloaded really means downloaded

`useDrain(api.delivery.drain, args)` serially fetches certified pages until `next === null`, persists after every page, and then follows the tail. It returns `{downloaded, caughtUp, staleSince, watermark}`; `downloaded` is the iterable the app filters for offline thread and search views. Offline, `caughtUp` means the last online drain exhausted and `staleSince` stays visible.

The agent writes one hook rather than cursor rotation across fifty chats. Surface cost is one React/Expo hook and one local cursor record; wire cost is only missing pages. It pays warm-offline search over everything actually downloaded and a truthful “up to date as of …” label. Prove it with 10,000 deliveries, then 200 across five conversations: reconnect, cut the network, and find both the oldest and newest downloaded messages without fetching an old page.

### 2. A stable durable outbox bubble

`useOutbox(api.messages.send)` exposes durable entries as `{intentId, ids, args, state, refusal}`. The chat template keys a bubble by the pinned message ID and renders it from `args`; reconnect changes that same bubble `queued → committed | rejected | expired`, never inserts a second bubble.

Surface cost is one hook and a local index over data the outbox already stores; the replay envelope adds no extra bytes beyond §3. It pays the familiar “clock/check/error on my one message” experience and makes unpredicted sends feel intentional. Prove it by killing after enqueue and by injecting a 503 after commit: the DOM key, text, and list position stay constant, and the server contains exactly one message.

### 3. A named offline device in journeys

Extend the journey context from today's `{as,tick,url}` (`snapback2/packages/snapback2/src/test.ts:5-10`) with `device(name, principal)`, whose test-only handle supports `network.down()`, `close()`, `coldStart()`, and `network.up()`. A named device owns one temporary durable carrier across fresh client instances.

Cost is a test-only store and four verbs, with zero production or wire bytes. It gives an agent a five-second approximation of the scheduled browser/simulator witness and catches most custody mistakes before physical qualification. Prove that the transport records zero requests while down, that a new JS process reads held answers, and that its FIFO outbox survives; current journeys create and close ephemeral clients (`snapback2/packages/snapback2/src/test.ts:124-145`).

Ranked in that order: complete foreground custody changes the user's experience most, stable intent identity removes the next-largest confusion, and the device primitive makes both hard to regress. Rejected alternative: background push or cron drain violates NOT-DOING and makes offline evidence depend on timing outside the app.

## 5. Steal one thing

Steal HTTP's **strong validator** contract: the origin mints an opaque ETag, the client echoes it with `If-None-Match`, equality reuses the stored representation, and a miss returns the complete replacement. RFC 9110 defines that revalidation and `304 Not Modified` behavior ([RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)).

Snapback should call the token `validator`, because one POST batches representations, but preserve those semantics exactly: server-minted, opaque, strong equality only, and bound to the complete typed representation listed in §2. A batch item is either `{notModified:true, validator}` or a full delivery with a new validator; it borrows the equality contract, not HTTP's status code. The same algorithm serves query responses, SSE frames, and resume, replacing both the current live digest over only `(state,result)` (`snapback2/crates/snapback2-core/src/live.rs:17-19`) and the separate frame-minus-seq digest (`snapback2/crates/snapback2/src/writer_values.rs:56-61`).

It fits because a validator carries no row and grants no authority; it only selects an answer that the certificate and receipt already admitted. `complete`, `capped`, `denied`, and `partial` necessarily validate differently, so the cache cannot invent completeness. Cost is one SHA-256 over an envelope already serialized and one 43-byte base64url token per logical result. Prove that an unrelated commit changes `seq` but not the validator, while any change to state, cursor, public receipt, plan/schema generation, principal, or auth epoch forces a full delivery. Rejected alternative: CloudKit-style change tokens would import deletion history and record patches—the deferred delta-replica design.

## 6. Cut

I would remove apparatus, not offline outcomes:

- Remove general mutable offline replay and its unimplemented OCC prose. V1 queues only compiler-inferred append-only mutations; mutable operations remain online. This deletes row-version/read-set design work and lets O1 prove one conflict rule: compare-and-insert, then current rules.

- Remove per-page delivery-log descriptors from resume. Once a contiguous drain is exhausted, compact it into the single cohort and watermark from §2; unmounted `deliveredHistory` snapshots remain readable but stale, while other holders are sealed. This makes a hard cap honest and turns hundreds of scans and hashes into one tail scan.

- Remove `want:'receipt'`, bare `epoch`, and `assets` on `RangeStore`. Resume always carries custody; ordinary query/subscribe use only `receipt=1`; wire fields are `authEpoch` and `programGeneration`; O4's `ByteCache` collaborates by row lease instead of coupling media into O2. Also make the 256 MiB asset ceiling fixed in v1 rather than expose a second option-bag spelling.

- Remove duplicated row payloads from the public envelope. Internal `ClosureReceipt.rows` contains full `RowRecord`s (`snapback2/crates/snapback2-core/src/engine/mod.rs:223-231`); O1 should ship one row pool, let typed result nodes reference it, and make receipt facts reference `(table,id)`. The client expands refs before exposing `data`.

- Remove `offline/E_RETAIN_POLICY`; invalid schema vocabulary belongs to `schema/E_RETAIN_POLICY` with the exact legal rewrite.

Lane O3 is not needed to meet the stated bar: cold reads replay answers, search filters the drained log, and pending sends render from arguments. Ruling 3 still requires it, so I would mark it explicitly non-gating and start it only after O2 and the physical witness, preventing the twin from shaping O1's wire or delaying the bar. These cuts unblock a frozen receipt, a small store, and an independently shippable carrier. Rejected alternative: cutting `deliveredHistory`, byte leases, or the cold-kill witness would remove user-visible outcomes rather than machinery.

## 7. Lane O1 on one page

Land these slices in order; O2 starts after slice 1 against exported types and shared golden vectors.

1. **Freeze the envelope.** Add `ClientReceiptV1`, `ClientRangeFactV1`, `ClientAbsenceFactV1`, `AuthorityCohortV1`, `DeliveryEnvelopeV1`, and `RepresentationValidatorV1` in `snapback2/crates/snapback2-core/src/offline.rs`; mirror them with a strict decoder in `snapback2/packages/snapback2/src/offline-protocol.ts`. `DeliveryEnvelopeV1` has `{protocol, programGeneration, schemaHash, planHash, authority, state, result, next, rowPool, receipt, validator}`. Row-valued result nodes and receipt facts reference the one pool. Keep `ClosureReceipt` private. Rust/TypeScript golden fixtures must round-trip byte-identically, and hidden-versus-absent protected reads must yield indistinguishable public facts. This is O2's start gate.

2. **Land retention authoring.** Add `RetentionPolicy::{UntilRevoked, DeliveredHistory}` in `snapback2/crates/snapback2-core/src/schema.rs` and project it into `snapback2/crates/snapback2-core/src/certificate.rs`. Extend `snapback2/packages/compiler/src/quarry/{ast,parser,schema}.ts`, `snapback2/packages/compiler/src/lower/schema.ts`, `snapback2/packages/compiler/src/ir.ts`, and `snapback2/packages/compiler/lib.d.ts`. The spelling is `retain deliveredHistory`; omission means `untilRevoked`. Invalid values produce `schema/E_RETAIN_POLICY` plus “remove the line or write `retain deliveredHistory`.” Compiler fixtures include the corrected `first 50` messenger and reaction-delivery shapes.

3. **Project receipts onto existing routes.** In `snapback2/crates/snapback2/src/writer_wire.rs`, build the frozen public envelope and canonical validator. Thread `withReceipt` through `serve.rs` and `writer.rs::Action::{Execute,Subscribe}`. `/api/query?receipt=1` and `/api/subscribe?...&receipt=1` opt in; omission preserves current bytes. Add certificate-gated point-absence projection in `snapback2/crates/snapback2-core/src/engine/runner.rs`. Route tests cover every query state and every SSE frame, plus receipt-off byte identity.

4. **Add bounded resume.** Put DTO validation in new `snapback2/crates/snapback2/src/writer_offline.rs`, add `Action::Resume` in `writer.rs`, and register `POST /api/resume` in `serve.rs`. Reject caps before execution; resolve authority once; pin seq/time/generation; process the cohort before mounted queries; issue attach tickets and the replay grant; return only `notModified` or a full frozen envelope. Tests cover quiet tail, chunking, caps, no subscribe rerun, same-principal re-login, principal replacement, and generation reset.

5. **Add replay grants and dedup.** Persist grants and intent outcomes in `snapback2/crates/snapback2-core/src/store.rs`; parse `ReplayEnvelopeV1` on `/api/mutation`; inject its IDs in `writer_auth.rs::mutation_context`; make outcome persistence part of the mutation transaction. Tests cover exhaustion, offset reuse, altered-body reuse, two devices, rejected parents, expiry from server-minted time, and a fault injected after commit but before response.

6. **Close the executable seam.** One cross-language fixture sends O1 JSON through the TypeScript carrier decoder. One journey drains, kills, cold-starts, purges, reconnects, and replays two sends in order. Add `snapback2/packages/snapback2/guide/offline.md`, the necessary entries in `guide/families.source.json`, and receipt/resume wire examples; run the affected compiler, core, server, guide, inventory, and measurement checks. The LLP orientation constraints determine this order: authority-safe wire first, then storage, with no replica, tombstone service, scheduler kind, or new gate.

Rejected alternative: building O2 against a hand-written receipt stub would freeze its storage around precisely the shape O1 is responsible for correcting.

## If I could change one ruling

I would change ruling 3: ship O2 stored-answer replay and the durable outbox in v1, and move O3's twin and prediction to the first evidence-triggered follow-on. The offline bar's reads are already satisfied by held answers and the drained-log filter. Sends can preserve one stable pending bubble from their arguments without pretending a local mutation was authoritative. This removes the evaluator bundle and coverage semantics from the critical path while keeping the receipt capable of supporting them later. I would reopen O3 when a measured app needs a new named query offline or when argument-rendered pending UI proves inadequate.
