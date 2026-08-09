# Review artifact — LLP 0201, GPT family

Provenance: llp-review loop (single round), orchestrated 2026-08-08;
reviewer = Codex CLI (`codex exec`, model gpt-5.6-sol,
model_reasoning_effort=xhigh, read-only sandbox), mutually blind to
the Claude-family reviewer and to the authoring session; scope =
uncommitted working tree at base 68fbbb602 —
llp/0201-social-messenger-canonical-benchmark.plan.md (blob 5d1788da)
+ benchmarks/briefs/social-messenger.md (blob a1e7aa46), with
LLP 0197/0198, benchmarks/protocol.md, rung-matrix.md,
briefs/messaging.md, guide/capabilities.md as read-only context; not
redacted; method = shared standard prompt (scratchpad
0201-review-prompt.md), review-only, no edits permitted; 124,923
tokens. Body below is verbatim.

---

## Round 1 — 2026-08-08 — working tree at 68fbbb602 (blobs 5d1788da / a1e7aa46)

## Overall assessment

Clique is a strong benchmark concept with an unusually concrete product contract, meaningful backend-sensitive features, and good separation between authoring experience and artifact quality. It is not ready to freeze: the primary wall-clock boundary, reduced-run scoring, milestone-failure handling, and performance environment are not yet defined tightly enough to support comparative claims. Several references to the governing publication standard have also drifted.

## Strengths

- **LLP 0201 D1 and the brief’s “Global rulings.”** The explicit exclusions, media limits, conflict policy, screen inventory, and observable behavior substantially reduce incidental lane divergence.

- **LLP 0201 D3, “Independent quality gate.”** Separating builder experience from independently tested outcomes is a major improvement over self-reported benchmark quality. Trust-boundary holdouts are particularly valuable.

- **The brief’s milestone acceptance sections.** Requirements such as server-side handle uniqueness, logout invalidation, removed-member exclusion, expired edit rejection, and asset denial test real backend properties rather than UI checkbox completion.

- **LLP 0201 D6, “UI kit.”** A presentational-only kit is a sound compromise: it removes pixel-pushing cost without prescribing hooks, fetches, cursors, or subscription architecture.

- **LLP 0201 D7, “Pilot → gap-fix → freeze → scored wave.”** The separation between instrument development and scored execution is correct in principle, as is the explicit statement that the old messaging family remains frozen and lends no inherited claim.

- **The qualitative sequencing in D4.** Essay → rubric → holistic → quantitative results protects the narrative from obvious anchoring on measured numbers.

## Concerns

- **BLOCKING — D2/D3 and `benchmarks/protocol.md` “Timing”: the authoring clock has no unambiguous proof boundary.** The protocol stops the clock at “the last passing acceptance evidence,” while D3 places independent checklist execution and holdout grading after the builder ships. If grader execution is inside the clock, the headline authoring metric includes grader latency, simulator automation, and a different model family. If it is outside, the document never identifies the independent receipt that stops the clock; a builder-authored suite is not sufficient under LLP 0197 rule 8. The same ambiguity affects per-milestone “first-green” timestamps, scale replay, and the fresh M7 session. Resolve this by defining separate recorded clocks for M1–M6 authoring, M7 authoring, public acceptance execution, scale loading/probes, and hidden grading; state exactly which statistic is used in claims. Milestone green should come from an automatic neutral harness receipt, with Snapback reusing `snapback verify` as LLP 0197 requires.

- **BLOCKING — D4 and brief “Scoring”: the reduced-run total is undefined and includes many unexercised dimensions.** M1–M3 does not exercise O4 offline behavior, O5 performance, B4 offline/sync, B6 search, B7 push/actions, or B8 day-2 evolution. The brief nulls only O5. Scoring these as zero would punish scope that was never assigned; renormalizing them silently would create a different weighting; leaving them in violates LLP 0198 P0.0(e)’s rule against averaging unexercised dimensions. Resolve this with a separately frozen reduced-run applicability/weight table—or declare reduced runs ineligible for an overall L4 score—and specify null handling, denominators, cap-failure treatment, per-configuration aggregation, and the exact L4 win rule.

- **BLOCKING — D2 “Budget caps and the proceed rule”: downstream failures cannot be interpreted independently.** M2 assumes functioning identity, M4–M6 assume messaging core, and M7 assumes the complete live artifact. After an M1 or M3 cap failure, “proceed to the next milestone” usually produces dependent failures rather than useful partial credit. O1’s phrase “weighted by milestone reach” and its ~90 anchor for “every attempted milestone” are also gameable unless every full-run milestone remains in the denominator. Resolve this with a prerequisite DAG and explicit statuses such as `failed`, `blocked-by-upstream`, and `not-applicable`; either stop dependent work or define a preregistered rescue-checkpoint policy. Blocked milestones must not be counted as additional independent capability failures.

