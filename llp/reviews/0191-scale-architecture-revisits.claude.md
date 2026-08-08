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
