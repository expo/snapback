# Review artifact — LLP 0183, Claude family

## Round 1 — 2026-08-07

- Reviewer: claude-fable-5, fresh-context general-purpose subagent (no
  inherited conversation; not the supervising session, which contributed
  the 2026-08-07 status/ruling records and therefore does not count
  itself as a reviewer)
- Target revision: `llp/0183-zerobugs-quality-surface.rfc.md` at git blob
  `b649359be5bf50e92663b73e85eb274eac13723b` (repo commit `6c2b67a09`,
  839 lines), content-pinned per LLP 0189
- Method: full-document read plus the commissioned evidence set (control
  PLAN, acceptance.v1 + ratification-13.v1, sampled receipts zb2.v3 /
  zb5-large.v3 / zb5-hot.v8, both platform tickets); LLP 0005 standard
  structure; five execution-informed questions added by the commission
- Runtime 283 s; 15 tool uses; no redaction (local repo only, no external
  sends)
- Stakes: foundational (per the 2026-08-07 author commissioning ruling)

---

## Overall assessment

LLP 0183's core bets — control-before-capability, receipts-not-claims, delegated owner authority, honest GAP taxonomy — were tested by an actually-executed Stage 0.5 and largely vindicated: the control surfaced two genuine platform findings, several shipped-client defects, and a 15-row workaround register that maps recognizably onto the D-workstreams. The document is close to acceptable as a charter, but execution has overtaken its sequencing text in ways the Status section records without reconciling (D3-first vs Stage-1-first, margin-freeze trigger, absent Zero arm), and the margin-freeze and FAIL-attribution protocols have identifiable exploitable seams. I recommend acceptance after a focused revision, not redesign.

## Strengths

- **The control-first structure (§D1, §Stage 0.5) earned its cost.** The method — build the whole pinned surface on shipped capabilities, run every gate, record honest PASS/GAP/FAIL — surfaced the P1 touched-table version-scan (`issues/closed/20260806-buffered-mutation-touched-table-version-scan.md`, fixed with cardinality-independence witnesses and a flat 6,176-batch re-ingest) and the open hot-cycle stream-stale finding (`issues/20260807-hot-cycle-live-stream-stale-at-settle.md`), plus shipped-client defects (AuthCoordinator deadlock, anonymous live-header) no smaller demo had reached. This is exactly what an acceptance program should do before capability work, and the RFC predicted it ("validates the anti-reduction harness… informs instrumentation").
- **The immutable attempt-trail discipline (§ZB0, §Capability publication; evidence README) works as designed.** The `zb5-hot` v1–v8 ladder in `demos/zerobugs/control/PLAN.md` §Lane 8 is a model artifact: each preserved FAIL isolates exactly one defect, remediations increment rather than rewrite, and the honest-boundary closures (large leg on the P1; hot leg on the stream ticket) refuse to backfill. The receipts I sampled (`snapback-control.zb2.v3.json` GAP with 37 honest GAP rows; `snapback-control-large.zb5.v3.json` PASS 14/0; `snapback-control-hot.zb5.v8.json` preserved FAIL) match the Status section's claims exactly.
- **The anti-reduction and vector-not-score rules (§Quality target, §ZB2) held under pressure.** ZB2 reporting 3 PASS / 39 GAP because no retention carrier exists — rather than simulating retention with undisclosed custody — is the honest-GAP taxonomy doing real work, and it directly informed the D3-first ruling.
- **§13's pre-registration protocol executed as written.** The durable-disconnected-intent candidate was ratified (`ratification-13.v1.md`) before Stage 1/2 results, with the adverse contingency (zero queued intent in the control today) disclosed at ratification time, and the manifest's §15 append-only rule was respected rather than rewriting v1.
- **The delegated-authority table (§Scope) and structural-non-parities table survived contact.** Every workaround-register row names a plausible removing owner; the control's receipts respected the declared boundaries (generic `id_` prefixes, Lane L continuity honestly non-promised, declared composition rather than hidden sidecars).

## Concerns

**1. MATERIAL — The margin-freeze precondition has been sequenced around, and the Zero comparator arm has no owner.** §"Freeze performance margins from evidence" requires, *before Stage 1 implementation begins*, a variability envelope "from repeated Zero-arm and current-control trials" and frozen path-specific margins. But: (a) no Zero-arm receipt exists — Stage 0.5 built only the Snapback control, and no lane or owner is named for building and running the pinned Zero arm before Stage 4; and (b) the recorded ruling starts D3 (a Stage 2 workstream) first, which means the "before Stage 1" trigger may simply never fire while capability work proceeds. The document records this ruling in Status without reconciling it with §Sequencing. *Resolve by:* amending §Sequencing/Status to state explicitly which gate binds D3-first work (e.g., margins and Zero-arm variability trials must be frozen before any comparative claim and before Stage 1 *exit*), and naming an owner and timebox for the Zero-arm build and its trials.

**2. MATERIAL — Margin-setting is not blind to the comparative delta.** The freeze protocol derives margins from "measurement noise and the largest user-visible regression the authors are willing to accept," but the noise envelope requires running both arms — which reveals the delta — and the regression-budget component is subjective and set by the same authors afterward. Raw control numbers are already on record (1,509 ms list-ready normal, 1,341 ms at 5.5M rows). The guard "control slowness cannot justify loosening a Zero-relative margin" addresses only one direction of bias. *Resolve by:* pre-committing the regression-budget component (absolute per-interaction-class budgets) in `acceptance.v2` *before* Zero-arm trials run, leaving only the noise term data-derived; or requiring the author to ratify margins from delta-blinded summaries.

