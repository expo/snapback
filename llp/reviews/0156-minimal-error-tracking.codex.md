# LLP 0156 minimal error tracking review — Codex family

## Round 5 — 2026-08-02 (Codex-only spot-check of the v0.6 hunks; loop closed after)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the
author's explicit request)
**Method:** fresh non-author `codex exec` context, read-only sandbox,
mutually blind (instructed not to read `llp/reviews/` for 0156);
SHA-pinned target and capsule. Codex-only round: Fable was READY on
v0.5 and its v0.5 residues were editorial (applied in v0.6).
**Instruction capsule SHA-256:** `0554df9ad67c4eddcc831026aefea922bfe1defa012b765344d8f527be570729`
**Target:** `llp/0156-minimal-error-tracking.rfc.md` (1373 lines, Draft, v0.6)
**Target SHA-256:** `75aba44bea2468ba50495323349380033f831e6e71869abff6beffcf57b10e83`
**Status:** completed
**Verdict:** NOT READY (0 BLOCKING, 0 MAJOR — 4 MATERIAL
accounting/fixture-scope gaps and 1 MINOR initialization pin, all
inside the v0.6 hunks, all with prescribed resolutions; severity
strictly declining for the third consecutive round)

**Coordinator note (loop closure):** the round-5 findings were applied
as v0.7 per Codex's own prescribed resolutions (mismatch counter in
`telemetry_meta` + fixture; overflow counter defined
cumulative-per-generation with atomic rebind reset and labeled scope;
the generation-fence fixture split into unclaimed / claimed-undispatched
/ on-the-wire cases; `allow_private_webhook` scoped webhook-only with
the destination-matrix fixtures required for both destinations;
`state_seq = 0` at group creation pinned). The loop was then closed
under the corpus's asymmetric stopping rule — Fable READY (round 4,
with only editorial residues, declining re-review), Codex NOT READY in
rounds 3–5 with monotonically shrinking, fix-of-the-fix findings
(2 BLOCKING + 3 MAJOR → 2 MAJOR + 3 MATERIAL → 4 MATERIAL + 1 MINOR) —
matching the LLP 0154/0150 precedent. The v0.7 repairs are themselves
unreviewed. The author decides the status transition.

### Verbatim review (round 5)

1. **Verdict:** NOT READY

2. **Per-repair verdict**

   1. **UNSOUND.** The coupling invariant is correct: disposition-changing classifier revisions create a new fingerprint namespace, consistent with the group uniqueness key (`llp/0156-minimal-error-tracking.rfc.md:552-562`, `llp/0156-minimal-error-tracking.rfc.md:782-784`). However, the defensive mismatch path promises counting without defining durable storage, surface semantics, or an acceptance fixture (`llp/0156-minimal-error-tracking.rfc.md:559-562`, `llp/0156-minimal-error-tracking.rfc.md:1167-1180`, `llp/0156-minimal-error-tracking.rfc.md:1192-1221`).

   2. **UNSOUND.** Removing the pseudo-group is structurally correct, and atomic meta accounting preserves group-schema truthfulness (`llp/0156-minimal-error-tracking.rfc.md:474-484`). But the inherited meta contract represents the current generation (`llp/0154-minimal-observability.rfc.md:415-420`, `llp/0154-minimal-observability.rfc.md:433-439`), while this RFC neither defines counter reset/keying during rebind nor explains how one cumulative value supplies the promised “delta in the window” (`llp/0156-minimal-error-tracking.rfc.md:1005-1007`).

   3. **SOUND.** Both suppression classes have explicit group columns, are updated atomically with the no-row decision, remain available through the counters-only operator projection, and have a fixture gate (`llp/0156-minimal-error-tracking.rfc.md:753-776`, `llp/0156-minimal-error-tracking.rfc.md:992-994`, `llp/0156-minimal-error-tracking.rfc.md:1074-1077`, `llp/0156-minimal-error-tracking.rfc.md:1206-1208`).

   4. **UNSOUND.** The normative body correctly makes claim the generation linearization point and permits completion only for requests already on the wire (`llp/0156-minimal-error-tracking.rfc.md:1057-1066`). The E2 acceptance text still says rotated rows are “not delivered — including an in-flight edge,” which either contradicts that scope or leaves “in-flight” critically ambiguous (`llp/0156-minimal-error-tracking.rfc.md:1234-1236`).

   5. **UNSOUND.** The normative transport paragraph now binds webhook and Sentry destinations and correctly confines HMAC to the webhook (`llp/0156-minimal-error-tracking.rfc.md:1080-1091`). However, `allow_private_webhook` is grammatically placed as an exception to the generic rules, leaving its effect on Sentry ambiguous, while the deliverable still requests “webhook URL/redirect/rotation rules” and does not require the TLS/pinning/redirect matrix for both destinations (`llp/0156-minimal-error-tracking.rfc.md:1083-1089`, `llp/0156-minimal-error-tracking.rfc.md:1229-1242`).

   6. **UNSOUND.** Returning `state_seq` when history is empty totalizes the floor, but the truncation predicate assumes without stating that newly created groups initialize `state_seq = 0`; the DDL supplies neither a default nor an initialization rule (`llp/0156-minimal-error-tracking.rfc.md:777-779`, `llp/0156-minimal-error-tracking.rfc.md:850-858`). A nonzero initial token would falsely label untouched groups as truncated.

   7. **SOUND.** Counter capture—not the SQLite commit—is the admission-lock boundary, preserving D3’s nonblocking producer contract while telemetry writes remain serialized (`llp/0156-minimal-error-tracking.rfc.md:906-910`, `llp/0156-minimal-error-tracking.rfc.md:922-927`, `llp/0154-minimal-observability.rfc.md:637-643`). The activation guard now states defensive idempotence (`llp/0156-minimal-error-tracking.rfc.md:862-872`); allocator slot 5 covers the pre-existing allowlisted details that 0154 permits (`llp/0156-minimal-error-tracking.rfc.md:613-641`, `llp/0154-minimal-observability.rfc.md:625-632`); and `classifier_v` is explicitly an abbreviation (`llp/0156-minimal-error-tracking.rfc.md:753-766`).

3. **New defects**

   1. **MATERIAL — Classifier-disposition mismatches lack implementable accounting.** The failure path cannot fulfill “counted” without a named durable counter and exposure contract (`llp/0156-minimal-error-tracking.rfc.md:559-562`). Add a current-generation `classifier_disposition_mismatch_count` in `telemetry_meta`, increment it in the failed upsert transaction, expose it in the variance envelope, and add a fixture proving the group remains unchanged while the counter advances.

   2. **MATERIAL — `overflow_fold_count` has undefined generation and temporal semantics.** A current-meta scalar cannot produce a historical query-window delta, and its behavior during generation rebind is unstated (`llp/0156-minimal-error-tracking.rfc.md:474-483`, `llp/0156-minimal-error-tracking.rfc.md:1005-1007`, `llp/0154-minimal-observability.rfc.md:415-420`). Prefer defining it as a cumulative current-generation counter reset atomically on rebind and label that scope in responses; if window deltas are required, add generation-keyed time buckets or durable baselines.

   3. **MATERIAL — The generation-fence fixture overclaims cancellation.** The body permits an already-on-wire request to complete, while the deliverable can be read as requiring every in-flight edge to remain undelivered (`llp/0156-minimal-error-tracking.rfc.md:1061-1066`, `llp/0156-minimal-error-tracking.rfc.md:1234-1236`). Replace it with separate fixtures for an unclaimed pending row, a claimed-but-not-dispatched row, and an already-on-wire request; assert no new dispatch after rotation while permitting the last case to complete.

   4. **MATERIAL — Destination-generic transport is not closed through configuration and acceptance.** The normative paragraph covers both destinations, but its private-network exception and the deliverable remain webhook-shaped (`llp/0156-minimal-error-tracking.rfc.md:1080-1090`, `llp/0156-minimal-error-tracking.rfc.md:1229-1242`). State explicitly whether private transport is webhook-only; otherwise rename the knob. Require webhook and Sentry DSN fixtures for hostname-preserving TLS, resolve/validate/pin, private/link-local rejection, and redirect refusal, with HMAC fixtures only for webhook.

   5. **MINOR — The transition-floor label depends on an unstated initial CAS value.** Pin group creation to `state_seq = 0` with no creation-history row, so `MIN(seq) IS NULL AND state_seq > 0` unambiguously means pruning occurred (`llp/0156-minimal-error-tracking.rfc.md:777-779`, `llp/0156-minimal-error-tracking.rfc.md:850-858`).

