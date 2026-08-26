# LLP 0209 arc, lane C3 — grok review record (D2 private-overlay matrix)

**Change:** the complete principal-bound private-overlay matrix (landed as the series ending `57f99a710`, 2026-08-26)
**Reviewer:** grok-4.6, xhigh, blind on full rounds
**Orchestrator:** Claude Fable 5 (session 01VKza4iiZ918TtDxobNDvvy)
**Provenance:** every review below was actually received from the named model; verbatim per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | C3 series | VERDICT: NOT READY (2 MATERIAL) |
| r2 | fix round 1 delta | VERDICT: NOT READY (1 MATERIAL) |
| r3 | fix round 2 delta (targeted) | VERDICT: READY |

## r1

I'll review the two-commit series against the D2 charter and LLP 0209 constraints, starting with the skill, charter, and the exact diff.The charge is a read-only adversarial review of the two-commit series, so I’ll inspect the diff, charter, and LLP 0209 constraints next.I’ll pull the full test addition, freezer changes, and the LLP 0209 sections that govern overlays, partitions, and wakes.I have the runner and freezer; next I’ll check partition recomputation, matcher skip aggregation, `completeResult`, and the bound/minting conventions.# LLP 0209 D2 — private-overlay matrix (blind review)

**Range:** `7f0ba1454` → `e370798a6` vs `7f0ba1454^`  
**Read-only.** No repository mutations. `cargo test -p snapback-engine` compile errors on main were not chased.

The 16-cell cartesian product exists, is corpus-local, and is not a D1-oracle copy. Own-update really commits through the served path. Matcher skip plus zero deliveries is a real E-2 sandwich for **overlay-row UPDATEs**. Two claims in the charter are not actually proved: partition-of-one **identity isolation**, and other-principal **authority-instance rotation** on the LLP 0200 §2.4 channel.

---

## (a) Matrix completeness vs the claim

2 surfaces × 2 overlays × 4 arms = 16 frozen ids, all present (`pc-private-{list,detail}-{viewState,notificationState}-{own-positive,own-update,absent,other-principal}`).

| Arm | What actually runs |
| --- | --- |
| **own-positive** | Evaluator exact bytes + proofs; served establishment; cross-principal UPDATE skip + 0 deliveries. World is `fullWorld` — identical to own-update's initial world. |
| **own-update** | Not a second frozen snapshot. Store is seeded **without** `updated`, then `invoke_mutation` patches `viewed` / `subscribed`. Evaluator successor + served `live_replace` with exact successor bytes (`viewed` 100→101, `subscribed` true→false, the other overlay untouched). Matcher `Match` is on a synthetic `ChangedRow`, not on the served commit's matcher decision. |
| **absent** | Own overlay is `null` in bytes; the other overlay remains populated. Distinct from “graph missing.” |
| **other-principal** | Initial world **equals** absent. Unique work is paired-world evaluator equality (bytes + node/graph completeness). Served path does not re-subscribe the absent twin. |

Own-update **does** prove a data commit through the served path with one delivery and exact successor bytes (`graph_corpus_v1.rs:10322-10350`). It does **not** prove that the served wake was a precise `Match` rather than conservative fallback.

## (b) Non-interference proof strength

For every cell, the runner requires overall matcher `skip`, target-node `Skip`, no `ConservativeFallback`, then a real mutation and `drain_live_stream().len() == 0`.

An over-broad **matcher Match** (table-granular `viewState` / `issueNotifications` / `identityBinding`) **fails**. An extra **delivery** with identical bytes **fails**. A Skip that still **re-evaluates** and then suppresses the identical frame **stays green** — `evaluations_executed` is never read (G3-A scheduler tests do). Matcher skip is the E-2 property; wasted evaluation after Skip is a 0200 scheduler residual.

Matcher probes are **UPDATE-only**. INSERT/DELETE of the other principal's overlay row is not replayed. Presence-vs-absence is evaluator paired-world only.

## (c) Partition identity

Plan rule `class3: "partition-of-one"` is asserted. Class-2 scope hashes are owner-recomputed in `validate_corpus_invocation`. Class-3 is deserialized from the frozen invocation and re-hashed — a recorded preimage, not an independently assembled `AuthorityPartitionV1`.

Distinctness is ordinary (`usr_…00`) vs crew (`usr_…01`). Those principals already differ in class-2 `allowedValues` (`public` vs `internal+public`). The inequality would survive dropping class-3 from the digest. Crew vs removed share class-2 (`buildAuthorityOwner` equivalence `same`); that pair is used only as a dummy `aut_` id, never as the distinctness pair.

