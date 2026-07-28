# Fable-family review: LLP 0108 corrective target set

**Date:** 2026-07-28
**Reviewer:** Claude Code 2.1.220 / `claude-fable-5`
**Effort:** max
**Session:** `a94421e9-d980-4a26-8917-f33492b084e5`
**Topology:** Fresh mutually blind corrective-delta review on the isolated
37-file capsule; no prior reviews or journals available.
**Target-vector SHA-256:** `fc2e6ad00668554937cce66052912cb5bbf7e0970606ac13fb77fbebd957ae59`
**Capsule SHA-256:** `7d6a7a8f817ffea9f52b3845ba96e1f187a0ec4a23795ffd72a22bac99567313`
**Instruction SHA-256:** `f7a2c9be63db967bf5ad8a370726b311ec2155c535fa5170ced17c33ee32be58`
**Runtime:** 1,190,986 ms API time; 48 turns; no web requests; no permission
denials; completed normally.

## Verbatim review

I've now read all six targets completely, the Accepted context (LLP 0058, 0072, 0081, 0037-adjacent registry), and cross-checked the included implementation (server registry and refusal statuses, migration executor states, ephemeral stamping, hosted-supervisor/admission code, Fly driver, publish script). Here is the complete blind review.

---

# Corrective super-refine review — LLPs 0041, 0094, 0099, 0104, 0105, 0108

**Reviewer basis.** All six targets read in full; cross-checked against Accepted LLP 0058 (esp. §Capability maturity, availability/diagnostics), LLP 0072 (identities, adapter contract, Fly/Tigris authority and its named single-writer fallback), LLP 0081 (closed 13-state journal, ceiling, rehearsal), and the included code: `src/manifest.rs` (capability registry), `src/server.rs` (refusal statuses, connection-open offers), `src/storage/migration_executor.rs` + `src/migration.rs`, `src/ephemeral.rs`, `src/auth/handshake.rs`, `packages/snapback-hosted-supervisor/*`, `packages/snapback-cli/adapters/fly-machines-vm-driver.mjs`, `scripts/snapback-publish.mjs`.

## Corrective-delta verification (items 1–10)

1. **0058 relocation — executed.** LLP 0058 in this capsule contains no qualification text; LLP 0108 declares itself the addendum and explicitly avoids revising Accepted text in place. (Residual: see DETAIL-4.)
2. **Pre-CAS isolation — executed.** LLP 0108 §2 defines `QualificationDataIdentityV1`, the verified disposable restore, confinement of candidate DDL/data/live/outbox/journals, destroy-or-quarantine cleanup with terminal receipts; 0104/0105 adopt it. (Nuance: DETAIL-5.)
3. **`QualificationUseV1` closure — mostly executed, with defects.** Grammar, signature preimage, per-operation optionality, durable `unused|reserved|terminal|expired` journal, budgets, live-frame replay keys, retention/GC, and a refusal matrix exist and 0094's status table matches 0108 exactly. Four MATERIAL defects remain here (M1, M2, M3, M5).
4. **Supervisor-signed absolute deadline — executed, with one ambiguity.** `MigrationDeadlineV1` with 135/140/140/180 cuts, admission expiry, drift invalidation, and monotone abandonment are all present in LLP 0099. One MATERIAL ambiguity remains (M4).
5. **Provisional, self-expiring, target-enforced claim families — executed.** 0108 §4 (`familyEpoch`, ≤120 s provisional expiry, reboot refusal, per-boundary rechecks) is adopted verbatim by 0104 and 0105; capability withdrawal never rolls back the graph or data.
6. **Operator/root closure — executed.** LLP 0105's corrective section closes offline root custody, 2-of-3 recovery, sealed seven-day intermediate, 24-hour rotation overlap, delegation limits, monotone per-device request replay, device administration, and the exhaustive command→variant→authority registry, with `release.upload` a distinct bounded-stream authority that cannot activate a release and deploy authority that cannot upload.
7. **HTTP-400 and registry reconciliation — executed and verified against code.** LLP 0058:1515 pins the invalidation-client refusal at HTTP 503; LLP 0094 §0E and the implemented server (`src/server.rs:21164`, `:34914`) serve 400; LLP 0108 resolves to 400 by later-addendum precedence. LLP 0108 §1's maturity/predicate table matches `TargetCapabilityId::maturity` and `is_supported_by` in `src/manifest.rs:5321-5408` exactly (BoundedChildren/WriteActivity = Proposed and hard-false; the five experimental ids; rest stable).
8. **Hosted-ephemeral wire closure — executed.** 0094's corrective matrix (integer `ephemeralAuthorityProtocol: 1`, `eai1.<43 chars>`, every-frame stamping including the flattened-ack exception) matches the implemented `Option<u32>` / eai1 pattern / `install_ephemeral_authority_instance` in `src/server.rs` and `src/ephemeral.rs`. (Residual spelling conflict in 0105: DETAIL-3.)
9. **Ledger lineage — executed.** 0041, 0104, 0105, and 0108 agree: images embed the immutable candidate-ledger digest; the final ledger is a signed extension whose `previousLedgerSha256` equals it; a carrier-supplied post-promotion digest is never self-authenticating.
10. **`release.upload` row and drift/5-second accounting — executed.** The exact scope row exists in 0105's registry table; 0099's corrective section invalidates the admission (not just the checkpoint) on barrier-time drift and defines the 5-second running-batch allowance inside the 45-second reserve. (Residual arithmetic leftover: DETAIL-1.)