4. **Recommended next step.**

Keep the RFC in Draft; repair the four MATERIAL gaps, pin the `state_seq` initialization, and run one narrow Codex re-review limited to those edits.
## Round 4 — 2026-08-02 (narrow delta on the v0.5 hunks)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the
author's explicit request)
**Method:** fresh non-author `codex exec` context, read-only sandbox,
mutually blind (instructed not to read `llp/reviews/` for 0156);
SHA-pinned target and capsule; narrowest round: the seven v0.5 hunks
only.
**Instruction capsule SHA-256:** `57fd4ae5f437378f6c55b59c0ae5b387f6ff2512eaf1fb1c25c7f90cb6ac8262`
**Target:** `llp/0156-minimal-error-tracking.rfc.md` (1297 lines, Draft, v0.5)
**Target SHA-256:** `324b0350b55a226710b3a748ca351caa35b24fc3cb0a4cbdfaad6ab0b492db44`
**Status:** completed
**Verdict:** NOT READY (2 MAJOR — dispatch-time generation fence,
SSRF coverage for the Sentry DSN destination; 3 MATERIAL —
classifier-version/disposition coupling, `_overflow` schema
truthiness, suppression-counter storage; 1 MINOR shared with the
other family; barrier/sequences/rollout/allocator hunks all SOUND)

### Verbatim review (round 4)

1. **Verdict:** NOT READY.

2. **Per-repair verdict**

   1. **SOUND.** Sequence assignment and buffer admission share one critical section; resolution captures the counter while holding that lock and durably advances `enqueue_high_water` in the same transaction. The defensive boot maximum prevents reuse below any committed barrier (`llp/0156-minimal-error-tracking.rfc.md:856`, `llp/0156-minimal-error-tracking.rfc.md:864`, `llp/0156-minimal-error-tracking.rfc.md:871`).

   2. **UNSOUND.** The precedence table is exhaustive, covers terminal and point records, and cleanly separates classification from fingerprinting (`llp/0156-minimal-error-tracking.rfc.md:471`, `llp/0156-minimal-error-tracking.rfc.md:487`, `llp/0156-minimal-error-tracking.rfc.md:501`). However, classifier changes can alter arm membership without changing fingerprint identity, while groups preserve only the first-fold disposition/version (`llp/0156-minimal-error-tracking.rfc.md:489`, `llp/0156-minimal-error-tracking.rfc.md:510`, `llp/0156-minimal-error-tracking.rfc.md:521`). Defect 1 remains.

   3. **SOUND.** Per-record enqueue sequences provide the missing within-flush ordering, are stored on groups and activations, and drive both bulk resolution and the `since` preset (`llp/0156-minimal-error-tracking.rfc.md:718`, `llp/0156-minimal-error-tracking.rfc.md:758`, `llp/0156-minimal-error-tracking.rfc.md:769`, `llp/0156-minimal-error-tracking.rfc.md:898`, `llp/0156-minimal-error-tracking.rfc.md:920`).

   4. **SOUND.** Persisted rollout bounds plus an emission-time predecessor hash give the flusher a restart-safe, exemplar-independent suppression lookup (`llp/0156-minimal-error-tracking.rfc.md:643`, `llp/0156-minimal-error-tracking.rfc.md:651`, `llp/0156-minimal-error-tracking.rfc.md:654`).

   5. **SOUND.** The allocator now supplies a total priority order, canonical byte accounting, whole-value JSON dropping, UTF-8-safe truncation, and an unambiguous reserved `unclassified` sentinel (`llp/0156-minimal-error-tracking.rfc.md:551`, `llp/0156-minimal-error-tracking.rfc.md:566`, `llp/0156-minimal-error-tracking.rfc.md:573`, `llp/0156-minimal-error-tracking.rfc.md:585`).

   6. **UNSOUND.** Per-destination identity, immutable capped payloads, terminal timestamps, retry bounds, and receiver deduplication are specified (`llp/0156-minimal-error-tracking.rfc.md:969`, `llp/0156-minimal-error-tracking.rfc.md:989`, `llp/0156-minimal-error-tracking.rfc.md:999`). The generation fence governs recovery scans, not dispatch already armed or in flight, and the URL-security contract covers the webhook but not the separately configured Sentry destination (`llp/0156-minimal-error-tracking.rfc.md:995`, `llp/0156-minimal-error-tracking.rfc.md:1010`, `llp/0156-minimal-error-tracking.rfc.md:1024`). Defects 2 and 3 remain.

   7. **UNSOUND.** The atomic bulk transition, explicit reopen, hard activation cap, and no-row cooldown rule are sound individually (`llp/0156-minimal-error-tracking.rfc.md:806`, `llp/0156-minimal-error-tracking.rfc.md:839`, `llp/0156-minimal-error-tracking.rfc.md:898`, `llp/0156-minimal-error-tracking.rfc.md:1006`). The reserved overflow row and suppression counters still lack coherent storage contracts, and the derived transition floor is incomplete when no history row remains (`llp/0156-minimal-error-tracking.rfc.md:438`, `llp/0156-minimal-error-tracking.rfc.md:797`). Defects 4–6 remain.