- **BLOCKING — D2 and brief “Scale envelope and performance”: the proposed cross-backend performance score is not presently comparable.** “Backend and client colocated on the run machine” cannot simultaneously describe local Snapback, hosted Convex, and potentially local or hosted Supabase. Ratio tests do not make the environment hardware-independent: deliberately slow page 1 can make page 50 pass, two points do not establish non-superlinear growth, and the 1/10-versus-full-corpus search comparison needs matched dataset states. The p95 sample size, warm-up, concurrency, cache posture, timeout, and noise policy are unspecified. Resolve this by either using an actually matched deployment posture or splitting O5 into a backend-specific scale-safety gate and a separately deferred comparative-performance claim. Freeze the sampling protocol and measure curves at several sizes, not just favorable endpoint ratios.

- **MATERIAL — Brief “Scale envelope and performance”: action-log replay does not yet guarantee equivalent state.** Fixed event timestamps conflict with replay through “normal functions/mutations” if secure application writes derive time server-side. Normal replay can also trigger 100,000 push entries, expiry jobs, receipt fan-out, and realtime work differently across lanes. Finally, spot counts do not prove semantic equality of follow edges, memberships, message distribution, or search selectivity. Resolve this with a frozen replay-adapter contract covering privileged identity, virtual time, allowed batching, side-effect policy, and whether replay cost is scored. Verify a canonical semantic digest or a broad invariant manifest, not only counts.

- **BLOCKING — Brief M4/M5: temporal deletion and revocation promises are partly impossible or contradictory as written.** A server cannot make an already cached message or asset disappear from a disconnected client “for all members within 5 minutes”; that also conflicts with offline search over previously synced messages. View-once and delete-for-everyone cannot revoke bytes a client has already copied. The “pilot-calibrated short window” and “forged timestamp-window call” also lack a safe clock-control mechanism and could reward accepting caller-supplied timestamps. Resolve this by scoping guarantees precisely: server-authoritative refusal after expiry/consumption, client purge on the next sync or local deadline, and copied bytes outside the threat model. Provide a harness-controlled server clock or privileged fixture-time seam, and define effects on local search, quoted replies, tombstones, and assets.

- **MATERIAL — D1/M7 conflicts with LLP 0198 P3’s day-2 methodology and does not necessarily force a migration.** LLP 0198 requires frozen, hashed, acceptance-equivalent starting artifacts so repeats measure evolution rather than one stochastic predecessor build. Clique instead evolves each lane’s unique M1–M6 artifact. In addition, polls can be implemented in a new table without migrating existing data, so “a schema migration with no data loss” is not enforced by the observable spec. Resolve this by distinguishing an integrated longitudinal M7 score from the canonical LLP 0198 day-2 benchmark, or use frozen accepted starts. If migration cost is intended, require an observable backfill/change to existing message records plus before/after semantic digests.

- **MATERIAL — D3 “Holdout probes” lacks preregistration custody and grader-reliability controls.** Publishing probes after the wave prevents builder exposure, but without a pre-run commitment an operator can change or select the secret set after seeing results. Rotating forms also destroy cross-wave comparability unless their difficulty is linked. “One grader per lane; panels deferred unless noise shows up” cannot reveal grader noise because no artifact is graded twice. Resolve this with a timestamped hash or encrypted commitment before the first lane, independent custody or an auditable access log, common anchor probes across waves, and duplicate blind grading of a pilot sample. Publish sanitized evidence/action traces rather than raw grader transcripts, consistent with LLP 0197’s redaction rule and LLP 0198’s “raw transcripts never publish” posture.

- **MATERIAL — Global LWW, M3 receipts, and M6 offline writes leave concurrency semantics under-specified.** Queueing stateful “toggle” operations under last-write-wins is unsafe under retry: a duplicated like or reaction can invert the intended state. The brief also does not define whether group receipt quorum uses membership at send time or current membership, how leaving/removal affects outstanding receipts, or whether newly added members receive prior history. Resolve this with idempotent set-state intents and client mutation IDs, ordered replay and retry semantics, a frozen recipient-set rule for receipts, and explicit join/leave/history visibility rules.

- **MATERIAL — M1 auth does not define a comparable or adequately safe lane contract.** “Stored only as a standard hash” permits weak constructions such as unsalted fast hashes. Snapback’s current capability index describes email-code sessions rather than password auth, while competing agents may choose built-in auth, a third-party identity service, or hand-rolled tokens; provisioning and credentials could fall inside different clocks. Resolve this by freezing eligible backend-specific recommended auth paths and their versions, defining what setup is preprovisioned, and requiring either an official provider or a named adaptive password KDF with minimum parameters. Token issuance, expiry, revocation, and API-token scope also need checklist coverage.

- **MATERIAL — M5 search does not exercise the capability claimed in D1 consistently.** The brief requires case-insensitive arbitrary substring search, while `guide/capabilities.md` advertises term, phrase, prefix, exclusion, and equality-filter search—not substring search. At the scale envelope, arbitrary substring can force full scans or a second client-side implementation and materially changes B6/O5. Resolve this by either adopting a portable normalized term/prefix contract, including Unicode normalization and pagination, or retaining substring deliberately while labeling it as a separate GAP rather than evidence for the documented text-search capability.

