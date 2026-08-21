# Review artifact: LLP 0267 — grok family

Target: `llp/0267-query-cost-guardrails.rfc.md`

## Round 1 — 2026-08-16

- **Reviewer:** Grok 4.6 (`~/.grok/bin/grok`, --reasoning-effort xhigh,
  --disable-web-search), fresh non-interactive session, blind to the other
  family's review.
- **Revision under review (v0.1):** sha256
  `c402362b6fd1b2dfd22d719db24be806536b7322f68514e2d392b5d7c27d2363`
  (authoring-worktree bytes, pre-commit).
- **Verdict:** NOT READY.


1. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:69` (§1.2)
The account of shipped per-query measurement is incomplete in a way that would leave a second bounds system in place. The RFC says `src/storage.rs` “currently has only” the `single_table_v1` 1,024 examined-entry guard, `cfg(test)` `KeysetScanStats`, and generic execution with no successful examined-entry count. I opened `src/storage.rs`: those three exist (`query_on_with_examined_entry_ceiling` / `SNAPBACK_SINGLE_TABLE_EXAMINED_ENTRY_CEILING_EXCEEDED` at 6199–6213; `KeysetScanStats` at 5987–5998; generic `query_on` with `examined_entry_ceiling: None`). The same file also ships `RelationalExecutionObservation { examined_root_entries, joined_lookups }` (5743–5750), filled as `examined_root_entries: root_window.rows.len()` (5871–5873) — result count, not physical candidates. `src/local.rs` already refuses on those facts: snapshot-batch children use `let examined = child_output.rows.len()` against `identity.node_examined_entry_ceilings` (31412–31415); relational nodes refuse `SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED` when `examined_root_entries` or `joined_lookups` exceed owner-pinned ceilings (30775–30780, 31480–31486). `src/manifest.rs:5624` hard-pins `single_table_v1` `examined_entry_ceiling: 1_024`. The RFC never names those codes, never says they are result-count substitutes (which §1.2 itself forbids), and never decides whether `queryCost` replaces them. An implementer following §1.2 would add a parallel accumulator beside the already-enforced examined-entry machinery that G0 is supposed to inherit.

2. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:324` (§4.3)
§4.3 states “LLP 0209 §8 requires one pure `QueryCostPolicyV1` shared by local and server.” I opened `llp/0209-live-graph-profile.spec.md` §8 (368–397). That section is the D2–D3 interface: “One IR, two evaluators,” byte-identical graph results or `unknown`, and “Refusal parity. A graph the server would refuse (bounds, policy, admission) must refuse identically locally.” It does not name `QueryCostPolicyV1`, a host policy type, or src/local.rs-vs-src/server.rs sharing. The commission’s “local parity per LLP 0209 §8” is that graph-evaluator rule. The RFC then says “Clients do not reimplement it,” which is the opposite of a D3 local evaluator applying the same refusals. A shared host function is allowed as new work; presenting it as already required by §8, and treating that as fulfilling the charter’s §8 parity decision, would send implementers at the wrong seam.

3. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:121` (§1.6, §3.4, §6)
The 1,000 ms live-turn rule cannot be implemented from the text as one threshold. §1.6: each fixture cell takes ≥3 warm samples; “Evaluation and memo-delivery bases are their respective maxima × 1.25.” §3.4 item 3 refuses when “a live real-evaluation or memo-delivery basis is at least 1,000 ms.” Item 1 also refuses when a *measured* signal exceeds the effective hard maximum (instance `maxUnpreemptibleLiveTurnMs` = 1,000 at §2.2:189). Then §3.4:266 and §6:373 say “999.999 ms is below it; 1,000 ms refuses” and “Boundary fixtures at 999.999/1,000/1,000.001 ms must pass/refuse/refuse.” Those cannot all be true of a measured turn: 999.999 ms × 1.25 = 1,249.999 ms, which item 3 refuses. The only measured basis I opened is LLP 0209 §1 (57–58): one 5.5M-row evaluation p50 863 ms, max 3.6 s; v0.3 still records a ~900 ms real evaluation (544–545). Under §1.6 that p50 is already a 1,079 ms basis and refuses, so the “hard live-turn refusal boundary” in the instance table is 800 ms of measured time, not 1,000 ms. The RFC never says the 999.999 fixtures are post-scale policy inputs. An acceptance author writing a 999.999 ms *turn* and an admission author trusting the 1,000 ms table will build different gates.

4. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:227` (§1.1, §1.3, §3.2–3.3)
The ladder cannot be evaluated from the signals the observation defines. §1.1’s five signals are total `scannedRows`, `index ranges consulted` as “normalized consultations,” `resultBytes`, `evaluationTurnMs`, and the fan-out estimate. §1.3:89–90: range rows expose table, selected index or `fullScan`, bound shape, and `consultations`; `indexRangeCount` is their sum — not rows visited per consultation. §3.2:227–229 requires: ledger contains `fullScan` **and** “that consultation visits more than `maxUnindexedScannedRows` entries.” A mixed plan (full scan of 10 plus an indexed range of 300) cannot attribute 10 vs 300 from a total of 310 plus a `fullScan` flag. §3.3:241–242 and the §3.1 warn examples (214–216) require result *row* count (`maxUnpagedRows`, “128 unpaged result rows”). Row count is not one of the five signals, and §4.3’s policy inputs are declaration, target capability, instance config, qualification, and observer groups — not the result value. Offset pagination is correctly rejected; that does not supply the missing measurements. Implementers will have to invent a sixth signal and per-range scan counts, or silently substitute result count, which §1.2 forbids.

5. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:339` (§5)
Unification with LLP 0209 G0 is not a decision an implementer can execute, and one row misstates §2. I opened 0209 §2:120–123 and 0183 D2:283–286: every admitted graph declares **root, examined-entry, relationship, fanout, argument, byte, summed-window, and maintained-write** bounds, sized from fixtures; 0209 §9:415–417 repeats that G0 pre-commits no numbers. The RFC table (343–350) maps “root / examined-entry” together onto `maxScannedRows` with only “contributes to” / “per-node scan attribution,” and “relationship / fanout” onto “range consultations and structural child work,” with no rollup (sum vs max vs per-node check) and no code for a per-node miss vs `SNAPBACK_QUERY_COST_BOUND_EXCEEDED`. Those first two pairs are distinct in 0209/0183 and in shipped snapshot-batch (`take` vs `node_examined_entry_ceilings` vs `node_joined_lookup_ceilings`). The table also lists **live fanout** as a “G0 bound”; it is not in the 0209 §2 / 0183 D2 list. “One accumulator rolls them up” and “no `g0Bounds` twin” are architecture, not the consumption rules the commission asked for. Two G0 implementers can still build two different systems inside `queryCost`.

6. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:140` (§2, §2.2)
Charter item (b) — where each ladder threshold lives, and whether instance config may loosen it — is not closed. The §2 title says “instance policy may only tighten” the declaration. §2.2:192–196 says the effective value is min(declaration, target capability, instance) and that instance “may lower a default but may not raise” only four absolute ceilings: 4 MiB, 1,000 ms live-turn, 1,000 ms fan-out, 512 ranges. `maxUnindexedScannedRows` (256), `maxUnpagedRows` (256), and `maxUnpagedResultBytes` (256 KiB) are the index and pagination rungs and are **not** on that list. Combined with §2.1:157–159 (a `fullScan` is admitted only when its declared scan bound is ≤ the instance unindexed threshold), raising instance 256 to 10⁷ would admit huge full scans. The RFC never says those 256s are absolute, declaration-only, or operator-raisable. That is a missing decision on the charter’s require-index / require-pagination thresholds.

7. SEVERITY: MINOR — `llp/0267-query-cost-guardrails.rfc.md:94` (§1.4)
`resultBytes` is specified as “exact canonical JSON length after result-contract validation.” I opened `src/result_contract.rs:76–84`: the shipped 4 MiB ceiling is `serde_json::to_vec(value).len()`, not JCS. LLP 0108:283 uses “canonical” / JCS for contract *identity* hashes, not this byte ceiling. If implementers use JCS here and `serde_json` there, the same result can pass one bound and fail the other.