## MATERIAL concerns

**M1 — `liveSubscribe` qualification use has no defined transport, and `subscriptionId` cannot be known at signing time.**
`MATERIAL` / `IN-DELTA` / **LLP 0108 §3 (operation enum, §3.1 steps 3–4)**, conflicting with LLP 0094 §"LLP 0104 hidden-qualification wire amendment" and LLP 0104 §"Registered qualification invocation".
0108 defines `liveSubscribe` as a client-signed `QualificationUseV1` operation requiring `connectionId` **and** `subscriptionId`, and §3.1 verifies "the grant and use signatures" and reserves `(grantId, operation, useIndex)` on every registered route. But 0094's route table says `/live/{name}/subscribe` carries "no free token" and 0104 says subscribe is "reached through a connection whose token is already bound to the activated grant… never a free-floating qualification token," with the pairing rule making a lone `qualificationUse` a decode refusal. There is therefore no way to present, and no place to verify, a `liveSubscribe` use — yet the subscription budget and its reservation key depend on one. Additionally, the wire dialect returns `subscription_id` in subscribe *outputs* (kit snapshot frames, `src/live_wire.rs`), so a client cannot sign a use containing `subscriptionId` before the subscribe completes. An implementer must invent either a new carrier or a server-side reservation scheme — a security-relevant decision.
**Smallest fix:** one decision in 0108 §3 — either (a) remove `liveSubscribe` from the client-signed use enum and define subscribe consumption as a server-side reservation keyed `(grantId, liveSubscribe, serverAssignedUseIndex)` bound to the qualification session (with 0094's row unchanged), or (b) declare subscribe carries the paired body members like open and amend 0094's row — and state where `subscriptionId` comes from.

**M2 — §3.1's numbered gate order contradicts §3.2's ordinary-auth precedence.**
`MATERIAL` / `IN-DELTA` / **LLP 0108 §3.1 vs §3.2** (0094's corrective closure sides with §3.2).
§3.1's "exact order" runs size/route/paired-carrier/version/shape enforcement (step 1) **before** ordinary sender proof and authentication (step 2). §3.2 and 0094 state "ordinary authentication precedes qualification diagnostics" and that an unauthenticated caller "receives the ordinary bounded auth refusal and learns nothing about a candidate." An unauthenticated request with, say, a lone qualification header gets `SNAPBACK_QUALIFICATION_PAIR_REQUIRED` under §3.1 but the ordinary auth refusal under §3.2 — the implementer must pick, and the §3.1 choice leaks the qualification surface's existence to anonymous scanners, defeating the stated secrecy goal.
**Smallest fix:** reorder §3.1 so ordinary sender proof/authentication is step 1 (permitting only generic transport byte-size caps earlier), or add one sentence stating that step-1 violations are diagnosed only after step-2 success.

**M3 — grant expiry: 10 minutes (LLP 0104) versus 30 minutes (LLP 0108).**
`MATERIAL` / `IN-DELTA` / **LLP 0108 §3** ("expiry no later than 30 minutes after issue") vs LLP 0104 §"Registered qualification invocation" ("expiry of at most ten minutes").
0108 defers the grant to "the supervisor-signed `sqg1` compact grant defined by LLPs 0094 and 0104," yet in the same paragraph normatively specifies grant content itself — it is the *only* place the 2/2/32/16/8/256/16 MiB maxima are defined — so its 30-minute bound is equally a definition, directly conflicting with 0104's 10-minute bound. Grant lifetime is a security parameter (candidate-exercise attack window); a validator built from 0108 alone accepts 20-minute grants that 0104 forbids.
**Smallest fix:** one number: state the operative bound once in 0108 §3 (presumably ten minutes, matching 0104) and delete or align the other sentence.

**M4 — "restart … conservatively exhausts the affected budget" contradicts the reboot-safe absolute deadline and the profile's own crash-resume matrix.**
`MATERIAL` / `IN-DELTA` / **LLP 0099 §"Corrective deadline and admission closure"**.
The corrective section replaces journaled elapsed-interval reconstruction with supervisor-signed absolute deadlines — whose entire value is that they remain evaluable across reboot/stop/replacement — then states "Restart, stop/start, replacement, backwards wall clock, unavailable supervisor time, or uncertainty about elapsed downtime conservatively exhausts the affected budget and enters abort/reconciliation." Read literally, *every* under-barrier interruption aborts even when fresh supervisor time proves the 135-second cut has not passed; that nullifies the absolute deadline's resume value and collides with the interruption-class matrix ("crash inside/between durable transitions → process kill → supervisor restart" resuming per LLP 0081 §4) and with the earlier (superseded) "crash resume reconstructs the remaining budget" design. Note "uncertainty about elapsed downtime" is a failure mode of the *superseded* elapsed-interval model, suggesting a leftover. Both readings are safe, but executor behavior and the remote conformance fixtures differ materially between them.
**Smallest fix:** one sentence choosing: either "after an interruption the executor obtains fresh supervisor time and continues only when the signed cuts have not passed; only unavailable/uncertain supervisor time exhausts the budget," or "any interruption while the barrier is held aborts" (and then adjust the interruption-matrix expectations accordingly).

**M5 — replay-versus-expiry precedence makes the 14-day retention and `SNAPBACK_QUALIFICATION_REPLAY_EXPIRED` unreachable.**
`MATERIAL` / `IN-DELTA` / **LLP 0108 §3.1 (steps 3–4) vs its retention/GC and §3.2 (410 row)**.
§3.1 verifies grant/use expiry at step 3, *before* the step-4 reservation-key lookup that would return a retained terminal response. Grants live at most 10–30 minutes, yet terminal responses "are retained for at least 14 days," expired replay state is removed "only by a receipt-bearing GC operation," and 410 means "the retained exact-replay response was validly collected." Under the stated order, any exact replay after grant expiry refuses 403 at step 3 and never reaches the retained response — so the 14-day retention, the GC receipt, and the 410 code are dead letters, and a supervisor recovering a lost qualification response after expiry (the retention's evident purpose, e.g. crash during the final receipt assembly) cannot. Inverting the order violates the "exact order." The implementer must invent the precedence.
**Smallest fix:** one sentence: "For a carrier whose `(grantId, operation, useIndex)` is already `terminal`, exact replay returns the retained response regardless of subsequent grant expiry, until GC collects it (then 410); expiry evaluation applies to new reservations only."

## DETAIL concerns

**D1** — `DETAIL` / `IN-DELTA` / **LLP 0099 §"Downtime ceiling and checkpoint"**: "The remaining 5000 ms is fixed scheduling margin" cannot coexist arithmetically with the corrective accounting (135 forward + 5 running-batch + 40 abort/reopen = 180; the 5 s is *inside* the 45 s reserve). No enforced number differs; delete or restate the sentence.

**D2** — `DETAIL` / `IN-DELTA` / **LLP 0099 §"Corrective deadline and admission closure"**: `MigrationDeadlineV1` is persisted "before the barrier" with cuts fixed from `barrierStartedAt`, while the ceiling is "measured from successful write-withdrawal/barrier acquisition." Acquisition latency silently consumes forward budget (safe direction), but the reference instant of the conformance cuts is ambiguous; state when `barrierStartedAt` is stamped relative to acquisition.

**D3** — `DETAIL` / `IN-DELTA` / **LLP 0105 §"Ephemeral wire and custody" (round 1)**: the offer is spelled `ephemeralAuthorityProtocol: "ephemeral-authority.v1"`, but LLP 0094's corrective closure and the implemented server (`Option<u32>`, `src/server.rs:2757`) use integer `1`. 0094 owns the wire per 0105's own governing amendment, so the decision exists; add one sentence in 0105 marking the round-1 token (and its refusal-code phrasing) superseded by 0094's matrix, so a client author reading the hosted plan cannot emit the string.

**D4** — `DETAIL` / `IN-DELTA` / **LLP 0104 §"Post-bakeoff round-2 reconciliation" and LLP 0105 §"Post-bakeoff round-2 reconciliation"**: both retain "same-landing amendments to LLP 0058 …" instructions. Since the prior terminal escalation was precisely about amending Accepted 0058, and LLP 0108 is now the addendum, strike or mark those sentences superseded to prevent the failure from recurring at landing time.

**D5** — `DETAIL` / `IN-DELTA` / **LLP 0108 §2/§5 with LLP 0104 corrective**: "Promotion copies no candidate-created data or schema into production" plus "candidate DDL … only against the disposable restore" leaves unstated how production acquires the physical schema the promoted graph needs (registry table, incarnation fields, indexes). The drift-invalidation rule operationally forces the correct order (approved production migration/backfill first, then qualification backup, then CAS), and §5's still-current-schema proof pins it — but one sentence stating "production physical schema rides the ordinary approved migration/activation machinery before the qualification backup; 'copy' means no isolated-database transfer" would remove a trap: the §5/0104 failure clauses assume no production mutation pre-CAS is attributable to qualification.

**D6** — `DETAIL` / `IN-DELTA` / **LLP 0104 §2.3**: `actorKind` is "`human | service | agent`" there but the (controlling) round-2/round-3 reconciliations fix the closed set as `human | agent` with service actors mapped to `agent` and bare service refusing. Declared non-controlling, but §2.3 is the first section an implementer reads; consolidate.

## Per-target verdicts

- **LLP 0041** — READY: the nine-package candidate-promotion amendment is complete, gates-only, lineage-closed via `previousLedgerSha256`, and honest that it is unexecuted; the code (publish script, nine-package list) matches its claims.
- **LLP 0094** — READY: the qualification carriers, HTTP-400 reconciliation, and hosted-ephemeral wire closure are exact and match the implemented server; it is a party to M1 only on the side consistent with LLP 0104.
- **LLP 0099** — NOT READY: M4 (interruption-exhausts-budget vs reboot-safe absolute deadline) leaves the corrected mechanism's central behavior undecided; D1/D2 are residuals.
- **LLP 0104** — READY: the qualification, publication, isolation, and revocation semantics are closed with explicit deference to 0108; remaining issues are superseded-text residuals (D4, D6) and the shared conflicts whose locus is 0108.
- **LLP 0105** — READY: the operator/root/request-replay/command-registry closure, claim-family expiry, and ledger lineage are complete and corroborated by the supervisor/admission implementation; D3/D4 are one-sentence residuals.
- **LLP 0108** — NOT READY: M1, M2, M3, and M5 are unresolved contradictions or gaps in the very contract this addendum exists to make complete (use transport for live subscribe, gate-order vs diagnostic precedence, grant lifetime, replay/expiry precedence).

## Set verdict

The corrective delta is substantially and verifiably executed — LLP 0058 is untouched with 0108 as the addendum, the capability registry and HTTP-400 assignment match the code exactly, isolation, claim-family expiry, root/operator closure, deadline cuts, and ledger lineage are all present, and the implementation slices corroborate rather than contradict the documents. But five MATERIAL defects remain, four concentrated in LLP 0108's qualification-use protocol and one in LLP 0099's interruption semantics. Each has a one-sentence-to-one-decision fix, and none requires reopening Accepted text.

VERDICT: NOT READY