Served tests subscribe only as the active principal. `normalize_served_harness_identity` blanks `partitionHash` before proof compare. Stability across own update **is** engine-issued (same subscription before/after).

## (d) Authority transitions

**Active principal (generation 0→1):** real. `configure_graph_corpus_scheduler` + `subscribe_graph_corpus_case` + `graph_corpus_authorization_frames` (payloads from `authorization_invalidation_frames`). Fence vs delivery split by `snapshot` presence; fence index precedes delivery; stale-authority snapshots counted against successor witness; overlay bytes restored. Frames are emitted frames.

**Other-principal “instance rotation”:** not an authority-instance rotation. `GRAPH_CORPUS_TRANSITION_OTHER_PRINCIPAL` patches a **synthetic** `identityBinding.authorityInstanceID` column (not in the canonical schema; injected at seed). The subscription is `subscribe_live` **without** the corpus authorization scheduler. Zero deliveries are from `drain_live_stream` only; authorization-channel fences are never inspected. `subscribe_graph_corpus_partition_case` (owner-issued instance 0x32 vs 0x33) is unused.

## (e) Additivity + placement

Diff is six files. `corpus.v1.json`, `bound-derivation.v1.json`, pending, dispositions, paired worlds, and sealed G2 artifacts are untouched. Oracle is `privateOverlayProjection` over fixture tables, not the D1 control handler. Canonical `usr_` / `aut_01hw6s0ys{j,m,n}f8h8rct4ank7f24s` minting from `0b140beb3` is used. Frozen artifact is internally consistent with the 16 cells and the bytes below. Rust does not re-check `contentDigest` or execute `deltaEligibility` (frozen string only). Two-way tests do both.

## (f) Bound declarations

Consistent with §2.6: principal-bound nodes carry only examined+lookups (=2, binding+target); root carries all six `maxWindow*`; rollup is the single demand lineage; `maxMaintainedWritesPerMutation: 0`; broadcast `query-shaped` / `base-not-class-1`. Analytical scan/range (list 7/6, detail 6/5) matches P×kind.

---

## Required answers

**(j) Least constrained arm: `own-positive` (worst cell: `*-notificationState-own-positive`).**

Same initial world as own-update; no own `Match`; no null; no paired-world; not the authority-transition vehicle (only `own-positive` × `viewState` is). Stays green: matcher skipping **own** overlay writes; overlay not updating; overlay not going `null`; completeness proofs that change only when the other principal’s row is removed; a notification-only authority-channel bug (same graph, but this cell never enters the scheduler).

**(k) Notification is not isomorphic copy-paste.** Both overlays live in every graph, so partition/authority/completeness **shape** is shared. Notification-specific proofs are real: `issueNotifications` matcher skip (a viewState-precise matcher that is table-granular on notifications would fail), `subscribed` true→false with `viewed` held, and `notificationState: null` while viewState stays populated. A defect that only fires on an authorization-channel notification-only graph is not covered, because no such graph exists here.

---

## Findings

### MATERIAL

**1. Other-principal “authority-instance rotation” is a data-column patch off the §2.4 channel.**  
`private_overlay_served_graph_manifest` (`graph_corpus_v1.rs:2052-2066`) patches `identityBinding.authorityInstanceID`. That field is injected in `private_overlay_seed_tables` (`1140-1148`); canonical `identityBinding` has only `principal` / `userID` / `sourceUserID` (`schema.mjs:79-85`). The probe runs under `subscribe_live` (`10088-10105`), then `drain_live_stream` (`10237-10242`). No `configure_graph_corpus_scheduler`, no `graph_corpus_authorization_frames`. The owner-issued rotator `subscribe_graph_corpus_partition_case` (`test_support.rs:785-797`, engine `13825-13844`) is unused. Binding-row skip **is** a useful principal-bound capture test. It does not prove B’s instance rotation emits no fence/delivery on A’s retained scheduler.

**2. Partition distinctness is confounded with class-2 and is not engine-issued.**  
Freezer hashes ordinary vs crew invocations (`freeze-graph-g0-corpus.mjs:2302-2321`). Ordinary vs crew already differ in class-2 visibility scopes (`187-216`). Crew vs removed are the `same` class-2 pair and are not used. Runner re-hashes the frozen preimage (`graph_corpus_v1.rs:9802-9814`, `4985-4987`); class-3 is not rebuilt from owner facts. Served path never subscribes the other principal; `normalize_served_harness_identity` (`6543-6554`) blanks `partitionHash`. An engine that omitted class-3 from the digest would still go green.