8. SEVERITY: MINOR — `llp/0267-query-cost-guardrails.rfc.md:295` (§4.1)
`SNAPBACK_QUERY_COST_INDEX_REQUIRED` / `PAGINATION_REQUIRED` are defined as “crossed 256” / “256 rows or 256 KiB.” Those are only the §2.2 defaults. The details payload correctly has `limit`; the register text will be wrong if instance config lowers those knobs (which §2.2 explicitly allows).

9. SEVERITY: MINOR — `llp/0267-query-cost-guardrails.rfc.md:247` (§3.3)
`notPageable` is allowed for “point, scalar, and closed-small aggregate contracts,” but “closed-small” is not sized against `maxUnpagedRows`. The shipped `single_table_v1` surface is a no-cursor whole result with a 1,024-entry examined ceiling (`guide` capability index; `src/manifest.rs:5624`). Under §3.3 a 1,024-row whole result needs keyset pagination, which that capability cannot express. The RFC does not say whether that class is `notPageable`, withdrawn from production, or exempt.

## Round 2 (delta) — 2026-08-16

- **Reviewer:** fresh Grok 4.6 xhigh session; delta review of v0.2 (sha256
  `bf7607970ba94a1b2fbe0ddda2eb5a21a8607b2f4ba7d5bd6004e76e3b2f0943`).
- **Verdict:** NOT READY (3 findings, including the convergent
  `query_cost_terminal` offer-gating defect).


1. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:59` (§1.1/`§1.5`/`§1.6`)
`executionKind` now distinguishes `liveEstablishment` from `liveReevaluation`, but only two timing seams are bound, and executed samples are pooled across both. Finite `evaluationTurnMs` inherits the `FUNCTION_QUERY` span (`src/local.rs:27329-27378` on the file-backed read lane; the mutex lane at `8252-8298` is the same span). A live scheduler turn inherits `CurrentLiveEvaluation.started_at` through `finish_current_live_evaluation` (`src/local.rs:23891-23967`), which encloses the nested query span **plus** serialize/enqueue. Live establishment is a third shipped path: subscribe wraps only `execute_query_invocation` in `FUNCTION_QUERY` (`src/local.rs:15910-15948`) and returns the first snapshot on HTTP, never `CurrentLiveEvaluation`. §1.6 then says real vs memo samples are “selected by status and never pooled” (line 119), so every `status: "executed"` sample — establishment, reevaluation, and any finite run of the same function — feeds one `rawRealEvaluationMaxMs`. Those measurements do not contain the same work. LLP 0209 §1 recorded ~61–68 MB of six-observer frame bytes; serialize/enqueue on that shape is large enough to flip the 800/1,000 ms gate. A qualification author who warms subscribe/`FUNCTION_QUERY` and a runtime that compares `CurrentLiveEvaluation` to the same refuse-at boundary will not build the same 1-second rule.

2. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:469` (§3.4)
`query_cost_terminal` is a new `LiveEnvelope` kind, but new durable kinds are not free additions. LLP 0094 §0C.2 (`llp/0094-wire-envelope-contract.spec.md:738`) and LLP 0093 (`llp/0093-client-protocol-and-native-clients.rfc.md:343-347`) require every new kind to be offer-gated on the CurrentAsOf pattern; `resync_required.reason` is the documented ungated escape hatch, which this RFC correctly rejects because both full and micro clients auto-resubscribe (`packages/snapback-client/index.mjs:13225-13246`, `13708-13765`; `packages/snapback-client/micro-live.mjs:177-180`). The RFC names no offer, no subscribe admission that requires it, and no fallback for a connection that did not offer. Shipped unknown-kind behavior is skip-not-crash (micro returns; full `applyDurable` only matches known `LIVE_DURABLE_KINDS`), so an ungated frame is neither terminal nor a resubscribe. An implementer cannot simultaneously obey this RFC, keep quarantine from being bypassed, and obey the accepted wire rule.

3. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:595` (§5 summed-window)
The new window ledger both “stop[s] before charging a unit that would exceed” a remaining budget and “may publish” a page that reaches a maximum without a successor, while “exceeded maximum refuses the page; no result … is published.” When remaining `maxWindowScannedRows` (or root/row/byte/range) is smaller than the work needed to fill the declared page, those sentences split: one implementer publishes a short terminal page, the other refuses. A published short page with no continuation is indistinguishable from end-of-data and is not a 0209 completeness label (`prefix` / `window` / `refused` in `llp/0209-live-graph-profile.spec.md:190-199`). Two G0 implementers will not build the same summed-window system, and the publish-short reading silently truncates a keyset result.

## Round 3 (delta) — 2026-08-16

- **Reviewer:** fresh Grok 4.6 xhigh session; delta review of v0.3 (sha256
  `9dd28cd5baf8a4c4b93e2bbcf0572f7159310630fd70a3becef5cf31ef71341e`)
  against the round-2 findings.
- **Verdict:** READY. (The subsequent v0.4 delta was limited to the codex
  round-3 residual — the mixed-bundle timing seam — and was verified by the
  codex family's round-4 pass.)

## Round 4 (delta) — 2026-08-21 — LLP 0267 §7 W5 revision (v0.8)

**Reviewer family:** Grok
**Provider / runtime:** grok-4.6 (Grok Build), reasoning xhigh
**Date:** 2026-08-21
**Redacted:** no
**Method:** directed delta re-review of HEAD `f9399686e` against the
prior dual xhigh round's 5 MAJOR + 10 MINOR claims; current tree only
(not a mutually-blind first pass). This session did not author §7.

**Target:** `llp/0267-query-cost-guardrails.rfc.md` §7 (v0.8), plus
contradiction check against §§1–6 and the consumed Phase 0 rulings
(LLP 0059 ruling 6; LLP 0095/0278 D0.5; LLP 0031 D3; LLP 0200 §3
inspect serialization).

**Verdict:** CLEAN-TO-LAND (READY). Prior MAJORs 1–5 are actually
fixed. No new contradiction with §§1–6 or the Phase 0 rulings. Three
non-blocking MINORs remain as implementer pins, not reopenings.

### Overall assessment

v0.8 is a real revision, not a recitation of the commit message. The
eight claimed repairs are present in the current text and, where they
depend on shipped seams, they match those seams. §7 stays a
diagnostics/inspection amendment: no new bounds surface, no policy
rung, no change to §§1–6 enforcement.

### Checklist (the eight claimed fixes)

1. **§7.4 consumes D0.5 verbatim (>16 warns, 64 hard ceiling only) —
   FIXED.** Current §7.4: counts above the provisional 16-per-view
   budget "remain **supported** and draw only a structured warning;
   the sole hard refusal is the 64-per-connection transport ceiling,
   with its own pre-refusal warning (LLP 0278/0095)." That matches
   LLP 0278's D0.5 amendment (supported-but-flagged past 16;
   correctness envelope = the 64 hard ceiling) and LLP 0095's
   inspection-floor wording. The v0.7 sentence that treated 16 as a
   refusal ("budget diagnostics fire before the 64-per-connection
   ceiling or the provisional 16-per-view budget refuses") is gone.
   §7.6 consumes the same ruled budgets and adds no refusal.

2. **§7.1 bounds are now real — FIXED.** Three named ring families
   (not §§7.2–7.6 as rings); dual bound of record count (512) **and**
   byte-accounted per-family budgets summing to ≤4 MiB; variable-size
   fields truncated with a visible `truncated` marker; oversize
   records dropped with per-family `droppedRecords`; per-key maps
   capped at 1,024 with LRU-on-update eviction into `otherKeys` plus
   monotone `evictedKeys` so totals stay exact; recorder caps
   disambiguated from §3.4 enforcement maxima. Equivalence hashing
   reuses the §5 window-ledger canonical-args hash (named at
   `llp/0267-query-cost-guardrails.rfc.md:514`) rather than minting a
   second algorithm.

3. **Redaction no longer overclaims — FIXED.** Hash is framed as a
   **fingerprint** for low-entropy args and is gated-only; raw args
   remain forbidden everywhere; `QueryCostObservationV1.fixtureIdentity`
   is projected to `null` in the recorder (consistent with §1.1's
   "qualification storage only"); D0.5 ownership tuple is projected
   (authority class + instance self, never principal or literal URL)
   while D0.5's sharing key itself is unchanged; owner labels are
   constrained to framework surface identifiers and "must not embed
   argument or row values"; `PublicInspect` gains no cost fields
   (rings, counters, or correlation identities). Gated extensions
   revert to §1.1's public rule at any future export boundary.
   Acceptance fixtures name all of these.

4. **Wave/subscription split — FIXED as to the original MAJOR.**
   `LiveDeliveryWaveV1` is server-owned, emitted at §1.5 boundaries,
   server-snapshot only. Client-observed facts (`deliveryLagMs`,
   `suppressedEqualSnapshots`, `pendingDeliveryReason`) live on the
   §7.4 inspection row. Join key is (`functionId`, `deliveredVersion`
   ↔ `authoritativeRevision`). No wire carrier moves either record.
   (See MINOR 1 for a domain pin, not a reopening.)

5. **Causal vocabularies closed with precedence — FIXED.**
   `rerunCause` is four trigger classes in listed precedence
   (authorization-invalidation > mutation-invalidation > refresh >
   reconnect-reestablish). Coalescing and memo delivery are execution
   facts (`coalesced`, `memoDeliveries`, `coveredVersions`), not
   causes — v0.7's `coalesced-flush` / `memo-delivery` cause members
   are gone. `pendingDeliveryReason` is a closed six-member enum
   with pinned first-match order; `authority-unavailable` is one
   member whose *detail* carries LLP 0059's open-suffix spelling
   (the enum itself has no wildcard); equal-snapshot dedup is
   excluded (completed delivery, not a miss). New cause requires a
   dated amendment.

6. **`MutationPhaseCostV1` typed with nullability; delivery lag
   moved — FIXED.** The typed record is in §7.2; every timestamp and
   derived duration is `number | null`, null when either endpoint is
   null. Formulas match ruling 6. `deliveryLagMs` is not a mutation
   field; it lives on the §7.4 row, first covering delivery, both
   endpoints client-observed on one clock. Server contributes
   per-function counters only; the two clocks are never merged. No
   undifferentiated "pending".

7. **`LiveCoalesceStats` claim is now accurate — FIXED, verified
   against the tree.** v0.7 claimed the 20260808 ticket kept these
   counters off serialized inspect. That ticket is stale. Shipped
   `InspectState` and `PublicInspect` both serialize
   `live_coalesce: LiveCoalesceStats` as `liveCoalesce`
   (`crates/snapback-engine/src/local/inspection.rs:37-38` and
   `:127-128`); LLP 0200 §3 already accepted that schema rotation.
   §7.3 now says the wave record complements those counters and adds
   no second coalesce surface.

8. **Acceptance wording and header hint — FIXED.** Header:
   `Accepted (§7 only: Proposed per LLP 0295 W5; owners to accept)`
   (ref-check still reads the first token as `Accepted`). §7.7:
   "On acceptance, this RFC owns…" not "This RFC accepts". Open
   questions still mark §7 as proposed. Guide sentence extends the
   existing §4.2 page. Fixtures cover attribution, redaction
   (including `fixtureIdentity`, projected D0.5 tuple, owner labels,
   `PublicInspect`), byte/key bounds with visible markers, and
   hosted-default-off.

### No new contradiction with §§1–6 or Phase 0

- §§1–6: explicit nonclaim of a new bounds surface; observed
  `subscriberCount` / `distinctEvaluationGroups` do not substitute
  for §1.6 declarations; wave clocks reuse §1.5 exactly; recorder
  caps are not §3.4 maxima; §4.1 inheritance is the value-free rule,
  not the query-cost detail field set; `fixtureIdentity` projection
  matches §1.1's qualification-only note.
- LLP 0059 ruling 6: timestamps and derived subtractions consumed;
  delivery owned by the subscription projection; `blockedReason`
  vocabulary not re-opened; no undifferentiated pending.
- D0.5: 16 warns / 64 refuses; inspection floor consumed; equal-
  snapshot dedup treated as completed delivery, matching LLP 0278.
- LLP 0031 D3: cost snapshot is gated `/_snapback/api/inspect`-class
  or in-process CLI; `PublicInspect` allowlist unchanged. Adding
  rings to `InspectState` would fail the typed `From` projection
  until they are dropped — that is the D3 compile-error guard, and
  the fixture requires the drop.

### Strengths

The v0.7 overclaims that would have shipped a second bounds system,
a fake 4 MiB cap, a wire cost carrier, and a non-reversible-hash
lie are actually gone. Closing `pendingDeliveryReason` as a
precedence enum over a defined owed-delivery condition, and moving
coalesce/memo out of `rerunCause`, are the right shapes. Honest
fingerprint framing plus gated-only correlation ids is the correct
privacy posture for a local-dev recorder.

### Concerns (non-blocking)

1. SEVERITY: MINOR — `llp/0267-query-cost-guardrails.rfc.md:780`
   (§7.3/§7.4 join key domain). The join
   (`deliveredVersion` ↔ `authoritativeRevision`) and the owed-
   delivery comparison ("committed version … newer than
   `authoritativeRevision`") are only coherent if all three of
   `deliveredVersion`, ruling-6 `authoritativeRevision`, and D0.5
   "held snapshot version" are LLP 0095 §1.3 `LIVE(version)` —
   the **storage commit version**. The tree also has a same-named
   client-local counter in
   `packages/snapback-client/external-store.mjs:147` that increments
   per accepted row set and is used for optimistic-layer retirement.
   Pin one sentence: these fields are the §1.3 storage version, not
   that counter. Without the pin two implementers can join 1,2,3
   against storage versions.

2. SEVERITY: MINOR — `llp/0267-query-cost-guardrails.rfc.md:839`
   (§7.4 `pendingDeliveryReason` writer). The row's new cost fields
   are introduced as "each one an event the client itself observes,
   so no server→client cost carrier is implied," but owed-delivery
   is defined by **joined snapshots** and member 6 (`server-pending`)
   is disambiguated by the server wave records / `liveCoalesce`
   counters. Pin whether the field is live client state (own-commit
   coverage + client-visible holds 1–5, with inspect-time join
   filling `server-pending` for other-writer stalls) or an
   inspect-time computed field. The W5 stalled-projection fixture
   (own send) is client-observable either way.

3. SEVERITY: MINOR — `llp/0267-query-cost-guardrails.rfc.md:728`
   (§7.2/§7.4 `deliveryLagMs` cardinality). Lag is specified per
   (subscription, covering delivery) pair — first covering delivery,
   client clock — but stored as one scalar on the subscription row.
   One subscription covers many commits. Pin "most recent covered
   commit" (or equivalent) so two implementations do not disagree
   on which pair the field reports. The single-send attribution
   fixture does not need this; the general field does.

### Suggestions (nits; do not block)

- `MutationPhaseCostV1.disposition: string` could cite the LLP 0218
  terminal-kind union instead of an open string.
- "the §5 canonical-args hash the host computes anyway for cursor
  binding" is true for pageable G0 queries, not for mutation
  equivalent-enqueue; that path computes the hash for the counter.
- Per-family default byte split (how 4 MiB divides across three
  rings) can stay implementation-owned; a 1.3 / 1.3 / 1.3 default
  would remove one implementation fork.
- Recorder truncation of `accessPathConsultations` must copy; it
  must not mutate the qualification-stored §1.1 observation.

### Open questions

None that §7 needs to reopen. The three MINORs are one-sentence
pins, not design forks.

### Recommended next step

Ready for the owners (LLP 0267, LLP 0095/0114, LLP 0278) to accept
§7. The three MINORs can land as a follow-up sentence each or as
implementation-ticket pins; they should not hold acceptance.