**3. MATERIAL — FAIL-attribution authority is the exploitable seam in the defeat-on-any-loss protocol (§13, §11).** Most Stage 0.5 FAILs were legitimately reclassified as gate-authoring defects and rerun (ZB3 v1, ZB4 v1, ZB2 v2, zb5-large v2, most of the hot ladder). That was done with exemplary per-attempt evidence — but the classification (product defect vs harness defect) is made by the team running the benchmark, and at Stage 4 a "loss" for the better-claim could be reclassified and rerun until pass while the letter of "one loss defeats" is preserved. *Resolve by:* adding a rule that any claim-bearing (Stage 4) FAIL reclassified as harness-defect requires an independent-family review of the reclassification evidence before the rerun's result can carry the claim.

**4. MATERIAL — The workaround register exposes mechanism seams no D-workstream owns.** The control's first-order frictions were: the source-id / physical `_id` / principal-binding triple (`W-IDENTITY`, `W-MUTATION-IR` — the reason both "current-IR" mutations stayed on the JS tier); portable stored enum domains (`W-ENUM`); numeric identity/default columns (`W-SHORTID`); a handler-visible settlement identity for effect idempotency (two separate guide-gap entries); and authority-partitioned search-source selection (`W-SEARCH-EPOCH`). The register assigns these to D5/D6/D7 by stretch, but the D5 brief (§D5) says nothing about source-key/identity bindings, the D6 brief (§D6) says nothing about authority-partitioned search membership despite the control proving it is the crux, and the settlement-identity API falls between D5 and D7. An accepting reader of the umbrella would not know these are the load-bearing gaps. *Resolve by:* one paragraph per affected workstream brief naming these as required scope, or explicit new rows/amendment assignments in the §Scope table.

**5. MINOR — D3-first inverts a stated dependency and sits on a known-broken substrate.** §D3 defines the local evaluator as consuming "admitted D2 graphs," and §Sequencing runs Stage 1 (D2) before Stage 2 (D3); the ruling starts D3 first. Meanwhile D3's live/retention substrate has an open at-scale defect (stream-stale ticket). Probably workable if D3's first classes are store-shape work rather than evaluation, but the document should say so, and say whether hot-profile GAP closure gates any D3/D4 design freeze.

**6. MINOR — Scale-out of the receipts discipline is unaddressed (Stage 1+ concurrency).** Stage 0.5 was one serial supervisor, and even so, legitimate generated-identity rotation forced ZB0 re-receipts four times and composition-pin resyncs within a single lane. With D2–D8 concurrent: attempt-number races on a shared `<arm>.<gate>.<attempt>` namespace, cross-lane identity-rotation invalidating other lanes' pinned identities, and informal free-text GAP owners ("owner D3") that can orphan. *Resolve by:* a short concurrency rule — receipt custody/lease per lane, machine-readable GAP-owner ids, and adoption of the LLP 0189 scoped-digest binding (which this RFC predates and never references) for what survives an identity rotation.

**7. MINOR — Rot-prone detail retained in the umbrella; one dangling header concept.** The D5 paragraph enumerating Zero's exact `Date.now()` override paths is inventory content that already required one correction and will rot with any pin change — cite the inventory instead. The Status section is accreting execution log (5.5M-row numbers, Chrome behavior) better left to PLAN.md/receipts it already links. And the Revised header credits a "refusal-union ownership" addition that no body section defines — either restore the definition or drop the phrase.

## Suggestions

- Note in §13 (or the ratification artifact) that the durable-disconnected-intent candidate is asymmetric by construction — the Zero arm cannot pass it, since finding 10 was known at ratification — so the pre-registration is protecting against post-hoc *candidate selection*, not comparative bias. This is fine, but saying it plainly forestalls a "benchmark theater" reading.
- State how the §13 ratification (a standalone append to frozen v1) is carried into `acceptance.v2` — §15 implies successor incorporation but the ratification file only says "the next versioned manifest incorporates this record."
- Note that the v2 variability envelope will be measured on the *control* arm while noninferiority will be judged on the *final* D2–D8 arm; require re-validation of the noise term against the final arm or state the envelope is Zero-arm-anchored.
- The Stage 0.5 experience — most first attempts fail on harness authoring, not product — is itself a reusable methodological finding; a two-line note in §ZB0 ("expect and budget for gate-defect attempts; classification evidence is mandatory") would help Stage 1+ lanes.

## Open questions

- Who builds the pinned Zero arm, on what timeline, and where do its receipts live? Nothing in the document, PLAN.md, or evidence directory answers this.
- What exactly does D3's staged work produce before D2's graph profile exists — store/protocol Specs only, or an evaluator against the current fragment surface? (The program-plan file may answer; the RFC does not.)
- Is closure of the hot-profile GAP (stream-stale ticket) a precondition for any Stage 1/2 design freeze, or purely parallel repair?
- Does "Stage 0.5 completed" carry any claim about the four ZB7 production GAP classes (TLS/OAuth/backup/restore), or are those understood to gate only Stage 3? The Status wording is compatible with both readings.
- Whether the diary required by §Decision-requested ("the application gets a diary under LLP 0016") exists — PLAN.md notes lane jobs were scope-barred from creating it, and I could not locate one.

## Recommended next step

**revise-and-stay-Draft** — the program structure is validated by execution and close to acceptable, but concerns 1–4 (sequencing/margin reconciliation, blind-margin protocol, FAIL-attribution rule, unowned mechanism seams) change what an accepting author is actually authorizing and belong in the text before the Decision-requested acceptance is taken up.