### MINOR

- **Wasted evaluation after Skip.** Zero deliveries + matcher skip; no `evaluations_executed`. Over-broad **wake** fails; silent re-eval of identical bytes does not.
- **Matcher is UPDATE-only.** Other-principal INSERT/DELETE never replayed; paired-world is evaluator-only.
- **Served own-update does not replay matcher.** Precision `Match` is synthetic (`9960-9980`); served loop only checks one `live_replace` (`10341-10345`). Conservative fallback with correct bytes stays green on the served arm.
- **`deltaEligibility` / `contentDigest` not executed in Rust.** Frozen only (`2297`, artifact `14854`). Two-way asserts eligibility.
- **`stableAcrossOwnDataUpdate: true`** is a freezer boolean (`2321`, asserted `9815-9816`). Real stability is the served before/after (`10365-10371`).
- **Window-page rescale** (`10271`, `10408`) follows the corpus rerun convention (`4160-4163`). Establishment uses the declared plan. Overlay semantics are not the subject of the bound.

### REFUTED-RISK

- **D1 control oracle.** `privateOverlayProjection` + `oracleAuthority` string; control handler not invoked. Diff does not touch D1 sources.
- **Additivity.** Existing corpus/bounds/pending/dispositions/paired/sealed files absent from the diff. No `PendingLiveFanout` constructor change.
- **Canonical minting.** `usr_000…00/01/02` and `aut_01hw6s0ys{j,m,n}f8h8rct4ank7f24s`.
- **§2.6 bounds.** Kind-conditional fields, rollup, `maxMaintainedWritesPerMutation: 0`, `query-shaped` / `base-not-class-1`.
- **Active-principal fence/restore.** Counts come from emitted authorization + live frames (`10489-10557`).
- **Byte leakage of the other principal’s overlay.** `fullWorld` / absent worlds still contain the other row; projection oracle is host-only. Evaluator leak would miss frozen bytes (`3768`, `7572`, …).
- **Notification missing from authority restore.** Same graphs project both overlays; restored bytes include `notificationState`.

---

Byte-level snapshot of the overlay contract (list; detail is the same values with `issueId`/`issueTitle`):

- own-positive: both overlays populated  
- own-update viewState: `viewed` 100→101, notification held  
- own-update notification: `subscribed` true→false, viewState held  
- absent / other-principal viewState: `viewState: null`, notification present  
- absent / other-principal notification: `notificationState: null`, viewState present  

That is a real overlay matrix. It does not close partition-of-one identity or other-principal instance rotation as specified.

VERDICT: NOT READY (2 MATERIAL)

## r2 — fix round 1 delta

I'll start by loading the review skill and the C3 delta so I can verify each claimed closure against the actual `e370798a6..ab329363a` change.Next I’ll pull the review skill, the previous C3 findings, and the exact delta so the closure claims can be checked against the code.I’ll review this delta directly against the prior C3 findings and LLP 0209, starting with the previous reviews and the source-only diff.I'll pull the source-only delta, LLP 0209 §2.4, and the original-series tests so each F1–F4 closure can be checked against the spec.The rotation path and census look like the likely remaining holes — I’ll trace those against LLP 0200 §2.4 and the actual test helpers next.Checking one F2 hash-path detail and the F3 collection window so the closures table is accurate.# Targeted re-review — C3 fix round 1 (`e370798a6..ab329363a`)

Read-only against LLP 0209 §3.2 / LLP 0200 §2.4 and the four claimed closures. Generated guide/diagnostics churn is line-shift regeneration and is ignored. `snapback-engine` compile-on-main is out of scope.

## Closures

| ID | Claim | Verdict |
| --- | --- | --- |
| F1 | Real cross-principal authority rotation (owner-issued rotator **and** §2.4 fence machinery); fake `authorityInstanceID` column gone; binding write honestly renamed | **Open — MATERIAL** |
| F2 | Class-3-only pair is same-class-2; engine-issued partition identities; no hash-normalization cheat | **Closed** |
| F3 | In-flight predecessor gated; closed census = exactly one fence + one successor snapshot | **Closed** |
| F4 | B INSERT/UPDATE/DELETE skip + unchanged eval counts; `deltaEligibility` observed; own-update claims corrected | **Closed** (one honesty nit) |

---