- **MATERIAL — D2/D5/D7 contain publication and configuration drift.** LLP 0201 cites “LLP 0197 rule 4a” for aid disclosure and “rule 4b” for capability failures, but the current LLP 0197 has neither subrule: starter disclosure is rule 10, and no success-gate rule currently defines 4b. D5 promises two scored frontier families × tier 1 × N≥3, while P5/OQ3 permit the second full-app family to be N=1 or omitted. D7 also does not explicitly preregister the counterbalanced three-backend order required by LLP 0197, and the “unpublished” pilot supplies the scored caps and ceilings. Resolve this with one configuration table defining scored versus exploratory cells, family scope, N, exact balanced schedule, cache/state posture, and stopping rules; correct or add the governing rules. Publish pilot records as clearly excluded calibration evidence when the resulting thresholds are published.

## Suggestions

- **SUGGESTION — Add deterministic offline fault injection.** Drop an acknowledgement, duplicate a replay, disconnect during settlement, and reconnect two devices out of order. This would expose substantially more than a happy-path airplane-mode test.

- **SUGGESTION — Put stable accessibility labels/test IDs in the UI kit.** That will reduce grader variance without adding a backend-shaped data interface.

- **SUGGESTION — Add frozen grader calibration artifacts.** A known-good, known-bad, and subtly authorization-broken app would make severity buckets and rubric anchors testable before scored grading.

- **SUGGESTION — Separate scale-safety from speed.** A hard correctness/resource gate plus published latency curves is more defensible than compressing correctness, replay speed, subjective “feel,” and comparative performance into O5’s eight points.

- **SUGGESTION — Recalculate program cost after the pilot using all actors.** The current 10–30M-token estimate should include M7’s fresh session, grader tokens, duplicate calibration grading, scale-seed authoring, and failed/capped lanes.

## Open questions

- Is O5 intended to support a comparative “backend A is faster” claim, or only “this generated app remains viable at the envelope”?
- Is M7 evidence for LLP 0198’s canonical day-2 claim, or an integrated full-lane experience measure unique to Clique?
- Who may inspect the active holdout set before a wave, and how will its frozen identity be proven afterward?
- Does a reduced run receive any overall rubric score, or only applicable dimensions and quantitative metrics?
- After a prerequisite milestone fails, is the desired construct independent capability testing or the realistic consequence of a broken cumulative app?

## Recommended next step

**Revise, then run another independent review round.** The app specification is close to freeze quality, but the measurement and governance contract is not yet ready for author acceptance.


---

## Round 2 — 2026-08-08 — revision (c), plan blob 62b9d7d4 / brief blob f6b4a8c7 — verdict: NOT READY

