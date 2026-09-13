# Reviews of LLP 0191 — Claude family

Target: `llp/0191-scale-architecture-revisits.research.md`

## Round 1 — 2026-08-08

**Provenance.** Reviewer: Claude Fable 5 (`claude-fable-5`), fresh
general-purpose subagent, context-blind to the orchestrating session.
Orchestrator/reviser: Claude Fable 5 session (did not author this review).
Lens: design-partner (declared) — decision quality, missing revisits, prior
art, open-question recommendations; prose demoted to non-blocking.
Target revision: commit `dcd12ba5d8e62f4d91a99ddf5590f0fdd0b64121`, target
blob `4114404c61d75a9efe99dff8bc656b5fcaa90e7d`. Capsule: detached worktree
at that commit, structural exclusion of `llp/reviews/0191*` verified (none
existed). Instructions: `brief-r1.md` sha256[0:16] `4c7d4a06c9862059`,
identical brief to both families. Runtime: 522 s, 28 tool uses. Received
and recorded verbatim 2026-08-08; sealed from the other family's reviewer
by capsule pinning (the other family runs in a worktree at the same
pre-artifact commit).

**Verdict: NOT READY** (one MATERIAL concern: the post-repair
delivered-frame count).

### Verbatim review

# Review — LLP 0191 (Scale-architecture revisits), round 1, design-partner lens

Reviewer basis: read the target in full; independently verified the headline numbers against `demos/zerobugs/evidence/snapback-control-hot.zb5.v10.json` (48 settle samples, 110.88 ms–147.70 s, median 72.8 s — "~74 s" is accurate), `snapback-control-large.zb5.v3.json` (`raw-list-ready-timing` samplesMs `[1341.053]` — "~1.3 s" accurate, but n=1), LLP 0183, LLP 0190, LLP 0158, the `20260808-*` sweep tickets, `issues/closed/20260807-hot-cycle-live-stream-stale-at-settle.md`, `issues/20260807-server-sigterm-strands-large-sqlite-wal.md`, diary 0061, and the control PLAN's workaround register.

## 1. Per-section design assessment

### §1 — Live-query evaluation model

**Framing: right, and the best-evidenced section.** "Evaluation × subscribers × mutations, with no sharing and no increments" is the correct diagnosis, and the arithmetic checks out against the receipts: 16 mutations × 6 observers ≈ 96 owed re-evaluations at ~1.3 s each ≈ 125 s of serial drain per cycle, which brackets the observed 111 ms–148 s span and ~74 s median almost exactly. The document is also right that correctness held throughout and the ceiling is purely architectural.

**The ladder: right rungs, right order, one missing rung.** Coalescing-first is what every comparable system did first; shared evaluation second is proven at scale (Hasura's subscription multiplexing is precisely "evaluate once per (query, args), fan out per-session" and it works in production); IVM-last-and-scoped matches the hard lesson of the field (Zero built ZQL as a *closed* language precisely so IVM is tractable; Convex looked at IVM and deliberately chose re-run + caching instead; Materialize proves general IVM works but at heavy operational/memory cost). The rungs are genuinely separable: rung 1 is pure scheduling, rung 2 requires only the authorization-partition answer, rung 3 requires declared shapes. Good.

**Is "rung 1 → single-digit seconds" sound?** Arithmetically yes: with coalescing, a 16-mutation burst costs one drain of 6 × ~1.3 s ≈ 8 s serial (less if evaluations parallelize), so the burst's settle latencies collapse from a 74 s median to single digits. Two caveats: (a) the 1.3 s figure is a **single sample** in the receipt — the spike (OQ4) must establish the distribution before the Spec leans on it (minor); (b) coalescing changes delivery semantics from "every state" to "eventually latest" — the D4 contract must say so explicitly, because clients must not depend on intermediate frames (minor, but should be named as required Spec content).

**MATERIAL — the 676 → 12 frame claim is unverifiable and appears to contradict the immutable receipt.** The document states: "after the invalidation repair the same workload delivered **12**" frames, and concludes "most frames were redundant … evaluation work and delivery work with no information in it," feeding the claim that "the delivery side is ready" for coalescing. Problems: (i) the cited closed ticket summarizes the pre-fix trace (676 update/boundary frames) but contains no post-fix frame count at all; (ii) the local trace (`fixtures-local/…/2.jsonl`) is absent from the checkout, as expected — but the document's own Evidence-base rule is "all claims below cite artifacts that exist and cannot be rewritten," and this number's only support is an absent local file; (iii) the immutable post-fix receipt `zb5-hot.v10` records **~521 deliveries** (26–33 per observer per cycle, 6 observers × 3 cycles) for the same 48-mutation workload — roughly 2 frames per mutation per observer, i.e., delivery is demonstrably *not* coalesced post-repair. Either "12" measures something narrower than "delivered frames for the same workload" (in which case the metric must be defined and cited), or it is wrong. Note the fix is cheap and does not weaken the section — if anything, 521 post-fix deliveries *strengthens* the case for commissioning coalescing, and the supersession repair (resolutions supersede with distinct revisions) still shows the obligation machinery can express "latest wins." But as written this is overclaimed evidence supporting a required design-content claim, in a document whose stated ground rule is immutable citation.

**Missing rung (minor, but I would add it to the required design content): invalidation precision.** The current trigger is "declared reads intersect the touched *tables*." The industry's first-order lever is finer-grained invalidation — Convex's read-set/index-range intersection, Firestore's per-document matching — which makes most mutations invalidate *no* subscriptions rather than making re-evaluation cheaper. The hot profile can't show this win (all 16 mutations genuinely touch the list), which is presumably why it's absent, but the general workload the D2/D4 Specs must serve is many subscriptions over *different* data with *heterogeneous* args, where rung 2's sharing collapses nothing (different args = different keys) and precision is the lever that matters. Recommend: name "read-scope precision" as explicit D2/D4 design content between rungs 1 and 2. Confidence: high.

**Decision: sound.** Commission D2/D4 with rungs 1–2 required and rung 3 as the admitted-shape question, measured per rung — I would commission the same, with the precision addition and with the note that rung 1 is D4-separable and need not wait for D2's (heavier) Spec. Confidence: high.

### §2 — Local facts as a read path

**Framing: right and genuinely insightful.** Recasting D3 from "offline support" to "the read-path scaling strategy" is the correct architectural move, and both receipted findings (re-evaluation ceiling; quarantine degrading to nothing renderable) do point at it from different directions. Prior art strongly validates the convergence thesis and — importantly — the admitted-shape scoping: ElectricSQL rebuilt itself around *Shapes* after general partial replication with live queries proved intractable; PowerSync's sync rules are authority-parameterized buckets (their parameter queries are essentially this document's principal partitions); Linear's full-model-sync works only because the workspace partition is small and closed — which is exactly why "retained fact + delta stream = replica" needs Zero-style query-driven scoping at 5.5M rows, not Linear-style whole-partition sync. The document's direction is consistent with all of this.