## F1 — MATERIAL: B “rotates” by subscribe/supersede, not the §2.4 authority channel

The honesty half of F1 is real. The fake `identityBinding.authorityInstanceID` column, the `graphCorpusTransitionOtherPrincipal` patch mutation, and the `otherPrincipalAuthorityTransition` disposition are gone. The leftover probe is now named as a capture-skip of an ordinary `sourceUserID` write (`graph_corpus_v1.rs:10432–10530`).

The replacement “rotation” is not an LLP 0200 §2.4 authority transition.

What the new test actually does (`private_overlay_real_other_principal_authority_instance_rotation_is_isolated`, `graph_corpus_v1.rs:10540–10731`):

1. Clones the graph under a **second function name** `{query}OtherPrincipalRotation` (`:10578–10584`) so A and B are not co-subscribers of one live graph.
2. Establishes B, then “rotates” B with `subscribe_graph_corpus_other_principal_partition_case` + `supersedes` (`:10643–10656`). That helper only swaps `prepare_resolved_session_fixture` to discriminator `0x36` and calls `subscribe_live_prepared_with_invalidation` (`engine.rs:13983–13998`).
3. Asserts **global** `fences_applied` is unchanged (`graph_corpus_v1.rs:10708–10712`) and that A’s matcher/stream/observation stay quiet.

Why that is the wrong channel:

- LLP 0200 §2.4 (`llp/0200-live-evaluation-scheduling-and-settlement.spec.md:195–224`) splits an authority transition into **scheduler-state fence marking** (no evaluation) plus a **delivery-time gate**, then restoration on the authorization lane. “Revocation safety is the fence plus the gate, not the resnapshot.”
- LLP 0209 §3.2 cause 2 (`llp/0209-live-graph-profile.spec.md:1863–1867`) says instance rotation “rotate[s]/end[s] the owner-issued partition or retire[s] the affected retained graph instance; LLP 0200 §2.4 applies the fail-closed fence and delivery gate before restoration.”
- Production marking is `LiveFanoutCoalescer::fence_authority` (`live_coalesce.rs:214–237`) invoked from the transition loop that **increments** `fences_applied` (`engine.rs:33280–33296`). The F1 test never takes that path; the assertion that `fences_applied` is unchanged is a proof that **nothing** was fenced, including B.
- `supersedes` is documented as “a net-zero replacement” that leaves old live authority intact until the new snapshot succeeds (`engine.rs:23300–23303`). Ownership uses `AuthorityKey::Session { user_id, session_id, generation }` — **no instance id** (`invocation.rs:813–824`, `2800–2804`). Same session `0x34`, generation `1`, different instance `0x35` vs `0x36` is therefore the same live owner doing a client resubscribe. B’s new snapshot arrives as a subscribe result, not as an `authorization_invalidation` fence-then-restore.
- A’s quietness is then nearly free: different function, different connection, and a path that never marks fences.

The owner-issued session fixture **is** the G3-A partition rotator (`subscribe_graph_corpus_partition_case` / `prepare_resolved_session_fixture`). That is sufficient to mint a second class-3 instance (and F2 uses it honestly). It is **not** the §2.4 authority channel.

**What would close F1:** drive B through the production marking loop (`fence_authority` via the transition dispatcher, not a second `subscribe`), on the **same** graph function A retains, then show B’s census is one fence + one successor snapshot while A’s `fences_applied` / authorization frames stay zero. The global counter cannot be the A-isolation witness if B is actually fenced.

---

## F2 — closed: same-class-2 is real; served hashes are engine-issued

Two complementary pairs, both honest:

**Frozen crew/removed fixture.** Both actors are `role: "crew"` (`fixture-digests.json:36–44`), which is why `buildAuthorityOwner` already lists them as `relation: "same"` (`freeze-graph-g0-corpus.mjs:223–228`) versus crew/ordinary as `different`. The freezer now builds that pair (`:2298–2306`), `assert.deepEqual`s `class2` (`:2280–2286`), and tags `differingInput: "class3"`. Class-2 scopes are owner-reconstructed (`resolvedClass2Inputs` / `normalizedOwnerScope`, `:245–285`) with the raw principal forbidden in the class-2 preimage (`:273–277`). Rust independently rebuilds each class-2 `scopeIdentity` (`graph_corpus_v1.rs:4988–4997`) and then hashes the **full** preimage (`:5009–5011`). The “class3 nulled, remainder equal” check (`:9835–9839`) is a preimage compare, not a stripped-hash compare.