Provenance: llp-super-refine loop round 2 (loop round 1); reviewer =
Codex CLI (`codex exec --skip-git-repo-check`, model gpt-5.6-sol,
model_reasoning_effort=xhigh, read-only sandbox, cwd = capsule
0201-capsule-r2 — capsule tar sha256-16 bb633d5e666ea2d5, structurally
excludes llp/reviews/*; out-of-capsule abstinence self-attested);
instructions sha256-16 bdd074e44ffbdbe8 (delta round: IN-DELTA vs
PRE-EXISTING required; refine-not-redesign mandate; AUTHOR-DECISION
channel); mutually blind to the Claude-family reviewer; 140,037
tokens. A first launch attempt failed before any model output
(untrusted-directory refusal; recorded, not counted). Body below is
verbatim.

## Overall assessment

The reviewed hash vector (`62b9d7d4`, `f6b4a8c7`) is substantially stronger than the initial design, but it is not yet an executable, divergence-resistant instrument. Most remaining defects are in the revision delta’s timing, status, replay, holdout, and scoring contracts; one pre-existing M1 acceptance item also violates milestone ordering.

## Concerns

1. **MATERIAL — IN-DELTA — LLP 0201 D2–D3; brief “Milestones” and M1/M6/M7 acceptance.** A milestone becomes green on its first harness-executed passing acceptance suite, but the checklist contains checks that cannot run at that boundary: M1 has grader source inspection and defers token probing to M6; M6 includes a grader-written variation; M7 requires grader snapshot comparison. Meanwhile, the builder authors the scripted suite, so using it as the clock oracle is gameable and is not made neutral merely by harness execution. Define separate frozen manifests for an independently owned `authoring-green` gate and post-lane grading, assign every checklist item an executor and phase, and stop authoring clocks only on the harness-owned gate.

2. **MATERIAL — PRE-EXISTING — brief M1 acceptance item 6.** M1 requires the avatar to render beside posts and messages, which do not exist until M2 and M3. This prevents genuinely ordered first-green milestones and shifts later feature work into M1’s budget. Restrict M1 to profile rendering and move the post/message avatar assertions to M2/M3.

3. **MATERIAL — IN-DELTA — brief “Statuses and dependencies”; M6.** The status/DAG contract is not total. M6 requires only M3 but its checklist depends on M4 media/reactions and M5 view-once/search; upstream failures therefore become a second, misleading M6 capability failure. Also, if M4 and M5 fail consecutively, the lane stops while M6 remains DAG-eligible and has none of the three permitted statuses. Make M4/M5 true prerequisites for their dependent M6 checks or define conditional sub-gates, and add a non-capability `not-run-after-stop` representation plus an orthogonal run-termination reason for agent/environment aborts.

4. **MATERIAL — IN-DELTA — LLP 0201 D2/D7; brief budget table.** Scored caps depend on pilot completion figures, but no pilot safety limit or rule exists for failed/blocked pilot milestones. P3 then changes the platform, brief, kit, or harness in response to the pilot without requiring recalibration, potentially freezing thresholds from obsolete conditions. Predeclare calibration-run safety limits, require valid green measurements before freezing an affected cap, rerun affected pilots after material semantic changes, and define token caps within model-family comparison sets because token accounting is not cross-family interchangeable.

5. **MATERIAL — IN-DELTA — replay contract; M6 custom-client API.** The scale adapter is described as a thin M6 API/headless client, but the required M6 API exposes only conversations/history/text send/receive. It cannot replay real registration, posts, follows, group construction, or other action-log verbs; the starter seed also needs such a path before M6. Freeze a canonical replay-adapter action schema covering every fixture-log verb, require it to invoke the same application mutations and auth path, state when its incremental portions must exist, and define whether each action must settle before the next so authoritative replay order is reproducible.

6. **MATERIAL — IN-DELTA — M7 snapshot and scale-replay sequencing.** The M6 API does not require receipts, reactions, media digests, or a global export, yet M7 claims a backend-neutral comparison of all those facts. Its per-user, backend-native API output is not automatically a canonical snapshot. The order relative to scale replay is also unstated, so M7 may backfill the small fixture, the full 100k-message envelope, or a partially replayed database after an O5 cap. Freeze a canonical snapshot schema/export procedure, define message-count semantics—including polls, tombstones, and expired messages—and pin an isolated sequence/state so every M7 starts from the same class of pre-M7 dataset.

7. **MATERIAL — IN-DELTA — LLP 0201 D2/D4; brief O5.** O5 is called non-comparative because deployment postures differ, but its 8 points enter the comparative weighted total and its anchors use absolute replay speed, near-ceiling latency, “headroom,” and perceived feel. Recording posture does not remove that confound. Pin each backend’s resource tier and recommended posture, define a deterministic O5 mapping from the frozen scale-safety invariants, and keep posture-sensitive absolute latency and subjective feel diagnostic rather than score-bearing.

8. **MATERIAL — IN-DELTA — LLP 0201 D3.5; brief “Holdout probes.”** An unchanged anchor published after wave 1 is necessarily known to builders in wave 2, contradicting the claim that builders never see their own wave’s probes. The current text cannot simultaneously provide prompt post-wave publication, secret repeated anchors, and scored holdout status. Resolve this through the author decision below and state which evidence is claim-bearing.

9. **MATERIAL — IN-DELTA — brief global revocation semantics versus M2 feeds.** The global ruling includes unfollow in a rule saying the server refuses reads/assets after revocation, while M2 requires the same posts to remain accessible in Global. Carve unfollow out of content-access revocation: it should server-authoritatively remove entries only from the Following projection and purge that projection locally, without denying the underlying posts.

10. **MATERIAL — IN-DELTA — M1 KDF/source inspection; fixture personas and scale registration.** The grader requires no plaintext password storage “anywhere,” but both starter and scale fixture packs intentionally contain plaintext credentials. Define the explicit test-fixture exception, require those credentials to remain outside production persistence/client bundles/logs, and specify what evidence qualifies a backend’s built-in password provider without requiring inspection of unavailable provider internals.

11. **MATERIAL — IN-DELTA — LLP 0201 D3.4 grader calibration.** The noise trigger considers bucket disagreement only on a “shared finding.” One grader can completely miss a planted authorization defect—or the two graders can produce disjoint findings—without triggering escalation. Require detection and minimum-severity thresholds for planted defects, treat unmatched material findings as disagreement, and make a failing grader family ineligible until recalibrated.

12. **MATERIAL — IN-DELTA — full-run scoring and early termination.** O1 defines zero completeness credit for blocked checklists, but no rule exists for unobserved O3/O4/O5 or builder dimensions, especially B8 when M7 never runs. Nulls cannot feed a derived total under LLP 0197, while dropping failed lanes would violate all-runs reporting and create survivor bias. The full-run total and L4 eligibility therefore require the author decision below.

13. **MINOR — IN-DELTA — reduced-run scoring anchors.** Reduced O1’s 60 anchor references M4, and B5’s anchors depend heavily on M4/M5 revocation behavior even though reduced runs stop at M3. The text also does not say whether the separate holistic score is published for reduced runs. Add reduced-scope anchors and explicitly make holistic either recorded/published-but-nonclaiming or null.

14. **MINOR — IN-DELTA — search semantics.** NFC plus “case-insensitive word-prefix” still leaves case-folding and word-boundary behavior underdetermined for non-ASCII text. Either pin Unicode default case folding and a word-boundary standard or constrain the frozen corpus/probes to a stated simpler character domain.

## AUTHOR-DECISION items

### 1. Full-run totals after blocked or stopped milestones

**Problem:** Some score dimensions are unobserved, but full runs are supposed to retain partial credit and publish an overall total.

**Why it exceeds refinement:** Choosing an imputation or claim gate changes the L4 statistic and the meaning of partial credit.

Options:

- **Failure-floor scoring:** assign a frozen floor, such as zero, to dimensions made unobservable by a valid capability failure. Preserves totals and penalizes failure, but conflates “not observed” with “worst observed experience.”
- **Claim-blocking nulls:** retain nulls and make any configuration with an incomplete lane ineligible for L4 totals. Most faithful to LLP 0197, but one failed repetition blocks the scored claim.
- **Dual publication:** publish a preregistered failure-aware claim statistic plus a clearly conditional completed-lane total. Preserves information but adds complexity and must prevent the conditional view from becoming the headline.

### 2. Holdout anchors across published waves

**Problem:** Reusing an anchor preserves comparability, while publishing it destroys future blindness.

**Why it exceeds refinement:** The choice trades off holdout resistance, immediate inspectability, and cross-wave comparability.

Options:

- Make public anchors non-scored diagnostics and use only secret rotated probes for O3/O5.
- Keep anchors secret until the last wave, delaying claim publication and LLP 0197 inspectability.
- Retire anchors after publication and bridge rotations on frozen reference artifacts, preserving blindness at additional calibration cost.

The current pair has unresolved MATERIAL defects in its clock oracle, status/scoring totality, replay and snapshot contracts, holdout custody, and security wording.

VERDICT: NOT READY


---

## Round 3 — 2026-08-08 — revision (d), plan blob c34b1393 / brief blob 4463d502 — verdict: NOT READY (pre-existing clean; all MATERIAL IN-DELTA)

Provenance: llp-super-refine loop round 3, delta round; reviewer =
Codex CLI (`codex exec --skip-git-repo-check`, gpt-5.6-sol,
model_reasoning_effort=xhigh, read-only sandbox, cwd = capsule
0201-capsule-r3 — tar sha256-16 2c991ced709a5e1f, structurally
excludes llp/reviews/*; out-of-capsule abstinence self-attested);
instructions = 0201-r3-instructions.md (delta enumeration; IN-DELTA
vs PRE-EXISTING; convergence = no MATERIAL in PRE-EXISTING across
families); mutually blind to the Claude-family reviewer; 112,937
tokens. Body below is verbatim.

## Overall assessment

Revision (d) resolves much of the prior feedback, and the three author rulings are individually coherent. Their integration remains incomplete in several claim-affecting areas: green receipts, milestone states, caps, scale validation, and null-driven scoring are not yet deterministic. All MATERIAL concerns below are IN-DELTA; I found no MATERIAL concern in PRE-EXISTING text.

## Concerns

- **MATERIAL — IN-DELTA — Brief §Executors and milestone checklists.** The coverage manifest cannot reliably gate `green` because executor classes are not explicitly assigned to every atomic assertion. No checklist item is tagged `[choreo]`, several infer choreography from wording, and some items mix executor classes—for example M4 acceptance 4 combines cross-client behavior with grader-only API probing, while M7 acceptance 4 is an untagged snapshot comparison. An item-level mapping can therefore cover one clause while omitting another and still appear valid. Split compound items into stable assertion IDs, assign every assertion an explicit `suite-required`/`choreo`/`grader` class, and require the coverage manifest to map every suite-required assertion—not merely every numbered item—to a test and receipt.

- **MATERIAL — IN-DELTA — Plan D2 / Brief §Statuses and dependencies.** The new status state machine is not closed. If an agent or environment aborts while a milestone is in progress but before cap exhaustion, that milestone is neither `not-run` (“before reaching it”) nor `capability-failure` (“cap exhausted”); the attempt/null and authoring-wall rules consequently have no answer. Late dishonest-mapping reclassification can also retroactively invalidate prerequisites and the consecutive-failure termination history after downstream milestones already ran. Add an explicit attempted-abort state and define separate execution-time versus adjudicated status, including how reclassification affects clocks, prerequisites, nulls, completion, and termination without rewriting history.

- **MATERIAL — IN-DELTA — Brief §Statuses, M6, and M7 acceptance.** The revised DAG still permits inconsistent downstream execution. M6 can run after M2 fails despite requiring offline likes, and M7 can then run because it requires only M6 even though M7 acceptance 5 requires the entire M1–M6 suite to pass; this lets M7 either fail by construction or repair M2 under the day-2 budget. Freeze whether M6/M7 require all referenced earlier milestones, or make their regression assertions explicitly conditional on previously green capabilities and preserve prior failures.

- **MATERIAL — IN-DELTA — Plan D2/P2 / Brief §Budgets and cap table.** The authoritative brief contradicts itself: lines 234–238 say both wall and token caps are shared by every lane, while the plan and the later cap table make token caps family-specific. “Comparison set” is also unsuitable shorthand for cross-family wall sharing because the governing protocol defines a comparison set as using the same model. Define cap keys explicitly—such as wall cap by wave and milestone, token cap by model family and milestone—and use that definition consistently in both documents and the pilot formula.

- **MATERIAL — IN-DELTA — Brief §Scale envelope and performance / O5.** The named verification mechanics do not validate the invariant manifest they claim to validate. The manifest contains corpus-wide entity counts, per-chat counts, and follow edges, but the stated API/UI checks inspect only three chats, selected messages, and three profiles; posts, users, most chats, and most follow edges can be missing while those probes pass. Moreover, invariant-manifest failure is absent from O5’s scoring inputs, so performance could be scored on an artifact that never reached the envelope. Freeze an exhaustive or deterministically sampled verifier covering every manifest class, and make manifest conformance an explicit O5 eligibility/gating input with a pinned failure score.

- **MATERIAL — IN-DELTA — Plan D2 / Brief O5.** O5 is described as deterministic, but its 30/60/90 examples plus “interpolate” do not define an exact function across rule failures, ceiling ratios, and replay-cap margin. Inputs such as “visibly stall” and “unbounded memory growth” are themselves not mechanical predicates. Publish a complete scoring function for every input combination, measurable thresholds for each degradation rule, and clarify that raw latency values are diagnostic while their frozen ceiling predicates may affect the score.

- **MATERIAL — IN-DELTA — Plan D4 / Brief §Scoring applicability.** The null ruling lacks the full-run applicability mapping needed to decide totals and completion. Dimensions span milestones—B5 covers M1/M2/M4/M5, B1 and B9–B11 span much of the run—and the text does not say how partial exercise interacts with a later blocked milestone; it also does not specify whether unexercised O3/O4/O5 become null or failure scores. “Complete lane” is consequently undefined. Freeze a milestone/assertion-to-dimension applicability manifest with status-specific rules for every O/B dimension, then define completion directly from that manifest.

- **MINOR — IN-DELTA — Plan D3.4 grader calibration.** Calibration requires recall of every planted MATERIAL defect but does not explicitly require precision: a grader can over-report MATERIAL findings, including on the known-good artifact, and still satisfy the stated eligibility test. Make unmatched MATERIAL findings or any MATERIAL finding on the known-good artifact fail calibration unless adjudicated as a planting error.

- **MINOR — IN-DELTA — Plan P1 / Brief §Holistic.** P1’s record-schema deliverable still names only `capability-failure` and `blocked-by-M{n}`, omitting `green`, `not-run`, and termination reason; the holistic section also says to “report both” holistic and weighted totals even when the null ruling forbids a weighted total. Synchronize these residual descriptions with the new status and null rules.

The unresolved delta defects can change clocks, capability status, claim eligibility, and scores for the same run record, so the pair is not yet freeze-ready.

VERDICT: NOT READY


---

## Round 4 — 2026-08-08 — revision (e), plan blob d1fc24cb / brief blob 398dd288 — verdict: NOT READY (pre-existing clean; all MATERIAL IN-DELTA)

Provenance: llp-super-refine loop round 4, final budgeted delta round;
reviewer = Codex CLI (`codex exec --skip-git-repo-check`, gpt-5.6-sol,
model_reasoning_effort=xhigh, read-only sandbox, cwd = capsule
0201-capsule-r4 — tar sha256-16 3863da9478a5c784, structurally
excludes llp/reviews/*; out-of-capsule abstinence self-attested);
instructions = 0201-r4-instructions.md; mutually blind to the
Claude-family reviewer; 98,219 tokens. Body below is verbatim.

## Overall assessment

Revision (e) closes most round-3 issues and integrates the new status and choreography rules cleanly. However, the cap key, outcome-score applicability, and scale-manifest oracle remain materially inconsistent or gameable. All concerns below are IN-DELTA; no settled pre-existing text needs reopening.

## Concerns

- **MATERIAL — IN-DELTA — D2 / Brief “Budgets.”** Token caps are declared to be keyed by `(model family, milestone)`, but the transfer rule calculates `GPT cap(backend B, milestone)` and the brief explicitly calls these “per-backend token caps.” Both cannot govern the same run. Smallest sufficient resolution: preserve the declared key by defining backend-specific usage estimates from the transfer ratios, then take their preregistered maximum to produce one family-and-milestone cap; also state whether the 2× multiplier applies before or after transfer.

- **MATERIAL — IN-DELTA — D4 / Brief “Applicability” and O1–O5.** The universal rule that an O-dimension requires its entire observing scope green makes O1/O2 null whenever any milestone fails or is blocked, contradicting O1’s requirement that every milestone remain in its denominator and score failed checklists not-passed. It likewise makes O5 null when replay exhausts its cap or the manifest fails, contradicting O5’s explicit score of 0 for those outcomes. Smallest sufficient resolution: freeze dimension-specific predicates—O1 scores every in-scope status; O2 scores any gradeable attempted artifact; O3/O4 require M6 green; O5 scores every attempted replay, including its 0 branches—and keep complete-lane/L4 eligibility as a separate gate.

- **MATERIAL — IN-DELTA — Brief “Replay contract.”** Settle-receipt accounting establishes expected counts from acknowledged actions, not the artifact’s actual end state. Because the lane authors the replay adapter and acknowledgement path, it can drop or no-op actions while reporting success; the visible deterministic spot sample cannot make the claimed corpus-wide manifest conformance independent or ungameable. Smallest sufficient resolution: derive expectations from the log but independently observe and compare the actual corpus-wide manifest through harness-controlled reads; retain a post-build holdout sample for field-level integrity.

- **MINOR — IN-DELTA — O5 decision function.** “Ceiling margin above 50%” normally overlaps the 90 band’s “≤50% of ceiling,” and replay exactly at 50% falls into both “50–80%” and “≤50%.” Replace “margin” with observed ceiling utilization and use explicit half-open intervals, such as `>50% and ≤80%` for the 75 band.

- **MINOR — IN-DELTA — Statuses and dependencies.** M6 can have multiple failed prerequisites, but its single `blocked-by-M{n}` status does not specify which one wins. Freeze a deterministic root-cause rule or record the complete failed-prerequisite set.

The cap and applicability contradictions change stopping and scoring outcomes, while the replay oracle does not yet support its conformance claim.

VERDICT: NOT READY


---

## Loop close-out — 2026-08-08

The loop terminated at its 3-round budget (rounds 2–4). Final
verdicts bind to **revision (e)** (plan blob d1fc24cb / brief blob
398dd288): dual NOT READY, with **pre-existing text clean in both
families in rounds 3 and 4** (delta-convergence). A later revision
**(f)** (plan blob 40cd6ad8 / brief blob 90e47f39) applies the
round-4 convergent smallest-sufficient fixes and is **UNREVIEWED**.
Disposition ledger and proposed next step: super-refine final report
in the orchestrating session, 2026-08-08. Status remains Review;
acceptance is the author's call.


---

## Round 5 — 2026-08-08 — revision (f), plan blob 40cd6ad8 / brief blob 90e47f39 — verdict: NOT READY (pre-existing clean; 4 MATERIAL, all IN-DELTA)

Provenance: llp-super-refine loop round 5, author-authorized extension
(1–2 rounds granted in-session); reviewer = Codex CLI (`codex exec
--skip-git-repo-check`, gpt-5.6-sol, xhigh, read-only sandbox, cwd =
capsule 0201-capsule-r5 — tar sha256-16 eaebe35c999278ad,
structurally excludes llp/reviews/*); instructions =
0201-r5-instructions.md; mutually blind to the Claude-family
reviewer; 97,311 tokens. Body below is verbatim.

## Overall assessment

Revision (f) closes most round-4 findings, but four MATERIAL inconsistencies remain in the revised text. All are IN-DELTA; I found no PRE-EXISTING concerns and none requires revisiting an author ruling.

## Concerns

- **MATERIAL — IN-DELTA — LLP 0201 D2/D5/P2; brief “Budgets” and “Budget caps and performance ceilings.”** The token-cap schedule is neither single-valued nor total over the declared model matrix. The key is `(model family, milestone)`, yet the mid-tier Claude model receives its own mini-pilot-derived cap despite sharing the primary Claude family; Kimi and Grok receive no token-cap derivation; and the placeholder still says every cap is `2× slowest tier-1 pilot` with only one token-cap column. **Smallest sufficient resolution:** explicitly enumerate the cap-family mapping for every D5 model condition, treating the chosen mid-tier model as a distinct cap family if its own calibration is retained; assign Kimi/Grok an explicit rule; then make the generic formula wall/primary-specific and represent one token cap per cap family in the P3 table.

- **MATERIAL — IN-DELTA — LLP 0201 D3.4/D4; brief “Applicability.”** The new rules say O3/O4 score from milestone conditions and an attempted replay makes O5 never null, while D3.4 still requires every O-dimension to be null after both grading families abort. Consequently an execution-complete lane is called total/L4-eligible even when its required O scores are null. **Smallest sufficient resolution:** state once that D3.4’s no-usable-grader rule overrides O1–O5 applicability; retain the stated complete-lane enumeration as execution completeness, but require a usable grading record for a weighted total and L4 eligibility.

- **MATERIAL — IN-DELTA — brief “Replay contract — End state.”** The actual-state sample claims to cover every manifest class, but its enumerated checks cover chats/messages, conversation membership, and follows—not registered users/profiles, posts/replies, likes/reposts, memberships, reactions, or the remaining frozen action-schema classes. An adapter can therefore acknowledge but no-op large portions of the envelope without any listed actual-state check, while still reaching O5’s conformance gate. **Smallest sufficient resolution:** add hidden seeded actual-state checks for every frozen manifest/action-schema class, including posts and their dependent entities, while retaining the exact busy-chat paging check.

- **MATERIAL — IN-DELTA — LLP 0201 D2 “Separate recorded clocks”; brief “Statuses and dependencies.”** The plan correctly charges `aborted` as full wall cap plus actual tokens, but the brief says an abort charges “the exhausted axis’s” cap even though an abort occurs before either cap is exhausted. This permits incompatible published efficiency accounting. **Smallest sufficient resolution:** mirror the plan’s explicit cases in the brief: wall-exhausted capability failure = wall cap plus actual tokens; token-exhausted failure = token cap plus actual wall; `aborted` = wall cap plus actual tokens.

- **MINOR — IN-DELTA — LLP 0201 D4; brief O1.** Residual shorthand still equates an attempted milestone with `capability-failure`, and O1’s detailed paragraph enumerates only `capability-failure` and `blocked-by-M{n}`, although the governing rule includes `green`/`aborted` as attempted and every status as in-scope for O1. **Smallest sufficient resolution:** replace those shorthand enumerations with the exact revised status sets.

The remaining delta defects can change caps, charged efficiency figures, manifest conformance, and whether an overall/L4 score exists.

VERDICT: NOT READY


---

## Round 6 — 2026-08-08 — revision (g), plan blob 20713fbe / brief blob d6c79096 — verdict: NOT READY (2 MATERIAL IN-DELTA: safety-limit vs P2; O5 fixture verification)

Provenance: llp-super-refine loop round 6, final author-authorized
round; reviewer = Codex CLI (`codex exec --skip-git-repo-check`,
gpt-5.6-sol, xhigh, read-only sandbox, cwd = capsule 0201-capsule-r6
— tar sha256-16 078a2792d89bad4a, structurally excludes
llp/reviews/*); instructions = 0201-r6-instructions.md; mutually
blind to the Claude-family reviewer; 93,840 tokens. Body below is
verbatim.

## Overall assessment

Revision (g) closes the grading, applicability, status, abort-charging, and transitive-blocking issues consistently across both documents. Two in-delta measurement-contract defects remain at blobs `20713fbe` / `d6c79096`; no pre-existing concern is reopened.

## Concerns

- **MATERIAL — IN-DELTA — LLP 0201 D2/P2; brief “Budgets.”** D2 and the brief substitute the safety limit as a non-green pilot’s *figure* and then apply the 2× cap formula, yielding 8 h / 4M tokens. P2 instead says that when no pilot lane is green, the safety limit *itself* becomes the cap, yielding 4 h / 2M. This changes stopping outcomes and claim evidence. Smallest sufficient resolution: align P2 with D2—state that the safety limit substitutes as the pilot figure and the ordinary 2× formula still applies.

- **MATERIAL — IN-DELTA — brief “Scale envelope and performance.”** The new actual-state verifier does not explicitly validate several cardinalities consumed directly by O5: the 500-follow probe user, the 5-follow comparison user, and the specific 50-member receipt group. Random follow-count and membership samples can miss these fixtures, allowing performance to be scored against an underfilled workload. Smallest sufficient resolution: require exact checks of these named O5 fixtures at each relevant checkpoint before probes; mismatch is manifest nonconformance and scores O5 = 0.

- **MINOR — IN-DELTA — LLP 0201 D2; brief “Budgets.”** Kimi and Grok are said to have recorded, family-keyed advisory caps, but neither family has a token-cap derivation, and the slash wording does not explicitly make them separate cap families. Smallest sufficient resolution: enumerate Kimi and Grok separately and define their advisory token-cap value or explicitly record the token cap as inapplicable.

The unresolved MATERIALs can change milestone termination and O5 validity, so the revised unit is not ready.

VERDICT: NOT READY


---

## Loop close-out (final) — 2026-08-08

The author-authorized extension (rounds 5–6) is exhausted; this
supersedes the round-4 close-out note. **Final verdicts bind revision
(g)** (plan blob 20713fbe / brief blob d6c79096): round 6 dual
NOT READY — Claude 1 MATERIAL, Codex 2 MATERIAL, all IN-DELTA and
convergent (the safety-limit stand-in contradiction; O5 named-fixture
verification). Round 5 on (f): Claude READY / Codex NOT READY.
Pre-existing text was found clean by both families in every delta
round (3–6). **Revision (h)** (plan blob e2c65704 / brief blob
da973789) applies the round-6 convergent fixes and is **UNREVIEWED**.
Status remains Review; acceptance is the author's call.