**One bias to name:** framing D3 as "the read-path scaling strategy" tilts 0190's OQ1 toward Candidate A (declared projections), while the quarantine-degradation consumer tilts toward Candidate D (exact-result retention — cheap, but does nothing for read-path scaling). The document should say explicitly that these two consumers pull OQ1 in different directions and that a portfolio (D now, A as the convergent end-state) is the likely honest answer — 0190 already permits this. Minor.

**Decision: sound** (rule OQ1 with §1's ladder in view; shared end-state hypothesis). Confidence: high.

### §3 — App identity as a schema concept

**Framing: right.** The four independently-arrived clusters (W-IDENTITY, W-MUTATION-IR, W-SHORTID, settlement identity) are real, well-receipted, and genuinely one concept: "the application arrives with its own identity scheme." The evidence that the frozen provider contract needs exactly `clientID:mutationID:email` is the strongest argument for bundling settlement identity with app identity — they compose in practice, not just in taxonomy. Prior art confirms Snapback is the anomaly here: Convex exposes verified claims to handlers (`ctx.auth.getUserIdentity()` with email etc.), Supabase exposes JWT claims to RLS — a verified principal-claim surface is table stakes for ported apps; and literal-union enums plus identity columns are supported by the obvious comparators (Convex schema accepts unions of literals; Postgres `GENERATED AS IDENTITY` is the pinned source's own semantics).

**Two design cautions for the commissioned Spec (both minor):**
- "Server-owned monotonic numerics" should adopt Postgres *sequence* semantics (monotonic, gaps allowed, rollback burns values) — a gapless transactional counter serializes all writes to the table and would recreate a scale cliff at exactly the store size that exposed W-SHORTID. The ticket's word "transactional" should not be read as "gapless."
- The verified-claim surface is a trust-boundary widening (claims become handler-visible input); the Spec should treat which claims are exposed, and the alternative privileged-provisioning channel, as first-class alternatives rather than assuming in-handler claims win.

**Decision: sound — one owner-Spec, not slivers.** Distributing across D5/D7 guarantees seam mismatches (source keys are needed by both D5's generated `Get` and D2's graph addressing; principal claims by D2 auth and D7 provisioning). Confidence: high.

### §4 — Durable-store envelope

**Framing: right, evidence solid** (WAL-strand receipts v1/v2, keyring probe, the v4 attempt burn — all check out). The revisit — an enumerable, versioned member set with an atomic supported verb — is the known best form: Litestream/LiteFS exist because the `-wal`/`-shm` lifecycle is exactly this trap; SQLite's own backup API / `VACUUM INTO` is the right consistent-copy primitive; Postgres backup manifests are the enumerable-member precedent.

**Decision: fold into the 0158 lineage — agree, with one sharpening.** 0158 is the right owner because it *already contains* the essential structure: a per-sidecar custody disposition table (`copy`/`scrub`/`rotate`/`share`/`refuse`) and the WAL/journal-set treatment. But note the two consumers have **opposite keyring dispositions**: backup/restore-as-same-instance must *carry* the keyring sibling (the probed boot failure), while fork-as-derived-deployment must *not* (0158's accepted custody ruling mints fresh keyrings and admin tokens). The document's sentence "exports/copies/forks it atomically — checkpointing the WAL, **including the keyrings**" is fork-unsafe if read literally. The envelope contract must be operation-parameterized, and I'd lean "companion Spec in the 0158 lineage" over inline amendment, so backup/restore consumers who will never fork get their own acceptance rows rather than reading a forking RFC. Minor (the named owner already holds the correct policy). Confidence: high.

### §5 — Relational-surface completeness

**Framing: right** — these are quiet multipliers, and the ~1,400-line hand-written merge behind `W-QGROUP`/`W-MANUALSET` is exactly the authoring delta ZB6 measures. **Decision (fold into D2's owner-Spec as required scope, no separate program): agree** — a standalone "small schema features" program would drift. One accounting note (minor): the control's own workaround register routes `W-ENUM` to *D5* ("if generated validation/lowering is extended to portable stored enum domains"), while this section routes it to D2. The right owner is probably "the schema surface" wherever that lives; the commissioning ruling should name it explicitly so the enum ask doesn't fall between D2 and D5. Confidence: high.

### §6 — Bulk data flows

**Framing: right.** Three bespoke loaders rediscovering deterministic batches + exactly-once ledger + digest verification + resumability is the classic signature of an unbuilt protocol, and the converged shape matches the field's best form (tus-style resumable chunking, COPY/managed-export-style server streaming, job-id idempotency ledgers à la BigQuery load jobs). The echo-bound finding is correctly read: stream, don't echo. **Decision (assign to D8, control loader as reference implementation): sound.** One seam to name (minor): §4's *physical* envelope export and §6's *logical* import/export are different contracts with different consumers (byte-exact clone vs portable data); the two Specs should declare that seam so backup and migration don't converge accidentally — `issues/20260730-auth-logical-export-import.md` already sits on the logical side. Confidence: high.

## 2. Missing-revisit scan

The six-way carving is essentially right, and the §1-rung-3 / §2 split is **load-bearing, not drafting residue**: §1 is server-side evaluation cost (owners D2/D4), §2 is client-side read path (owner D3); they meet at one declared design point but have different owners, different consumers, and different failure modes. Merging them would rebuild the mega-doc that 0183 was deliberately split to avoid. Keep the split; the document already names the convergence deliberately.

Earned-but-absent candidates, all below the commissioning threshold in my judgment:

- **Quarantine-recovery contract (minor, recommend adding a sentence to §1's D4 scope).** The closed ticket establishes that a quarantined stream "by design never self-recovers without an authority transition." The invalidation fix removed *that* trigger, but the posture means any future server-side protocol defect bricks live streams until reload. The evidence earned a D4 stream-lifecycle question — what, if anything, re-establishes liveness after quarantine — that the document assigns nowhere (it assigns only fairness/starvation to D4).
- **Diagnosability as a contract (minor, acceptably absorbed elsewhere).** Three separate receipted attempt-burns were pure diagnosis cost (`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` naming no sibling; `path: "$"` naming no constraint; the refusal-channel discoverability gap). The document mentions the first inside §4 and leaves the rest to tickets/ZB6 — defensible, but worth an explicit sentence acknowledging the choice not to elevate it.
- **Settlement identity's placement** (§3) is slightly forced taxonomy — it is protocol/effect surface, not app-identity — but the `clientID:mutationID:email` provider-contract evidence shows the two compose in practice, so bundling is defensible. No change requested.

Nothing else in the receipts, diary, or sweep rises to a seventh revisit. No conflation requiring a split.

## 3. Prior art, per revisit

**§1.** Rung 1: universal practice — every production live-query system conflates to latest-value (Convex re-runs against latest state, not per-write; Firestore/Supabase Realtime debounce); the one hard-won lesson is that conflation is a *semantic contract*, not an optimization — clients lose intermediate states, so say so. Hasura's fixed-interval refetch (default 1 s) is also a legitimately simple bounded-staleness scheduler worth having on the D4 option list. Rung 2: Hasura subscription multiplexing (one parameterized query, session-variable array, many subscribers) is the direct precedent and validates feasibility; Figma's LiveGraph (shared view computation, per-subscriber permission filtering) validates the evaluate-once/project-per-principal split; Convex's caching keys identical `(query, args)` evaluations but must include identity whenever the function reads auth — the lesson the document already draws correctly: make the principal an *explicit, declared* input, shared with LLP 0190 §4's partition discipline. That "the two designs should share an answer" sentence is exactly right and is the section's best call. Rung 3: Zero/ZQL (closed language → tractable IVM), Materialize/differential dataflow (general IVM works, operationally heavy; arrangement-sharing is rungs 2+3 combined), Convex (deliberately *rejected* IVM — proof that a re-run architecture plus coalescing/caching is a legitimate stable resting point, not merely a waypoint). The corpus overall says: the ladder is correct, the rungs are the historically-taken paths, and — as flagged in §1 above — read-scope *precision* is the missing named lever.

**§2.** Replicache's CVR/pull model recomputes the view per client per pull and diffs — coalescing + caching, not IVM — and works because pulls batch naturally; Zero exists because that stops scaling, which is precisely this document's §1→§2 arc. ElectricSQL's retreat to Shapes and PowerSync's bucketed sync rules are the field's two independent convergences on "admitted shapes with authority parameters" — strong external validation of the D3 risk-class/admitted-shape scoping. Linear's sync engine warns that replica-as-read-path is easy only when the partition is small and closed. Firestore shows a major product shipping with *no* cross-query client reuse (per-listener snapshots) — i.e., 0190's Candidate D has a respectable precedent as a stable resting point, not just a stepping stone. Nothing in the document contradicts this corpus.

**§3.** Postgres `GENERATED AS IDENTITY` (the pinned source's own semantics — gaps allowed) is the form to match; Convex `getUserIdentity()` and Supabase JWT-claims-in-RLS establish verified-claim exposure as standard; Stripe-style idempotency keys and event-delivery ids establish read-only settlement-identity exposure as standard. The document is not reinventing anything here; it is filling recognized gaps.

**§4.** Litestream/LiteFS (the `-wal` lifecycle is exactly the trap the receipts hit), SQLite backup API / `VACUUM INTO` (the atomic-copy primitive 0158 already respecified onto), Postgres backup manifests (enumerable, versioned member sets). Known best form = manifest-driven versioned snapshot verb over the engine's consistent-copy primitive, with per-member per-*operation* dispositions — 0158's custody table is already that shape, which is the strongest argument for the fold-in decision.

**§5.** SQL enums/CHECK constraints and Convex's literal-union schema validators make the current refusal an anomaly against the obvious comparators; GraphQL persisted queries with structured variables are the precedent for the route-group argument ask. Table stakes, correctly scoped as D2 required content rather than a program.

**§6.** tus (resumable chunk protocol), Postgres COPY/pg_dump custom format, Firestore managed export, BigQuery load jobs (job-id idempotency, ledgered). The convergent shape the control rediscovered *is* the known best form; the document's "do not build a fourth" is the right reading.

No place in the document contradicts hard-won lessons from this corpus. The two places it is closest to reinventing something with a known form — the envelope verb (§4) and the bulk protocol (§6) — both correctly reach for the known form.

## 4. The five open questions, answered

**OQ1 — commission D2/D4 with the ladder as required content?** **Yes.** With three additions to the required content: (a) read-scope invalidation precision as a named lever alongside coalescing; (b) an explicit latest-value/conflation delivery contract (clients may not observe intermediate frames); (c) the rung-2 sharing key defined jointly with LLP 0190 §4's authority-partition answer — one answer, two consumers, as the document already says. Also commission them *separably*: rung 1 is D4-side scheduling and should not queue behind D2's heavier graph-profile Spec. Framing bias to note: the parenthetical "(cheapest high-leverage decision here)" is correct but conflates the two Specs into one yes/no; the honest decomposition is "spike now (OQ4), D4 contract next, D2 profile on its own clock."

**OQ2 — one identity owner-Spec or distributed?** **One dedicated owner-Spec** (joint D3/D5/D7 dependency), for the reasons in §3 above: the four surfaces interlock (source keys feed both D5 `Get` addressing and D2 graph addressing; principal claims feed D2 auth and D7 provisioning; the provider contract composes settlement identity *with* app identity), and the review round independently flagged identity as unowned cross-cutting contract. Constraint: the Spec defines the schema/context surface; LLP 0129 retains sole admission authority over any mutation-IR consequences. Settlement identity can live as a section with D5/D7 joint sign-off rather than a separate doc.

**OQ3 — envelope into 0158 lineage or standalone?** **Into the 0158 lineage, as a companion Spec** (not a buried amendment): 0158 already owns the sidecar custody-disposition machinery, so a standalone Spec would duplicate it — but backup/restore needs its own acceptance rows and its keyring disposition is the *opposite* of fork's, so the contract must be operation-parameterized and independently consumable by operators who will never fork. The shutdown-checkpoint repair (WAL ticket) is a genuine prerequisite and should be sequenced as a bounded runtime fix, not held hostage to the Spec.

**OQ4 — spike coalescing immediately?** **Yes, emphatically — this is the best single decision available in the document.** The instrument exists, the persistent-baseline recipe makes iteration minutes-scale, and the result sizes rung 1 for the D4 Spec *and* feeds the acceptance.v2 margin freeze. Guardrails: it is a measurement spike, not a landing (LLP 0189 — any behavior change lands via owner review); predeclare the metrics (settle-latency distribution under the same 48-mutation workload, delivered-frame counts with the metric *defined* — which also cleanly repairs the MATERIAL concern above — and fairness under at least one *sustained*-write scenario, not only the 400 ms burst, so the starvation risk is observed rather than hypothesized). One caution on the framing: "days-scale" is plausible for the measurement; do not let a successful spike become the de facto design — the spike answers "how much," the D4 Spec answers "what contract."

**OQ5 — priority order.** See section 5.

## 5. Sequencing (Stage 1, D3 already ruled first)

| Order | Item | Effort | Leverage | Rationale |
|---|---|---|---|---|
| 0 (running) | §2 / D3 (already ruled first) | large | high | Stage D3.0/D3.1 are read-only evidence work; proceed. |
| 1 (immediate, parallel) | §1 rung-1 coalescing spike (OQ4) | days | very high | Instrument built; sizes the win before any Spec prose hardens; repairs the frame-count evidence en route. |
| 2 | §3 identity owner-Spec | medium | very high | Widest unblocking effect: W-MUTATION-IR (D5 lowering), D2 addressing, D3 partitions, D7 provisioning, W-SHORTID/W-IDENTITY removal. Pure design work, no runtime dependency. |
| 3 | §1+§5 → D2 and D4 owner-Specs | large | high | The heavy documents; write them *after* spike data exists (rung-1 numbers) and with §5's surface and the precision lever as required scope. D4's contract can lead D2's profile. |
| 4 | §4 envelope companion Spec + shutdown-checkpoint fix | small–medium | medium-high | Independent lane; the runtime fix is bounded and prerequisite; high operational value per unit effort; also feeds LLP 0158 F-work. |
| 5 | §6 D8 bulk protocol | medium | medium | Demand-gated on D8 target qualification and the 0160 migration program; all design inputs already measured, so it keeps cheaply until demand arrives. |

The document's own implicit ordering is compatible with this; the one thing I would make explicit that it leaves implicit is that item 1 (the spike) and item 2 (identity Spec) are parallel-safe and should both start before the D2/D4 Specs are drafted.

## Concern register

- **MATERIAL** — §1's "after the invalidation repair the same workload delivered 12" frames: unsupported by any artifact in the checkout (the cited closed ticket contains no post-fix frame count; the local trace is absent), and in apparent contradiction with the immutable `zb5-hot.v10` receipt (~521 deliveries for the same 48-mutation workload, ~2 frames per mutation per observer — delivery is *not* coalesced post-repair). This number underwrites "most frames were redundant … the delivery side is ready for it," which is offered as rung-1 design evidence, in a document whose stated ground rule is that all claims cite immutable artifacts. Fix: define and cite the metric, or replace with the receipt's delivery counts (which, note, *strengthen* the coalescing case) and re-scope the "delivery side is ready" claim to what the supersession repair actually shows.
- minor — §1's ~1.3 s per-evaluation figure is a single receipt sample (n=1); acceptable for motivation, not for the Spec; the spike resolves it.
- minor — ladder omits read-scope invalidation precision; add as named D2/D4 design content.
- minor — coalescing's latest-value delivery semantics should be named as a contract change, not an optimization.
- minor — §2 should name the OQ1 bias: the read-path-scaling framing favors Candidate A while the degradation consumer favors Candidate D; a portfolio is the likely honest answer.
- minor — §3 "monotonic, transactional" identity columns: adopt sequence semantics (gaps allowed) or risk a write-serialization cliff.
- minor — §4 "including the keyrings" is operation-dependent (fork must scrub/rotate per 0158's custody ruling); the envelope verb needs per-operation dispositions.
- minor — §5 assigns W-ENUM to D2 while the control register routes it to D5; name the schema-surface owner at commissioning.
- minor — quarantine-recovery (a quarantined stream never self-recovers by design) is an earned D4 stream-lifecycle question the document assigns nowhere.
- minor — §4 physical envelope export vs §6 logical export/import seam should be declared so the two Specs stay disjoint.
- minor (implementation-phase list, per brief): "~74 s" vs computed 72.8 s median is fine; "burned two full receipted attempts (v1–v4)" reads ambiguously (two of the four attempts were envelope-member discoveries); Evidence-base cites `diag-run1/2.jsonl` in a form that reads as one path.

Every decision the document asks Charlie to ratify is, in my judgment, the right decision or repairable at Spec time — the six framings are evidence-true, the ladder is the historically validated path, and the ownership assignments are correct. The single MATERIAL concern is an evidence-integrity defect with an easy repair that does not change any decision's direction, but under this document's own immutable-citation ground rule it must be repaired before the decisions are commissioned from it.

VERDICT: NOT READY

## Round 2 (delta round) — 2026-08-08

**Provenance.** Reviewer: Claude Fable 5, fresh general-purpose subagent,
context-blind. Orchestrator/reviser: Claude Fable 5 session (did not
author this review). Lens: design-partner, delta round — IN-DELTA vs
PRE-EXISTING classification required. Target revision: commit
`a340e02ebac3d0bdb811b9109bf117f8fe49ddf7`, target blob
`6b54db12bcedf11652e7cb028f84b3f28b8e4bf5`. Capsule: detached worktree at
that commit with `llp/reviews/0191*` removed post-checkout and
`DELTA-0191.diff` (458 lines) embedded. Instructions: `brief-r2.md`
sha256[0:16] `360674bbfed7f3ba`, identical to both families. Runtime:
472 s, 29 tool uses. Received and recorded verbatim 2026-08-08.

**Verdict: NOT READY** (C1 IN-DELTA MATERIAL — the reviser's
burst-vs-paced reconciliation misreads the open-loop receipt; no
PRE-EXISTING MATERIAL found).

**Orchestrator adjudication notes (not part of the review):** two
concerns the capsule could not settle were byte-verified against the
local traces after receipt: `diag-run1.jsonl` contains 676 `update` and
676 `authorization_boundary` records (C2's "plus 676" is trace-true);
`diag-run2.jsonl` contains 48 `mutation_dispatch` records (the run2
workload was 48 dispatches, not the 1-cycle default the reviewer
hypothesized). Both claims are retained in the r3 revision with the
local-trace label.

### Verbatim review

# LLP 0191 round-2 delta review — design-partner lens (verification round)

Verification basis: the target document, `DELTA-0191.diff`, and the capsule artifacts. I recomputed the receipt claims directly from `demos/zerobugs/evidence/snapback-control-hot.zb5.v10.json` (521 total deliveries across `custodyAccounting.perCycle`; per-observer per-cycle counts 23–33; 48 latency samples 110.88 ms – 147,702.6 ms; median 72.8 s; 521/(48×6) ≈ 1.81), from `snapback-control-large.zb5.v3.json` (`raw-list-ready-timing` sample 1341.053 ms), from the control PLAN (15 workaround-register rows, PLAN line 416; 11 dated guide-gap bullets; 5,549,113 rows / 6,176 batches / 65.9 min), and from the cited tickets, LLP 0158 (`copy`/`scrub`/`rotate`/`share`/`refuse` manifest, scrub-and-mint), LLP 0190 (Candidates A and D, OQ1, 74 s in the Revised header), and LLP 0183 (D2–D8 charters, ZB6). The local traces are absent from the capsule as the brief anticipated; I treat the brief's byte-verified counts (run1: 1,913 records / 676 update frames; run2: 439 records / 12 update frames) as ground truth for exactly those counts and nothing more.

## 1. Delta faithfulness

**Most of the revision is a genuine repair, and a good one.** The evidence-base section now explicitly demotes the traces to "local diagnostics, not immutable receipts" and the labeling discipline is honored in §1. The five-rung ladder is a real improvement: precision (rung 2) was a missing lever, the rung-3 rewrite correctly identifies principal/policy as ambient query inputs and kills the unsound evaluate-once-project-later version, rung 4's "legitimate stable resting point" framing is honest, and the settlement-isolation addition is the best new design content in the document — the receipt times `client.mutate()` settlement, so "why does subscriber work hold up settlement at all" is the right architectural question, and it is framed as a question for the D4 contract rather than asserted as diagnosis. The §2 two-consumer split of 0190's OQ1 (Candidate D serves quarantine degradation, removes no evaluation; Candidate A serves scaling, needs the full replica machinery) matches what 0190 actually contains and is stated without overclaim, including the load-bearing condition that a tactical Candidate D must reuse the eventual identity/authority envelope. §3's trust-domain decomposition, the sequence-vs-gapless-counter reasoning (which correctly connects gaplessness to a write-serialization cliff at exactly W-SHORTID's scale), the `(issuer, subject)` binding, and the namespaced settlement identity all check against the three tickets. §4's operation-specific custody manifest is verified against 0158's actual disposition vocabulary, and the backup-carries-keyring / fork-scrubs-keyring asymmetry is exactly what the probed boot refusal plus 0158's scrub-and-mint ruling jointly require; grounding the consistent cut in the SQLite backup API rather than shutdown checkpoints is correct. §5's two-cause stacking is confirmed verbatim by PLAN's W-MANUALSET row. §6's reassignment (storage-side protocol owner; D8 qualifies targets rather than owning semantics) is a defensible improvement over the register's tentative "D8 may standardize" note, and the physical/logical envelope seam against §4 is well drawn.

**But the centerpiece repair introduces a new evidence misread.** The revised third bullet states the acceptance receipt "paces the same 48 mutations across three cycles awaiting each settle" and explains the 521-vs-12 discrepancy as "a paced workload gives supersession nothing to collapse." The immutable receipt says otherwise about itself: it carries a PASS check `open-loop-arrivals-use-fixed-nonadaptive-offsets` with `arrivalOffsetsMs: [0, 25, …, 375]` and the scheduling rule "dispatch deadline is cycleStart + inventoryIndex*25ms; **no prior response is awaited to choose an arrival**," a refusal fact `adaptive-arrival-rate: refused`, and a network summary of "fixed open-loop arrivals." The diagnosis instrument (`demos/zerobugs/control/scripts/diag-hot-stream.mts`) uses the identical `ARRIVAL_INTERVAL_MS = 25`. Both workloads are per-cycle open-loop bursts of 16 at 25 ms offsets; neither paces arrivals on settle. And the document's own second bullet describes the same receipt as "sixteen mutations dispatched over 400 ms … the queue drains at evaluation speed" — with 74 s median settles against a 400 ms dispatch span, v10 had *massive* queueing, so "nothing to collapse" cannot be the explanation for 521 deliveries (~1.8 frames per mutation per observer, *more* than one frame per mutation under heavy queueing). Two subsidiary problems compound it: (a) "post-fix the same burst delivered 12" — run2 has 439 records versus run1's 1,913, and the instrument's default is `--cycles 1`, so run2 plausibly ran 16 mutations, not "the same" 48; the capsule cannot confirm the workload equivalence the sentence asserts; (b) "676 update frames plus 676 authorization boundaries" — the summary ticket says "676 update/boundary frames, ~100–160 per observer" (6 × ~113 ≈ 676 combined), and the brief byte-verifies only the 676 update-frame count, so the additional 676 boundaries claim is uncorroborated and arithmetically in tension with the ticket's per-observer range. The honest state of the evidence is: two instruments with different frame-accounting universes and possibly different cycle counts produced numbers that remain unreconciled, and the inference drawn from the pair — "the delivery machinery already expresses 'latest wins' when work queues up" — is not established (v10's queueing with 521 deliveries points the other way, or at a metric mismatch). This does not weaken the case for rung 1 or the spike — if anything an unexplained discrepancy strengthens the spike's urgency — but a verification round cannot pass a bullet whose whole purpose is "two metrics that must not be conflated" when its reconciling mechanism contradicts the receipt it cites. The fix is narrow: state both numbers, state what each instrument counts and dispatched (open-loop 16×25 ms cycles in both; cycle counts per artifact), and declare the discrepancy an open measurement question the OQ4 spike's predeclared counters resolve — and re-key OQ4's metric axis from "burst vs paced" to arrival discipline plus frame-kind accounting.

Beyond that bullet I found no new broken cross-reference or decision that fails to follow: every ticket, LLP, disposition-table, candidate, and workstream citation added by the delta resolves correctly in the capsule.

## 2. Pre-existing text

No MATERIAL concern found. I verified the carried-over load-bearing numbers against the capsule: ~1.3 s (1341.053 ms, zb5-large.v3), the 111 ms–148 s span (110.88–147,702.6 ms), ~96 = 16×6, 400 ms = 16×25 ms, 15 register rows, 11 guide-gap entries, 5,549,113 rows / 6,176 batches / 65.9 min, the ~43-gap ZB2–ZB4 cluster (0190 lines 31/144), and the v1–v8 FAIL-ladder narrative in the closed stream ticket. Minor pre-existing items are in the register: the "~74 s" median is 72.8 s computed from the receipt (rounding inherited from the ticket and 0190; within "~"); "burned two full receipted attempts (v1–v4)" reads as four attempts until the reader learns only two (WAL strand, keyring/v4) were envelope discoveries; "§13" has corpus currency via 0183's own Revised header but 0183's in-file headings are unnumbered; the Convex/Firestore comparator characterizations are unevidenced in-corpus and should stay non-load-bearing.

## 3. Open questions

The five questions are, with one inherited flaw, stated fairly, and the two fault lines are the real remaining decisions. OQ2's fault line (single implementation owner versus vocabulary-decision-plus-distributed-amendments) is exactly the tension §3's own trust-domain paragraph creates, both horns are argued rather than strawmanned, and the shared floor (one coordinating document, one acceptance corpus, LLP 0129 keeping mutation-IR admission — confirmed against 0183's D5 row) is right. OQ3 correctly narrows to pure placement after the structural agreement, and either placement is livable given §4's content, which is what a well-posed placement ruling looks like. OQ5's head sequence is sound and the tail divergence is honestly a judgment call for the author. OQ1 I would sign as written. OQ4 I would sign in substance — measurement spike, not a landing; predeclared counters including frame kinds and bytes and the commit-ack/settlement/convergence separation; hypothesis not estimate — but not in its current wording: "burst vs paced" as the predeclared workload axis inherits the §1 misread (both existing workloads are open-loop fixed-offset arrivals), and since the spike is explicitly framed as "repairing this document's own round-1 evidence defect at the source," the axis must be the true one — arrival discipline (open-loop fixed offsets vs settle-gated) crossed with an explicit frame-kind accounting — or the spike will re-measure the same conflation with better instruments.

## Concern register

| # | Concern | Class | Severity |
|---|---------|-------|----------|
| C1 | §1 bullet 3: the v10 receipt is described as "paces … awaiting each settle" and the 521-vs-12 discrepancy attributed to pacing, but the receipt records open-loop fixed 25 ms arrivals (`open-loop-arrivals-use-fixed-nonadaptive-offsets` PASS; `adaptive-arrival-rate` refused) identical to the diag instrument's `ARRIVAL_INTERVAL_MS = 25`; "the same burst delivered 12" is unverified (run2's 439 records match the instrument's 1-cycle default, not 48 mutations); the inference that supersession "already expresses latest-wins when work queues up" is contradicted by v10's own heavy queueing with ~1.8 frames/mutation/observer. The discrepancy is real but unreconciled; the offered reconciliation misreads the immutable receipt. Propagates into OQ4's "burst vs paced" metric axis. | IN-DELTA | MATERIAL |
| C2 | "676 update frames plus 676 authorization boundaries": the boundary count is uncorroborated by the summary ticket ("676 update/boundary frames, ~100–160 per observer") and unverifiable in the capsule; verify against trace bytes or drop the "plus 676." | IN-DELTA | minor |
| C3 | §6 decision names "the storage/import-export owner," an owner the 0183 D-structure does not provide, while the Summary promises owners "the LLP 0183 workstream structure already provides." Name the owner concretely at commissioning. | IN-DELTA | minor |
| C4 | Rung 1 + settlement isolation assigned as "D4-side scheduling/lifecycle work," but 0183's D4 charter is the headless windowed-query controller (client window lifecycle); the P1 ticket already uses this seam, but the commissioning should confirm D4's charter extends to server-side evaluation scheduling or name the runtime owner. | IN-DELTA | minor |
| C5 | "median ~74 s" — receipt-computed median is 72.8 s; rounding inherited from the ticket/0190. | PRE-EXISTING | minor |
| C6 | "burned two full receipted attempts (v1–v4)" — the parenthetical range names four attempts; say which two (WAL strand; keyring, v4). | PRE-EXISTING | minor |
| C7 | "ratified §13 protocol" — 0183's headings are unnumbered in-file; cite by section name for robustness. | PRE-EXISTING | minor |
| C8 | Convex ("deliberately stopped there") and Firestore ("ships exactly this") characterizations are external, unevidenced in-corpus; keep non-load-bearing. | PRE-EXISTING | minor |

Implementation-phase detail items (not blocking, listed per brief): C3, C4, C6, C7 are commissioning-time wording/ownership cleanups; C5 is a rounding footnote; C8 is a prose hedge.

C1 is a misread of the immutable receipt at the exact point round 1 was commissioned to repair, with spillover into OQ4's predeclared metric definition. The fix is narrow (restate both workloads as what the artifacts record, declare the discrepancy open, re-key OQ4's axis), but under this brief's definition it is a MATERIAL in-delta defect, so the document is one targeted revision away, not ready as written.

VERDICT: NOT READY

## Round 3 (closing delta round) — 2026-08-08

**Provenance.** Reviewer: Claude Fable 5, fresh general-purpose subagent,
context-blind. Orchestrator/reviser: Claude Fable 5 session (did not
author this review). Lens: design-partner, closing delta round. Target
revision: commit `9f30acdb1280a0757dc91c8c04dcce9f4ac891d1`, target blob
`106cf5f1417cb76012a812e509e937eb2c1435aa`. Capsule: detached worktree at
that commit, `llp/reviews/0191*` removed post-checkout, `DELTA-0191.diff`
(296 lines) embedded. Instructions: `brief-r3.md` sha256[0:16]
`0a339cef9c703e04`, identical to both families. Runtime: 477 s, 39 tool
uses. Received and recorded verbatim 2026-08-08.

**Verdict: READY** (both round-2 MATERIALs verified repaired; no
PRE-EXISTING MATERIAL; five minors, C1 = scope the "no incremental
maintenance" categorical to the opaque-JS path given the wired DK-3
`live_delta` lane).

### Verbatim review

# LLP 0191 round-3 closing delta review — design-partner lens

Reviewed: `llp/0191-scale-architecture-revisits.research.md` at the capsule checkout, against `DELTA-0191.diff`, the zb5 receipts under `demos/zerobugs/evidence/`, `src/live_matcher.rs` and its fan-out call sites, LLP 0183/0190/0158, and the cited tickets under `issues/` and `issues/closed/`. The orchestrator's byte-verified trace counts were treated as ground truth for exactly those counts.

## 1. Delta verification

**Finding (a) — the two delivery measurements.** The repair is honest and now matches every artifact I could check:

- The acceptance-receipt side is stated exactly as `snapback-control-hot.zb5.v10.json` records it. Recomputed from the receipt: `custodyAccounting.perCycle` sums to **521 deliveries** over 3 cycles with per-observer-per-cycle values spanning **23–33**; `sourceAccounting.rawLatencyDistributions` holds 48 samples with min 110.88 ms, max 147,702.6 ms, **median 72,806 ms** — the document's "111 ms–148 s, median 72.8 s" is exact, and the "(cited as ~74 s by the ticket and LLP 0190)" parenthetical is verified in both `issues/shelved/20260808-live-query-reevaluation-cost-at-scale.md` and LLP 0190's Revised header.
- The round-2 defect — claiming the receipt "paces the 48 mutations awaiting each settle" — is fully retracted. The receipt's check `open-loop-arrivals-use-fixed-nonadaptive-offsets` (PASS, offsets 0–375 ms at 25 ms steps, "no prior response is awaited to choose an arrival") and `adaptiveArrivals: false` confirm the new text: both instruments share the open-loop fixed-offset discipline; `ARRIVAL_INTERVAL_MS = 25` is verbatim in `demos/zerobugs/control/scripts/diag-hot-stream.mts` (line 34).
- The remaining lifecycle distinction is real and receipt-backed: v10's actor identity block reads "fresh per-cycle external sessions", vs the diag runs' six persistent observers (ground truth). The diag counts (676 update + 676 authorization_boundary pre-fix; 12 update post-fix; 48 dispatches per run) match the ground truth exactly.
- Crucially, the delta no longer *explains* the 521-vs-12 discrepancy ("supersession collapses a burst" / "paced workload gives supersession nothing to collapse" are gone). It declares the reconciliation open and routes it to OQ4's predeclared per-instrument frame-kind accounting. That is the correct epistemics: with different observer lifecycles and undefined frame taxonomies, neither reading is derivable from the artifacts, and the document now says so. What it does still assert — pre-fix frames were overwhelmingly redundant, and the repair eliminates delivery of stale resolutions — is fairly attributed to the closed ticket (`issues/closed/20260807-hot-cycle-live-stream-stale-at-settle.md`, RESOLVED section: 32 conflicts → 0, supersession with distinct revisions, v10 PASS 21 / GAP 3 / FAIL 0).
- The ~96 re-evaluations figure is now correctly demoted to an *unmeasured upper bound* with the missing counter named.

**Finding (b) — the current-architecture paragraph.** The rewrite correctly describes what `src/live_matcher.rs` implements on the matching side: captured row/predicate/window-boundary read sets (`live_subscription_may_be_affected`, the `@ref LLP 0020` Phase-4 header comment at line 128 says exactly "reuses captured query dependencies and keeps a conservative replace fallback"), and rung 2 is now "extend and measure, not build," with the missing match/skip/fallback observability named. This is an honest repair of the round-2 finding.

However, the rewritten paragraph's closing categorical — "The matcher can only *skip*; there is no sharing between subscribers and **no incremental maintenance of a matched result**" — overstates. The bottom third of the same cited file is the DK-3 op-log delta core (`compute_live_delta`, line 665: "Compute the op-log delta for one live subscription from a commit's changed rows, **without re-running the query**"), and it is wired into the production fan-out (`src/local.rs` `notify_live_subscriptions_in_frame` → `try_live_delta_fanout`, ~lines 23596–24010; `live_delta` wire kind in `src/live_wire.rs`; governed by LLP 0008 DK-3 and LLP 0053, both in Related). The lane is tightly scoped — `HostPlan` single-table queries only, no membership filters, no standard patterns, no ordered/limited windows, schema-derived result contracts — so it **never applies to opaque JS handlers**, which means every §1 measurement, the control's entire workload, and the 72.8 s analysis stand unchanged. It also means rung 4's decision ("scope IVM to *admitted* shapes rather than attempt generically") is *confirmed by existing precedent in the runtime* rather than being greenfield — the same extend-not-build correction round 2 applied to rung 2 applies in miniature to rung 4. No decision flips (the §1 decision already assigns "deltas" to D2, and OQ4's predeclared frame-kind accounting would surface `live_delta` frames at spike time), so I classify this minor, but it is the one sentence I would amend at acceptance.

**Other delta statements checked against artifacts:**

- §4's recount ("two of its four receipted early attempts, the WAL-strand and auth-keyring discoveries, v1–v4") — v1–v4 are all FAIL receipts; the WAL-sidecar rejection appears in v1 and v2, `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` in v4. The one-defect-per-attempt attribution follows the closed ticket's own boundary accounting. Honest repair of the previously wrong "two full receipted attempts (v1–v4)".
- §1 decision's new D4-charter caveat — verified: LLP 0183's D-table row is "D4 window controller … Headless lifecycle Spec and React projection" and §"D4 — headless windowed-query controller"; flagging that server-side evaluation scheduling is outside that charter is a genuine catch, not filler.
- §6 decision's new "an owner the current 0183 D-table does not provide" — verified: no storage/import-export workstream exists in the D1–D8 table.
- "§13 in corpus shorthand" hedge — 0183's ratified comparator/claim-language protocol exists (Stage 4 + Quality target); the hedge honestly decouples the shorthand from the document's actual numbering.
- Evidence-base header reframing (two artifact classes, traces labeled as local diagnostics) and the Convex/Firestore prior-art demotions to "external, non-load-bearing" — both correct-direction integrity improvements.

No statement in the delta misreads a receipt or trace. The single overreach found is the "no incremental maintenance" categorical above, against code, not against the measurement artifacts.

## 2. Pre-existing text

Spot-checked carried-over anchors: `raw-list-ready-timing` in `zb5-large.v3` records 1,341 ms (~1.3 s ✓); the 5,549,113-row / 6,176-batch / ~66-minute §6 figures match the closed ticket and receipts; all cited tickets exist at the cited paths (`20260807-server-sigterm-strands-large-sqlite-wal.md`, `20260808-sessions-store-copy-needs-auth-keyring-sibling.md`, `20260807-result-contract-violation-names-no-bound.md`, `20260730-auth-logical-export-import.md`, the four §3 identity tickets, both §5 tickets); LLP 0158's custody manifest with explicit `copy`/`scrub`/`rotate`/`share`/`refuse` rules is verbatim in that RFC, and §4's fork-must-not-carry-keyring reading matches 0158's load-bearing non-inheritance. The §3 trust-domain decomposition, §4's operation-specific-manifest framing, and the nonclaims section (no Zero comparison without pre-registered receipts; refusals were the platform working as designed) are sound on decision quality, evidence integrity, and trust model. No MATERIAL concern found in pre-existing text. Two minor items are in the register.

## 3. Fitness to commission

Yes. The six sections now each end in a decision an owner can execute, with the ownership gaps themselves surfaced rather than papered over (the D4-charter extension question, the §6 missing owner, the §5 W-ENUM dual routing). The five open questions are well-formed rulings: OQ1–OQ3 present real fault lines with both families' arguments; OQ4 is now a properly pre-registered measurement spike whose axes are designed to *resolve* this document's own declared discrepancy at the source — the strongest single page in the document; OQ5 gives a defensible sequencing with the genuine tail divergence named. The document's honesty discipline — labeling trace-vs-receipt provenance, declaring the 521-vs-12 reconciliation open, refusing to lean a Spec on either number — is exactly the posture a design partner should hand an author for rulings. The one caveat a ruling reader should carry is C1 below: rung 4 is slightly more "extend" and slightly less "build" than the text says, which if anything strengthens its own admitted-shapes recommendation.

## Concern register

| # | Concern | Class | Severity |
|---|---------|-------|----------|
| C1 | Current-architecture paragraph's categorical "no incremental maintenance of a matched result" contradicts the wired DK-3 `live_delta` lane in the cited file (`src/live_matcher.rs` `compute_live_delta`; `src/local.rs` `try_live_delta_fanout`; LLP 0008 DK-3). Lane is inapplicable to opaque handlers/membership-gated/windowed/standard-pattern queries, so all §1 measurements and the control's workload stand, and rung 4's admitted-shapes decision is confirmed rather than undermined — no ruling flips. Amend with one scoping clause at acceptance so the D2 owner extends rather than reinvents. | IN-DELTA | minor |
| C2 | "dispatched open-loop over 400 ms": receipt offsets span 0–375 ms (the 400 ms mark is the authority transition). Rounding inherited from the ticket's language. | IN-DELTA | minor |
| C3 | "two of its four receipted early attempts": the WAL rejection actually appears in both v1 and v2 receipts; the text follows the closed ticket's one-defect-per-attempt accounting, so "two" is defensible but arguably undercounts envelope-caused burns by one. | IN-DELTA | minor |
| C4 | Status section still cites only the round-1 review artifacts while the Revised header records rounds 1–2; stale bookkeeping once round-2/3 artifacts exist. | PRE-EXISTING | minor |
| C5 | §2's "~43-gap cluster (ZB2/ZB3/ZB4)" not independently recomputed here (LLP 0190 pins 37 GAP rows for ZB2 alone; the cross-gate sum is plausible). Implementation-phase check, no decision rests on the exact count. | PRE-EXISTING | minor |

C2–C5 are detail-only, identify no defective decision, and belong to implementation/acceptance polish. C1 is the only substantive item; it is a one-clause description fix whose correction reinforces, rather than changes, the decision it sits under, and OQ4's predeclared frame-kind accounting would expose the lane empirically regardless.

Both round-2 MATERIAL findings are repaired honestly, the delta introduces no defective decision and misreads no measurement artifact, and no MATERIAL concern exists in carried-over text.

VERDICT: READY