**Served same-principal, two owner-issued instances.** `graph_authority_partition` copies installed class-2 (the known G0 test-only seam, `engine.rs:42169–42181`) and builds class-3 from the **session** `PreparedAuthority` instance id plus `input.auth` (`:42182–42224`). The rotation test then takes the engine observation preimage (`graph_serving_observation_for_test` → `graph.evaluation.partition.preimage` / `partition_hash`, `engine.rs:13651–13654`) and reconstructs with `graph_authority_partition_identity_v1` (`graph_corpus_v1.rs:10661–10677`) — the same fail-closed rebuild the memo key uses (`engine.rs:8914–8918`). Class-2 JSON is byte-equal, class-3 differs, hashes differ (`:10679–10693`). No field-stripping before hash.

The G0 class-2 resolver remains the installed context; that is an admitted P-C seam, not a new cheat.

---

## F3 — closed: in-flight gate is the production mark+gate; census is closed

The authority test now overlaps a real data evaluation with the **production** lock-free mark:

- Issue title commit, then `flush_pending_live_fanout` on a second thread (`graph_corpus_v1.rs:10855–10881`).
- Snapshot-pin hook (`set_graph_evaluation_snapshot_debug_hook` → storage pin, `engine.rs:5583–5588`).
- `scheduler_control.fence_authority(&subscription_id, epoch 1)` (`graph_corpus_v1.rs:10895`) — the same `LiveFanoutCoalescer::fence_authority` the transition loop calls.
- After join: `evaluations_executed` +1, `stale_authority_frames_discarded` +1, live outbox empty (`:10903–10918`). Discard is `authorize_live_delivery` → `authorize_delivery` (`engine.rs:28842–28864`, `live_coalesce.rs:245–261`).

Then the durable `GRAPH_CORPUS_AUTHORITY_MUTATION` drives obligation + restoration. Collection is the G2-C union of live outbox + authorization projection (`graph_corpus_v1.rs:10929–10938`). The new census is a `BTreeMap` equality on **every observed `kind`** (`:10943–10953`):

```text
{ "authorization_invalidation": 2 }
```

Any extra wire kind, or a third invalidation frame, fails. The two invalidation frames are then partitioned exhaustively by `snapshot` presence (`:10958–10970`): 1 fence (no snapshot) + 1 successor snapshot, fence index before delivery, `staleDeliveries == 0`. Successor bytes are the patched title under generation 1 (`:11000–11018`), not the frozen predecessor. That is a closed kind/count enumeration of the collected window.

---

## F4 — closed

Matcher and served scheduler both loop UPDATE / INSERT / DELETE for B’s overlay row (`graph_corpus_v1.rs:9928–9972`, `:10215–10300`). Each served commit asserts `evaluations_executed` unchanged and `crossPrincipalDeliveries == 0` (`:10288–10299`), then A’s observation is byte-identical (`:10301–10307`). Own-update still exact-matches `resultBytes` but only compares completeness **after** `normalize_snapshot_tuple` + `normalize_served_harness_identity` (proof-tuple / harness hashes rebound, `:6567–6578`, `:10412–10420`) and widens `maxWindowPages` (`:10328`). Binding write is no longer labelled an authority transition.

**Nit, not MATERIAL:** `deltaEligibility` “executes in Rust” is still `assert_eq!(json_string, "unchanged-principal-bound-replace-only")` (`:9974–9977`). Same bar C2 used. The served own-update arm does execute `live_replace`. The binding-row probe is matcher-replay only (no commit).

---

## Regressions

No sealed D1 digest change is claimed; the matrix `contentDigest` rotation is expected. F3’s switch from `private_overlay_store` to an explicit tempfile still seeds `private_overlay_seed_tables`. Removing the fake column/mutation does not drop overlay skip coverage. Guide/diagnostics regeneration follows moved `engine.rs` sites.

---

F2–F4 hold. F1 still does not put B on LLP 0200 §2.4 (fence-then-restore); it resubscribes a cloned function with a second owner-issued instance and then treats a global zero-fence counter as A-isolation.

VERDICT: NOT READY (1 MATERIAL)

## r3 — fix round 2 delta

