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