3. **New defects**

   1. **MATERIAL — Classifier-version changes can invalidate group disposition.** Arm membership is explicitly versioned, but group uniqueness is only `(generation, fp_version, fp_hash)`, and `failure_disposition`/`classifier_v` retain first-fold values (`llp/0156-minimal-error-tracking.rfc.md:487`, `llp/0156-minimal-error-tracking.rfc.md:510`, `llp/0156-minimal-error-tracking.rfc.md:714`, `llp/0156-minimal-error-tracking.rfc.md:730`). Moving an eligible code between, for example, `fault` and `overload` therefore folds newly classified records into a group whose disposition filter reports the old value. Resolve by including disposition in the fingerprint grammar, coupling every disposition-changing classifier revision to an `fp_version` bump, or rejecting an upsert whose stored disposition differs.

   2. **MAJOR — “Current generation only” is not fenced at dispatch.** Rows are checked by generation when boot/flush re-arms them, but the RFC separately requires an in-flight edge crossing rotation not to be delivered (`llp/0156-minimal-error-tracking.rfc.md:995`, `llp/0156-minimal-error-tracking.rfc.md:1158`). A send armed before rotation can pass the scan and execute afterward. Specify a dispatch claim/linearization point coordinated with generation rotation, plus the exact rule for sends already claimed or on the wire; otherwise narrow the guarantee to “not newly dispatched after rotation.”

   3. **MAJOR — SSRF protection does not cover every destination.** The HTTPS, public-address validation, pinning, redirect, and private-development rules are scoped to the configured webhook URL, while `sentry_bridge` is a separate destination aimed at a configured DSN (`llp/0156-minimal-error-tracking.rfc.md:973`, `llp/0156-minimal-error-tracking.rfc.md:1010`, `llp/0156-minimal-error-tracking.rfc.md:1024`). Apply an explicit equivalent resolve-validate-pin/no-redirect policy to the DSN endpoint, including hostname-preserving TLS validation.

   4. **MATERIAL — `_overflow` cannot truthfully inhabit the normative group schema.** One reserved row folds heterogeneous fingerprints and is exempt from normal issue behavior, but `error_groups` requires singular `kind`, `name`, `failure_disposition`, `classifier_v`, state, and fingerprint values (`llp/0156-minimal-error-tracking.rfc.md:438`, `llp/0156-minimal-error-tracking.rfc.md:703`, `llp/0156-minimal-error-tracking.rfc.md:714`, `llp/0156-minimal-error-tracking.rfc.md:724`). Define reserved sentinel values and exclusion from issue filters/state operations, or move overflow accounting into a dedicated aggregate/meta row.

   5. **MATERIAL — Suppression counts have no persisted location.** Rollout and cooldown suppressions are promised as counted, with cooldown counts specifically attached to the group, but neither `error_groups` nor `alert_outbox` contains such counters (`llp/0156-minimal-error-tracking.rfc.md:656`, `llp/0156-minimal-error-tracking.rfc.md:703`, `llp/0156-minimal-error-tracking.rfc.md:969`, `llp/0156-minimal-error-tracking.rfc.md:1006`). Add bounded per-reason group columns or a generation-scoped counter table/meta contract and update it atomically with the suppressed edge.

   6. **MINOR — The derived transition floor is undefined after complete history pruning.** The global cap may remove every transition row for an otherwise retained group, while the floor is defined solely as `MIN(seq)` (`llp/0156-minimal-error-tracking.rfc.md:797`, `llp/0156-minimal-error-tracking.rfc.md:800`). Define the empty-history case using `state_seq` and expose an explicit truncation flag, such as `history_truncated = state_seq > 0 && MIN(seq) IS NULL`.