I'll start by loading the review skill and inspecting the requested commit range so the re-review stays on the actual C3 delta.The review skill path missed; I'll locate it and pull the commit range plus the governing C3/§2.4 context.The truncated engine diff is the load-bearing path; I'll read the remaining hunks and the real fence machinery next.I'll read the fence/notify path, the test hook, and the F2/F3/F4 closures against the previous MATERIAL finding.The round-1 MATERIAL is closed. B no longer rotates by supersede: the same retained subscription is resolved to the alternate owner-issued instance, then driven through the shared §2.4 fence/restore functions, with per-subscription counters and a closed wire census.

## Fence machinery (real path, not injected frames)

`transition_graph_corpus_other_principal_authority_instance_for_test` does not mint envelopes. It:

1. Resolves the successor with the same fixture as establishment (`graph_corpus_other_principal_authority_for_test(..., true)` → instance `0x36`).
2. Calls `begin_live_delivery_frame` + `notify_authorization_subscriptions_in_frame` with only B’s cloned `LiveSubscription`.
3. That helper is the body extracted from `notify_authorization_event_in_frame_with_policy` (the 33267 family). It still runs `apply_live_authority_fences` → `coalescer.fence_authority`, raises the fail-closed obligation, publishes the inline `authorization_invalidation` via `enqueue_subscription_durable`, and `enqueue_authority_restoration`.
4. After the fence returns, the helper patches the **stored** subscription to the successor retained owner and clears `window_ledgers` so restoration cannot continue predecessor-authenticated pages.
5. The test then `flush_pending_live_fanout()`, which is `run_authority_restoration_turn` → `invoke_authorization_resolution` → `deliver_authorization_snapshot` (delivery-time `authorize_live_delivery` + `wake_durable_projection`).

That is the same census F4 already uses (drain, flush, project). Restoration is level-triggered from the obligation, not a second durable enqueue — matching `framesEnqueued + 1`.

It does **not** enter `notify_authorization_event_in_frame` itself (no issuer advance, no all-auth-scoped blast). That is the right blast radius for a class-3 instance rotation: a version event would also fence A. Isolation is therefore a property of the helper’s input set plus engine non-crosstalk, not of the global authorization-event dispatcher.

## Assertions (per-subscription, closed)

B is exact, not “at least”:

| Check | Bound |
| --- | --- |
| Wire | every frame `authorization_invalidation`; 1 fence (`snapshot` absent) + 1 restoration (`snapshot` present); fence index `<` delivery index |
| Overlay | restoration `snapshot.rows` == `b_before.resultBytes` |
| Global | `fences_applied + 1`, `restorations_completed + 1`, `live_matcher` unchanged |
| Per-sub | fence/wake/delivery/frames each `+ 1`; bytes increase |
| Identity | same `b_predecessor.subscription_id`; class-2 equal; class-3 object differs; reconstructed partition hashes differ |

The five activity counters sit on an `Arc` inside `LiveSubscription`, so increments on the fan-out clone are visible on the stored row. Fence/wake/delivery fire only inside the production functions, not a test-only stub.

A is closed on both instrumentation and observation: activity object equality (all five fields), empty stream, empty obligation projection, unchanged `resultBytes`, full observation byte-identical.

Predecessor graph lineage: `apply_live_authority_fences` retires B’s memo entry and predecessor authority component; the helper then clears `window_ledgers` before flush, so `live_subscription_rerun_input` cannot carry predecessor pages across the class-3 cut.

## A’s isolation

Non-tautological evidence is the wire/observation side: B’s frames never appear on A’s connection, A’s obligation projection stays empty, matcher stats do not move, and A’s stored serving observation is unchanged. The per-subscription zeros are a tripwire on the same `Arc` counters; they cannot fire unless A is passed into the fence loop or a durable enqueue uses A’s subscription object.

## F2 / F3 / F4

Unchanged in this delta:

- **F2** `private_overlay_matrix_executes_served_data_and_cross_principal_paths` — other-principal UPDATE/DELETE/INSERT skip
- **F3** `private_overlay_other_principal_binding_row_data_write_skips_capture` — binding-row write is data, not an authority transition
- **F4** `private_overlay_matrix_active_authority_transition_fences_and_restores` — in-flight gen-0 gated, then closed one-fence + one-snapshot census

Production notify is an extract-method; `test_activity` bumps are `cfg(test/test-support)` and do not change control flow. F4 still enters the family through `notify_authorization_event_in_frame`. The superseded `subscribe_graph_corpus_other_principal_partition_case` API is gone.

Non-blocking: `bytesEnqueued` is a strict increase rather than an exact delta; the rotation test does not re-assert `b_after.resultBytes` against the restoration frame (F4 does). Neither reopens the §2.4 bypass.

VERDICT: READY