4. **Recommended next step.** Keep LLP 0156 in Draft. Repair the classifier/fingerprint coupling, define dispatch-time generation fencing and destination-wide URL security, give overflow and suppression accounting explicit schemas, and totalize the transition-floor derivation. Then run a round-5 review limited to those amended hunks and their fixtures.
## Round 3 — 2026-08-02 (spot-check of the v0.4 repairs)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the
author's explicit request)
**Method:** fresh non-author `codex exec` context, read-only sandbox,
mutually blind (instructed not to read `llp/reviews/` for 0156);
SHA-pinned target and capsule; narrow round: the v0.4 repairs and any
defects they introduced.
**Instruction capsule SHA-256:** `1b4b4f414bd6699d16c46323d420493baa6e80005ad51b158ba1c9a8764ec815`
**Target:** `llp/0156-minimal-error-tracking.rfc.md` (1138 lines, Draft, v0.4)
**Target SHA-256:** `c59c462cdb22804f721eb40bfe5a0170a379580dc4630c7dbd5e229c7411bb49`
**Status:** completed
**Verdict:** NOT READY (2 BLOCKING — barrier above durable high-water
[independently convergent with the other family's round-3 MAJOR],
classifier contract not executable/materializable; 3 MAJOR — release
acceptance-order substrate, rollout suppression durability, outbox
destination/generation correctness; 2 MATERIAL; 1 MINOR; architecture
undisturbed)

### Verbatim review (round 3)

1. **Verdict:** NOT READY

2. **Per-repair verdict**

   1. **UNSOUND.** Versioning and emission-time classification are sound directions, but `ErrorClassificationV1` is not a complete executable contract. Its signature produces `fingerprint_hash` without accepting `name`, `errorClass`, `message_template`, or `subsystem`, although the fingerprint branches require them; its disposition table gives examples rather than an exhaustive mapping or precedence rule (`llp/0156-minimal-error-tracking.rfc.md:429-466`, `llp/0156-minimal-error-tracking.rfc.md:528-552`). It is also described as stamping terminal records, while eligible standalone diagnostics are point records (`llp/0156-minimal-error-tracking.rfc.md:441-444`, `llp/0154-minimal-observability.rfc.md:570-575`). Finally, `error_groups` stores neither `failure_disposition` nor `classifier_version`, even though `errors.issues` promises a disposition filter (`llp/0156-minimal-error-tracking.rfc.md:619-643`, `llp/0156-minimal-error-tracking.rfc.md:798-805`).

   2. **UNSOUND.** Admission-atomic sequence assignment is correct, but persisting the high-water only during flush does not make resolve restart-safe. With durable high-water `H`, an unflushed admission can receive `H+1`; resolve can persist `resolved_seq=H+1`; a crash before flush leaves the durable high-water at `H`; and the first post-restart event reuses `H+1`, failing the strict `>` regression test (`llp/0156-minimal-error-tracking.rfc.md:748-764`). A plain restart preserves the generation and therefore preserves the affected resolved group (`llp/0154-minimal-observability.rfc.md:418-422`).

   3. **UNSOUND.** The ASCII identifier grammar and bounded sentinel are good cardinality controls (`llp/0156-minimal-error-tracking.rfc.md:492-502`), but `unclassified` itself matches the accepted grammar, so it is not reserved. More importantly, the whole-record allocator does not order or define truncation for existing `function`, raw `message`, `appCode`, or arbitrary JSON `appDetails`; the stated priority list mentions only stamps, fingerprint, class, template, and stack (`llp/0156-minimal-error-tracking.rfc.md:504-518`). Those existing occupants are real: the settle envelope and Rust decoder currently retain them (`packages/snapback-harness/ctx-bootstrap.js:1207-1238`, `src/runtime.rs:3201-3233`), while LLP 0154 applies one serialized 8 KiB allowlisted-details cap (`llp/0154-minimal-observability.rfc.md:625-632`).

   4. **SOUND.** The branch tag, per-field presence byte, big-endian byte length, exact UTF-8 payload, integer representation, and ordered branch tuples form an unambiguous encoding suitable for Rust/JS golden vectors (`llp/0156-minimal-error-tracking.rfc.md:532-563`). The diagnostic tuple now includes `name` and `subsystem`, and `status_class` is represented in the group schema (`llp/0156-minimal-error-tracking.rfc.md:546-552`, `llp/0156-minimal-error-tracking.rfc.md:625-630`). The `iss_` TimeOrdered choice is also correct: LLP 0148 reserves random bodies for `usr_`, and the current helper exposes only TimeOrdered and Random bodies (`llp/0148-prefixed-identifiers.decision.md:142-147`, `src/ids.rs:49-58`).

   5. **UNSOUND.** Fold-only overflow, exemplar truncation flags, duplicate-first activation handling, unknown-release failure, and per-row bulk results are stated (`llp/0156-minimal-error-tracking.rfc.md:395-403`, `llp/0156-minimal-error-tracking.rfc.md:645-655`, `llp/0156-minimal-error-tracking.rfc.md:706-716`, `llp/0156-minimal-error-tracking.rfc.md:780-790`). The combined mechanism remains incomplete: `_overflow` has no reserved-capacity rule; `release_activations` has no hard row cap; the Revised header says activations age out at raw retention while the normative body assigns the group horizon (`llp/0156-minimal-error-tracking.rfc.md:70-75`, `llp/0156-minimal-error-tracking.rfc.md:680-710`); and keeping only the first activation cannot distinguish a genuine later reactivation of the same bundle hash. The `since` predicate is not durably representable after bounded transition history is pruned, and `activated_ms` cannot establish acceptance order within a flush because LLP 0154 assigns every row in a batch the same observation-clock stamp (`llp/0156-minimal-error-tracking.rfc.md:798-804`, `llp/0154-minimal-observability.rfc.md:544-558`). The transition matrix also leaves `regressed → open` merely “implicit,” and the promised transition floor has no pinned persistence/derivation rule (`llp/0156-minimal-error-tracking.rfc.md:698-705`, `llp/0156-minimal-error-tracking.rfc.md:728-779`).

   6. **UNSOUND.** For one destination, immutable payloads, edge uniqueness, recovery scans, bounded retries, terminal states, and count caps are a sound base (`llp/0156-minimal-error-tracking.rfc.md:841-873`). But one `status`/`attempts` tuple cannot independently track both the webhook and optional Sentry bridge, whose text reads as additive (`llp/0156-minimal-error-tracking.rfc.md:843-858`, `llp/0156-minimal-error-tracking.rfc.md:874-895`). Delivery semantics do not state at-least-once behavior or expose `delivery_id` as a receiver deduplication key; payload and `last_error` have no byte caps; terminal retention has no terminal timestamp; and the SSRF rule does not pin a validated public address through connection establishment. Recovery scans also lack a current-generation fence even though old-generation batches may land after rotation (`llp/0154-minimal-observability.rfc.md:423-446`). The “Sentry-formatted alert bridge” rename itself is accurate (`llp/0156-minimal-error-tracking.rfc.md:886-895`).

   7. **UNSOUND.** The suppression predicate is not implementable from the specified durable data. Records carry only the current fingerprint version/hash, while predecessor matching is left as prose (`llp/0156-minimal-error-tracking.rfc.md:565-578`). For exception-normalizer changes, the predecessor tuple depends on `message_template`, but groups do not retain that value; it exists only in raw-tier exemplars that can be absent or aged out (`llp/0156-minimal-error-tracking.rfc.md:619-655`, `llp/0156-minimal-error-tracking.rfc.md:680-690`). No persisted `(from_version, to_version, start, expiry)` rollout state is defined either.

3. **New defects**

   1. **BLOCKING — Resolve can persist a barrier above the durable enqueue high-water.** Persist the captured counter into `telemetry_meta.enqueue_high_water` in the same transaction as `resolved_seq`, while holding the admission-sequence linearization lock; boot should defensively seed from the maximum of the metadata high-water and current-generation persisted barriers. Add the exact crash fixture “resolve committed after unflushed admission, crash before any flush, first post-restart failure must regress” (`llp/0156-minimal-error-tracking.rfc.md:740-764`).

   2. **BLOCKING — The classifier/fingerprint contract cannot be implemented or materialized as written.** Define an exhaustive versioned classification table with precedence; apply it to eligible point as well as terminal records; split classification from fingerprinting or add every branch input to the function; and store at least `classifier_version` and `failure_disposition` durably in groups, with explicit cross-version aggregation semantics (`llp/0156-minimal-error-tracking.rfc.md:425-466`, `llp/0156-minimal-error-tracking.rfc.md:619-643`).

   3. **MAJOR — Release order, recurrence history, and bulk selection lack a durable acceptance-order substrate.** Store activation instances and their enqueue sequences, plus durable first/last/regression enqueue sequences on groups. Distinguish an idempotent duplicate lifecycle row from a genuine reactivation of the same release hash. Define bulk resolution’s single linearization point and either transact the whole snapshot or CAS a row version that advances on folds as well as state changes (`llp/0156-minimal-error-tracking.rfc.md:670-716`, `llp/0156-minimal-error-tracking.rfc.md:780-804`).

   4. **MAJOR — Fingerprint-rollout suppression cannot locate predecessor groups or survive restart.** During a rollout, stamp or deterministically derive a predecessor version/hash beside the new fingerprint, and persist rollout version bounds and expiry in metadata. Test exception normalizer changes after all predecessor exemplars have aged out (`llp/0156-minimal-error-tracking.rfc.md:565-578`, `llp/0156-minimal-error-tracking.rfc.md:645-690`).

   5. **MATERIAL — The whole-record allocator is not deterministic enough to preserve the existing refusal contract.** Pin canonical serialized-byte accounting, reserved overhead for truncation flags, the priority of every existing and new key, UTF-8-safe string truncation, arbitrary-JSON `appDetails` reduction/drop behavior, and whether raw message survives beside its template. Reserve `unclassified` from accepted handler class names (`llp/0108-inline-handlers-and-result-contracts.spec.md:983-1008`, `llp/0156-minimal-error-tracking.rfc.md:492-518`).

   6. **MATERIAL — The claimed bounded-state regime has unclosed edges.** Reserve `_overflow` inside or explicitly outside the group cap; hard-cap `release_activations` with a surfaced floor; reconcile its raw-versus-group retention contradiction; persist or normatively derive transition floors; and either remove `regressed → open` or specify its trigger, actor, CAS, and history row (`llp/0156-minimal-error-tracking.rfc.md:395-403`, `llp/0156-minimal-error-tracking.rfc.md:680-736`).

   7. **MAJOR — The alert protocol lacks destination and generation correctness.** Either make webhook and Sentry mutually exclusive or key delivery state by destination; scan and deliver current-generation rows only; define at-least-once semantics with `delivery_id` in the signed request; cap payload/error bytes; add a terminal timestamp; and require HTTPS plus validation of every A/AAAA result with connection pinning to the validated public address (`llp/0156-minimal-error-tracking.rfc.md:841-895`, `llp/0154-minimal-observability.rfc.md:423-446`).

   8. **MINOR — The `unclassified` sentinel is accepted as an ordinary class name.** Reserve it or encode classification failure separately so a validated handler-authored class cannot be indistinguishable from failed extraction (`llp/0156-minimal-error-tracking.rfc.md:492-502`).

4. **Design notes**

   None. These are mechanism-level defects in the v0.4 repairs; they do not require reopening the separate RFC, E0/E1/E2/E3 phasing, table split, or typed-operation architecture (`llp/0156-minimal-error-tracking.rfc.md:127-205`).

5. **Recommended next step.**

   Keep the RFC in Draft and issue a v0.5 repair covering the two blocking contracts first, then the release-order, rollout, bounded-state, allocator, and outbox defects. Run a narrow follow-up spot-check using explicit crash schedules and golden fixtures for: resolve-before-flush restart, same-batch activation ordering, same-hash reactivation, transition-history pruning, predecessor suppression without exemplars, generation rotation with an in-flight alert edge, and independent webhook/Sentry delivery state.
## Round 2 — 2026-08-02 (focused delta review of v0.3)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the
author's explicit request)
**Method:** fresh non-author `codex exec` context, read-only sandbox,
mutually blind (instructed not to read `llp/reviews/` for 0156);
SHA-pinned target and capsule; delta round focused on the v0.3
restructure's new machinery, design-partner mandate standing.
**Instruction capsule SHA-256:** `ce2271ec7cca86dd9e8cb2f360feb25c5d9cf82d9ecd74577ed166ff58001d5a`
**Target:** `llp/0156-minimal-error-tracking.rfc.md` (896 lines, Draft, v0.3)
**Target SHA-256:** `bb71459ad31a845e7cf51f0e7888eb2a678b21aed1886b89aaa134bcb7be0575`
**Status:** completed
**Verdict:** NOT READY (3 BLOCKING — per-event disposition not
representable by a class column, barrier restart-safety, outbox not a
delivery protocol; 5 MAJOR; 2 MATERIAL; 1 MINOR; converges with the
other family on barrier/disposition/cap/releases/outbox from an
independent read)

### Verbatim review (round 2)

1. **Verdict:** NOT READY

2. **Per-repair verdict**

- **E0.1 disposition and eligibility — UNSOUND.** Excluding routine refusals is correct, but the RFC models disposition as an operation-class registry column even though disposition varies per terminal outcome. It also omits `caller_error` from the supposedly closed summary enum and collides terminologically with 0154’s existing `system` disposition (`llp/0156-minimal-error-tracking.rfc.md:83`, `llp/0156-minimal-error-tracking.rfc.md:352`, `llp/0154-minimal-observability.rfc.md:609`).
- **E0.2 carrier — UNSOUND.** Capturing the discarded async stack is sound (`src/runtime.rs:672`, `src/runtime.rs:2982`, `src/runtime.rs:3010`), but the settle contract, trusted class extraction, and byte allocation are not sufficiently specified.
- **Fingerprint versioning — UNSOUND as specified.** Versioning correctly prevents silent reinterpretation, but the byte encoding is not actually pinned and version bumps create unaddressed new-issue alert storms (`llp/0156-minimal-error-tracking.rfc.md:436`, `llp/0156-minimal-error-tracking.rfc.md:657`).
- **Minted issue id plus unique fingerprint key — SOUND.** A minted handle with deterministic uniqueness in `(generation, fp_version, fp_hash)` is cleaner than inventing a derived body (`llp/0156-minimal-error-tracking.rfc.md:467`). The separate choice of a `Random` body contradicts LLP 0148, however.
- **Groups/exemplars/transitions split and structural titles — UNSOUND as a complete contract.** Separating raw exemplars is the right retention shape, but several supposedly structural fields are undefined or missing and the ledger is not resource-bounded (`llp/0156-minimal-error-tracking.rfc.md:482`, `llp/0156-minimal-error-tracking.rfc.md:539`).
- **Ledger, `state_seq` CAS, and resolved-seq barrier — UNSOUND.** Same-database atomicity is sound; the enqueue-sequence lifetime and bulk-CAS semantics are not (`llp/0156-minimal-error-tracking.rfc.md:580`, `llp/0156-minimal-error-tracking.rfc.md:589`).
- **Regression guarantee scoped to group lifetime — UNSOUND as written.** Scoping state loss is honest, but the text simultaneously folds at the cap and permits cap eviction, while responses report only a time horizon (`llp/0156-minimal-error-tracking.rfc.md:326`, `llp/0156-minimal-error-tracking.rfc.md:560`).
- **New-plus-regression alert policy and spike demotion — SOUND.** The two edges match the available state, while rate alerts correctly wait for buckets and a denominator (`llp/0156-minimal-error-tracking.rfc.md:655`).
- **Durable alert outbox — UNSOUND.** Atomic insertion is the right direction, but recovery, payload custody, bounds, and retry state are absent (`llp/0156-minimal-error-tracking.rfc.md:666`).
- **Alignment to the 8 KiB details cap — UNSOUND.** The stated allocator excludes fields already occupying the same envelope/details budget (`llp/0156-minimal-error-tracking.rfc.md:394`).
- **CE5 inherited loss model — SOUND.** “First persisted occurrence,” explicit drop counters, and lossy counts accurately inherit 0154 D3/C7 (`llp/0156-minimal-error-tracking.rfc.md:331`, `llp/0154-minimal-observability.rfc.md:630`).
- **Deploy-integrated bulk resolve — UNSOUND.** The behavior is useful, but one `expect_seq` cannot CAS an arbitrarily selected set of groups (`llp/0156-minimal-error-tracking.rfc.md:612`, `llp/0156-minimal-error-tracking.rfc.md:639`).
- **Since-release preset — UNSOUND.** Release identifiers are bundle hashes/deployment ids, yet the predicate orders them with `≥` and no durable activation catalogue exists (`llp/0156-minimal-error-tracking.rfc.md:500`, `llp/0156-minimal-error-tracking.rfc.md:626`).
- **`subsystem` facet — UNSOUND.** It is stored but absent from relevant fingerprints, allowing different diagnostic identities to collapse into a group with arbitrary facet metadata (`llp/0156-minimal-error-tracking.rfc.md:415`, `llp/0156-minimal-error-tracking.rfc.md:433`, `src/diagnostic.rs:23`).
- **Sentry-envelope egress — UNSOUND for the claimed graduation use.** An outbox containing only new/regression edges and metadata is an alert bridge, not error-event forwarding (`llp/0156-minimal-error-tracking.rfc.md:657`, `llp/0156-minimal-error-tracking.rfc.md:675`, `llp/0156-minimal-error-tracking.rfc.md:682`).

3. **New defects**

1. **BLOCKING — E0’s disposition is not representable by the proposed registry column.** LLP 0154’s registry rows describe operation classes and their failure predicates (`llp/0154-minimal-observability.rfc.md:472`, `llp/0154-minimal-observability.rfc.md:635`); one `function_run` can terminate as an application refusal, caller error, timeout, overload, or fault. Per-code application-refusal eligibility is additionally a function-manifest property, not an operation-class property (`llp/0108-inline-handlers-and-result-contracts.spec.md:983`, `llp/0108-inline-handlers-and-result-contracts.spec.md:992`). Resolve this with a versioned per-event classifier keyed by operation class, admitted code/status, carrier category, and manifest opt-in. Stamp the resolved `failure_disposition`, eligibility, classifier version, and fingerprint version/hash on the buffered terminal record. Rename 0154’s existing usage disposition and the new failure disposition distinctly.

2. **BLOCKING — `resolved_seq` is not restart-safe or fully linearized.** Groups survive ordinary restarts (`llp/0154-minimal-observability.rfc.md:409`), but the RFC persists an integer barrier without defining a durable enqueue high-water or boot epoch (`llp/0156-minimal-error-tracking.rfc.md:503`, `llp/0156-minimal-error-tracking.rfc.md:589`). A restarted counter can place genuine post-resolve events below an old barrier; concurrent counter allocation and channel acceptance also lack a stated linearization point. Resolve this with a persisted generation-local boot epoch plus local sequence, assigned atomically at successful buffer admission, or serialize transitions behind a buffer-drain fence. Add restart-after-resolve and concurrent-enqueue fixtures.

3. **MAJOR — The carrier’s trust and byte contracts are incomplete.** The settle envelope does not currently carry only code/message: declared refusals also carry `appCode` and `appDetails` (`packages/snapback-harness/ctx-bootstrap.js:1213`, `packages/snapback-harness/ctx-bootstrap.js:1226`), and the Rust decoder adds function/message/details (`src/runtime.rs:3205`). The proposed 8 KiB equation omits those occupants even though 0154 caps the entire allowlisted `details` object (`llp/0154-minimal-observability.rfc.md:616`). Moreover, the async seam produces a closed native class enum (`src/runtime.rs:3083`), while E0 never says whether settle-path `errorClass` is that closed classification or handler-controlled `name`/constructor text. Resolve this by pinning a getter-safe closed class algorithm with an `unclassified` fallback, defining a deterministic whole-details byte allocator and field priorities, and testing poisoned `message`, `stack`, `name`, constructor, proxy, and oversized `appDetails` cases.

4. **MAJOR — Fingerprint identity and stored classification disagree.** The canonical encoding omits integer representation, branch tags, null-versus-empty encoding, Unicode policy, and vectors (`llp/0156-minimal-error-tracking.rfc.md:467`). Transport fingerprints include `status_class`, but `error_groups` has no such column (`llp/0156-minimal-error-tracking.rfc.md:429`, `llp/0156-minimal-error-tracking.rfc.md:493`). Standalone diagnostics fingerprint only by code while storing `name` and `subsystem`, even though stable public diagnostic classification includes subsystem (`llp/0156-minimal-error-tracking.rfc.md:433`, `src/diagnostic.rs:31`). Resolve this with an explicit tagged byte grammar and cross-language vectors, a `status_class` column, and fingerprints containing every field whose stored/display value must be deterministic—at least `name` and `subsystem` for diagnostic branches.

5. **MATERIAL — `iss_` using `Body::Random` contradicts Accepted LLP 0148.** LLP 0148 makes UUIDv7/time-ordered bodies the rule and random bodies exclusive to `usr_` (`llp/0148-prefixed-identifiers.decision.md:3`, `llp/0148-prefixed-identifiers.decision.md:142`); the implementation exposes only `TimeOrdered` and `Random`, with the latter documented as user-specific (`src/ids.rs:49`). Resolve this by making `Issue` time-ordered, or amend LLP 0148 explicitly with a reason for a second random-body kind.

6. **MAJOR — The retention/resource story is not bounded or internally consistent.** New fingerprints supposedly fold into `_overflow`, yet groups may also be “evicted at the cap” without an eviction policy (`llp/0156-minimal-error-tracking.rfc.md:326`, `llp/0156-minimal-error-tracking.rfc.md:560`). A group cap and time horizon do not bound transition rows: one group can cycle indefinitely while the ledger is called the audit authority (`llp/0156-minimal-error-tracking.rfc.md:523`, `llp/0156-minimal-error-tracking.rfc.md:539`). The exemplar schema also claims truncation flags without storing one (`llp/0156-minimal-error-tracking.rfc.md:512`). Resolve this by choosing fold-only or a deterministic eviction policy, defining whether horizon uses `last_seen_ms`, reporting every state-loss boundary, and adding total/per-group ledger caps or a transition floor with explicit partial-history labeling. Add explicit exemplar truncation fields.

7. **MAJOR — Both release-oriented operations lack executable concurrency/time semantics.** `errors.transition` exposes one `expect_seq` for bulk selectors (`llp/0156-minimal-error-tracking.rfc.md:639`), while the since predicate compares opaque release identifiers (`llp/0156-minimal-error-tracking.rfc.md:626`). LLP 0154 records release activation only as a lifecycle observation subject to raw retention (`llp/0154-minimal-observability.rfc.md:592`, `llp/0154-minimal-observability.rfc.md:670`). Resolve bulk CAS with a selected snapshot of `(issue, state_seq)` and per-row applied/conflict results. Resolve release predicates through a durable generation-scoped release-activation catalogue—or require an explicit activation-clock boundary—and define missing/duplicate-release behavior.

8. **BLOCKING — The outbox is durable only at insertion, not as a delivery protocol.** There is no schema, immutable payload snapshot, pending-row bound, retry state, recovery scan, or interaction with group sweeping (`llp/0156-minimal-error-tracking.rfc.md:666`). A crash after commit but before the post-commit arm can strand a row; rendering from the current group can change or disappear before delivery. The claimed inheritance from 0154 D9 is also false: D9 merely notes a future best-effort HMAC forwarder and specifies no SSRF, redirect, or secret-rotation contract (`llp/0154-minimal-observability.rfc.md:999`, `llp/0154-minimal-observability.rfc.md:1008`). Resolve this with normative outbox DDL, immutable versioned payload bytes, a unique edge key, boot/flush recovery, bounded event-armed retries, terminal dropped/delivered states, retention/cap policy, and locally specified URL/redirect/secret rules.

9. **MAJOR — Sentry egress is attached to the wrong lane for its stated purpose.** Only new and regression edges enter the outbox, and its payload deliberately excludes message, template, and stack (`llp/0156-minimal-error-tracking.rfc.md:657`, `llp/0156-minimal-error-tracking.rfc.md:675`). Encoding those sparse metadata notifications as Sentry envelopes cannot preserve occurrences, exemplars, or continuing faults and therefore is not a zero-app-change graduation path. Resolve this by either naming it honestly as a Sentry-formatted alert bridge, or designing a separate explicitly opted-in eligible-error event forwarder with raw-data custody, independent retry/bounds, and pinned Sentry vectors.

10. **MATERIAL — A fingerprint-version bump manufactures alertable “new” issues.** The scheme deliberately starts new groups without continuity (`llp/0156-minimal-error-tracking.rfc.md:436`), while E2 alerts on every new group (`llp/0156-minimal-error-tracking.rfc.md:657`). Normalizer maintenance can therefore emit a fleet-wide alert burst. Resolve this with a version-rollout policy: carry-forward mapping, a counted suppression window for scheme-created edges, or explicit operator confirmation before alerts arm on the new version.

11. **MINOR — Phase and vocabulary cleanup remains.** The E0+E1 checklist requires outbox crash fixtures even though E2 is explicitly later (`llp/0156-minimal-error-tracking.rfc.md:655`, `llp/0156-minimal-error-tracking.rfc.md:727`, `llp/0156-minimal-error-tracking.rfc.md:757`). Move that fixture to E2. Also include `caller_error` in every closed disposition enumeration (`llp/0156-minimal-error-tracking.rfc.md:83`, `llp/0156-minimal-error-tracking.rfc.md:355`).

4. **Design notes**

- A cleaner E0 boundary is a fixed `ErrorClassificationV1` stamped after host admission: disposition, eligibility, classifier version, fingerprint version/hash, closed display class, and stable facets. Raw message/stack remain separately budgeted carrier data. The flusher then materializes already-decided classification instead of re-opening manifest and runtime semantics.
- Treat `error_groups.state` as current authority and `error_transitions` as bounded, explicitly partial history. Calling a horizon-swept ledger an “audit authority” overstates a telemetry file that is intentionally deletable (`llp/0154-minimal-observability.rfc.md:438`).
- Keep notification-edge delivery and error-event forwarding as separate outboxes. They have different payload sensitivity, volume, retry economics, and interoperability promises.

5. **Recommended next step.**

Revise to v0.4 and remain Draft. Close the E0 row contract, restart-safe barrier, and durable outbox first; then pin fingerprint/carrier vectors, align `iss_` with LLP 0148, and make release/bulk/retention semantics executable. The next focused review should concentrate on those three blocking protocols plus cross-document amendments to LLP 0154 and LLP 0108 before considering another status transition.
## Round 1 — 2026-08-02 (full review of v0.2, design-partner mode)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the
author's explicit request)
**Method:** fresh non-author `codex exec` context, read-only sandbox,
mutually blind (instructed not to read `llp/reviews/` for 0156);
SHA-pinned target and instruction capsule; design-partner mode at the
author's explicit direction.
**Instruction capsule SHA-256:** `21fa63c126e196cec46534958097c798836dd712101492096f967a23e6fd511e`
**Target:** `llp/0156-minimal-error-tracking.rfc.md` (580 lines, Draft, v0.2)
**Target SHA-256:** `bae81c0087bdbf0b32dbcc1662a29ecb8401bd0e27158a929c6a3f68bcd667e3`
**Status:** completed
**Verdict:** NOT READY (5 BLOCKING, 4 MAJOR, 2 MATERIAL; direction
endorsed as "issue index, not miniature Sentry"; proposes an E0
disposition/carrier phase and physical safe/authored/raw table split)

### Verbatim review (round 1)

1. **Verdict:** NOT READY

2. **Directional assessment**

The right product is a built-in, operator-only **issue index**, not a miniature Sentry. Snapback’s zero-infrastructure local operation and typed agent-facing operations justify grouping server failures locally even though comparable backend platforms delegate full error tracking. Rich symbolication, cross-project workflows, assignment, and client crash tooling should remain delegated.

Keeping LLP 0156 separate from LLP 0154 is correct: authored triage state, regression semantics, and external notifications are materially different from observability’s lossy event/rollup substrate. However, 0156 must explicitly amend 0154’s failure envelope and retention contract rather than claiming to consume it unchanged.

Sentry-envelope ingestion everywhere is not stronger for server failures because Snapback already owns the runtime seam. The stronger interoperability move is optional **Sentry-envelope egress** for server issues and Sentry-compatible ingest for a separately designed client-crash product. Issues should not become app-queryable data: the telemetry store is deliberately outside the app schema and contains operator-sensitive failure material (`llp/0154-minimal-observability.rfc.md:392`, `llp/0031-server-route-taxonomy.spec.md:188`).

The phase cut should become:

- E0: define actionable-failure eligibility and a cross-runtime exception carrier preserving class/message/stack.
- E1: safe durable groups, ordered triage state, typed operations/CLI, then the thin console projection.
- E2: new-issue and regression notifications only, through a reusable durable delivery seam.
- E3: a separate RFC for Sentry-envelope-compatible client ingest, authority, offline delivery, and symbolication.

3. **Findings**

1. **BLOCKING — Raw exemplar snapshots violate the inherited retention contract.** E1.2 deliberately retains stack and message snapshots after their raw rows expire (`llp/0156-minimal-error-tracking.rfc.md:330`). Yet LLP 0154 permits aggregates to outlive raw retention specifically because they are classification-only (`llp/0154-minimal-observability.rfc.md:420`); its daily aggregate horizon defaults to 730 days (`llp/0154-minimal-observability.rfc.md:873`). Diagnostic messages/details may contain source paths, handler text, and arguments (`src/diagnostic.rs:31`). As written, a nominal seven-day raw-retention setting silently becomes potentially 730-day retention for the most sensitive bytes. Resolve this by keeping `error_groups` classification-only and storing exemplars in a separate raw-tier table governed by the same retention floor as `telemetry_events`, or specify a new explicit sensitive-retention policy with deletion and operator controls.

2. **BLOCKING — A normalized exception message is still handler-controlled sensitive text, not `OperatorMetadata`.** The normalizer removes only digit, hex/base32, and quoted spans (`llp/0156-minimal-error-tracking.rfc.md:259`), but `errors.issues` exposes the resulting title under ordinary admin authority (`llp/0156-minimal-error-tracking.rfc.md:376`) and E2 sends it to the webhook (`llp/0156-minimal-error-tracking.rfc.md:413`). LLP 0031 classifies handler errors and handler-controlled text as sensitive application data (`llp/0031-server-route-taxonomy.spec.md:188`, `llp/0031-server-route-taxonomy.spec.md:286`), while LLP 0154’s closed metadata projection explicitly forbids free text (`llp/0154-minimal-observability.rfc.md:769`). Resolve this by making the ordinary title entirely structural—such as `<error_class> in <declared name>` or `<Diagnostic code> in <declared name>`—and placing the message template only in the raw-tier detail response.

3. **BLOCKING — The asserted stack-capture seam does not cover ordinary uncaught handler exceptions.** The Hermes metadata call does return a stack which `render_async_failure` currently frees unread (`src/runtime.rs:672`, `src/runtime.rs:2965`). But that function is reached through the post-eval unhandled-rejection queue (`src/runtime.rs:2891`, `src/runtime.rs:2921`). An exception from the awaited handler is instead caught by `__snapbackSettle`, which serializes only code and message (`packages/snapback-harness/ctx-bootstrap.js:1195`, `packages/snapback-harness/ctx-bootstrap.js:1236`); the Rust decoder then generally folds it to `SNAPBACK_HANDLER_FAILED` with no class or stack (`src/runtime.rs:3193`, `src/runtime.rs:3227`). Thus the RFC’s principal uncaught-exception branch cannot be implemented from the named seam (`llp/0156-minimal-error-tracking.rfc.md:255`). Resolve this with a trusted, cross-runtime failure envelope that preserves bounded error class, message, and stack for awaited handler failures, with parity fixtures for Ibex and workerd; alternatively narrow E1 to the failure classes the current substrate really carries.

4. **BLOCKING — “Every failed observation” conflates expected semantic refusals with actionable errors, and its custom-fingerprint claim keys the wrong field.** LLP 0108 defines declared application refusals for stale revisions, consumed invites, and validation failures (`llp/0108-inline-handlers-and-result-contracts.spec.md:971`). They surface as platform code `SNAPBACK_APP_REFUSAL` with the actual declared `appCode` in details (`llp/0108-inline-handlers-and-result-contracts.spec.md:989`, `llp/0108-inline-handlers-and-result-contracts.spec.md:1004`). Fingerprinting `(kind, name, Diagnostic code)` therefore collapses all declared refusal codes for a function, while tracking them all by default would fill the issue list with routine domain outcomes (`llp/0156-minimal-error-tracking.rfc.md:252`). Resolve this by adding an explicit error-tracking eligibility/disposition to the operation/diagnostic registry. Default-track unhandled exceptions and host faults; default-exclude routine declared refusals, cancellations, and caller validation. If an admitted application refusal is trackable, key it by `appCode`, not `SNAPBACK_APP_REFUSAL`.

5. **BLOCKING — A buffered pre-resolution failure can falsely regress an issue.** LLP 0154 producers enqueue fire-and-forget records and may wait up to 3 seconds for the batch flush (`llp/0154-minimal-observability.rfc.md:630`, `llp/0154-minimal-observability.rfc.md:648`). LLP 0156 lets `errors.transition` resolve a group while declaring that any subsequently flushed event causes regression (`llp/0156-minimal-error-tracking.rfc.md:350`, `llp/0156-minimal-error-tracking.rfc.md:385`). A failure already accepted before the resolve operation can therefore overtake the authored transition at persistence. Resolve this by routing transitions through the flusher as ordered control records or by establishing a drain barrier and durable event-sequence watermark; regression must mean “accepted after resolution,” not merely “persisted later.” Add the overtaking case to acceptance coverage.

6. **MAJOR — Deterministic issue identity is under-specified and does not fit LLP 0148’s current body policy.** The RFC specifies Crockford base32 of “the fingerprint hash” without pinning canonical tuple encoding, hash algorithm, truncation, fingerprint version, or collision handling (`llp/0156-minimal-error-tracking.rfc.md:289`). LLP 0148’s syntax accepts a 26-character body (`llp/0148-prefixed-identifiers.decision.md:102`), but its semantic policy makes object bodies UUIDv7 except `usr_` (`llp/0148-prefixed-identifiers.decision.md:142`), and the implementation registry offers only `TimeOrdered` and `Random` (`src/ids.rs:49`, `src/ids.rs:108`). Prefer a normally minted `iss_` plus a unique `(generation, fingerprint_version, fingerprint_hash)` key and equality check. If deterministic IDs are truly required, amend LLP 0148 with a `Derived` body class and pin canonical serialization, domain separation, truncation, migration, and collision behavior before implementation.

7. **MAJOR — Automatic group sweeping silently erases the RFC’s “non-negotiable” regression memory.** Groups are swept at a last-seen horizon (`llp/0156-minimal-error-tracking.rfc.md:323`), while a resolved group is promised to reopen on recurrence (`llp/0156-minimal-error-tracking.rfc.md:350`). After the sweep, the same fingerprint becomes a new issue rather than a regression, even without an operator deleting telemetry or rotating generations. OQ-B discusses explicit deletion/reset but omits this automatic loss (`llp/0156-minimal-error-tracking.rfc.md:536`). Resolve this by defining a separate bounded state-tombstone lifetime and the exact post-expiry behavior, or explicitly limit the regression guarantee to the retained issue horizon and expose that horizon in responses.

8. **MAJOR — The release-facing API cannot be implemented from the proposed schema.** The summary promises per-release first/last occurrence (`llp/0156-minimal-error-tracking.rfc.md:59`) and `errors.issues` filters by release (`llp/0156-minimal-error-tracking.rfc.md:376`), but `error_groups` stores only the first-ever and latest release (`llp/0156-minimal-error-tracking.rfc.md:313`). It cannot answer whether an issue occurred in an intermediate release or provide per-release counts/timestamps. Resolve this with a bounded `error_group_releases(generation, issue, release, first_seen_ms, last_seen_ms, count)` table and explicit eviction/exactness semantics, or remove the filter and per-release claim from E1.

9. **MAJOR — The E2 rate-spike rule has no authoritative data model.** The rule requires a trailing-hour count and trailing-seven-day hourly mean per issue (`llp/0156-minimal-error-tracking.rfc.md:401`), but `error_groups` stores only a lifetime count (`llp/0156-minimal-error-tracking.rfc.md:302`) and LLP 0154 rollups are keyed by kind/name, not issue (`llp/0154-minimal-observability.rfc.md:844`). Computing from raw rows becomes unavailable when retention is shorter than seven days and expensive without a fingerprint index. Remove spike detection from E2 and ship the evidence-backed new/regression pair, or add bounded per-issue time buckets plus drop/sampling/exactness and traffic-denominator semantics.

10. **MATERIAL — Webhook delivery needs an explicit transaction and reliability boundary.** E2 evaluates in the flusher and promises bounded retries (`llp/0156-minimal-error-tracking.rfc.md:410`, `llp/0156-minimal-error-tracking.rfc.md:413`), but does not say whether network I/O blocks the telemetry flusher, whether an alert edge is durably queued with the state transition, or how retry duplicates are identified. Resolve this with a bounded same-database alert outbox committed with the group transition, asynchronous event-armed delivery after commit, stable delivery IDs, an explicit at-least-once-or-lossy contract, and SSRF/secret-rotation/replay protections for the configured webhook.

11. **MATERIAL — The byte budgets contradict the substrate and the concurrency token is not a revision.** E1 proposes putting a stack capped at 16 KiB into terminal `details` (`llp/0156-minimal-error-tracking.rfc.md:458`), while LLP 0154 caps the entire serialized `details` object at 8 KiB (`llp/0154-minimal-observability.rfc.md:616`). Separately, `state_ms` is used for optimistic concurrency (`llp/0156-minimal-error-tracking.rfc.md:316`, `llp/0156-minimal-error-tracking.rfc.md:385`), but millisecond timestamps permit same-tick updates and ABA. Resolve this by pinning one whole-record byte budget—including stack, message, and JSON overhead—and adding an incrementing `state_version` used for compare-and-swap, leaving `state_ms` informational.

4. **Design proposals**

1. **Reframe the product as an agent-native issue index with optional standard egress.** Keep grouping, state, typed operations, CLI, and one thin operator page; explicitly decline assignment, team workflow, rich dashboards, and source-map management. Add optional Sentry-envelope egress for users wanting Sentry’s workflow. Benefit: preserves Snapback’s zero-infrastructure and agent advantages without competing with mature trackers. Cost: two operational modes and an adapter contract.

2. **Introduce an E0 “failure disposition and carrier” contract.** Define a closed classification such as `fault | semantic_refusal | cancellation | timeout | overload`, an `issue_eligible` rule, and a trusted exception payload containing bounded class/message/stack. Benefit: grouping, alerting, metering, and hosted logs stop inferring semantics from overloaded status/code fields. Cost: an amendment to LLP 0154’s operation registry and cross-engine fixtures before visible E1 work.

3. **Split safe aggregates, authored state, and raw exemplars physically.** Use classification-only `error_groups`, a revisioned state/transition ledger, raw-retained `error_exemplars`, and optional bounded per-release rows. Benefit: authority, retention, and exactness become structural rather than prose promises. Cost: more tables and coordinated maintenance.

4. **Narrow E2 and split E3.** Ship only new-issue and regression alerts through a reusable alert outbox; defer spike detection until a denominator-aware model exists. Move client ingest into its own RFC and choose a constrained Sentry-envelope subset there. Benefit: each phase has a coherent acceptance boundary and independently reversible scope. Cost: client crash reporting and velocity alerts arrive later.

5. **Keep issues operator-queryable, not app-queryable.** Agents should consume `errors.*` through admin host operations; application code should not read the telemetry sibling store. Benefit: no sensitive-data or feedback-loop expansion. Cost: apps wanting public status/error views must project their own safe domain state.

5. **Open-question adjudications**

- **OQ-A:**  
  **A1:** Endorse the corpus gate, but require a versioned canonical normalizer and classify its output as sensitive; locale/width rules alone do not solve privacy or grouping migration (`llp/0156-minimal-error-tracking.rfc.md:523`).  
  **A2:** Do not create a derived-body carve-out for v1. Mint `iss_` normally and make the versioned fingerprint hash the unique lookup key. Amend LLP 0148 only if stable re-derivation is backed by a concrete import/recovery requirement.  
  **A3:** Use a same-database transition ledger committed atomically with state, then optionally mirror it to the hosted control-plane audit. A buffered `lifecycle` observation is not an atomic audit of the mutation.  
  **A4:** Endorse deferral of merge/split. It is unnecessary until real grouping mistakes establish demand (`llp/0156-minimal-error-tracking.rfc.md:531`).

- **OQ-B:** Accept loss on explicit telemetry-file deletion and generation reset if documented, but reject the current leaning until automatic horizon expiry is specified. Authored state may be cheap to reconstruct socially, but regression identity is not reconstructible from retained aggregates once its row is swept (`llp/0156-minimal-error-tracking.rfc.md:536`).

- **OQ-C:** Symbolication need not block server E1, but reliable stack capture for ordinary handler exceptions does. E3 should block on a separate source-map custody and release-identity design (`llp/0156-minimal-error-tracking.rfc.md:543`).

- **OQ-D:** Container-VM should inherit E1. Declare Cloudflare `unsupported` for stateful issue grouping in the first capability matrix rather than leaving apparent parity ambiguous; revisit control-plane-held groups only after LLP 0154 Phase 2 proves its gateway (`llp/0156-minimal-error-tracking.rfc.md:549`).

- **OQ-E:** Ship only new-issue and regression alerts. Keep binary ignore-as-counting in E1; defer snooze and discard until observed noise/cost warrants them. Do not adopt first-in-deploy as a separate default yet because new/regression-only notification already avoids per-occurrence noise (`llp/0156-minimal-error-tracking.rfc.md:556`).

- **OQ-F:** Endorse the disjoint posture. LLP 0072 can link to issues later without making its hosted log retention or delivery contract authoritative for grouping (`llp/0156-minimal-error-tracking.rfc.md:571`).

- **OQ-G:** Choose Sentry-envelope-compatible ingest for client crashes, but only in a separate E3 RFC that pins the accepted envelope subset, versioning, DSN/authority model, abuse limits, idempotency, offline ordering, and source-map custody. Do not use Sentry-compatible ingestion for server failures merely to re-enter data Snapback already observes in-process (`llp/0156-minimal-error-tracking.rfc.md:575`).

6. **Recommended next step:** revise and re-review.