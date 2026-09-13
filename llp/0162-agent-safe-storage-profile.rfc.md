# LLP 0162: Agent-safe storage profile

**Type:** RFC
**Status:** Accepted
**Systems:** Storage, Runtime, Sync, Auth, Effects, Migrations, Agent experience, Diagnostics, Testing, Performance
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-03
**Revised:** 2026-08-07 (LLP 0189 re-scope: digest test coverage follows D-4 semantic-role scoping; review verdicts bind claim-relevant content per D-5; the narrow-claim row-13 lifecycle ratification is governed by D-3/D-6 while Track B row 13 itself stays the D-7 carve-out). 2026-08-07 (v0.49 — R9-2 publication-history hardening: the twelve pre-change rounds remain honestly identified as current-artifact-only legacy entries without fabricated historical digests; every later round carries a strictly increasing frozen artifact-prefix byte length and SHA-256, so later prose appends preserve old attestations while any rewrite inside a frozen prefix refuses. The current-complete-artifact digest and all existing custody rules remain in force.)
**Revised:** 2026-08-07 (v0.48 — the derived-fork publication attempt staged at `75b0ec0b4` for qualification commit `fac516e9a` surfaced a second implementation-digest self-cycle: the Rust structural test asserted that the live derived anchor was `withheld`, its carrier digest was null, and its receipt schema was v1, so an otherwise valid publication necessarily failed the digest-covered test and repairing the test necessarily moved C. The mirror now inspects the live chain without selecting a lifecycle state, exercises legacy-withheld and current-v2-published branches from synthetic fixtures, parses the anchor/carrier/receipt through closed `deny_unknown_fields` structs, and checks lifecycle-appropriate digest/schema bindings. The exact positive fork-axis serde spellings now match the lower-camel publication tuple. Independently, the test pins the LLP 0113 target-manifest tuple wholly `Missing`, retains the capability GAP, and proves the compiled derived-publication predicate false for contributor-source and public-package distributions even when a synthetic published chain qualifies structurally. Both checked-in anchors remain withheld; this implementation change requires a new qualification C and regenerated publication bindings.)
**Revised:** 2026-08-07 (v0.47 — author-directed convergence repair. The governing self-certification invariant is now explicit: an artifact may not be inside the implementation digest that certifies it, and the validator's own fixtures may not depend on live mutable records. `tests` remains covered, while both platform lifecycle receipts and the bounds-ratification record join the closed publication-cycle allowlist and remain canonical-byte- and receipt-digest-bound. The bench emitter now writes the checker's canonical JSON form. The checker attack corpus constructs synthetic review/evidence chains instead of pinning the live round list or commit. The Fable round-6 final paragraph is restored from the transcript's last write; the preserved round-7 and round-8 artifacts are reconciled without changing any verdict into four contiguous v2 histories through round 8. Rounds 4, 7, and 8 were each lost when orchestration reset review worktrees before commit and were recovered from surviving transcripts or `/tmp/review-preserve` copies. Both families record Scope 1 `READY` and Scope 2 `NOT_READY` in rounds 7 and 8. Both anchors remain withheld pending a fresh round from each family against the new qualification C, rebound platform evidence, and new named-author acceptance of the exact heads and implementation digest.)
**Revised:** 2026-08-06 (v0.46 — round-7 Fable found canonical JSON enforcement applied only to verdict sidecars, leaving every other publication-chain object exposed to duplicate-member last-wins parsing; the derived named-author acceptance could therefore visibly deny acceptance or visibly retain a six-round history while the oracle parsed approval or a fabricated round-1 restart. One closed parser boundary now enforces the invariant that no publication-chain JSON is ever read non-canonically across anchors, carriers, receipts, author acceptances, evidence fixtures, benchmark receipts, and verdict sidecars, with A4/A5 and per-artifact duplicate-member negatives. The transcript-recoverable Codex and Fable round-6 prose is restored verbatim to all four artifacts; all four sidecars are consistently chained v2 histories with rounds 1–6 and the recorded Scope-1 READY / Scope-2 NOT_READY values at `bdc682964`. `reviewArtifactSha256` is stated plainly as a current-state binding with no append-only strength of its own; the author-accepted `(roundCount, headEntrySha256)` is the sole review-history root of trust. Both anchors remain withheld pending fresh round-7 verdicts against the new qualification commit and new named-author acceptance of their exact heads.)
**Revised:** 2026-08-06 (v0.45 — the round-6 Codex adversarial review found that a complete verdict file could be deleted and restarted at round 1, and that implementation-tree v1 omitted Git mode/object type. Verdict authority is now `snapback.review-verdicts.v2`: every entry hashes the prior entry's canonical bytes, and named-author acceptance binds the exact round count and head-entry digest for all four histories, so truncation, restart, or replacement refuses relative to the accepted chain. The implementation digest is now `snapback:agent-safe-implementation-tree:v2`, hashing mode, object type, path, and bytes for every leaf and the `160000 commit` Ibex gitlink. Carrier, receipt, and author-acceptance contracts name that version explicitly; all v1 digests and artifacts that name them are stale and cannot publish. The stored v1 reviewer artifacts are preserved unmodified, both anchors remain withheld, and fresh v2 histories, a fresh qualification commit, fresh cross-family verdicts, and new named-author acceptance are required.)
**Revised:** 2026-08-06 (v0.44 — round-6 publication-oracle closure: every fork-review verdict sidecar must equal its canonical `JSON.stringify(parsed, null, 2) + "\\n"` bytes, so duplicate JSON members and every byte-level non-canonical form refuse before shape or verdict interpretation. The per-entry prose digest is explicitly a current-complete-artifact binding, not a historical as-of-round claim; restoring the four transcript-recovered round-4 sections therefore rotates all five entries in each sidecar without changing any verdict. The separate legacy storage-review Markdown path now requires exactly one occurrence of every declared field, so an appended blocking verdict cannot be shadowed by an earlier READY line; it remains a single-document compatibility path with no structured round history, and both publication anchors remain withheld.)
**Revised:** 2026-08-06 (v0.43 — the round-5 Codex adversarial review proved that v0.42's prose-verdict parser still published through four independent Markdown shapes: a verdict inside a fenced quotation, a lower-numbered historical round appended last, tab-delimited CommonMark headings hiding the actual final round, and a second conflicting Scope-1 table ignored after the first. Review authority is redesigned as four fixed-locator, exact-shape JSON verdict histories beside the still-required prose artifacts. Every entry binds its prose path and digest, family, round, reviewed commit, and typed Scope-1 or Scope-2 value; histories must be contiguous and commit-monotonic, the highest round must name qualification C, the two families must be distinct, and the verdict-file digests join the receipt and author-acceptance chain. Missing, malformed, duplicated, reordered, unknown-field, family-mismatched, commit-mismatched, or non-READY authority refuses. No prose body is parsed for authority. Both anchors remain withheld: at `b08e835f1`, both families record LLP 0163/0164/0165 READY and Scope 2 NOT READY pending this defect, so a fresh structured round at a new qualification commit is required before publication)
**Revised:** 2026-08-06 (v0.42 — the mutually blind Codex and Fable round-4 re-qualification reviews of LLP 0158 independently found two High publication-oracle defects in v0.41: an allowlisted receipt could rotate its implementation digest to P without ever matching the qualified tree at C, and the verdict parser could accept `NOT READY` or quoted READY prose as `READY`; Fable additionally found that qualification-specific commit/tree/facts/evidence literals in the in-scope Rust mirror recreated the source-digest cycle and made an honest receipt unsatisfiable. The Rust mirror now asserts only closed structural shape, publication requires committed `implementationDigestAt(C) == receipt == implementationDigestAt(P)`, author acceptance binds the receipt's implementation-tree digest, the checker reconstructs the exact candidate-facts digest, and only anchored authoritative verdict cells/statements in the final review round count; both anchors remain withheld)
**Revised:** 2026-08-06 (v0.41 — Charlie Cheever authorized narrowing the C-to-P custody rule to the exact implementation-digest scope after unrelated concurrent-session churn made the whole-repository rule unsatisfiable under AGENTS.md's fast-moving-main constraint; publication now directly compares the receipt digest with the implementation digest at P, preserving exact qualified-byte, ancestry, clean-worktree, and vendor-gitlink guarantees without asserting that out-of-scope repository bytes are unchanged; both anchors remain withheld)
**Revised:** 2026-08-06 (v0.40 — the row-13 narrowing and fork-lifecycle bound ratification for the narrow `operating.instance-forks` claim, ruled by the author 2026-08-05/06 and previously recorded only in LLP 0185, the acceptance-tail ticket, and the dated bench artifact, are transcribed into this RFC as the named revision authority; the Track B storage paired/absolute gates are unchanged and every capability remains Missing); 2026-08-06 (v0.39 — landed commit a0852be190d7a908e2419ccaac43f30eee977ee2 produced a preserved failed paired record: eight of nine comparisons and every idle gate passed, but current-range p95 crossed the unchanged faster-side equivalence edge; the absolute recorder did not run, statement caching is removed from the ordinary bounded range path to restore the pinned per-call preparation boundary, and every capability remains Missing); 2026-08-05 (v0.35 — exact C30 stopped before performance after one NOT READY review found moved Host-lease and pending-capacity projections; prospective C31 validates both globally and also closes the same client-suppression closure asymmetry while every capability remains Missing); 2026-08-05 (v0.34 — exact C29 stopped before performance after fresh review; prospective C30 closes terminal-supplement retention coherence, automatic sessions ACK custody, the public explanation oracle, direct Host terminal/pending rollback proof, and Accepted-0158 documentation drift while every capability remains Missing); 2026-08-05 (v0.33 — exact merged C28 failed fresh review before performance on automatic sessions range custody, required-null host tombstone schema, retention-time SQL/JSON coherence, and pending-writer rollback proof; prospective C29 repairs all four while every capability remains Missing); 2026-08-05 (v0.32 — exact C27 was abandoned pre-result after four identity-lifecycle defects; prospective C28 adds comparison-complete tombstones, contiguous floors, a 1,024-identity epoch cap, and transaction-side writer guards; no artifact or capability claim changes); 2026-08-05 (v0.31 — C25 was abandoned before any performance artifact after review found that strict decoding preempted ValidateRequired violation facts and the backfill exception lacked a staged-destination proof; C26 makes NonNull targets exact and rejects backfill/copy destinations not introduced by earlier AddField, with no measurement or capability claim change); 2026-08-05 (v0.30 — C21 passed exact performance but did not publish after a later target-projection/order defect; C24 validly failed only point-read p95 on the faster-side interval, the absolute gate was not run, and a prospective C25 repair now enforces LLP 0007's exact portable physical representation on every application-visible decoded row without changing the measurement contract or any capability claim); 2026-08-05 (v0.29 — prospective pre-C21 production release-layout repair recorded: the exact C20 binary's 2,359,296-byte `__TEXT` excess closely matched its RSS gap, so the shipped release profile now uses full LTO and one codegen unit to reduce cross-module duplication and fragmentation; no source route, benchmark, threshold, protocol, estimator, exception, or capability claim changes, and all capabilities remain Missing pending a new exact clean candidate); 2026-08-05 (v0.28 — C20 valid paired failure recorded: eight of nine read/write comparisons plus idle CPU and disk passed, but point-read p95 crossed the unchanged two-sided 5% equivalence edge on the faster side and idle RSS's confidence interval crossed the upper edge; the absolute gate was not run and every capability remains Missing pending a genuine prospective product repair and a new exact clean candidate); 2026-08-05 (v0.27 — C18/C19 pre-result abandonments and pre-C20 transport repair recorded: own-correctness first repaired a stale TableManifest test initializer, then the row-14 audit found that two intended public identity protocol refusals projected as HTTP 500 and lacked served-route negatives; their stable codes are now deliberately classified as 400 and the exact transport refusals are exercised before handler execution. No performance artifact or capability claim was produced, and every capability remains Missing pending a new exact clean candidate); 2026-08-05 (v0.26 — C17 valid paired failure recorded: thin LTO cleared the unchanged idle CPU, disk, and RSS gates, eight of nine read/write comparisons passed, point-read p95 alone exceeded the unchanged 5% equivalence interval, the absolute gate was not run, and every capability remains Missing pending a new exact post-mainline candidate); 2026-08-05 (v0.25 — C16 pre-result abandonment after the required post-commit fetch found newer origin/main; the additive demo-only mainline was merged normally, no performance artifact was produced, and every capability remains Missing pending a new exact candidate); 2026-08-05 (v0.24 — C15 valid paired failure and prospective pre-C16 production release-layout correction recorded in the dated body; all nine read/write comparisons plus idle CPU and disk passed, idle RSS alone exceeded the unchanged 5% interval edge, the absolute gate was not run, and every capability remains Missing); 2026-08-05 (v0.23 — C14 valid paired failure and prospective pre-C15 pay-for-play checkpoint/erasure infrastructure correction recorded in the dated body; all nine read/write comparisons plus idle CPU and disk passed, idle RSS alone exceeded the unchanged 5% interval edge, the absolute gate was not run, and every capability remains Missing); 2026-08-05 (v0.22 — C11/C12 pre-result abandonments, C13 valid paired failure, and prospective pre-C14 production query/custody correction recorded in the dated body; every capability remains Missing and a new exact clean candidate must rerun the unchanged gates); 2026-08-04 (v0.21 — seventh fixed-Air candidate failure and prospective pre-C10 precision/product-memory repair: exact candidate `eae262bd91fee6bfed6ae77ddd40af22dd10c8b6` failed point-read p95, query-plan p50/p95, and RSS under the unchanged v2 gate; artifact and exact metrics are recorded in the dated body, and the absolute gate was not run. The v3 recorder retains three mirrored, time-local subpairs inside each of the unchanged 11 outer pairs, reduces each outer metric by the median of its three raw paired regressions, and applies the same 20,000-sample bootstrap only to those 11 outer values; thresholds, baseline, and effective sample count stay unchanged, while all raw observations remain independently checkable and idle CPU/disk remain conservative over every raw candidate. Empty databases defer protected-detail key minting until first use while retained ciphertext still authenticates at boot. No result, exception, or capability claim is made before a new exact candidate reruns every gate); 2026-08-04 (v0.20 — sixth fixed-Air candidate failure and pre-C9 repair: exact candidate `f34fdb41ef603d07f6720685728a28a1b18d3fa7` passed eight of nine read/write comparisons plus idle CPU and disk, but point-read p95's two-sided interval was 0.805 percentage points beyond the unchanged lower equivalence edge and RSS's interval was 0.160 percentage points beyond its upper edge; see the dated body record. Point hits now fail closed unless the decoded opaque string id exactly equals the requested id. No benchmark, threshold, protocol, estimator, exception, or claim changed); 2026-08-04 (v0.19 — fifth fixed-Air candidate failure and pre-C8 repair: see the dated body record for the exact commit, artifact, and metrics; read caching is narrowed and TEMP-table custody is replaced by direct-only in-connection crypto whose zeroizing root key never crosses SQL; thresholds, protocol, and claims remain unchanged); 2026-08-04 (v0.18 — fourth fixed-Air measurement repair: clean candidate `ba00491f29c6db76f6fb0a2b1723b7bc44bcdf44` produced a preserved failed paired record, SHA-256 `debd40d041d853e869faeb09823e092f9561ccd610ed76f43b0dab905360e20c`. Seven of nine read/write comparisons plus idle CPU and disk passed; point-read p95 failed the unchanged 5% equivalence band at median 2.4291% with bootstrap interval -1.1443–8.0552%, query-plan-read p95 failed at median 1.9324% with interval 0.1568–5.1517%, and RSS failed at median 5.3365% with interval 4.8413–5.6836%. No exception is ratified and the absolute gate was not run. The production current-read hot paths now use the existing connection statement cache while armed writer connections retain capacity zero and therefore re-run the fail-closed authorizer on every prepare. The rare real manifest-activation cut now asks the macOS allocator to return unused setup pages after SQLite cache relief without dropping the live manifest, issued range, connection, or authorizer. Direct Host-incarnation crash/reopen and served explanation/projection fixtures close two compositional proof gaps. No threshold, protocol, estimator, or capability claim changed; a new exact clean candidate must rerun every original gate); 2026-08-04 (v0.17 — third failed-candidate product-memory repair: clean fixed-Air candidate `1364781e48c35686eb0c89b543a7ab9287de2f01` passed all nine read/write comparisons plus idle CPU and disk, but preserved record SHA-256 `2856a1eb3fd2081d49f551e8458a687146f365eece521a835656620190ca9abd` honestly failed the unchanged 5% RSS bound at median 5.2108% and bootstrap interval 4.9324–5.8917%; no exception is ratified. The shared production manifest-arming seam now requests SQLite to release unused connection memory after the rare activation/validation transaction and before installing the same connection-local fail-closed authorizer; only a new fixed-Air run can establish its RSS effect; the durable manifest, same armed connection, and issued range remain live. No threshold, protocol, estimator, or claim changed. A new exact clean candidate must rerun every original gate); 2026-08-04 (v0.16 — second failed-candidate repair: clean fixed-Air candidate `949db8be40e43cdbd7449a58b70550f6e18d2098` passed all nine read/write comparisons plus idle CPU and disk, but its preserved paired record, SHA-256 `29be1887ef5d5a85d14c909f8e68b6686e132907a818b1f2a217174d4ee86032`, honestly failed the unchanged 5% RSS equivalence bound (median 5.88%, bootstrap 5.41–6.40%). The paired candidate worker now measures active read/write costs in its parent and active idle state in a fresh child process whose preceding allocation/code footprint is the dormant comparator workload; the child then activates and retains the real armed storage connection and issued range across the window. This per-metric fixture separation removes transient active-write setup from the otherwise-idle RSS metric without changing any bound, estimator, product behavior, or claim. A third exact clean candidate must rerun every original gate); 2026-08-04 (v0.15 — post-failure measurement repair: fixed-Air candidate `e6412b9b24887322d0fdb07bdd65b8e8bd86edbf` produced and preserves a failed paired record, SHA-256 `24ff252962d3f12b17c8dbb883c2a9f9052ea2b6d0413b5573681e2d8917798a`; no bound, exception, or claim changed. The candidate idle fixture now consumes the real activated carrier into its same armed `LocalDatabase`, dropping and joining unrelated telemetry setup before the five-second window while retaining the durable coverage manifest and server-issued range. The dormant SQLite writer authorizer is installed only at activation/reopen of an active manifest, removing its pre-capability statement-prepare tax without weakening the active cut. The paired semantic checker now maps camelCase comparison identities to Rust's snake_case raw report keys. A new exact clean candidate must pass every original gate before publication); 2026-08-04 (v0.14 — pre-freeze publication-authority repair: the canonical proof now runs the P-vs-C history checker and its adversarial suite; published evidence is parsed semantically for the exact clean candidate, passed paired/absolute thresholds, Acceptance rows 1–4/13/14, two distinct `READY` review families, named-author acceptance, and explicit broader/derived `Missing` scope. Contributor-source authority independently requires a clean root, the exact checked-out clean `vendor/ibex` gitlink, and the implementation digest, regardless of general build-identity overrides. The derived-deployment chain is structurally non-publishable until a distinct end-to-end F0b performance contract lands. Every anchor remains withheld before results); 2026-08-04 (v0.13 — **contention bound corrected and ratified by Charlie before the final fixed-Air run**, under the user's explicit acceptance instruction: the production v1 policy is precisely a 1,000-ms head-reservation interval and a separate 500-ms maximum promotion-commit duration, not a 500-ms reservation. The fixed 128-sample/eight-writer active-carrier request-to-COMMIT p99 ceiling is therefore 1,250,000 µs. This pre-result correction preserves the reviewed production policy, permits 250 ms beyond its intentional reservation interval for the real envelope-bearing writer and SQLite commit tail, supersedes v0.12's mistaken 500-ms/750,000-µs pairing, and leaves every capability `Missing` until the actual run and applicable correctness gates pass); 2026-08-04 (v0.12 — **absolute performance bounds ratified by Charlie** before the final Track B fixed-Air run: on the recorded 512-row/one-change fixture, median ceilings are 1,000 µs fork creation, 2,500 µs exact diff, 7,500 µs strict promotion, and 250 µs TTL reap; ordinary-writer request-to-COMMIT p99 behind the frozen 500-ms production reservation is at most 750,000 µs. These fail-closed ceilings are informed by the preserved 2026-08-03 integrated record but fixed independently of the final candidate result; capability state remains `Missing` until every applicable gate passes); 2026-08-03 (v0.11 — sequencing gates recorded: the dated step-0 pre-profile baseline fixes hardware, fixtures, warm-up, run count, median/MAD, formulas, and bounds; OQ13's reproducible spike proves a held source snapshot but no intrinsic database-size WAL bound, narrowing LLP 0165 to budgeted pin or stable refusal; capability rows remain `Missing`); 2026-08-03 (v0.10 — post-acceptance scoped-review repairs from the combined light round (artifacts `llp/reviews/0163-0165-extraction.{fable,codex}.md`): host-originator reclamation predicate added (terminal-receipt-plus-declared-window; range-less host epochs close on incarnation rotation) with an Acceptance 14 leg; §8 provenance table rebuilt contiguous with Accepted/Draft ownership split; reservation-quota sufficiency added to the declared fairness terms; the legacy 0097 projection made total; protected-lane custody assigned to LLP 0163; tombstone bound recorded); 2026-08-03 (v0.9 — **Accepted by Charlie** after the seven-round super-refine loop (see `llp/reviews/0162-agent-safe-storage-profile.super-refine.md`), with three author decisions applied: OQ11 decided — an agent principal holding an LLP 0055 scoped grant may approve a `PromotionRequestV1`; OQ14 executed — the identity/envelope, fork/promotion, and proof/checkpoint contracts are extracted to LLP 0163/0164/0165 with this RFC as the profile umbrella; the commissioned dated amendments landed in LLP 0097, 0133, 0043, 0012, and 0095. Acceptance changes the document's status only: every capability remains `Missing` until the acceptance corpus passes (§Summary claim boundary), and the step-0 baseline artifact, the OQ13 snapshot-pinning spike, and LLP 0163-0165's own acceptance still gate advertisement); 2026-08-03 (v0.8 — final targeted repair from the seventh, delta-scoped cross-family round (repairs unreviewed; the loop closed at the declared stopping rule): re-seal widened to the full approved-facts digest (reads, ctx answers, decision/result facts, writes, effects, coverage) with the original approval preserved and re-seal as a separately identified engine attestation; identity tombstones retained until the epoch floor passes, closing the two-identity/same-epoch hole, with `result-expired`-before-`identity-horizon-passed` lookup precedence; journal completeness re-founded on an enforceable write-authority choke point (generated transaction API + SQLite authorizer) with an honest enumerated-fixture fallback class; post-expiry aggregate explanation gets `authorization-unprovable` fail-closed; promotion durably copies replay-log envelope facts into canonical; the aggregate promotion identity pinned to the rebase-invariant admission ticket; head reservation quotaed with a p99 contention metric and TTL-sufficiency condition; 0158 sentinel + intra-state crash matrix imported into Acceptance 12 with the registry-authority deviation declared; effect facts split into egress-family and 0066 settlement-capability axes; offline range exhaustion dispositioned; `verifiedCopyFidelity` named as its own proof class; per-component performance gating clarified; legacy `Missing` projection rationale recorded); 2026-08-03 (v0.7 — sixth cross-family review round applied: `PromotionRequestV1` re-seals automatically across rebase when re-execution reproduces the approved facts; promotion's admissible identity unified on the aggregate (per-source identities demoted to non-admissible write-fact-granularity provenance joins, Acceptance 3 carved); liveness weakened to declared conditional fairness with a bounded head-reservation escalation and ticket-lifetime/budget terms; offline minting closed via server-preallocated authenticated finite identity ranges; epoch closure defined on acknowledgement with the crashed-client wedge stated; the `result-expired` middle-regime disposition named and amended; checkpoint claims re-scoped to verified copy fidelity with 0158's publication state machine imported and the snapshot-pinning spike named; journal completeness given a closed write-path-registry derivation; the non-row authorization rule owned here; derived-deployment fork support moved out of core into a 0158-gated additive capability; `Promotable(noEffects)` named as a strictly narrower claim with a conservative legacy projection; index costs split; OQ4 authority corrected); 2026-08-03 (v0.6 — fifth cross-family review round applied: identity keyspace partitioned by originator class with server-authenticated host derivations (squatting foreclosed); envelope compact identity given a bounded retention clock independent of the resume floor and journal prune, with asymmetric-join dispositions; non-row authorization dropped to LLP 0088's current-policy rule with the residual named; `DenyAll` records a bounded payload-free attempt marker so no-egress promotion is provable; `PromotionRequestV1` seals the reviewed branch head and promotion commits one canonical transaction with an aggregate envelope; epoch issuance server-recorded so closure sees minted-not-just-admitted identities; §8 provenance claim replaced by a per-component owner/status table and the 0097 amendment scope widened to every touched section; FIFO admission tickets held across rebase with a concurrency-scaled budget and progress fixture; pins made finite renewable leases; exception authority corrected to dated author ratification with a hard ceiling; bounded envelope enumeration added; per-class credential acceptance; sequencing step-3(a)/5(a) duplication fixed); 2026-08-03 (v0.5 — fourth cross-family review round applied: audience decided to be a bound compared fact, not a key component (LLP 0133's collision rule preserved; key = stream-qualified operation identity, promotion identities derived from the globally non-reusable `childStreamId`); the epoch floor given an issuer/closure/advancement protocol that cannot strand in-flight identities; a dated proposed-normative amendment to LLP 0097 §Capability classes declared for the axis split and `DenyAll`; promotion contention answered with serialized admission and a bounded rebase budget; checkpoint dual-path proof pinned to one source snapshot; non-row fact authorization made current-plus-captured; the core tier's per-version rule owned by this RFC; aggregate membership and performance thresholds closed with LLP 0130 as exception authority; sequencing gains a baseline step 0 and splits mediation from capture-ledger work); 2026-08-03 (v0.4 — third cross-family review round applied: envelope/suppression identity stream-qualified with branch-local namespaces and deterministic promotion re-mint; suppression reclamation restricted to acknowledged receipts plus an epoch-bearing anti-replay floor, `identity-horizon-passed` reclassified as outcome-unknown; per-fact-class authorization for non-row explanation facts; fork capability split into orthogonal axes (egress/promotion/base/isolation) with no-egress `DenyAll` branches promotable; `AgentSafeV1` layered into a core aggregate, an app-effective conformance fact, and a history tier gated on LLP 0088; checkpoint dual-path proof derivation and erasure/custody protocol; measurement gate scoped per component against the dated baseline; rebase-by-replay affordance; uncovered-lane co-writes make a branch non-promotable); 2026-08-03 (v0.3 — second cross-family review round applied: `operationId` defined as the shipped `ClientMutationIdentity` widened (LLP 0133's extend-don't-ride-beside discipline) with per-originator identity sources and a bounded suppression lifecycle after LLP 0043's settlement pattern; LLP 0088 §6's per-post-image authorization rule imported verbatim with elision fixtures; the diff surface split into attributed change sequence versus net state diff with first-write-preimage/immutable-base requirement and canonical folding; deny-all egress renamed `DenyAll` (CaptureOnly reserved for 0097's ledger-backed meaning); "covered" given a definition; §8 given a base-class axis, a manifest-extension relationship to LLP 0134, and a closed v1 aggregate matrix; performance gate re-founded on a dated statistically controlled baseline artifact; `branches::promote` reframed as a deviation from Accepted LLP 0097 and ticketed there); 2026-08-03 (v0.2 — first cross-family review round applied: envelope keyed by operation identity with the commit version demoted to a stream-qualified snapshot association; the promotable fork class pinned to LLP 0097's in-app branch, with LLP 0158 derived-deployment forks capture-only; named checkpoints split into materialized and receipt-only substrate classes; per-fact read-set provenance discriminators per LLP 0007/0133/0146; LLP 0088's history invariants imported normatively; replay-sufficient promotion record required and the landed post-image `branches::promote` path marked superseded; capability claims routed through LLP 0134; commissioning authorities and amendment ownership named)
**Qualification amendment (2026-08-05, v0.22):** The C11 and C12
pre-result abandonments and C13's valid failed paired result are recorded
below. Generic current-query execution returns to ordinary per-call
preparation, and empty stores retain no protected-detail function or custody
mutex until their first real protected seal. No benchmark, baseline, bound,
protocol, estimator, exception, or capability claim changes.

**Qualification amendment (2026-08-05, v0.36):** Exact clean C31 was
abandoned before review results or performance when the mandatory fetch found
newer main. C32 retains the repair after a normal, regenerated merge; every
capability remains `Missing` pending fresh exact review and the unchanged
performance/publication gates.

**Qualification amendment (2026-08-05, v0.37):** C32 was abandoned before a
qualifying dual review completed and before performance when the mandatory
remote-tip check found two newer mainline cuts. Both were merged normally as
`cc5d6bce64550210d7b55b929841a8f9af8f2f68` and
`211f85714cdac7abdf4022b77cb08bce4419a35c`; the combined guide/generated
closures were regenerated, the C-frozen generated-leaf checker was corrected
from 208 to the actual 224 leaves, and C33 is the next prospective exact clean
candidate. No C32 review artifact or performance result qualifies publication,
and every capability remains `Missing`.

**Qualification amendment (2026-08-06, v0.38):** Exact clean C33 commit
`60637db377a681ff1f22cbe19f7b49b96b20ab9f`, implementation digest
`sha256:40789d24edf34b3a9cb9544e94e47337d5beb35ef065d290e19bcc67e610010d`,
and Ibex gitlink `4c34c831aa087d6783b0d68f281cdb374ed7fc89` received two fresh,
mutually blind `READY` verdicts. The 2026-08-06 author ruling in
`issues/shelved/20260803-0163-public-operation-identity-carrier.md` supersedes the
earlier HEAD-chasing interpretation: newer mainline cuts are normal
conflict-resolving merges that preserve C33's review authority, not review
invalidation and not new C-numbers. The merged tree lands first, receives
proportional build/test verification, and then runs the unchanged paired and
conditional absolute row-13 protocol against the landed commit. Every
capability remains `Missing` until that post-landing result and all other
named gates pass.

**Qualification amendment (2026-08-06, v0.39):** Landed commit
`a0852be190d7a908e2419ccaac43f30eee977ee2` produced a valid failed paired
record with SHA-256
`8e1f6a4cbbe786eb4eba71c8dc435457331d87446dd26a39a80314a4c6272ab0`.
Eight of nine read/write comparisons and every idle CPU, RSS, output-block,
and database-family-byte gate passed. Current-range p95 alone crossed the
unchanged two-sided five-percent equivalence band on the faster side: paired
median -4.1812%, deterministic-bootstrap 90% interval -5.9841% to -1.4621%.
The absolute recorder did not run, no exception is ratified, and every
capability remains `Missing`.

The bounded current-range path still cached its prepared statement even
though the pinned pre-profile comparator prepares it per call. The
post-failure fix-forward restores that ordinary product path to per-call
preparation. It does not change the benchmark, baseline, bound, protocol,
estimator, bootstrap population, active storage carrier, or capability claim.
A new landed successor must pass the original paired and conditional absolute
gates before publication.

**Qualification amendment (2026-08-05, v0.23):** C14's valid failed paired
result and the prospective pre-C15 production correction are recorded below.
Ordinary storage keeps history infrastructure eager but pays for the separate
checkpoint/erasure authority family only at its first owning operation. No
benchmark, baseline, bound, protocol, estimator, exception, or capability
claim changes.

**Qualification amendment (2026-08-05, v0.24):** C15's valid failed paired
result and the prospective pre-C16 production release-layout correction are
recorded below. Release binaries use thin LTO across the production dependency
graph; the measurement worker, baseline, bound, protocol, estimator, and
bootstrap population do not change. No exception or capability claim is made.

**Qualification amendment (2026-08-05, v0.25):** C16's pre-result
abandonment is recorded below. The required post-commit fetch found a newer
`origin/main`; its additive demo/diary/ticket changes were merged normally and
without conflict. No performance artifact, exception, or capability claim was
made for C16. A new exact post-merge candidate must rerun every unchanged gate.

**Qualification amendment (2026-08-05, v0.26):** C17's valid failed paired
result is recorded below. Thin LTO cleared the unchanged idle CPU, disk, and
RSS gates. Eight of nine read/write comparisons passed; point-read p95 alone
missed the unchanged two-sided 5% equivalence interval. No benchmark,
baseline, bound, protocol, estimator, exception, or capability claim changes.
The absolute recorder was not run. A newer additive `origin/main` found after
the run must be merged before another exact candidate reruns every unchanged
gate.

**Qualification amendment (2026-08-05, v0.27):** C18 and C19's pre-result
own-correctness abandonments and the prospective pre-C20 transport repair are
recorded below. The two client mutation identity-shape refusals now have a
deliberate HTTP 400 classification and a served-route negative fixture. No
benchmark, baseline, bound, protocol, estimator, exception, or capability
claim changes. No performance artifact was produced for either abandoned
candidate. A new exact clean candidate must rerun every unchanged gate.

**Qualification amendment (2026-08-05, v0.28):** C20's valid failed paired
record is preserved below. Eight of nine read/write comparisons and the idle
CPU and disk gates passed. Point-read p95 crossed the unchanged two-sided
equivalence interval on the faster side, while idle RSS's interval crossed the
upper edge. The absolute recorder was not run. No bound, protocol, estimator,
exception, or capability claim changes; a genuine prospective product repair
and a new exact clean candidate must rerun every unchanged gate.

**Qualification amendment (2026-08-05, v0.29):** The prospective pre-C21
production repair changes the repository's shipped release layout from thin
LTO to full LTO with one codegen unit. This targets the measured executable-page
excess without changing source behavior, the measurement worker, baseline,
bound, protocol, estimator, bootstrap population, exception posture, or any
capability claim. A new exact clean candidate must rerun every unchanged gate.

**Qualification amendment (2026-08-05, v0.30):** C21's exact paired and
absolute performance records passed, but its later publication replay exposed
a target-projection/order defect and therefore did not authorize publication.
C24's newer exact candidate passed own-correctness and eight of nine paired
comparisons plus every idle gate, but validly failed point-read p95 on the
faster side; the absolute recorder was not run. A post-result source and binary
audit found no point-read regression or supported slowdown. The prospective
pre-C25 repair instead closes an independently demonstrated LLP 0007 reader
contract hole: every application-visible row actually decoded now refuses a
declared portable field whose SQLite storage class, domain, or UTF-8
representation is not the one asserted by the writer. The migration executor's
closed-barrier backfill may still decode `NULL` for its one exact newly added
required destination field before publication; every other field remains
strict. The repair changes no benchmark, baseline, bound, protocol, estimator,
bootstrap population, exception posture, or capability claim. A new exact
clean candidate must rerun every unchanged gate.

**Qualification amendment (2026-08-05, v0.31):** C25 was abandoned before a
performance artifact was produced after the post-commit review found five
connected closed-barrier lifecycle defects: `ValidateRequired` could no longer
count and report its exact target `NULL` values; a resealed plan could aim the
backfill decoder exception at an existing required field; a plan could write
again after consuming the requiredness proof; and manifest absence could
re-adopt a logically retired physical column's old bytes. A follow-up resume
audit also found that terminal replay adopted caller-supplied successor schema
bytes before checking their plan identity. The prospective C26
repair makes NonNull validation observe only its admitted target NULLs while
every unrelated field remains strict, makes requiredness a sealed ordered
state machine, limits in-place backfill/copy to a prior `AddField`, and refuses
a physically pre-existing AddField destination on fresh admission while
requiring an exact committed AddField journal proof on resume; every terminal
replay verifies the successor identity before adoption. No benchmark, baseline,
bound, protocol, estimator, bootstrap population, exception posture, or
capability claim changes. Every capability remains `Missing`; a new exact
clean candidate must rerun every unchanged own-correctness and performance
gate.

**Pre-qualification repair (2026-08-04):** Candidate
`e12e2f9f94e84bed71b9b5630f5ce56e9544de90` was frozen but deliberately not
performance-qualified after the canonical proof audit found that its
adversarial fixtures copied the live publication records. That would make the
proof self-contradictory after an honest P transition: tests intended to inspect
frozen-C withheld records would instead inspect P's published bytes. The
fixtures now read both records from the storage carrier's immutable
qualification commit (or `HEAD` while still at C), the live checker independently
validates the checked-out P state, and a published storage record must name a
strictly earlier C. No performance artifact was created for the abandoned
candidate; no threshold, protocol, estimator, or claim changed. A new exact
clean candidate must rerun every original gate.

Candidate `86a43eacc6aaaf4b7af23d619eaf6b52dbbda138` contained that
repair and passed the clean withheld-state checker, but it likewise produced no
performance artifact: the immediately preceding fetch found newer
`origin/main` that was not its ancestor. The lane therefore integrates and
reconciles that mainline before freezing the next candidate, so no post-C source
merge can evade the publication history guard.

**Fifth fixed-Air failed candidate and product repair — 2026-08-04:** Clean
candidate `3ea2fdc6c4e8a29b6424e7821a9391b8668fbeb0` produced a preserved failed
paired record with SHA-256
`50b31b07abf9ef9f2e176df65970e7795341af5428e0e8abafc81082aaa5b79c`.
All mutation comparisons plus idle CPU and disk passed, but the five newly
cached read statements made point reads about 52% faster and pushed range/query
intervals outside the unchanged two-sided 5% equivalence band; idle RSS
independently failed at median 5.3280% with interval 4.8413–5.8566%. No
exception is ratified and the absolute gate was not run. The shared version
read, point read, and range count return to their pre-profile preparation
behavior while only the bounded range-page and generated-query shapes retain
caching. The operation-detail key leaves its one-row SQLite TEMP database for
an equally connection-local direct-only crypto function whose captured root
key zeroizes on connection drop and never crosses SQL, removing a live pager
without changing
sidecar validation, ciphertext, transactionality, the active manifest, or
custody access. No threshold, protocol, estimator, or capability claim changed;
a new exact clean candidate must rerun every original gate.

**Sixth fixed-Air failed candidate and product repair — 2026-08-04:** Clean
candidate `f34fdb41ef603d07f6720685728a28a1b18d3fa7` produced a preserved failed
paired record with SHA-256
`7e8c7c8f6dd8d8400dbc507a269b56d000c4857ac41144e73bb3eefc6ea0b487`.
Eight of nine read/write comparisons plus idle CPU, output-block, and
database-family-byte gates passed. Point-read p95 missed the unchanged
two-sided 5% equivalence band: paired median -2.4002%, deterministic-bootstrap
90% interval -5.8052–1.1575%, or 0.8052 percentage points beyond the lower
edge. Idle RSS independently missed the same unchanged equivalence band at
median 4.4497% and interval 2.5662–5.1600%, or 0.1600 percentage points beyond
the upper edge. Neither marginal miss is an authorized exception. The absolute
recorder was therefore not run.

The pre-profile source, this candidate, and an earlier read-passing candidate
have the same uncached point-read and version-read implementation. The repaired
product boundary adds one fail-closed invariant: a point hit returns only when
its decoded `_id` is a string exactly equal to the requested opaque id. This
implements LLP 0007's representation/equality rule at the point-read boundary;
it is not benchmark-only work. No benchmark source, bound, estimator, protocol,
exception, or capability claim changes. A new exact clean candidate must rerun
every original paired and absolute gate.

**Seventh fixed-Air failed candidate and prospective v3 repair — 2026-08-04:**
Clean candidate `eae262bd91fee6bfed6ae77ddd40af22dd10c8b6` produced a preserved
failed paired record with SHA-256
`aafbfbbac1e15a18c3cf318611d346ad06bd61f65415347d52f8c365ed04bcea`.
Point-read p95 failed at median 1.2588% with interval -1.1857–8.7609%; two of
the 11 candidate p95 observations were isolated 21.57% and 55.17% paired
outliers. Query-plan p50 failed at median -4.0758% and interval
-5.6804–-2.9851%, and query-plan p95 failed at median -4.4992% and interval
-7.4237–-0.0039%. Idle RSS independently failed at median 5.1970% and interval
4.7977–5.4553%. Mutation, point p50, range, idle CPU, output-block, and
database-family-byte gates passed. No exception is ratified and the absolute
recorder was not run.

The C8/C9 raw observations show that one 60-operation worker report per outer
pair is too quantized and scheduler-sensitive for the registered microsecond
read equivalence claim. Before any new result, paired schema v3 therefore keeps
the same 11 independent outer pairs, thresholds, baseline bytes, 20,000-sample
deterministic bootstrap, and effective sample count, but retains three full
time-local subpairs inside each outer pair. Even pairs use `AB, BA, AB`; odd
pairs use `BA, AB, BA`. Each outer threshold value is the median of its three
raw paired regressions, and only those 11 values enter the unchanged outer
bootstrap. The checker independently recomputes both levels from all retained
raw reports. Idle CPU and disk remain conservative over every raw candidate
observation, so the inner median cannot hide background work or a write.

This prospective precision repair cannot excuse C9's narrow but repeated
~2-MiB RSS excess. Empty databases also stop eagerly minting and touching a
protected-detail root key/sidecar: the direct-only connection function remains
the custody boundary, first protected use atomically publishes and
directory-syncs its zeroizing-key sidecar before ciphertext may commit, and
retained ciphertext still requires and authenticates its sidecar at boot. This
is a production lifecycle/memory repair, not an idle-fixture reset. A new exact
clean candidate must rerun the complete paired and absolute protocols, and all
capabilities remain `Missing` until it passes.

**Eighth fixed-Air failed candidate and prospective pre-C14 product repair —
2026-08-05:** Candidate
`ced86eff72fb2d406d9aa0bafdbe3a9b1aaf8bf3` (C11) was abandoned before a
result after own-correctness found incomplete derived-fork custody for
operation-authority tables. Its paired process was terminated and produced no
output artifact, so C11 is not a performance failure. Candidate
`b9a6630d37ea87f642a630f0a4cff1dcd5f464ae` (C12) contained that custody
repair but was superseded before qualification when a fetch found newer
`origin/main`; it also produced no measurement artifact.

Exact clean candidate `0e4968ea54f00f111c55cc3a434d5e465dcb463e`
(C13) produced the valid paired-v3 artifact whose frozen identity and internal
date remain `agent-safe-active-covered-paired-2026-08-04` and `2026-08-04`.
The run completed at 2026-08-05 05:35 local time. The artifact SHA-256 is
`75246591a2da266d20a2bd4ffb05599451b1fc67b2062e625db34daee4ed99dd` and
the candidate executable SHA-256 is
`3238f8cbf90633de97d4acc87b621699732bebdfd24bbce5f7a4e2e8a9e043e2`.
Seven of nine read/write comparisons passed. Query-plan p50 failed at median
-4.2859% with deterministic-bootstrap 90% interval -5.0093%–-3.6138%, and
query-plan p95 failed at median -4.3549% with interval
-5.5492%–-3.4036%. Idle RSS independently failed at median 4.9881% with
interval 4.6172%–5.1984%. Idle CPU and disk passed. The absolute recorder was
not run. C13 therefore does not pass Acceptance 13, authorize acceptance of
LLP 0163–0165, or advertise any capability. The repeated query/RSS shape was
already present in C9, and the C12-to-C13 mainline merge changed neither
`crates/snapback/src/bench.rs` nor `crates/snapback/src/storage.rs`, so the evidence does not attribute the
failure to newer mainline.

The prospective production correction returns generic current-query execution
from connection-retained prepared statements to ordinary per-call preparation,
matching the pre-profile lifecycle. Empty stores retain no protected-detail
function or custody mutex; the first real protected seal installs the same
connection-local `DIRECTONLY` carrier, while existing ciphertext still
requires, authenticates, and installs its sidecar at boot. These are
production-wide lifecycle and memory corrections, not evidence-fixture
switches. No bound, protocol, estimator, bootstrap population, exception, or
capability claim changed. A new exact clean candidate must rerun every original
gate.

**Ninth fixed-Air failed candidate and prospective pre-C15 product repair —
2026-08-05:** Exact clean candidate
`1162b7846aa1d3e693711665074e2421f4b7f146` (C14) produced the valid
paired-v3 artifact whose frozen identity and internal date remain
`agent-safe-active-covered-paired-2026-08-04` and `2026-08-04`. The run
completed at 2026-08-05 06:41 local time. The artifact SHA-256 is
`4fb1d3be0102afffb567c74ab5462fc613b37a46ef362c4f84a358885cbbe904`
and the candidate executable SHA-256 is
`587c07c5ae0bf9118f47ab3bd4f4bd3bc71f976107e07daf0e7a29094e369e61`.
All nine registered read/write comparisons passed. Idle CPU passed with a
maximum observation of 36 microseconds against the 5,000-microsecond ceiling,
and all 33 idle output-block counts and database-family byte deltas were zero.

Idle RSS alone failed the unchanged two-sided 5% equivalence gate. The baseline
median was 40,272 KiB, the candidate median was 42,224 KiB, and the paired
median regression was 4.820717%. Its deterministic-bootstrap 90% interval was
4.244347%–5.148515%, exceeding the unchanged upper edge by 0.148515
percentage points. No exception is ratified. The absolute recorder was
therefore not run, C14 does not pass Acceptance 13, and it authorizes no LLP
acceptance or capability publication.

The prospective production correction removes no durable fact and changes no
ordinary mutation contract. History policy and row-history tables remain eager
because every central application write enters that seam. The distinct named
checkpoint and protected-erasure authority family—four tables, their six
implicit primary/unique indexes, and the generation singleton—is initialized
atomically only by the first checkpoint or erasure operation. Existing or
partial families are completed on open without losing retained authority;
absent inspect, erase, and recover calls keep their stable not-found result
without creating state; first-use races serialize; and derived-fork custody
continues to classify, scrub, and rotate only authority that actually exists.
This is a production-wide pay-for-play lifecycle boundary for an optional
feature, not allocator cleanup or fixture shaping. A new exact clean candidate
must rerun every original gate, and every capability remains `Missing` until it
passes.

**Tenth fixed-Air failed candidate and prospective pre-C16 release repair —
2026-08-05:** Exact clean candidate
`a0a45bcae90d92293d7953f997b929669804a760` (C15) produced the valid
paired-v3 artifact whose frozen identity and internal date remain
`agent-safe-active-covered-paired-2026-08-04` and `2026-08-04`. The run
completed at 2026-08-05 07:54 local time. The artifact SHA-256 is
`ab32a2a1d111f14ca13f8d3c8f79f2dcba3c608726fc4dee943e1c2a454aba4d`
and the candidate executable SHA-256 is
`38e7b75d10d9cd2a9e47cf4f156ad58b0d786ac9456110ea54e543597f659791`.
All nine registered read/write comparisons passed. Idle CPU passed with a
maximum observation of 39 microseconds against the 5,000-microsecond ceiling,
and all 33 idle output-block counts and database-family byte deltas were zero.

Idle RSS alone failed the unchanged two-sided 5% equivalence gate. The baseline
median was 40,352 KiB, the candidate median was 42,304 KiB, and the paired
median regression was 4.926500%. Its deterministic-bootstrap 90% interval was
4.529342%–5.263158%, exceeding the unchanged upper edge by 0.263158
percentage points. No exception is ratified. The absolute recorder was
therefore not run, C15 does not pass Acceptance 13, and it authorizes no LLP
acceptance or capability publication.

C14 and C15 retained the same 1,952-KiB median candidate-minus-baseline gap
despite C15 removing the unused checkpoint/erasure schema family from fresh
ordinary stores. A post-result binary audit found that the candidate recorder's
release `__TEXT` segment is about 2.26 MiB larger than the pinned external
baseline worker, making release code layout and touched executable pages the
credible production-level target rather than another small durable-schema
change. The prospective correction enables thin link-time optimization for
the repository's release profile. This is a shipped release build property,
not a worker-only flag: it changes no source route, live state, benchmark,
bound, estimator, exception, or capability claim. Exploratory runs made with
an environment override are diagnosis only and are not qualification evidence.
A new exact clean candidate with the profile committed must rerun every
original paired and absolute gate, and every capability remains `Missing`
until it passes.

Candidate `c68e2e3025da8f939b4c0e4e19c2024502c7a4ce` (C16) committed that
release-profile correction locally before fetching, but was deliberately not
measured: the required fetch then found `origin/main` at
`33c486ebff17007ccf6b6d55a51b1081e817f431`, which was not C16's ancestor.
That mainline delta adds only messaging demos, their diaries, and a guide-gap
ticket; it changes no Track B implementation, recorder, threshold, or
publication path. The lane merged it normally and without conflict. C16 has no
performance artifact and authorizes no claim; a new exact clean post-merge
candidate must run every unchanged gate.

**Eleventh fixed-Air failed candidate — 2026-08-05:** Exact clean candidate
`561b80c64fe040a2ca0d6f6ba269e9b7dcdb3467` (C17) produced the valid
paired-v3 artifact whose frozen identity and internal date remain
`agent-safe-active-covered-paired-2026-08-04` and `2026-08-04`. The artifact
SHA-256 is
`aed3ab1583b3a1c2ee8f7dc02cb057d3e8004f80b685eaa00c837baa83de38c6`
and the candidate executable SHA-256 is
`3070779a3a334daf6820785b25b3c0112a827516f1eaba61d70e3dc09c456fc7`.
Eight of nine registered read/write comparisons passed. Point-read p95 alone
failed the unchanged two-sided 5% equivalence gate: its paired median was
-1.131034%, but its deterministic-bootstrap 90% interval was
-5.646481%–8.651852%. No exception is ratified.

Thin LTO did clear every idle gate. The baseline RSS median was 38,288 KiB,
the candidate median was 40,064 KiB, and the paired median regression was
4.532102% with a deterministic-bootstrap 90% interval of
4.211843%–4.799666%. Candidate idle CPU peaked at 24 microseconds against the
5,000-microsecond ceiling, and all 33 idle output-block counts and
database-family byte deltas were zero. Because the read-tail interval failed,
the absolute recorder was not run, C17 does not pass Acceptance 13, and it
authorizes no LLP acceptance or capability publication. After the run,
`origin/main` advanced to `97e8ae9e9e6564877057a00e97a18f735fe79381`
with two additive issue files and no Track B implementation, recorder,
threshold, or publication change. That commit must be merged normally before
a new exact clean candidate reruns every unchanged gate. Every capability
remains `Missing`.

Candidate `1e826e1d8f26f889df7da82b94ba324582342370` (C18) contained the
new mainline merge but was abandoned before performance when proportional
own-correctness found a stale `TableManifest` initializer in
`crates/snapback/tests/network_profile_v1.rs`. The fixture was completed with the existing
`history: None` posture and passed its focused test; no product behavior or
performance surface changed.

Exact clean candidate `e35af16ec949b8bea185160a85002f7f5a24ae1c` (C19)
then passed the focused operation-ledger, fork/promotion, proof/checkpoint,
instance-fork, capability, network-profile, guide, reference, generated-
artifact, and withheld-publication checks. Its paired process began on the
fixed Air but was deliberately interrupted before completion and produced no
output artifact after the final row-14 test inventory found that public
mutation transport's two intended identity-shape refusals had no served-route
negative. The new fixture immediately exposed a real response-classification
defect: `SNAPBACK_OPERATION_IDENTITY_REQUIRES_CLIENT_MUTATION_ID` and
`SNAPBACK_OPERATION_HOST_IDENTITY_FORBIDDEN` both returned HTTP 500 even
though each is a caller-fixable protocol refusal checked before handler
execution.

The prospective correction deliberately adds those two stable codes to the
server's conservative client-fault allowlist as HTTP 400 and exercises both
through the real generated mutation route before a valid mutation. The
storage-level host-authentication, derivation, squatting, later-host-operation,
lease, and rotation corpus remains unchanged. This is production transport
correctness required by Acceptance 14, not a benchmark or threshold change.
C18 and C19 authorize no LLP acceptance or capability publication; every
capability remains `Missing` until a new exact clean candidate passes all
unchanged gates.

Exact clean candidate `c00b77dc82c60492663175a5dcfe4035396803fe` (C20),
implementation-tree SHA-256
`70e313107fea370c98f29aba445cc226fda172e4c99ea3f9b516e7f204facb9c`,
ran the one unchanged paired recorder on the fixed Air. Candidate executable
SHA-256 was
`2f7afc5b8f0727983eab6b78445be8b0d55111a023519746e0a91a27cb884e80`;
the preserved record SHA-256 is
`f46156651c8f9a6977050088b765b5604dec606673cd2c78a5c6770a181d44d5`.
Eight of nine read/write comparisons passed. Point-read p95 alone failed the
unchanged two-sided 5% equivalence gate on the faster side: median -2.4002%,
90% bootstrap interval -5.9006% to -1.1714%. Idle CPU passed at a 33 µs
candidate maximum against the conservative 5,000 µs resolution, and every
output-block/database-family byte delta remained zero. Idle RSS failed narrowly:
baseline median 40,192 KiB, candidate median 42,096 KiB, paired median +4.7391%,
90% bootstrap interval +4.6844% to +5.2632%. The artifact therefore records
`measuredComparativeThresholdsPassed: false`; the absolute recorder was not
run. C20 authorizes no LLP acceptance or capability publication, and every
capability remains `Missing`.

A post-result binary audit found that C20's release `__TEXT` segment was
46,841,856 bytes versus 44,482,560 bytes for the fixed external baseline
worker, an excess of 2,359,296 bytes that closely tracks the 1,904-KiB median
candidate-minus-baseline RSS gap. C17 through C20 did not change the current
point-read implementation or recorder; C20's current reads all shifted faster,
and the point-read p95 observations are quantized around 3.3–3.7 microseconds,
where one approximately 42-nanosecond bucket can move a paired ratio across a
percentage edge. There is no product regression to mask and no source-path
slowdown is authorized.

The prospective pre-C21 correction instead makes the existing production
release-layout optimization complete: release builds use full LTO with one
codegen unit, letting the compiler optimize the shipped dependency graph as one
unit and reduce cross-module code duplication and executable-page
fragmentation. This is a repository-wide production profile, not a recorder
flag. It changes no route, live state, benchmark, bound, protocol, estimator,
exception, or capability claim. The exact committed candidate must show a
smaller release segment before it is allowed to run the one unchanged paired
protocol; every capability remains `Missing` meanwhile.

Exact clean candidate `85dcbd3ab941ccc1efcab7a99862e0baa7899f07` (C21)
passed the unchanged paired and absolute performance gates on the fixed Air.
It did not authorize publication: the later publication replay found that the
target projection was being constructed in the wrong order, and the repaired
remote-target semantics required a newer exact qualification source. The C22
and C23 publication/identity attempts were superseded before final
qualification and made no capability claim.

Exact clean candidate `f222877df22b2d7a58064884e43d29e3ff8ef0a5` (C24),
implementation-tree SHA-256
`0b6d046fe44c66db011b85b9bda9688e35f05a5bf33f796579619e74b17df927`,
ran the one unchanged paired recorder on the fixed Air. Candidate executable
SHA-256 was
`57727c6b1c111d810380827aee22ea868eb2e18363487824cdd57cfc4fc4d0ff`;
the preserved record SHA-256 is
`355d74d24b104477ba8000e1d0c055d6fe5c96625241f25a9cf3fb68211c970a`.
Eight of nine read/write comparisons passed, as did every idle gate. Point-read
p95 alone failed the unchanged two-sided five-percent equivalence gate on the
faster side: median -2.263430597%, 90% bootstrap interval -5.609492988% to
+1.186105620%. Idle RSS had median +0.63517% and interval -0.87246% to
+2.48139%; idle CPU peaked at 22 microseconds, and every recorded disk delta
was zero. The absolute recorder was not run. C24 therefore authorizes no
publication, and every capability remains `Missing`.

An independent raw-sample, source, build, and disassembly audit reproduced the
C24 statistics exactly. C21 and C24 use identical point-read source, benchmark,
recorder, and release profile; in both, the pooled candidate p95 is exactly 83
nanoseconds faster than the fixed baseline. The different pass/fail outcome is
consistent with the approximately 42-nanosecond timing quantization moving one
outer-pair statistic across the unchanged lower edge. No artificial slowdown,
benchmark change, protocol change, threshold change, or rerun-until-green is
authorized.

A separate LLP 0007 audit found a reachable product defect independent of the
performance result. SQLite's permissive affinity permits pre-activation raw
DML, brownfield files, or corruption to store a physical representation that
the portable writer would refuse; the reader previously accepted such values,
including Boolean INTEGER values other than zero or one and lossy invalid
UTF-8. The prospective C25 implementation makes the shared row decoder assert
the declared storage class, portable numeric/timestamp domain, exact UTF-8,
JSON validity, and required-versus-optional nullability for every row it
returns. Existing preserved physical columns without a current declaration
retain their legacy scalar projection, and no unbounded open-time or full-table
preflight is added. The only internal staging exception is LLP 0081's
closed-barrier backfill window: its exact newly added required destination may
remain `NULL` until the backfill step, but all other fields are decoded
strictly and publication follows verification. A new clean candidate must pass
all own-correctness and performance gates before any capability can leave
`Missing`.

Exact clean candidate `95e844d6c8a9c71e4be66c4f0ecb5f9dc30d00bc` (C25)
was stopped before producing a performance artifact. A post-commit read-only
audit found that the strict decoder ran ahead of LLP 0081's typed validation:
the effective successor schema made the `ValidateRequired` target required, so
its expected staged `NULL` values failed decoding before the validator could
emit bounded violation facts and its stable step-failed result. The same audit
showed that the backfill decoder exception was selected by destination name
without independently proving that the plan had staged that destination.

The prospective C26 repair retains strict application reads and narrows the
privileged behavior to mechanically checked cases. A NonNull migration scan
may decode `NULL` only for the exact fields it is validating; sealed-plan
admission permits that requiredness lifecycle only for a field staged earlier
by `AddField` or an optional predecessor field whose successor becomes
required. Any unrelated required `NULL` still refuses as storage corruption.
In-place `BackfillField` or `CopyField` may target only a prior `AddField` and
must precede `ValidateRequired`; the validation must be consumed by
`MakeRequired`, after which later writes refuse. `AddField` itself refuses an
existing predecessor field, a missing successor declaration, type drift,
duplicate staging, and—on fresh target admission—a manifest-hidden physical
column retained by logical retirement. The same exact operation's resume may
observe its own already-created column only when that AddField's atomic journal
entry proves it; a fence/operation row alone is insufficient. Published-held
and terminal replay recompute the artifact seal against the stored binding and
verify the supplied successor manifest before adopting it, while
pre-publication resumes re-run the full predecessor-relative semantics. LLP
0081's earlier “new or nullable”
phrase is narrowed to this local v1 new-destination proof domain. Focused tests
preserve the typed step-failure facts, reject existing-required and late-write
plans, and refuse retained-byte re-adoption. C25 authorizes no result or
publication, and every capability remains `Missing`.

Exact clean candidate `cf56fd38229cebe3616f18c5f51e48c295f15d7c`
(C27), implementation-tree digest
`sha256:f85812a14f2255f444bced135b0b3dc52d04656a5bdbc0199f764967020991ac`,
was abandoned before a performance result. One paired process started on the
fixed Air and was deliberately terminated pre-result after an independent
review found four correctness defects: payload-free tombstones could not
distinguish exact, authorization-stale, and other identity collisions; closing
a later epoch could leap the floor over an earlier open epoch; repeated
same-epoch successor ranges made the epoch bound unbounded; and the atomic
writer insertion seam rechecked only live suppression, allowing a key to be
reinserted after ACK plus compact-envelope pruning. No paired artifact was
produced, the absolute recorder was not run, and no capability claim changed.

Prospective C28 retains separate domain-separated full-identity and
authorization-facts digests in each payload-free tombstone, advances floors
only over the contiguous closed prefix, caps each client epoch at 1,024
identities (four contiguous 256-counter ranges, aligned with the existing
client outbox and per-auth settlement bounds), and reclassifies retained state
inside every terminal or pending writer transaction before publication. Exact
loss-response range re-service remains available; a fifth range refuses with
`SNAPBACK_OPERATION_RANGE_EXHAUSTED` and requires a fresh authenticated epoch.
An identity-null intent may bind that successor only after durable
same-principal comparison; missing or different principal custody leaves it
pending rather than failed or cross-authority-submitted. Suppression and
tombstone epoch/counter corruption also refuse rather than replaying a
mismatched record. C28 must pass fresh correctness, performance, review, and
author-acceptance gates; every related capability remains `Missing`.

Exact merged C28 commit `e60473b41159d639bb35ac926564ae49b64f9f51`
passed 2,127 Rust library tests and the withheld-publication checks, but fresh
mutually blind Codex and Fable review stopped it before performance. The
reviews found that ordinary sessions-mode callers did not automatically carry
the current authority descriptor into range issuance; the generated tombstone
schema rejected the required `counter: null` emitted for Host identities;
Host closure trusted an SQL terminal-time projection without comparing it to
the retained JSON record; and the pending-writer tombstone test did not stage
and roll back application/journal writes. No C28 performance process began and
no performance artifact exists.

Prospective C29 installs current session authority and principal custody before
durable range assignment, injects the same descriptor defensively at the range
transport boundary, generates a required-but-nullable Host counter schema with
a representative round trip, validates suppression terminal/acknowledgement
SQL projections before lookup or Host retention decisions, and proves the
pending writer refuses and rolls back staged application, journal, envelope,
and lifecycle rows. The merged mainline's two externally managed control-
catalog schemas are also preserved by the canonical Rust schemagen without
claiming Rust ownership. These are prospective correctness repairs only;
every capability remains `Missing` until a new exact candidate passes fresh
review, the unchanged one-shot performance gates, and publication acceptance.

Exact clean C29 commit `3f5c587fbe58533a6d471b0e13f238e6baabf774`
and implementation digest
`sha256:58dcf92bad47ae5327a5b8459b5ba5666ddfa467ee31a27266497ba4c9226ad9`
received fresh Codex and Fable `NOT READY` verdicts before performance. Both
found that the sibling pending-terminal table still exposed an unchecked SQL
retention-time projection. The reviews also found automatic sessions authority
installed after ACK selection, a foreign-key public explanation oracle, a
non-discriminating Host rollback matrix, and stale Draft wording for Accepted
LLP 0158. No C29 performance process ran.

Prospective C30 globally validates Host primary-key, lane, audience, epoch,
terminal-time, acknowledgement, and retained-JSON coherence before closure;
foreign or moved projections cannot hide a young ordinary or pending-terminal
receipt. Automatic sessions resolve authority before ACK selection. Foreign
and absent public explanation keys return one metadata-free
`authorization-unprovable` response, while the admin lane retains exact
divergence diagnostics. Direct Host terminal and pending writer negatives
observe staged caller app/journal writes before rollback, prove no lifecycle
or lease write crossed the retained-state guard, and prove rollback clears the
publication set while retaining the tombstone. Rust decoding now requires the
nullable tombstone counter key, and current docs record LLP 0158 as Accepted
without publishing its distinct derived capability. These are prospective
correctness repairs only; every capability remains `Missing` pending fresh
exact review, performance, and publication acceptance.

Exact merged C30 commit `365a3f21117cbaecdf80b8e5bff7debea47fc2d0`
and implementation digest
`sha256:8c7b73ad43ef59555562f3dbfd852c0c2b398ae14613af9e5d49c3f220b8d635`
received a Fable `READY` and Codex `NOT READY` verdict before performance.
Codex found that Host closure still trusted lease audience/epoch projections,
and pending-capacity admission still trusted lifecycle lane/audience
projections. Fable independently noted the same-class client-suppression
closure asymmetry as a low-priority follow-up. No C30 performance process ran.

Prospective C31 enumerates leases and pending lifecycles globally, validates
physical keys plus every duplicated SQL/JSON projection, and derives live
lease and outcome-pending counts only from validated identities. Register,
complete, replay, capacity, and close seams share the same fail-closed checks.
Client closure now uses the global suppression comparison pass as well, so a
moved unacknowledged receipt cannot disappear from its epoch. Direct
corruption fixtures cover lease audience/epoch, pending lane/audience/epoch,
and client suppression audience moves. These remain prospective correctness
repairs: every capability stays `Missing` pending a fresh exact candidate,
dual review, the unchanged one-shot performance gates, and publication
acceptance.

Exact clean C31 commit `58ec598c38b3f8077682266727dbe3e0dc574b1d`
was abandoned before either fresh review returned when the required fetch
found newer `origin/main` at `2bb84423b59e81e4afa865339765142ad2769bc2`.
No review artifact or performance result was accepted for C31. The three
upstream commits were merged normally as
`1eaa30b7f4e810476c556c3c4206b3deb6597849`; its AppDescriptor and
artifact-index changes were regenerated from the combined source while the
C31 custody repairs and all `Missing` capability projections were retained.
C32 was subsequently abandoned before a qualifying dual review completed and
before performance after the required remote-tip check found newer main at
`2b5da1ff6a31f7a8240c7d72af26967b6c34022b` and then
`9d7f81a4095799c49f8bb27006e1d597f80f84cb`. The two normal merge commits
above preserve the Track B repairs and regenerate the combined closures. C33
is the next prospective exact candidate and must rerun fresh dual review and
both unchanged one-shot performance gates.

**Implementation evidence:** 2026-08-03 (dated candidate evidence recorded:
the comparable read/write/idle observations are within threshold on the step-0
machine, but the historical runs were ordinal-zipped rather than experimentally
paired. A post-run audit records the committed baseline digest but cannot make
the observations measurement-time-bound experimental pairs; the public covered
lane was not activated. A separate integrated-revision fork/promotion absolute
record now covers the final hardening. The v0.13 absolute and active-carrier
p99 bounds are author-ratified before results, but the exact fixed-Air records
and the applicable correctness gates remain open, so
Acceptance 13 and every capability remain
unpassed/`Missing`)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0012, LLP 0017, LLP 0018, LLP 0024, LLP 0035, LLP 0036, LLP 0037, LLP 0042, LLP 0043, LLP 0051, LLP 0053, LLP 0055, LLP 0066, LLP 0070, LLP 0072, LLP 0081, LLP 0088, LLP 0090, LLP 0094, LLP 0095, LLP 0097, LLP 0129, LLP 0130, LLP 0133, LLP 0134, LLP 0146, LLP 0155, LLP 0158, LLP 0159, LLP 0160, LLP 0161

> **Proposal boundary.** LLP 0161 derives nine ideal properties for an
> agent-optimized storage engine. This RFC does not claim all nine at their
> strongest form. It proposes a deliberately bounded profile that answers most
> of the agent questions behind P1-P9 without replacing SQLite, adding temporal
> machinery to ordinary reads, or maintaining a Merkle tree on every write.

## Summary

Adopt an **agent-safe storage profile** built from three composable primitives:

1. a **universal commit envelope** for every covered durable state transition;
2. a **safe current-head fork** with effect quarantine, bounded lifetime, exact
   journal diff, and strict promotion by re-execution; and
3. **bounded proof and history** based on complete change journals, named
   checkpoints, and `ContentDigestV1` at proof boundaries rather than on every
   commit.

The local reference implementation keeps stock SQLite as its physical engine.
Ordinary current-state reads remain ordinary application-shaped SQL. Ordinary
writes add constant-sized commit metadata plus records proportional to the
captured read/write/effect facts. Expensive work — database copies, full
digests, historical materialization, and branch effect simulation — happens
only at an explicit agent operation or proof boundary.

The profile intentionally implements P1, P3, P5, and P8 strongly on their
declared paved paths, and P9 strongly on its declared admission and
containment surface (ordinary-mutation fencing and read-side audit remain
deliberate remainders); preserves the already-strong deterministic-handler and
migration-proof halves of P6 and P7; and substitutes journal-based diff plus
named checkpoints and bounded change history for full P2 and P4. It does not
change LLP 0088's rejection of merge as sync-core machinery. A successful fork
is kept by LLP 0097's promotion-by-re-execution path, never by storage merge.
The promotable fork class is LLP 0097's in-app branch; LLP 0158's
schema/function-divergent derived-deployment forks remain non-promotable in
v1, preserving LLP 0158's merge-back non-goal unamended.

This is a product and engine-layer proposal, not a physical-storage rewrite and
not a commission to implement. The claim boundary, stated once and referenced
elsewhere: document status and capability status are separate facts (LLP 0134
owns the latter); no target may advertise any profile capability above
`Missing` until the acceptance corpus passes on that target, and while this RFC
is Draft nothing may be advertised at all.

## Motivation

LLP 0161's P1-P9 set comes from three real agent pressures: speculation, proof
over memory, and concurrency without coordination. The strongest realization
of every property is coherent, but several parts have high cost relative to the
first agent outcome they unlock:

- maintained Merkle state puts hash maintenance and durable tree lifecycle on
  every write primarily to make arbitrary state comparison cheap;
- database-wide `AS OF` requires a retained historical representation,
  historical schema semantics, authorization, compaction, and garbage
  collection;
- generic bidirectional lenses must either restrict their transformation
  algebra or retain complement data for otherwise lossy changes; and
- universal replay of nondeterministic actions requires storing or simulating
  external observations that may be large, secret, or impossible to reproduce.

Most day-to-day agent questions are narrower:

- What operation made this commit, under whose authority?
- What did the operation read and write?
- Did my earlier attempt already commit?
- Can I try this against real-shaped data without affecting canonical state or
  firing real effects?
- What changed in the try, and can I safely keep it?
- How did this record change recently?
- Can I prove a migration, checkpoint, or promotion boundary?

Snapback already has separate foundations for these answers: commit versions
and a row journal; server-captured read facts on the Ibex lane (host-plan
deciding reads are client-supplied validated baselines per LLP 0007);
deterministic ctx-answer ledgers; specialized settlement receipts (today keyed
by the optional `clientMutationId` — the transport client defaults it off,
while the first-party React optimistic path already mints one);
migration proofs; scoped grants (LLP 0055) and fencing where lanes define
them; plus LLP 0097's landed-but-unwired branch substrate. The 80/20 move is
to join those foundations into one honest durable-operation contract before
adopting a new physical storage engine or a fully temporal logical layout.

## Goals

- Make every covered durable operation attributable, explainable,
  retry-addressable, authority-scoped, and receipt-producing.
- Make speculative execution against a current real-shaped database safe by
  default and bounded in resources.
- Give forks an exact machine-readable diff for every declared covered lane.
- Preserve deterministic query/mutation re-execution and make its coverage
  legible.
- Give agents recent record-change history and explicit checkpoints without
  imposing temporal predicates on the current-state query path.
- Preserve stock SQLite's planner, indexes, constraints, transactions, crash
  recovery, backup primitives, and direct inspectability on the canonical local
  target.
- Define portable semantics whose target mechanics can differ across SQLite,
  Postgres, and Cloudflare while advertising their actual capability class.
- Establish evidence-based triggers for revisiting incremental Merkle state,
  arbitrary database-wide as-of, general lenses, or a version-native physical
  engine.

## Non-goals and explicit non-claims

The v1 profile does **not** claim:

- incrementally maintained Merkle roots for every table or O(1) comparison of
  arbitrary states;
- arbitrary database-wide `AS OF` at every retained commit;
- indefinite history retention;
- general or persistent data branching;
- merge of divergent branch state into the sync core;
- promotion onto an advanced canonical head;
- deterministic replay of arbitrary actions or of the external world;
- bidirectional lenses for arbitrary schema transformations;
- engine-observed read sets for raw SQL or for an undeclared administrative,
  protected, asset, or external-effect lane;
- cross-system transactional atomicity with external providers;
- coverage of the client-side store — the client materialization, journal
  replay, and offline mutation queue remain owned by LLP 0043/0053/0090 and
  LLP 0155's client arm; this profile covers host-side durable state, and
  LLP 0161 OQ5 (which properties the client store needs natively) stays open;
  or
- one physical storage implementation shared by every deployment target.

A capability or receipt must state its lane coverage. Missing coverage is a
declared absence, not a successful empty diff or proof.

## The profile at a glance

| LLP 0161 property | Agent-safe v1 realization | Deliberate remainder |
|---|---|---|
| P1 — fork | Two declared classes (§3); deny/capture effects; TTL/quota; journal diff; strict-CAS promotion by re-execution with serialized admission (§5) | Arbitrary historical branch, advanced-head promotion, merge |
| P2 — Merkle state | Complete covered-lane journal, per-commit write-set digest, boundary `ContentDigestV1`, independent verification at high-stakes boundaries | Maintained Merkle tree and arbitrary-state O(1) equality |
| P3 — provenance | One durable operation-keyed envelope record per covered durable operation | Per-row duplication of principal metadata |
| P4 — history | Named checkpoints (materialized or receipt-only, §6), fork-pinned bases, bounded record-change history under LLP 0088's invariants | General relational as-of and indefinite retention |
| P5 — read/write sets | Public normalized captured sets with per-fact provenance (server-captured vs client-supplied-validated) on paved query/mutation and dry-run paths — durable digest plus bounded detail on mutations, response-scoped explanation on queries and dry-run | Raw-SQL and undeclared-lane capture |
| P6 — replay | Existing deterministic query/mutation tier plus recorded ctx answers and branch operation log; explicit effect intents/receipts | Arbitrary action and external-world replay |
| P7 — evolution | LLP 0081 proofs, rehearsal/checkpoints, compatibility decisions and refusal | General bidirectional lens runtime |
| P8 — settlement | Automatic stable operation identity and atomic receipt on ordinary covered mutations | Universalization to a lane until its conformance row is green |
| P9 — admission | Uniform authority check for covered commits, fencing where the lane defines one, and per-principal fork count, bytes, digest-work, and TTL limits | Read-side audit beyond the declared explanation surface; universal fencing on the ordinary mutation lane |

## Design

### 0. Defined terms

**Covered.** A lane is *covered* exactly when it has a declared entry in the
target's coverage manifest, a journal-completeness proof for every write path
in the lane, and an envelope mapping. Coverage is declared per lane, surfaced
in the capability manifest, and changed only by a dated manifest change.
Artifacts — envelopes, diffs, proofs — bind the coverage-manifest version in
force at emission and are never retroactively requalified; whether a crash cut
or a missing envelope is a defect is judged against the manifest in force at
the time of the write. Related terms carry their owners' definitions: *lane*
(a declared family of durable write paths sharing custody and journal
treatment), *stream identity* (LLP 0158's per-instance version stream),
*paved path* (the supported authoring surface per LLP 0004/0007).

**Egress classes.** `DenyAll` refuses every host egress attempt fail-loud and
records a bounded, payload-free **attempt marker** (egress family and count,
no intent payload) durable in the branch — so "no egress was attempted" is
provable even when a handler catches the refusal and continues; `CaptureOnly`
(LLP 0097's ledger-backed meaning, reserved) records each denied effect as an
inspectable durable intent. The distinction
is load-bearing in §3, §5, §8, and §Sequencing and always carries this
definition.

**Other terms.** *Audience* is LLP 0133's authority-instance descriptor
scope. *Originator class* is the identity-source class of §1 (client-minted
versus host-derived). *Protected-lane custody* is the encrypted,
access-controlled storage class for secret-bearing retained content; its
schema and ownership land with LLP 0163 (the envelope Spec — ctx answers
and effect payloads are envelope facts).

### 1. The universal commit envelope

Every covered transition across a durable boundary writes one logical
`CommitEnvelopeV1`, keyed by the operation's stable audience-scoped
`operationId`. The commit version is an association, not the key: a
data-changing operation records the stream-qualified commit version it
produced, while a receipt-only outcome — today a no-op mutation retains the
current version, and LLP 0043 recognizes an authoritative version zero for a
fresh-database no-op — records the observed snapshot version without claiming
a distinct commit. Several receipt-only operations may share one snapshot
version; no two envelopes share an operation identity. Every version fact on
the envelope, diff, and promotion surfaces is qualified by the stream identity
it belongs to, because a parent and its fork provably mint colliding version
numbers with different contents (LLP 0158's spike evidence). The artifact
schema and table names are follow-on specification work; this RFC defines the
required facts and atomicity contract. The follow-on schema marks each field
as required, required-where-the-lane-defines-one (audience fences, plan
digests), or retained-bounded (detail subject to §2 expiry).

The operation identity **extends the shipped `ClientMutationIdentity`** under
LLP 0133's discipline (extend, never ride beside): `operationId` is the
existing `clientMutationId` widened to every originator, and the canonical
identity continues to bind every semantics-affecting fact the shipped path
binds today — enumerated in LLP 0133 §Exactly-once identity, including the
function, auth fingerprint, authority-instance descriptor, input fingerprint
over `{args, readSet, ctxLedger}`, the settlement carrier where it diverges
from the default, and 0133's lane and claim additions. The audience is a
**bound compared fact, not a key component**: LLP 0133's collision rule is
preserved unamended, so re-presenting an identity under a divergent audience,
principal, or any other bound fact fails closed in the shipped
`SNAPBACK_CLIENT_MUTATION_ID_REUSED` / stale-authority diagnostic families —
it never executes as novel and never returns another audience's receipt. The
physical key is the stream-qualified, originator-partitioned operation
identity: envelopes and
suppression records live in the namespace of the stream that executed them
and of the originator class that minted them, so `(streamId,
originatorClass, operationId)` is the full key. The host-derived namespace is
unwritable by client-originated admission, and host-derived identities are
additionally server-authenticated under the issuing authority (the same
binding the epoch protocol uses), so a client cannot pre-claim — squat — the
identity a future cron occurrence, job attempt, or migration step will
deterministically derive. Branch envelopes are
branch-local and are discarded at teardown. Promotion does not replay the
branch's identities into canonical, and it has exactly one admissible
identity: the aggregate promotion identity on the `PromotionRequestV1` (§5)
is the sole key that participates in duplicate suppression, collision
comparison, retention floors, and receipt lookup — a post-promotion retry of
it returns the aggregate receipt. The per-source identities derived from
`(childStreamId, sourceOperationId)` are **non-admissible provenance join
records**, recorded atomically with the aggregate envelope at write-fact
granularity so every journaled row joins to the branch operation that
produced it; they never suppress or answer a retry. `childStreamId` is
globally non-reusable — minted once with
collision-resistant randomness (LLP 0148's grammar) and never reissued across
teardown, restore, or registry reconstruction — so a re-created branch cannot
collide with an earlier promotion's records, and re-execution is
never suppressed by the branch's own receipts. The widening lands as
dated amendments to LLP 0133/0043, which remain the duplicate-suppression
authority.

The envelope contains or durably references:

- stream identity and the produced or observed commit/snapshot version;
- stable `operationId` and operation kind;
- principal and a non-secret session or invocation identity;
- authority audience, grant/policy identity (LLP 0055 scoped grants where the
  principal is an agent), and fencing token or epoch where the lane uses one;
- function, artifact, migration-plan, or administrative-command digest;
- canonical argument digest and, where applicable, a plan digest;
- base commit version or read baseline;
- normalized read-set and write-set digests, every fact carrying a provenance
  class — `serverCaptured`, `clientSuppliedValidated`, or
  `serverEvaluatedConditional` — so a client-supplied host-plan baseline
  (LLP 0007 §Transactions) is never presented as a server observation; LLP
  0133's claim-labeling and LLP 0146's completeness vocabulary apply rather
  than a new parallel scheme;
- bounded retained read/write details sufficient for recent explanation;
- the deterministic ctx-answer digest and, for lanes claiming replay, the
  ledger retained verbatim — the retention selection rule is the lane's
  declared replay class, not an unstated subset;
- classified effect intents and settlement identities, carrying **two
  orthogonal classification axes**: the egress family (the branch
  substrate's closed enum, which the `DenyAll` attempt marker records) and
  LLP 0066's settlement capability (`transactional | provider-idempotent |
  provider-queryable | compensatable | inherently-ambiguous`, not yet an
  owned taxonomy), the latter being what §5's promotability and provisional
  rules turn on; credential/egress seam per LLP 0036; without embedding
  credentials or unredacted secret payloads; and
- the terminal or pending receipt returned for this operation.

The application data change, row journal entries, commit envelope, duplicate
suppression record, and initial receipt state commit in the same physical
transaction. A commit version is not visible until all of those facts are
visible. A crash may leave none of them or all of them; it may not leave a data
change whose covered commit envelope is absent.
The terminal and pending writer insertion seams independently reclassify the
operation identity inside that same transaction before publication, in
suppression, compact/tombstone, then floor order. Exact retained state refuses
reinsertion, divergent state returns the stable mismatch, and below-floor state
returns `identity-horizon-passed`; a pre-handler lookup is never insertion
authority, and any refusal rolls back the application and journal writes too.

Identity source is defined per originator class. Client-originated operations
carry a client-minted `operationId` before the first attempt, reused across
transport retries — a client-contract change owned by LLP 0012/0095
amendments. Host-initiated operations — cron occurrences, durable jobs,
migration steps, administrative commands — derive their identity
deterministically from a durable upstream identity (job id plus
attempt-invariant key, cron occurrence, migration operation id), never minted
fresh per attempt, so a host-side retry after a crash returns the stored
receipt; an operation producing multiple durable commits derives a child
identity per commit from the parent identity plus a stable ordinal. The transition is versioned: once a target advertises envelope
coverage for a lane, an ordinary mutation arriving on that lane without an
identity refuses stably rather than executing uncovered, and legacy clients
negotiate the prior contract until the amendment's cutover. Repeating an
operation with the same canonical identity and audience returns the stored
receipt without re-executing. Reusing the identity with any divergence in the
bound identity facts — arguments, read baseline, ctx ledger, artifact,
principal audience, or operation kind — refuses with the shipped stable
mismatch diagnostics.

Duplicate suppression is bounded by an explicit lifecycle that preserves LLP
0043's shipped rule rather than weakening it: an *unacknowledged* receipt is
never evicted — at capacity, admission of new identities refuses rather than
reclaiming old results, exactly 0043's refuse-at-capacity bound. Reclamation
applies only to receipts already acknowledged, or removed by an operator
purge that explicitly admits forfeiting exactly-once. Because a reclaimed
identity would otherwise be indistinguishable from a novel one, identities
carry a structured issuance epoch with a defined protocol. Epochs are
server-issued and authenticated, bound to the issuing authority instance or
session incarnation, so a client that loses its local store obtains a new
session and therefore a new epoch — client-local state never fabricates
monotonicity. Offline minting is closed by construction: at session open the
server preallocates an authenticated **finite identity range** (epoch plus
counter range) of at most 256 counters that the client persists atomically
before use; offline
mints draw from the persisted range, so the server knows the last-issuable
bound at preallocation and closure can conservatively bound every
minted-but-never-delivered identity by the range without a mint-time
round trip. An authenticated client epoch may own at most four contiguous
ranges, or 1,024 identities in aggregate, matching the existing client outbox
and per-auth settlement bounds. Exact response-loss recovery re-serves the
already committed successor before any of its counters is admitted. A client
that exhausts its current range while offline queues further intents locally
as uncovered and refreshes at reconnect; a fifth same-epoch range refuses
`SNAPBACK_OPERATION_RANGE_EXHAUSTED`, so continued admission requires a fresh
authenticated session/epoch and range. An uncovered identity-null intent may
atomically adopt that successor descriptor/range only if its durable principal
id matches the newly authenticated principal; otherwise it remains pending
with `uncovered-reauth-required`. These are stable, disclosed
degradations owned by the dated LLP 0043/0012/0095 amendments.
An epoch **closes** only when both hold: its issuer is
terminated or revoked, so no new first attempts can be minted under it, and
every identity in its preallocated ranges is admitted-and-**acknowledged**
(LLP 0043's acknowledgement, not any weaker "settled"), never-admitted and
expired by the range's declared window with an explicit outcome-unknown
classification, or operator-purged. Two consequences are stated plainly: a
minted-but-never-delivered identity either holds its epoch open or is
classified outcome-unknown by name — never silently reclassified below the
floor — and an admitted-but-unacknowledged identity holds its epoch open
until operator purge, which is LLP 0043's own posture (a crashed client
wedges only its audience's floor, bounded by refuse-at-capacity, never by
eviction). Host-originated identities have no client acknowledgement, so
they carry their own reclamation predicate rather than borrowing one no
host actor can satisfy: a server-authenticated host identity — there is no
remote party whose observation must be protected — reclaims after its
terminal receipt has aged past a declared host retention window, and a
host epoch (range-less, bound to the server incarnation) closes when the
incarnation has rotated and every identity minted under it has a terminal
receipt older than that window or is purged (decided 2026-08-03 by dated
revision after the post-acceptance scoped review; the fixture leg lands in
Acceptance 14). The
per-audience minimum accepted epoch advances only over the contiguous closed
prefix: closing sequence N cannot advance past any lower nonclosed sequence,
and tombstones are deleted only below that recomputed floor. This makes
stranding impossible by construction: an in-flight first attempt under
an open epoch is always admissible, and a single unacknowledged identity
holds its epoch open (bounded by the refuse-at-capacity rule, not by
eviction). A retry bearing an epoch below the floor refuses with a stable
`identity-horizon-passed` diagnostic rather than silently re-executing; the
diagnostic is an explicit outcome-unknown disposition, not a typed failure —
clients must not record it as a terminal `failed` result, and the dated LLP
0043/0012/0095 amendments define its client handling. Restamping an old
`operationId` under a newer epoch is a distinct admission, safe because
reclamation is post-acknowledgement: the acknowledging client already
observed the outcome, so a restamp is a client-contract violation that at
worst executes a new operation, never a silent duplicate settlement. The
compact envelope identity (§2) may outlive the suppression record; it
retains the terminal outcome (committed or refused) and the receipt digest,
so while it survives, a retry receives a stable `result-expired` answer —
outcome-known, payload gone — which is a client-visible contract change from
LLP 0043's republish-the-stored-result rule and lands in the same dated LLP
0043/0012/0095 amendments as `identity-horizon-passed`. The floor is not the
only guard: when an identity's last durable record would otherwise be
reclaimed while its epoch is still open, a payload-free **identity
tombstone** (a domain-separated full-identity digest, a separately
domain-separated authorization-facts digest, its counter projection, and
terminal outcome class) is retained until
the audience floor has advanced past the epoch — so a reclaimed identity in
an open epoch can never re-execute as novel. Lookup precedence is defined:
suppression record, then compact envelope or tombstone (`result-expired`),
then the epoch floor (`identity-horizon-passed`). Host-originated epochs
follow the host reclamation predicate above, not the client
acknowledgement rules. An exact digest match returns `result-expired`;
authorization-facts divergence returns `SNAPBACK_AUTH_STALE_RESULT`; and any
other identity divergence returns `SNAPBACK_CLIENT_MUTATION_ID_REUSED`. P8 is
advertised with these bounds, never as an unbounded promise; tombstone growth
inside an open client epoch is bounded by the 1,024-identity aggregate epoch
capacity.

The compact envelope identity has its own bounded retention clock — the
profile's third, and it is declared like the other two: a per-audience
envelope-identity window, independent of the sync-resume replay floor (which
it may never pin) and of the journal prune predicate. On covered lanes the
envelope window is at least the journal window, so a journal row never
outlives the envelope that explains it; the reverse — an envelope surviving
its journaled rows — answers explanation with the digests, counts, and a
stable `journal-expired` disposition rather than fabricating detail.

The envelope is operation-level metadata. Row journal records join through the
stream-qualified commit version of the data-changing operation; they do not
duplicate the principal, plan, and authority payload on every row.

#### Coverage

The initial coverage target is every ordinary paved application mutation,
including Ibex mutation execution and host-plan mutation settlement, plus
branch promotion. Read-only query execution produces explanation facts, not a
durable envelope write — only durable transitions write envelopes, keeping the
idle and read budgets intact. Existing migration, durable-background-work,
push, and auth journals remain valid specialized authorities; conformance maps
their existing receipt into the envelope vocabulary before the profile claims
those lanes. The host-plan lane's read-set provenance depends on LLP 0007's
Option A contract (pending ratification); until ratified, that lane advertises
`clientSuppliedValidated` provenance explicitly.

Actions are not declared replayable merely because an action eventually causes
a covered mutation. The durable mutation receives an envelope; the action's
ambient external observations remain outside P6 unless a separately declared
effect adapter records them.

### 2. Explanation retention

The envelope retains two forms of explanation:

1. a durable compact identity — the read/write/ctx/effect digests, provenance
   classes, and counts;
2. bounded normalized detail — the actual captured row, missing-row, predicate,
   write, and effect facts needed to explain a recent operation.

After detailed retention expires, an explanation remains honest: it returns
the durable digests, counts, coverage, and a stable `detail-expired`
disposition. It never fabricates an empty set. Detail may also be bounded at
capture time: when captured facts exceed the declared per-operation detail
budget, the durable digests and counts are still recorded and the explanation
carries a stable `detail-truncated` disposition — truncation is disclosed,
never silent. When constituent facts are gone and their per-fact
authorization can no longer be evaluated under current policy, the
explanation returns only non-sensitive operation metadata with a stable
`authorization-unprovable` disposition — retained counts and membership
digests are withheld fail-closed rather than disclosing facts whose
authorization cannot be proved. Query explanation is response-scoped and non-durable (§1
Coverage); the capability manifest distinguishes mutation-durable from
query-ephemeral explanation. The explanation surface also supports bounded
enumeration — listing operations by principal, session, or time range within
the retention window, under the same fail-closed authorization — because an
agent that lost its context has lost its `operationId`s, and "what did I do"
is the question the substrate exists to absorb; the enumeration index's cost
is named in the structural budget. Named checkpoints, active forks,
open incidents, migrations, or operator pins may retain detail longer, charged
to an explicit principal or app budget; every such pin is a finite renewable
lease with a mandatory maximum lease duration, never an unbounded hold.

### 3. Safe current-head forks

The v1 profile names two fork classes and refuses to blur them, because the
corpus holds two deliberately different primitives:

- The **promotable class is LLP 0097's in-app branch**: same process and trust
  boundary, the same schema/function/auth bundle as the parent (a branch
  cannot diverge them), a typed child stream over a materialized base plus
  overlay, based on the current canonical head. Only this class may promote
  (§5), which keeps re-execution against the canonical bundle well-defined.
- The **non-promotable class is LLP 0158's derived deployment**: a separate
  instance with its own canonical stream and scrubbed-and-minted identity,
  which may diverge schema and functions. It never promotes; LLP 0158's
  merge-back non-goal is preserved unamended. A fork based on a named
  checkpoint is always this class in v1 — its base sits behind the canonical
  head, so strict-CAS promotion could never accept it anyway, and LLP 0097
  deliberately defers historical-base in-app branches rather than defining
  them, so the derived deployment is the only primitive the corpus offers for
  a checkpoint base today. A non-promotable in-app branch at a checkpoint
  base would need a dated LLP 0097 amendment and is not proposed here. The
  scrub-and-mint produces a new stream identity for the fork; the fork
  receipt records the parent stream identity so parent envelopes remain
  joinable as evidence.

Promotion applies only to the first class. Nested forks are out of scope in
v1: a fork may not itself be forked. Both classes
remain target-owned mechanically; the local target uses the landed LLP 0097
materialized-copy/overlay substrate and LLP 0158's F0a scrub-and-mint work
rather than a new database engine. One vocabulary dependency is inherited
rather than restated: "derived deployment" is defined by LLP 0158's OQ9
amendment to LLP 0018/0012, which is proposed-normative in a still-Draft RFC.

A profile-conforming fork of either class:

- records its parent, base version or checkpoint, coverage manifest, owner,
  creation operation, and publication receipt;
- carries class-appropriate identity: a derived-deployment fork carries newly
  minted fork identity and no reusable canonical credential (LLP 0158
  scrub-and-mint); an in-app branch carries branch-scoped authority no broader
  than its creator's current grant (LLP 0097);
- denies every unclassified host egress path and captures or simulates only
  effects whose branch adapter is explicitly declared;
- records its durable operations with the same commit-envelope vocabulary;
- has per-principal and per-app limits on live fork count, retained bytes,
  journal/digest work, and lifetime;
- is disposed by default and is reaped on TTL, never pinning the canonical
  replay floor (LLP 0088 §5's independent retention clocks; LLP 0097 §4); and
- reports host-mediated versus end-to-end isolation honestly, preserving LLP
  0097's distinction for client-initiated effects.

Promotability is also a retention fact: at admission, each branch operation's
replay inputs (canonical arguments, ctx answers, effect observations) are
classified under the LLP 0043/0053 retention rules and the protected-lane
custody rules (LLP 0146 supplies the dry-run/explanation vocabulary, not the
retention contract); an operation whose inputs cannot be retained transitions the branch to
non-promotable immediately, recorded on the branch receipt. In a derived
deployment, every profile store — envelopes, suppression records, history,
checkpoints — is classified by LLP 0158's mechanical custody sweep (copy,
scrub, rotate, or refuse) like any other `_snapback_*` table.

The first safety slice may be **deny-all egress** rather than capture or
simulated effect success. That narrower slice is useful and honest only under
its own name: its capability class is `DenyAll`/host-mediated — `CaptureOnly`
stays reserved for LLP 0097's ledger-backed meaning, where denied effects are
recorded as inspectable durable intents — and every bypass test fails closed.
F0a's deny-all posture is the *derived-deployment* class's `DenyAll` slice —
its implementation status is F0a's to report. The in-app branch's equivalent
egress mediation is LLP 0097's own prerequisite, is unbuilt, and is
sequencing step 5(a); a step-3(a) branch cannot execute egress-bearing paths
until 5(a) lands. The capture ledger is deferred work for both classes.

### 4. Journal diff instead of maintained Merkle state

For a fork with a known base, the covered-lane journal is the primary diff
index. Each commit records a canonical write-set digest and exact changed-row
facts for its declared lanes.

The diff surface is two distinct products, named separately even where they
share machinery: an **attributed change sequence** — the ordered
journal-derived list of committed changes with operation and principal
attribution — and a **net base-to-head state diff**. The net diff cannot be
derived from post-image journals alone: update-then-revert, insert-then-delete,
and delete-then-reinsert are indistinguishable from net change without the
base value, and the landed substrate's materialized copy becomes the writable
fork (LLP 0158's spike records the same fact for backup destinations), so the
base is not implicitly retained — a doc/code divergence worth naming: LLP
0097 §Design 1 reads as an immutable base plus overlay, and the landed
`MaterializedBase` comment says the copy is the writable fork; the divergence
is recorded in 0097's implementation lane alongside the promote deviation. A net-diff claim therefore requires an
immutable retained base or first-write preimages recorded per row within the
fork. Each target chooses its substrate — immutable base or first-write
preimages — provided the diff receipt names the choice and the same folding
corpus passes. Net-diff folding is canonical: update-then-revert folds to no
change; insert-then-delete folds to nothing; delete-then-reinsert of an
identical row folds to no change and of a different row to an update; system
fields state their own coverage. Sibling forks of one base are compared
through that common base (each diffs to the base; the diffs are compared) —
v1 offers no direct cross-fork comparison primitive, and frequent
no-common-ancestor comparison is precisely the Merkle revisit trigger's
escalation signal.

Fork diff enumerates those changes from the base
to the fork head and includes:

- base and head stream-qualified commit/checkpoint identities;
- covered and uncovered lanes;
- added, updated, and deleted logical rows;
- schema, system-field, asset, and effect coverage as separate facts rather
  than implied app-row coverage;
- operation and principal attribution by commit-envelope join; and
- a digest over the canonical emitted diff. At runtime that digest is
  **inventory** in v1 — Acceptance 9's independent comparison is a
  fixture-time property, not a runtime derivation — except at the promotion
  boundary, where §5's staged re-execution comparison supplies the
  independently derived expected value; §8's proof class advertises the diff
  surface accordingly.

Journal completeness has a named, enforceable derivation, not fixture
enumeration: covered-lane physical writes pass through a single **write
authority choke point** — a generated transaction API (LLP 0037's
schema-generated pattern) holding an unforgeable lane-writer token — and a
SQLite authorizer denies any write to a covered table arriving outside that
seam, so "complete" means every physical write provably transits the
journaling path, with a compile-level negative fixture (direct SQL to a
covered table is denied) and runtime refusal for anything unregistered.
Until that seam lands, completeness claims honestly downgrade: the diff and
coverage capabilities advertise the enumerated-fixture inventory class, not
completeness.
An unjournaled or unclassifiable path makes the diff capability refuse or marks
the lane missing; it may not silently produce a partial result as complete.

`ContentDigestV1` remains the independent state-proof vocabulary. It is
computed at explicit high-stakes boundaries — migration rehearsal/apply,
promotion, named checkpoint, audit, or a caller-requested proof — rather than
maintained on every ordinary commit. A promotion or audit may independently
apply the expected operation/change facts to the base and compare the expected
digest with the staged actual result. A digest without an independently derived
expected value remains inventory, following LLP 0081.

The shipped `ContentDigestV1` header is migration-shaped — it binds a plan
digest, generation, barrier head, publication version, and also the
algorithm version, schema hash, qualified table, and publication timestamp
(the preimage is migration-instant-bound, not merely migration-shaped) — so each new
boundary (promotion, named checkpoint, audit) must define its own
domain-separated canonical preimage and its independent expected-value
derivation before claiming proof there — with golden vectors committed per
domain before any caller wires in; the promotion digest domain itself
(canonical header, preimage, expected-state derivation from base plus
approved facts, actual-state scan, coverage binding, golden vectors) is
defined by **LLP 0165** (proof domains and checkpoints), whose acceptance is
a named prerequisite for the core tier's boundary-proof component. For a materialized checkpoint
the verification is dual-path over **one pinned source snapshot**: the
checkpoint operation pins a source read snapshot that both the backup and an
independent scanner consume, and the two digests must agree — two code
paths, one value. What that proves is **verified copy fidelity at the pinned
snapshot**, not boundary proof in LLP 0081's predecessor-derived sense, and
the profile claims only the former for checkpoints. The pinning mechanism is
net-new work: the landed `MaterializedBase::materialize` gives the *copy*
internal consistency (it reads the version off the copied pages) but holds
no source transaction an independent scanner could share — whether SQLite's
backup API can run inside a held source read transaction, and the WAL-growth
bound of holding it for a database-sized copy, is a named spike. Without
database-wide `AS OF`, a later scan of the live source cannot recover the
copied version, so the snapshot's transaction and WAL lifetime is part of the
checkpoint operation's declared resource budget, and a snapshot that cannot
be held long enough produces a stable refusal, never a digest over drifted
bytes. Checkpoint publication imports LLP 0158's publication state machine
normatively and completely — staging sentinel (so refusal predates the
data), staged pathname, fsync order, atomic rename as the publication
point, directory fsync, orphan recovery by the rename's verdict, and receipt
linearization — so "a crash leaves no checkpoint or a complete verified one"
is a property of that machine, not an assertion, and its acceptance uses
0158's intra-state crash-cut matrix, not boundary sampling. One declared
deviation from the imported machine: checkpoint *validity* after erasure is
registry-authoritative (unlike fork bootability, which 0158 recovers from
local evidence), because erasure obligations need an authority that can
outvote a self-evident copy. A receipt-only checkpoint's
digest is inventory unless the dual-path verification ran at creation. A
checkpoint digest without an independent derivation remains inventory.

### 5. Promotion stays strict and merge-free

Promotion adopts LLP 0097's staged re-execution design and applies only to the
in-app branch class (§3). It never applies row post-images directly and never
invokes a storage merge.

Re-execution requires a replay-sufficient durable operation log, per LLP 0097
§5: each entry retains canonical argument values, the declared ctx answers
consumed, and any captured or simulated effect outcomes in causal order, with
transitive dependency enforcement — a write that depends on a provisional
effect outcome, directly or through a later operation that read it, stays
provisional or makes the branch non-promotable. Promotion refuses when a
required input, artifact version, or effect observation is unavailable. An
argument digest alone is not replay-sufficient; the log is a named schema in
the follow-on Spec (artifact identity, canonical arguments, ctx answers,
effect observations, causal dependencies, custody classes). When
non-promotability arises late — an uncovered-lane co-write, a non-retainable
replay input — the branch receipt names the specific operation that
foreclosed promotion with a stable diagnostic, so the agent knows what to
change rather than merely that work is lost.

The landed `branches::promote` path applies overlay post-images directly — a
deviation from Accepted LLP 0097 §5, which already forbids driving promotion
from post-images, not a design this Draft supersedes. The fix belongs to
0097's implementation lane and is ticketed there independently of this RFC's
fate; this profile inherits 0097's rule and adds the negative conformance
fixture proving no product path can reach post-image promotion.

V1 promotion requires the canonical head to equal the fork's recorded base
version, and it consumes a sealed approval artifact: a `PromotionRequestV1`
binds the exact reviewed child-stream head (sealed by a branch-head CAS — a
branch write after review invalidates the request), the operation-log digest,
the diff digest, the coverage manifest, the approver's identity and
authority, and a stable promotion identity — the admission-ticket identity,
server-minted at first admission, invariant across rebase and re-seal, and
governed by the host-originator epoch protocol; it, not any
`childStreamId`-derived value, is the aggregate identity of §1. The approval
binds the **approved-facts digest**, which covers the normalized
decision/result facts, the relevant read dependencies (base-relative), the
retained ctx answers, the write set, the effect set, the artifact identity,
and the coverage manifest — LLP 0097 §5's meaning-preservation comparison,
not the write set alone, so identical post-images over a changed base do not
re-seal. When a rebase re-executes the log and reproduces that digest
against the new head, the request **re-seals automatically** against the new
`childStreamId`: the original approver's approval over the digest is
preserved untouched, and the re-seal is recorded as a separately identified
engine attestation, never as a new approval attributed to the original
signer. Any divergence — including different reads or results with
identical writes — forces fresh approval. Promotion revalidates current
principal, grant, policy, manifest, operation
identity, and fence; re-executes the operation log into staging; compares the
resulting write/effect facts with the request's approved facts; and commits
once, as **one canonical transaction and one canonical version** (LLP 0097's
batch rule), writing one aggregate promotion envelope keyed by the promotion
identity with per-source join records at that version — the aggregate
envelope is the retry receipt. The promotion transaction also durably copies
the replay-sufficient log entries' envelope facts (principal, artifact,
arguments, read/write facts) into canonical alongside the join records, so
per-row attribution survives branch teardown rather than dangling as opaque
identifiers.

A branch whose log contains no egress attempts is promotable under a
`DenyAll` egress policy — denial forecloses promotion only for operations
that attempted effects. An operation that writes to an uncovered lane inside
the fork makes the branch non-promotable: equivalence cannot be proved for
writes the journal does not cover.

If canonical state has advanced, promotion refuses. The paved recovery is
**rebase by replay**: the recorded replay-sufficient operation log is
re-executed into a new fork based on the current head, re-diffed, and
promotion re-attempted; divergent re-execution results surface in the fork
diff for review rather than being auto-resolved, because clean re-execution
is not meaning preservation (LLP 0097 §5). This adds no merge and no
advanced-head semantics — it points the already-specified re-execution at a
new base. Beyond that, the strict protocol deliberately trades convenience
for provability. Advanced-head semantic reconciliation remains a separate
future RFC.

Contention is answered by the engine, not etiquette, because the pinned
first consumer is a fleet of concurrent agents forked from one head.
Promotion admission is **serialized per canonical stream**: attempts are
admitted one at a time in admission order, so of k concurrent forks exactly
one promotes per admission cycle and the rest observe a deterministic
refusal, not a race. Admission is fair, not merely serial: a fork that loses
holds a FIFO admission ticket that its rebased successor inherits, so a slow
or large-log agent is not deterministically outraced by newly arriving
forks, and the rebase budget scales with the observed concurrent-fork count
rather than being a constant chosen blind to k. Exhausting the budget
refuses with a stable contention-exhausted diagnostic that distinguishes
"lost the head again" from "re-execution diverged," and the aggregate
contention rate is an app-level fact the admission queue exposes rather than
a per-principal quota that cannot see it. The progress guarantee is
**conditional fairness with a declared model**, not an unconditional claim:
promotion admission serializes only promotion — ordinary canonical mutations
advance the head outside it — so bounded eventual progress for all k forks
holds when promotion arrival stays below admission service capacity and
replay work per fork is finite, and the engine adds one bounded escalation
to keep the condition reachable: after a ticketed fork loses R consecutive
cycles, its next cycle takes a **bounded head reservation** — ordinary
mutation admission on that stream is deferred for a declared, bounded
interval while the re-sealed promotion commits. Reservations are quotaed per
app and stream (a principal cannot repeatedly defer application traffic by
losing on purpose), a maximum promotion-commit duration is declared, and a
reservation that expires mid-attempt aborts the attempt cleanly with the
ticket retained. Ticket lifetime equals the fork's TTL, which must exceed
the fork's expected service time under the observed queue depth (a declared
condition, not an assumption); the rebase budget is a declared function of
queue position, the reservation threshold R, and observed losses, with the
observed concurrent-fork count as its floor. Reservation-quota sufficiency
for the observed loss pattern is itself a declared term — quota exhaustion
yields the contention-exhausted diagnostic as an honest declared outcome
outside the fairness claim, never a silent stall. Under those declared
terms, bounded eventual progress is an
acceptance property; outside them, the contention-exhausted diagnostic is
the honest outcome. The measurement gate's mutation-latency metrics include
p99 under promotion contention so the reservation's cost is measured, not
ambient.

### 6. Bounded history and named checkpoints

The profile exposes **bounded record-change history**, not arbitrary
database-wide temporal SQL. For a covered record it can show the retained
sequence of journaled post-images/tombstones, commit provenance, operation
identity, and change disposition. Where the retention window lacks a complete
predecessor anchor, the response says so and does not claim reconstruction of
the earlier row state.

Bounded history adopts LLP 0088 §1/§5/§6 as its owning design rather than
restating a parallel one: history is per-table opt-in declared in the schema
with a bounded retention window surfaced in the manifest; v1 has no unbounded
option; a query past the retained horizon is a normal condition answered with
a stable horizon marker, not an error; and history retention and sync-resume
retention run on independent clocks — history may never pin the canonical
replay floor. LLP 0088 is Draft and gated on the LLP 0085 evidence review;
that gate is a dependency of this component, not overridden here.

A named checkpoint comes in two declared substrate classes. A **materialized
checkpoint** is a consistent physical copy taken by an explicit operation (the
local target uses SQLite's backup primitives); its cost is proportional to
database size, is charged to the retention owner, and it alone can base a
(non-promotable) fork. A **receipt-only checkpoint** is a durable boundary
receipt — schema identity, stream-qualified commit version, coverage manifest,
and optional independently verified `ContentDigestV1` — with no retained
state; it supports later proof and audit but cannot materialize the past by
itself. Neither class pins the canonical replay floor: a materialized
checkpoint retains its own copy, not canonical journal history. Migration,
fork, deployment, incident, and explicit agent operations may create
checkpoints, declaring the class. A fork's pinned base is a lighter receipt of
its own materialized copy, not automatically a named checkpoint. (The corpus
uses "checkpoint" in other senses — LLP 0075's protocol checkpoints, LLP
0090's resumable query snapshots, LLP 0081's rehearsal checkpoints, and
`ContentDigestV1`'s own stream-accumulator checkpoints; a named
database checkpoint here is none of those.) A checkpoint is a
read-later/rehearsal primitive, not a promise that every intervening commit
supports relational `AS OF`.

History reads authorize fail-closed under the two-part rule this RFC states
normatively (agreeing with LLP 0088 §6, whose history-tier landing OQ8
tracks): the caller must be authorized for the record **now**, and
the read policy is additionally evaluated against **each historical
post-image**, dropping versions that fail — failing versions are elided, not
disclosed. 0088 explicitly rejected the cheaper current-row-only gate because
it leaks formerly-visible field values; this profile inherits that rejection.
The same per-version rule extends to retained explanation detail and
fork-diff rows, which are historical row values by another name. For
non-row facts **this RFC owns the rule** (LLP 0088 is the analogy, not the
source — its design has no non-row fact categories): the **current** read
policy evaluates each retained fact; no historical policy version is loaded,
because a retained policy series is exactly the historical representation
this profile's non-goals decline. The residual specific to non-row facts is
the missing first gate — there is no current record to be "authorized for
now," so the current table/lane admission gate below stands in per fact
class. The today's-policy-over-yesterday's-facts bound applies to row and
non-row facts alike and is accepted for both; if it proves harmful in
practice it is a revisit trigger, not a silent behavior. Within that
shape, missing-row and predicate facts evaluate against their table and lane
policy; result-membership facts evaluate as the query's own read would; ctx
answers and effect payloads live in protected-lane custody and are redacted
for callers without it; and pagination and horizon markers never disclose
the existence of elided versions or rows. Possession
of a commit, operation, or checkpoint identifier is not authority.
Revoked credentials cannot settle effects or promote a retained fork.

Retention is always bounded; an explicit owner may extend it only through
finite renewable leases with a mandatory maximum duration (LLP 0088's
no-unbounded-option rule), and only independently materialized checkpoint
copies — never history rows — may outlive the history window.
Garbage collection preserves active fork bases, named checkpoint roots, open
operation receipts, and the minimum explanation facts required by policy, then
reclaims expired detail and materialized state. Deletion and erasure
obligations override pins: a protected-lane erasure applies to retained
detail, history post-images, and materialized checkpoints, and the receipt
records the erasure rather than silently keeping the bytes. Materialized
checkpoints participate through custody: every copy is registered at creation
with an owner and location class; erasure marks the checkpoint invalid in the
registry so later use fails closed, destroys reachable copies (or shreds
their keys where copies are encrypted at rest), and records on the receipt
which copies were destroyed versus marked invalid but unreachable. An
unreachable copy is an honest open erasure obligation, not a silent success.

### 7. Deterministic replay and schema evolution keep their narrower strengths

Queries and mutations retain the existing deterministic execution tier:
ambient time/randomness remain denied, declared ctx answers are recorded, and
re-execution consumes those answers. The commit envelope makes the replay
scope, artifact identity, and retained inputs discoverable. It does not turn an
action into a deterministic handler.

Branch effect handling follows LLP 0097: deny, capture, or declared simulation
inside the branch; durable fenced settlement only after canonical promotion.
An effect-outcome-dependent write remains provisional or makes the branch
non-promotable.

Schema evolution continues to use LLP 0081's typed plans, rehearsal, approval,
receipts, independent verification, compatibility decisions, and stable
refusal. This profile adds checkpoint and commit-envelope integration. It does
not add a general bidirectional-lens runtime. A future lens proposal must name a
closed transformation algebra, complement-data rules for lossy transforms,
index/query implications, and executable round-trip laws.

### 8. Capability honesty

Targets advertise orthogonal facts rather than one over-broad boolean. Exact
wire names belong to the schema follow-on, but the capability vocabulary must
distinguish at least:

- commit-envelope coverage by durable lane;
- read/write explanation detail and retention class;
- fork capability as orthogonal axes: egress policy (`Missing` | `DenyAll` |
  `CaptureOnly`), promotion (`NotPromotable` | `Promotable` — a `DenyAll`
  branch with no egress attempts may be `Promotable`), base (`currentHead` |
  `namedCheckpoint`; promotion exists only at `currentHead`), and
  host-mediated versus end-to-end isolation. These changes are carried as a
  **dated proposed-normative amendment to LLP 0097** (2026-08-03, effective
  when this RFC is accepted) whose declared scope is every 0097 section it
  touches: §Capability classes (the axis split and the `DenyAll` value),
  §Acceptance (the fixture substitution below), §5's promotion protocol (the
  serialized fair admission, bounded rebase budget, rebase-by-replay, and
  `PromotionRequestV1` additions of this RFC's §5), and the claim boundary
  where it names branch capability values. 0097's ordered `Missing` |
  `CaptureOnly` | `Promotable` maps to (`Missing`, any), (`CaptureOnly`,
  `NotPromotable`), and (`CaptureOnly`, `Promotable`) respectively, so an
  existing three-value report translates losslessly; a (`DenyAll`,
  `Promotable`) target passes 0097's acceptance corpus with the
  effect-settlement fixtures replaced by negative fixtures proving its
  attempt markers are empty and that any egress attempt forecloses
  promotion. That combination is named **`Promotable(noEffects)`** — a
  strictly narrower claim than 0097's `Promotable`, whose staged-settlement
  half it has never exercised — and it must not be reported as 0097's
  `Promotable`: the reverse projection for legacy three-value consumers maps
  it to `Missing`, a deliberate, documented under-claim (projecting to
  `CaptureOnly` was considered and rejected because it would assert a
  capture ledger that does not exist; 0097's honesty rule forbids
  over-claiming, and consumers wanting the truth read the extension). The
  projection is total: any (egress, promotion) pair maps to the greatest
  0097 three-value claim it fully satisfies, so (`DenyAll`,
  `NotPromotable`) — the expected intermediate state between sequencing
  steps 5(a) and 6 — also projects to `Missing`;
- diff coverage by data/effect lane;
- history class (`Missing`, bounded changes, named checkpoints);
- proof class (recorded inventory, `verifiedCopyFidelity` for the checkpoint
  dual-path claim, or independent boundary proof — the middle value exists so
  projections cannot upgrade copy fidelity into 0081-sense proof);
- replay class (deterministic handlers versus nondeterministic actions);
- schema-evolution class (proofs with no lens claim); and
- admission/resource-bound class.

These class values are a versioned capability-manifest extension carried
beside LLP 0134's maturity registry, not forced into it: the extension itself
registers as a `TargetCapabilityId` whose maturity (soak, promotion registry,
demotion) is 0134's business, while the multi-valued class facts live in the
extension because `TargetCapabilityId` is a closed boolean-membership enum
that cannot carry them; manifest validation enforces mutual exclusion within
each axis. Capability claims are per-target; whether an app exercises a
claimed capability (history, for example, is per-table schema opt-in) is an
app fact that does not change the target's advertisement.

The v1 aggregate is closed, and it is layered so no tier is hostage to a
document this RFC does not own. **`AgentSafeV1-core`** requires, on the local
target: the ordinary Ibex mutation lane and the host-plan settlement lane
(the latter advertised at `clientSuppliedValidated` provenance while LLP 0007
Option A is unratified), each with envelope coverage and explanation;
**in-app branch** support with a declared egress policy of `DenyAll` or
`CaptureOnly`; branch promotion; exact diff; and boundary proof, where the
boundary proof the core requires is the promotion domain (migration proof is
LLP 0081's, and the checkpoint domain gates the checkpoint capability).
Derived-deployment fork support is **not** in core: it is a separately
advertised additive capability gated on LLP 0158's acceptance, and the
derived-deployment legs of Acceptance 5 and 7 gate that capability rather
than the core tier (the Acceptance preamble's row mapping carries this
carve). The fork-at-checkpoint affordance named by the as-of revisit trigger
therefore applies only where this additive capability is advertised. The core's provenance
rule is that **no core component depends on a decision owned by a document
this RFC does not control** — the promotion proof domain's focused Spec is a
named prerequisite this RFC commissions and controls, which is the one
in-family exception the table shows — stated per component rather than as a
blanket status claim:

| Core component | Owning document | Status | Dependency |
|---|---|---|---|
| Branch substrate, promotion | LLP 0097 (+ dated amendment above) | Accepted, gate unpassed | decided |
| Envelope, explanation | this RFC (umbrella) / LLP 0163 (contracts, schemas) | Accepted / Draft | decided here |
| Diff surfaces | this RFC (umbrella) / LLP 0164 (contracts, schemas) | Accepted / Draft | decided here |
| Promotion proof domain | LLP 0165 | Draft | named prerequisite |
| Derived-deployment forks | LLP 0158 | Accepted | **not core** — additive capability; distinct qualification and publication remain `Missing` |
| Host-plan lane contract | LLP 0007 | Draft (shipped; Option A unratified) | provenance labeled `clientSuppliedValidated` until ratified |
| Identity/settlement widening | LLP 0133 / 0043 amendments | Spec Accepted / RFC Draft (shipped) | decided contract, dated amendments pending |
| Client conformance | LLP 0012 / 0095 amendments | Draft (shipped) | decided contract, dated amendments pending |
| Read-surface conventions | LLP 0004 (+0017/0024/0042) | Draft (shipped conventions) | shape only |
| Scoped grants | LLP 0055 | Review (shipped) | decided contract |
| Effect vocabulary | LLP 0066 | Review, unowned taxonomy | classification labels only |

The committed contract details and artifact schemas are owned by the
extracted Specs — LLP 0163 (operation identity and commit envelope), LLP
0164 (fork and promotion), LLP 0165 (proof domains and checkpoints) — under
LLP 0037's generated-schema pattern; this RFC remains the profile umbrella.

**This RFC owns the per-version authorization rule for retained
explanation detail and fork-diff rows in the core tier** — §6 states the
two-gate rule normatively here rather than importing it, and OQ8's
supersession question applies only to the history tier.
**`AgentSafeV1-history`** is
an additive tier gated on LLP 0088's acceptance, adding bounded record
history and its authorization corpus. Uncovered *specialized* lanes do not
block the core aggregate — core certifies its enumerated ordinary lanes
while those absences stay visibly advertised as `Missing`. Receipt-only
checkpoints without dual-path verification are a separately named
inventory-only capability and join no aggregate. Conformance is two separate facts:
*target support* (the machinery exists and passed acceptance) and
*app-effective coverage* (the projection of covered lanes, opted-in history
tables, and retained classes this app actually has); the unqualified
aggregate claim requires both, and agents plan against the app-effective
projection. Specialized lanes (migration, durable background work, push,
auth) advertise individually and join the aggregate only through OQ7's
receipt bridge. If any component demotes under LLP 0134's rules, every tier
containing it demotes with it. A target with a missing component advertises
the individual capabilities it actually has.

Publication-proof algorithms are capability facts too. A digest or verdict
history is interpreted only under the explicit algorithm/schema version named
by its carrier, receipt, and named-author acceptance; an older artifact is not
silently reinterpreted under a newer checker. `snapback.review-verdicts.v2`
and `snapback:agent-safe-implementation-tree:v2` are the minimum publication
contracts after the round-6 repairs below. A v1 receipt, acceptance artifact,
or verdict history may remain retained evidence behind a `withheld` anchor,
but it cannot establish target support or app-effective coverage and must
refuse with a version-specific re-qualification diagnostic if presented for
publication.

### 9. Storage engine and portability

Stock SQLite remains the canonical local physical engine. This RFC introduces
no new page format, WAL, query planner, temporal table layout, or mandatory
storage server. It preserves application-shaped SQL tables and the direct local
inspection/brownfield properties valued elsewhere in the corpus.

The portable contract is the operation/envelope/fork/diff/history/proof
semantics, not SQLite copying, filesystem reflinks, Durable Object bookmarks,
Postgres schemas, or a vendor-specific Merkle root. Each target owns its
mechanics and passes the same semantic corpus before advertising parity.

Dolt, DoltLite, another version-native engine, or a Snapback-maintained Merkle
layer may be evaluated as an opt-in target or future implementation. No v1
receipt, proof, cursor, or application API depends on one, and adopting one is
not part of this RFC.

## Performance and simplicity budget

The profile earns its 80/20 label only if the common path stays simple and
measured.

### Structural budget

- Ordinary current-state reads add no history join, temporal predicate,
  Merkle-root lookup, branch overlay, or extra storage round trip.
- Ordinary covered writes add a bounded number of metadata records plus detail
  proportional to the captured read/write/effect facts. They perform no
  full-table scan and no per-row Merkle-ancestor update. Bounded per-record
  history additionally requires a `(table, row, version)` journal index —
  per-row write amplification — and the explanation enumeration surface (§2)
  requires a principal/time index on envelopes — per-operation amplification;
  the two costs are measured separately in the bytes-written metric, named
  here, not silently absorbed.
- Full content digest computation, checkpoint copying, and historical
  materialization are explicit operations with progress and resource budgets.
- Fork and retention garbage collection are demand-driven or bounded; they do
  not introduce idle polling or periodic writes on an idle local app.
- Explanation payloads and effect observations are size-bounded and redact or
  refuse secrets rather than turning provenance into an unbounded data lake.

### Measurement gate

Each metric gates the component it measures — read/write/idle metrics gate
the envelope and explanation components; fork, diff, promotion, and reap
metrics gate the fork and promotion components; the full list gates only the
aggregate — so early sequencing steps can advertise their components without
waiting for promotion to exist. Before a component may be advertised above
`Missing` (the claim boundary in §Summary), the same fixture corpus and
protocol must compare the dated named baseline artifact against the
profile-bearing build for:

- current-state point/range/query-plan reads;
- warm-VM single-writer mutation throughput and p50/p95 latency;
- fan-out cost for the existing local benchmark shapes;
- bytes written and retained per changed logical row and per operation;
- idle CPU, resident memory, and disk writes;
- fork creation, diff, promotion, and TTL-reap latency at representative data
  sizes; and
- crash/reopen behavior at every envelope, publication, promotion, and effect
  settlement cut.

The comparison baseline is a dated, named baseline artifact, not a runtime
toggle: the profile defines no supported profile-off mode, so profile-off
numbers come from the pre-profile baseline binary re-measured under the same
protocol. LLP 0035's current numbers are explicitly single-run
order-of-magnitude evidence, so a statistically controlled baseline must be
recorded before this gate can run: fixed hardware class and fixture sizes,
declared warm-up, a declared run count, median plus spread, and per-metric
equivalence bounds with explicit formulas for throughput and latency
regression. The guardrail is normative, not proposed: no read-path
regression beyond the equivalence bound, no new idle CPU or disk writes, and
no more than a 15% regression in warm single-writer throughput and in
mutation latency (p50 and p95, each judged individually). The revision and
exception authority is **the author, by dated revision to this RFC** — LLP
0130's standing decisions do not currently cover this document, and claiming
them would require a new SD there, which is not asserted. Exceptions are
bounded, not open-ended: no exception may pass a metric beyond twice its
threshold; an excepted metric is re-measured after the next component lands;
and an exception holds the affected capability below `Stable` under LLP
0134's maturity rules until it re-measures within threshold. Every exception
is ratified before capability promotion, names a documented benefit, and is
recorded next to the baseline artifact, never silently absorbed. Acceptance
13's pass condition is the thresholds in force
in this section at measurement time. Creating the baseline artifact is
sequencing step 0. The fork/diff latency metric doubles as the instrument for
the Merkle revisit trigger's first condition.

#### Step-0 baseline record — 2026-08-03

The named artifact is
[`agent-safe-step0-pre-profile-2026-08-03`](../tests/acceptance/fixtures/agent-safe-storage/performance-baseline.2026-08-03.v1.json),
generated by
[`crates/snapback/src/bin/snapback-agent-safe-step0.rs`](crates/snapback/src/bin/snapback-agent-safe-step0.rs).
It pins pre-profile revision `2ab36e28c74c450213b65f17ef81c0d6652ba33a`
plus exactly three instrumentation paths (`crates/snapback/src/bench.rs`,
`crates/snapback/src/bin/snapback-bench.rs`, and the dated runner), built in release mode on a
Mac17,3 / Apple M5 / 10 logical CPU / 32 GiB hardware class under macOS
26.5.2, Rust 1.97.0, and Cargo 1.97.0. No profile implementation path is in the
baseline source.

The fixed protocol performs one unrecorded whole-run warm-up, four local
warm-ups per metric, and 11 fresh-fixture recorded runs. It reports the median,
median absolute deviation, min, max, and every raw run. Candidate comparison
uses paired candidate/baseline run ratios and a deterministic bootstrap over
the 11 ratios; the 90% interval must lie wholly inside the registered bound.
Latency regression is `100 × (candidateMedian − baselineMedian) /
baselineMedian`; throughput regression is `100 × (baselineMedian −
candidateMedian) / baselineMedian`. Read equivalence is 5%; mutation
throughput, p50, and p95 are each bounded at 15%. Idle CPU resolution is 5,000
µs per five-second sample across 11 fresh idle fixtures, idle RSS equivalence
is 5%, and idle disk requires zero output block operations plus unchanged
database-family bytes.
The runner refuses to start while another `cargo` or `rustc` process is present
on the fixed machine, so compilation from another worktree cannot silently
enter the dated record.
Crash/reopen cut matrices are correctness gates: the pre-profile source has no
envelope/publication/promotion/effect-settlement boundary, so each candidate
component must pass its named cut corpus before advertisement.

The baseline medians include 3.292 µs point-read p50, 56.583 µs range-read
p50, 25.375 µs query-plan-read p50, 129.481 mutations/s, 7,709.416 µs mutation
p50, 7,767.167 µs mutation p95, 74,000 allocated file-family bytes and zero
additional retained file-family bytes for the one-row/one-operation fixture.
The 11 five-second idle samples record median/MAD user CPU of 7/1 µs and
system CPU of 13/1 µs; every sample has zero output block operations, zero RSS
delta (42,416 KiB before and after), and zero database-family byte delta
(1,145,176 bytes before and after). These are comparator observations, not
capability claims. Fork creation/diff/promotion/reap have no honest pre-profile
product comparator; their first implementation must record absolute latency
and obtain a dated bound beside this artifact before advertisement.

This record completes sequencing step 0. It did **not** pass Acceptance 13 by
itself: the profile-bearing candidate comparison had not yet run, and every
capability remained `Missing`.

#### Fixed-Air failed candidate and protocol repair — 2026-08-04

Clean candidate `e6412b9b24887322d0fdb07bdd65b8e8bd86edbf` produced a paired
record with SHA-256
`24ff252962d3f12b17c8dbb883c2a9f9052ea2b6d0413b5573681e2d8917798a`.
It failed the registered point-read p50/p95, idle CPU, and idle RSS gates and
therefore authorized no status or capability change. Review traced the point
cost to a dormant mutex-backed SQLite authorizer callback and the idle cost to
the candidate retaining a full `LocalSnapback`: its queued lifecycle telemetry
flushed three seconds into a window whose contract says setup is outside the
measurement.

The repaired protocol changes no bound or estimator. Dormant databases install
no writer authorizer until a manifest is activated; active and reopened
connections retain the fail-closed authorizer and zero statement cache. The
candidate performs real range issuance and durable coverage activation, then
consumes the carrier into that same armed `LocalDatabase` before sampling.
Dropping and joining unrelated runtime services outside the window gives the
candidate and baseline the same retained storage object while the issued range
and active coverage state remain live. The failed record remains evidence, not
a result that may be overwritten or reclassified; a new clean revision must
rerun every original paired and absolute gate.

The next clean candidate, `949db8be40e43cdbd7449a58b70550f6e18d2098`,
passed every read/write comparison plus idle CPU and disk. Its preserved record
(SHA-256
`29be1887ef5d5a85d14c909f8e68b6686e132907a818b1f2a217174d4ee86032`)
still failed the unchanged RSS bound: median 5.88%, deterministic-bootstrap
90% interval 5.41–6.40%. That run exposed a second harness asymmetry. Baseline
idle followed the dormant report workload, while candidate idle followed the
extra active envelope/write fixtures as well, so their transient allocation
and code-page footprints were being counted as idle resident state.

The candidate worker therefore records active read/write metrics in its parent
process and delegates idle to a fresh child of the same release executable.
The child first runs the dormant comparator workload, then activates and holds
the real storage manifest/range fixture for five seconds. This separates the
registered per-metric fixtures while retaining the active product state under
test; it does not discard active storage, change the RSS formula, or introduce
an exception. The second failed record also remains evidence, and a new exact
clean revision must rerun the complete paired and absolute protocols.

The next clean candidate, `1364781e48c35686eb0c89b543a7ab9287de2f01`,
again passed every read/write comparison plus idle CPU and disk. Its preserved
record (SHA-256
`2856a1eb3fd2081d49f551e8458a687146f365eece521a835656620190ca9abd`)
honestly failed the unchanged RSS bound at median 5.2108%, with a
deterministic-bootstrap 90% interval of 4.9324–5.8917%. No exception is
ratified. The result remains failed evidence and cannot qualify publication.

The near-bound result makes unused connection-local SQLite pages touched by the
rare manifest publication and validation transaction a plausible target, not a
proven cause. The shared production `WriterAuthorityV1::arm_manifest` seam now
issues SQLite's advisory `shrink_memory` request after disabling statement
caching and installing the in-memory manifest, then installs the
connection-local authorizer before returning. This preserves the same
connection, durable manifest, finite issued range, and fail-closed authorizer.
The request is shared by authenticated local-target activation and the evidence
fixture; it is not a candidate-only fixture reset, and only a new fixed-Air run
can establish whether it changes RSS. No threshold, protocol, estimator, or
claim changes. A new exact clean revision must rerun the complete paired and
absolute protocols, and every capability remains `Missing` until it passes.

#### Absolute-operation bound ratification — 2026-08-04

Charlie ratifies the following hard ceilings before the final Track B
fixed-Air measurement. On the recorder's fixed 512-logical-row,
one-changed-row, one-operation fixture, the medians must be at most 1,000 µs
for fork creation, 2,500 µs for exact diff, 7,500 µs for strict promotion,
and 250 µs for TTL reap. Across the fixed 128 samples and eight file-backed,
active issuance-bearing ordinary-mutation carriers whose first requests are
held behind the production 1,000-ms promotion reservation, request-to-COMMIT
p99 must be at most 1,250,000 µs. The policy's separate maximum
promotion-commit duration remains 500 ms.

The preserved 2026-08-03 integrated observation informed these ceilings, but
the final candidate result did not: the limits are registered here first and
the final recorder fails closed instead of writing a passing artifact when any
ceiling is exceeded. They are absolute safety/performance guardrails for the
named fixture, not estimates of user-visible end-to-end latency and not an
exception to any comparable-path threshold above.

#### Fork-lifecycle bound ratification for the narrow `operating.instance-forks` claim — 2026-08-06

This subsection transcribes into this RFC — the named revision authority —
two author rulings previously recorded only in LLP 0185's revision header,
the acceptance-tail ticket, and the dated bench artifact itself.

On 2026-08-05 the author scoped row 13 for the narrow local
`operating.instance-forks` claim (LLP 0185 Phase 0 item 6 / OQ6 ruling) to
**fork lifecycle metrics only**: derived-fork creation (cold small parent,
cold 32 MiB parent, live parent), drop, attributed diff and net diff at 10k
journal rows, reap sweep, and concurrent creation. On 2026-08-06 the author
ratified these median-gated ceilings: create ≤ 2 s small / ≤ 3 s at 32 MiB /
≤ 2 s live; drop ≤ 1 s; attributed diff ≤ 500 ms and net diff ≤ 750 ms per
10k rows; reap ≤ 1 s per sweep of three; and concurrent 3-create wall time ≤
3× the sequential-create bound. The bounds are asserted mechanically by
`crates/snapback/tests/instance_fork_bench_v1.rs` (release profile, `--ignored`), so a rerun
is a pass/fail row-13 gate; the dated receipt is
[`instance-fork-lifecycle-bench.2026-08-06.v1.json`](../tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json)
(`ratifiedBy: "LLP 0162 author (Charlie), 2026-08-06"`).

This narrowing governs only the additive derived-deployment fork claim
(§8's not-core capability). It does not modify, substitute for, or rescope
Track B's storage-engine paired and absolute gates, whose protocol and
thresholds are unchanged above. For the narrow claim, the remaining row-13
need was a second-platform (Linux) run of the same bench; the 2026-08-06
macOS aarch64 ratification receipt alone does not generalize across
unmeasured platforms.

*Second-platform closure — 2026-08-06 (later the same day):* both
platform-qualified receipts landed at integrated commit `4444767cc` —
[`instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json`](../tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json)
and
[`instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json`](../tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json)
— every ratified median bound passing on both. Row 13 for the narrow claim
is measurement-complete for those two named environments; receipts must be
re-run and re-bound when the qualification commit advances because the
claim-relevant scoped surface changed (LLP 0189 D-3, 2026-08-07 — this
narrow-claim lifecycle ratification is governed by the D-3/D-6 default;
the Track B row 13 storage-engine paired protocol itself remains the
named D-7 carve-out and is unchanged). No further platform is claimed.

#### Candidate and absolute-operation records — 2026-08-03

The comparable candidate artifact is
[`agent-safe-profile-candidate-2026-08-03`](../tests/acceptance/fixtures/agent-safe-storage/performance-candidate.2026-08-03.v1.json).
It was produced from clean revision `33357bc3c2cf45166c24cc7ee6e139e98973e536`
on the exact Mac17,3 / Apple M5 / 32 GiB baseline machine and Rust/Cargo 1.97.0
toolchain. Its arithmetic verdict passes all registered comparable
point/range/query-plan read, warm single-writer, allocation/retention, and idle
CPU/RSS/disk thresholds. The audit found that the runner ordinal-zips the
earlier historical baseline runs with later candidate runs; those samples were
not experimentally paired or interleaved. The artifact also names rather than
digests the baseline in its original runner output; the post-run audit adds the
committed baseline SHA-256
`d28d8514f48db3f8a0e4d0c33a1381f12e4ad13eaf6a69187aef9b7fe822ab91`).
That later binding cannot retroactively establish a measurement-time protocol.
Consequently this is useful exploratory evidence, not a fully qualified pass
of the accepted paired protocol. Independently, no production target activates
the public issuance-bearing covered lane, so the run does not prove that lane's
active-path overhead or pass its correctness corpus.

The first attempted candidate record was rejected before publication because
the recorder incorrectly serialized an empty dirty-path set as `unknown`; it
also contained a noisy point-read-p95 sample outside the equivalence interval.
After the recorder defect was fixed, the protocol was rerun once and the clean
passing artifact above is the dated record. A future active-lane measurement
must be confirmatory rather than treating this replacement run as evidence for
an unexercised component.

The no-comparator absolute record is
[`agent-safe-fork-promotion-absolute-2026-08-03`](../tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.2026-08-03.v1.json),
from clean revision `83d0e71901357733293f66a5b125991bbfd892f8` on the same
machine. Over 11 fresh fixtures it records median/MAD latencies of
171.250/0.625 µs for fork creation, 694.375/4.375 µs for exact diff,
1,500.208/20.875 µs for promotion, and 27.625/0.166 µs for TTL reap. The
artifact itself records that the RFC author has not ratified absolute bounds;
p99 contention is also unmeasured. Revisions between the comparable candidate
and absolute record only repair benchmark fixture-clock expiry and canonical
row ordering. Later revisions materially harden promotion tickets, proof/write
authority, schema/request retry binding, and host-ticket lifecycle, so the
historical record is preserved rather than treated as final-code performance
evidence.

The integrated successor is
[`agent-safe-fork-promotion-absolute-integrated-2026-08-03`](../tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.integrated.2026-08-03.v1.json),
from clean revision `882a337fe5a71ad0b65497d98c44338ec4d44870` on that same
Mac17,3 / Apple M5 / 32 GiB machine. Its 11 fresh fixtures record median/MAD
latencies of 219.333/3.001 µs for fork creation, 707.959/6.501 µs for exact
diff, 2,227.292/23.875 µs for promotion, and 29.458/0.583 µs for TTL reap.
The run discovered and then followed a canonical textual-row-order repair; its
source revision includes the regression test and the artifact identifies that
immutable revision. It still records `boundRatification` as `Missing`, makes no
p99 contention measurement, and keeps the fork/promotion claim boundary
`Missing`.

These records make Acceptance 13 **Partial**, not passed: the comparable
binary observations are within threshold, while a valid paired/interleaved and
baseline-digest-bound protocol, active covered-lane measurement,
author-ratified fork/promotion bounds, p99 contention evidence, and the
applicable crash-cut corpora remain open. No exception is requested and every
capability remains `Missing`.

## Security and privacy

- Envelopes store identities and canonical digests, not reusable credentials.
- Raw arguments, ctx answers, read/write details, and effect observations are
  classified before retention; secret or regulated content is redacted,
  encrypted in its owning protected lane, or refused.
- Explanation, diff, history, and checkpoint reads authorize separately from
  current application reads and fail closed when the target cannot prove the
  required policy.
- Authority is checked at initial admission, promotion, and each asynchronous
  effect attempt. Historical authority is evidence, never automatically reused.
- Operation identity does not grant authority and does not make a secret
  receipt publicly discoverable. The envelope is evidence, never a second
  authority: envelope-recorded authority identifiers may be used only as
  lookup keys into current authority state — no envelope field may supply an
  authorization *result*.
- Digests over low-entropy arguments or identities are domain-separated and,
  where exposure would create an offline guessing oracle, keyed.
- Quotas cover live forks, retained bytes, history pins, digest work, effect
  captures, and explanation detail; exhaustion produces stable diagnostics and
  never degrades into an unbounded best effort.

## Acceptance

The full profile claim requires all of the following on the local reference
target; each tier advertises when its own rows pass — rows 1–4, 13, and 14
gate the envelope/explanation components, rows 5–10 the fork and promotion
components (with the derived-deployment legs of rows 5 and 7 gating the
additive derived-deployment capability, not core, per §8), row 12 the
boundary-proof component (together, the core tier);
row 11's record-history half gates the history tier and its checkpoint half
the checkpoint capability. Row 13's applicable submetrics gate every
component and tier individually; the complete metric set gates only the
aggregate:

1. **Atomic envelope:** crash cuts around a covered mutation reveal either no
   data/journal/envelope/receipt change or the complete committed set. Direct
   invocation of either writer seam after ACK and compact-envelope pruning
   reclassifies the tombstone transactionally and rolls back every staged app
   and journal write rather than republishing the identity.
2. **Retry settlement:** identical retries return the stored receipt without a
   second write — including a host-initiated retry after a crash; identity
   reuse with any divergence in the bound identity facts refuses stably,
   including reuse under a divergent audience or principal; an in-flight
   first attempt under an open lower epoch is admitted normally while a
   genuinely reclaimed identity refuses; a restored client store, a
   torn-down-and-recreated branch, and a restamped old identity each produce
   the declared outcome rather than a silent duplicate; an identity minted
   before issuer termination but first delivered after floor advancement is
   classified outcome-unknown, never terminal `failed`; crash cuts around
   range preallocation and client range persistence preserve exactly-once; a
   retry answered from a surviving compact envelope receives the stable
   `result-expired` outcome-known disposition; the epoch-closure predicate
   cannot advance a floor past a live unacknowledged receipt, including when a
   later ready epoch closes before an earlier open epoch; with two
   identities in one open epoch, reclaiming the acknowledged one leaves a
   tombstone so its retry answers `result-expired` rather than executing as
   novel, and tombstone reuse separates authorization-fact divergence from
   other identity divergence without retaining the underlying facts; exact
   response-loss re-service preserves custody through four bounded ranges, a
   fifth same-epoch range refuses atomically, and offline exhaustion degrades
   to the disclosed uncovered queueing disposition; receipt-only
   operations sharing one snapshot version keep distinct
   envelopes keyed by operation identity; and after every envelope and
   suppression record for an identity has been reclaimed, a retry bearing a
   below-floor epoch still refuses with `identity-horizon-passed` rather than
   re-executing.
3. **Provenance and explanation:** a committed row change joins to its
   operation, principal, authority, artifact, and retained read/write facts —
   at a promotion version, through the write-fact-granularity per-source join
   records to the originating branch operation;
   expired detail reports `detail-expired`, capture-bounded detail reports
   `detail-truncated`, a surviving envelope whose journaled rows were pruned
   reports `journal-expired`, and none fabricates an empty explanation;
   bounded enumeration by principal/session/time authorizes fail-closed;
   an aggregate whose constituent authorization cannot be evaluated after
   expiry or truncation returns `authorization-unprovable` under changed
   grants rather than disclosing counts or digests; non-row
   explanation facts (missing-row, predicate, membership, ctx answers,
   effects) authorize fail-closed per their fact class under changing
   principals and grants.
4. **Coverage honesty:** every declared lane has positive and bypass fixtures;
   an undeclared or unjournaled lane cannot produce a complete diff/proof
   claim; and manifest fixtures compare target support with app-effective
   coverage, proving missing specialized lanes remain visibly missing.
5. **Fork isolation:** proved per class — in-app branch writes over the
   materialized base plus overlay are invisible to canonical and sibling
   branches, and derived-deployment fork isolation is proved under its own
   declared model; canonical writes after the base are invisible to the
   materialized base in both classes.
6. **Effect quarantine:** every host egress family is denied or, where the
   class declares capture, captured in the fork, with negative bypass tests;
   the `DenyAll` attempt marker survives branch crash and reopen;
   client-side scope is reported separately.
7. **Identity and authority:** proved per class — canonical credentials are
   absent from a derived-deployment fork, while an in-app branch proves
   canonical-capability non-reachability under branch-scoped authority no
   broader than its creator's; revoked or stale authority blocks promotion
   and later effect settlement in both classes.
8. **Resource containment:** count, byte, digest, and TTL limits refuse or
   reap deterministically; after any reap or expiry the canonical replay floor
   equals its value as computed from sync-resume retention alone (LLP 0088
   §5's independent clocks), and the envelope-identity window neither pins
   the floor nor lets a journal row outlive its envelope.
9. **Exact fork diff:** randomized covered writes compare the journal-derived
   net diff with an independent base/head logical comparison, including
   deletions, missing rows, update-then-revert and delete-then-reinsert
   folding (distinguished via retained preimages or the immutable base),
   schema/system coverage, and multiple commits; the attributed change
   sequence is verified separately against the journal.
10. **Strict promotion:** an unchanged-base branch re-executes into staging
    and commits once; any advanced canonical head refuses; contingent effect
    state remains provisional through settlement, including LLP 0097's
    transitive fixture where a chain of operations dependent on a provisional
    effect outcome stays provisional together; no product path can invoke
    the deviating post-image promotion; promoting a branch whose operations
    carry branch-local envelopes re-executes rather than returning a stored
    branch receipt, and a post-promotion retry of the canonical identity
    returns the canonical receipt; rebase-by-replay into a fresh fork
    re-executes the recorded log and surfaces divergent results in the diff;
    and k concurrent forks of one head resolve through serialized admission —
    one promotes per cycle, the rest observe deterministic refusals, and an
    exhausted rebase budget yields the stable contention-exhausted
    diagnostic; under the declared conditional-fairness terms — with
    approval issuance in the loop and concurrent ordinary canonical writers
    running — all k forks make bounded eventual progress via inherited FIFO
    tickets and the bounded head reservation; promotion consumes only a
    sealed `PromotionRequestV1` — a branch write after review invalidates
    it, and a rebase that reproduces the full approved-facts digest re-seals
    without fresh approval as an engine attestation over the preserved
    original approval — while identical writes over a changed base, or
    divergent reads or results with identical writes, refuse re-seal and
    force fresh approval (negative fixtures for both); a retry of the
    pre-rebase aggregate identity returns the aggregate receipt.
11. **Bounded history and checkpoint:** retained row changes and named
    checkpoint receipts survive crash/reopen and expire or remain pinned
    according to policy; authorization enforces the per-version rule — a row
    whose visibility changed between retained versions returns the authorized
    versions and elides the rest without disclosing their existence, including
    across pagination and horizon markers; erasing a protected record
    destroys or invalidates every registered checkpoint copy and records
    unreachable copies as open obligations.
12. **Boundary proof:** migration/promotion/checkpoint fixtures independently
    derive expected values and compare them with actual `ContentDigestV1`
    under each boundary's domain-separated preimage (§4); checkpoint fixtures
    run with concurrent writers before, during, and after the backup and
    prove same-snapshot equality or a stable refusal; checkpoint publication
    crash cuts land on either side of the atomic rename per the imported
    LLP 0158 state machine, never in between; inventory-only
    digests cannot be presented as proof.
13. **Performance budget:** the measurement gate above is published against
    the named baseline artifact and passes per metric; any exception names its
    documented benefit next to the baseline before capability promotion.
14. **Identity lifecycle:** capacity exhaustion refuses admission rather than
    evicting receipts; unacknowledged receipts are never reclaimed; delayed
    acknowledgements and crash cuts preserve exactly-once; operator purge is
    explicit and recorded as forfeiting exactly-once; a below-floor retry is
    presented to the client as outcome-unknown, never a terminal `failed`;
    a negative fixture proves no authorization decision can be derived
    from envelope contents beyond lookup-key use into current authority
    state; and a client-minted identity cannot occupy the host-derived
    namespace — a squatting attempt neither forecloses nor perturbs the
    later host-derived operation; and host-identity reclamation and
    range-less host-epoch closure follow the host predicate — terminal
    receipts age past the declared host window, incarnation rotation closes
    the epoch, and a host retry inside the window returns the stored
    receipt.

Hosted targets remain `Missing` for each unproved capability until they pass the
same semantic fixtures with target-specific crash and resource tests.

## Sequencing

This is dependency order, not implementation authorization. LLP 0130's
standing decisions, LLP 0129's admission machinery, and LLP 0155's program
direction own commissioning; LLP 0158's F0a is the sole live adjacent lane
today, and it deliberately excludes capture-ledger integration and promotion.
Steps that alter ordinary mutation identity, settlement, wire shapes, or
client behavior land as dated amendments to their owning documents — LLP
0051/0129/0133 for settlement, LLP 0043/0053/0090 for retention, LLP 0094/0095
for wire and lifecycle, LLP 0012 for client conformance — not by centralizing
those contracts here.

0. *(Recorded 2026-08-03.)* Record the dated, statistically controlled
   performance baseline artifact (§Measurement gate) — the baseline gate is
   complete; each component's candidate comparison still gates advertisement.
1. Make `operationId` automatic on first-party ordinary mutations and unify
   their duplicate-suppression/receipt behavior with the existing settlement
   vocabulary.
2. Add the operation-level provenance record and public explanation surface
   over existing captured read/write facts, with the read API shaped by LLP
   0004's surface conventions (admin/inspection per LLP 0017; agent surfaces
   per LLP 0024/0042).
3. Wire the fork substrate per class: (a) the in-app branch — registry/TTL,
   branch-scoped grants, resource bounds (egress mediation is step 5(a); a
   3(a) branch cannot execute egress-bearing paths until it lands); (b) the derived
   deployment — identity scrub-and-mint, publication recovery, registry/TTL,
   coordinated with LLP 0158's F0a program. Step 6's promotion consumes (a)
   only.
4. Record fork operations with the envelope and expose the exact coverage-aware
   journal diff.
5. Wire LLP 0097's host-egress mediation in two slices: (a) the `DenyAll`
   mediation slice — a genuine prerequisite for any in-app branch; (b) the
   capture-ledger slice, needed only for `CaptureOnly` and for promoting
   branches that attempted effects. Step 6 consumes (a); no-egress branches
   promote without waiting for (b).
6. Wire strict-CAS staged promotion by re-execution over a replay-sufficient
   operation log, with serialized admission and the bounded rebase budget,
   including provisional effect state and fenced settlement,
   replacing or disabling the post-image `branches::promote` path.
7. Add bounded record-change history, named checkpoints, retention pins, and
   boundary proof integration.
8. Re-run the measurements and decide the revisit triggers below from evidence.

## Revisit triggers

### Incremental Merkle state

Reopen P2's maintained-tree design when one of these is measured:

- journal-derived fork diff misses its latency or memory target at a real
  subscriber/data size;
- agents frequently compare states without an ancestor/base relationship;
- boundary full-digest cost dominates migration, promotion, or checkpoint UX;
- retained journal pins cost more than a maintained partitioned digest would;
  or
- a stable version-native engine passes Snapback's local performance,
  durability, packaging, inspection, and portability gates with less total
  owned complexity than the overlay design.

The first escalation should evaluate coarse stable key-range partitions before
a general immutable Merkle DAG.

### Database-wide as-of

Reopen P4(c) when multiple real incidents or workflows cannot be served by
operation explanation, bounded record history, named checkpoints, or
fork-at-checkpoint. A reopening must price historical schema semantics,
authorization, deletion/erasure, GC, backup amplification, and query latency.

### Schema lenses

Reopen P7's lens half when measured client-version overlap makes mixed-schema
read/write populations a steady state and LLP 0081's compatibility decisions,
staged generations, and refusal behavior cannot serve it. A reopening begins
with a closed transform algebra and round-trip laws, not a general lens claim.

### Universal action replay

Reopen full P6 for actions when a concrete incident needs reproduction beyond
the deterministic handler tier and effect receipts. The proposal must address
large/streaming responses, secrets, retention, provider ambiguity, and whether
recording an observation is semantically sufficient.

## Open questions

1. What are the default detail-history, envelope-identity, and
   named-checkpoint retention windows, and which principals may extend them
   within the finite-lease rule?
2. *(Decided in v0.5: host-plan coverage stays mandatory in the core
   aggregate, advertised at `clientSuppliedValidated` provenance while LLP
   0007 Option A is unratified.)* Does Option A's eventual ratification
   change the advertised provenance class in place, or mint a new manifest
   version?
3. Which read/write explanation details remain stored verbatim, which are
   canonical digests only, and which require protected-lane custody?
4. *(Initial threshold retained by the 2026-08-03 step-0 record.)* Does the
   normative 15% local mutation budget match the workload value?
   The author may ratify a different threshold by dated revision to this RFC
   (the §Measurement gate's authority — LLP 0130 does not cover this
   document) before the sequencing step 0 baseline lands; the read-path
   equivalence bound and idle tolerances are pre-registered numerically in
   the step 0 protocol, and the initial instrumentation-only measurement is
   gated on that same baseline artifact.
5. Which document owns the committed artifact schemas and capability-manifest
   extension: this RFC after acceptance, LLP 0037's generated-schema pattern,
   or a focused follow-on Spec — and how do the §8 `TargetCapabilityId`
   registrations interact with LLP 0134's soak windows? The same owner takes
   the disposition vocabulary (`detail-expired`, `detail-truncated`, horizon
   markers, `identity-horizon-passed`) and the aggregate definition, so both
   can version independently of this RFC.
6. Is LLP 0007's Option A host-plan contract ratified before the P5
   explanation surface ships, or does making that lane's provenance public
   force the ratification?
7. Which existing specialized receipts can map losslessly into the universal
   envelope, and which need an explicit compatibility/version bridge?
8. When LLP 0088's 0085-gated evidence review lands, does its history design
   supersede §6's import verbatim for the history tier? (The core tier's
   per-version rule for explanation detail and fork-diff rows is owned by
   this RFC per §8 and is not at stake.)
9. Do derived deployments inherit the parent's historical envelopes and
   explanations, or only application state plus fork-local provenance minted
   after the cut?
10. *(Folded into §8's dated LLP 0097 amendment in v0.6, which now names
    §5's protocol additions including rebase-by-replay.)* Does divergence
    surfacing need its own receipt vocabulary?
11. *(Decided 2026-08-03 at acceptance: yes — an agent principal holding an
    LLP 0055 scoped grant may be the `PromotionRequestV1` approver; the
    approval records the grant identity, and Acceptance 10's fairness
    fixture may run with an agent approver in the loop.)*
12. Does the core tier need a "list my live forks and their promotability
    disposition" surface — §2's enumeration reasoning applies to fork
    receipts too?
13. *(Executed 2026-08-03; dated record in LLP 0165.)* SQLite's backup API and
    an independent scan can share one held source read transaction while
    concurrent writers progress. There is no intrinsic database-size WAL
    bound: the contract is budgeted pin or stable refusal, with no digest over
    drifted bytes.
14. *(Executed 2026-08-03 at acceptance: the contracts are extracted to
    LLP 0163 — operation identity and commit envelope, LLP 0164 — fork and
    promotion, and LLP 0165 — proof domains and checkpoints (the promotion
    proof Spec §4 names), each Draft, each owning its committed artifact
    schemas under LLP 0037's generated-schema pattern, which also settles
    OQ5's ownership half; this RFC remains the profile umbrella and the
    acceptance corpus's home.)*

## Capability registry record

On 2026-08-04, `agent_safe_storage_v1` entered the closed target-capability
registry at `Experimental` maturity. The id names this RFC's versioned
`agentSafe.v1` extension and component-fact vocabulary; it deliberately does
**not** mean that the `AgentSafeV1` core aggregate is supported. Every target's
positive predicate remains false, every public projection remains `Missing`,
and the guide retains the GAP until the applicable corpus, review, acceptance,
and publication gates pass.

## Source-owned publication carrier amendment — 2026-08-04

Two independent local publication chains now exist:
`agent_safe_storage_v1` and
`agent_safe_derived_deployment_fork_v1`. Each is a tracked
anchor → carrier → dated receipt chain. At frozen C both anchors are valid
`withheld` records, so this amendment and its implementation advertise
nothing.

A future storage `published` anchor is accepted only by a known, clean
`contributor-source` build whose canonical implementation-tree digest matches
the carrier. The build independently verifies a clean root and an exact,
clean checked-out `vendor/ibex` gitlink regardless of general build-identity
environment overrides. The implementation tree includes Cargo/build inputs,
Rust implementation, codegen and contract packages, the publication checker,
recorders, and the `vendor/ibex` gitlink identity. Its algorithm identifier is
`snapback:agent-safe-implementation-tree:v2`. Each canonical leaf frame hashes
the Git mode, Git object type, repository-relative path, content length, and
content bytes; a symlink is therefore a `120000 blob`, an executable regular
file differs from `100644`, and `vendor/ibex` is explicitly a `160000 commit`
entry whose content is the gitlink object id. Incremental builds track
the vendored source directories plus the resolved submodule worktree and
common-git metadata, so an in-place Ibex source, index, HEAD, or ref change
cannot retain a cached clean digest. The two anchors, carriers,
receipts, and closed dated evidence outputs are cycle exclusions. Publishing
the local manifest also refreshes the pre-existing signed codegen closures for
Latency Kanban, Triage Graph, and Contention Calendar. Because Triage evidence
is itself an input to the local persistent-store publication carrier, its three
dated evidence outputs plus that carrier and its source-owned anchor are a
second, closed transitive cycle exclusion. The checker derives the exact
receipt substitutions and resulting anchor digest from C; source maps and all
other carrier/anchor bytes are immutable. Rust and conformance-test bytes stay
inside the implementation digest and cannot change at P. The history-aware
checker, now in the canonical local proof, proves the qualification commit C
is an ancestor of publication commit P. Under Charlie Cheever's
author-authorized 2026-08-06 narrowing, it recomputes the implementation digest
from committed bytes at C and again from committed bytes at P, and requires
both to equal the receipt's `implementationTreeSha256`. The receipt, carrier,
and anchors are cycle exclusions and may rotate at P, so a P-only comparison
would be self-satisfying; the three-way equality is the proof that the receipt
names the qualified implementation and that P still has it. A refusal reports
the receipt, C, and P digests plus every changed in-scope path. That digest's scope is precisely
`IMPLEMENTATION_ROOTS` plus the `vendor/ibex` gitlink, minus the closed
`PUBLICATION_CYCLE_ALLOWLIST`; a mismatch reports every changed in-scope path
between C and P. The closed scope obeys one governing rule: **an artifact may
not be inside the implementation digest that certifies it, and the validator's
own fixtures may not depend on live mutable records.** Test coverage in
`IMPLEMENTATION_ROOTS` follows LLP 0189 D-4 (2026-08-07, superseding the
original directory-wide "keeping `tests` is mandatory" rule): checkers that
define the claim's semantics stay in the digest even when wave-shared;
wave-shared harnesses, metrology, and fixtures may depart only in the same
change that lands (or names) their LLP 0175-admissible frozen-record drift
gate, so post-qualification test gutting still moves either the digest or a
gate — coverage moves, it never vanishes. The exception is artifact-specific, not directory-wide: the two
platform lifecycle receipts and the bounds-ratification record are evidence
about a qualified tree, minted or rebound at or after qualification. Their
canonical bytes are bound by the author acceptance and receipt chain; hashing
those same bytes into the tree they certify adds no tamper evidence and creates
a cycle. The checker separately
requires a clean publication worktree and an exact, clean checked-out
`vendor/ibex` gitlink. Therefore the residual custody guarantee is direct: the
qualified implementation Git entries — mode, type, path, bytes, and Ibex
gitlink — are identical at publication.
It deliberately no longer asserts that bytes elsewhere in the repository are
unchanged. This is required by AGENTS.md's fast-moving-main constraint: demos,
guide prose, unrelated packages, and other subsystems' LLPs or issues can land
between C and P without invalidating qualification, provided they remain
strictly outside the digest scope. The carrier binds the receipt, which in
turn binds the acceptance record, paired and absolute performance records, two
independent reviews, and author acceptance by path and SHA-256. It also parses those
artifacts semantically for exact clean candidate/hardware/protocol identity.
The candidate-facts field has no parallel rotation hole: the checker
reconstructs the closed candidate object from implementation code covered by
the same C/receipt/P digest, hashes its deterministic `JSON.stringify` bytes, and
requires that exact digest independently in the carrier and receipt; derived
author acceptance directly binds both that candidate digest and the receipt's
implementation digest, while storage author acceptance directly binds the
same receipt implementation digest. The qualified source commit, component list, target,
negative targets/distributions, and evidence locator order are likewise
reconstructed or exact-shape checked rather than trusted from one mutable
publication record.

The carrier, receipt, and applicable storage or derived author-acceptance
artifact must all name the v2 algorithm explicitly, under their corresponding
v2 schemas. Every digest computed with
`snapback:agent-safe-implementation-tree:v1` is stale: changing only an
executable bit or replacing a file with a symlink could preserve that value.
No v1 value is reinterpreted as v2. A v1 receipt may remain inert behind a
`withheld` anchor so the historical storage and fork chains remain inspectable,
but presenting it through a `published` anchor refuses with a version-specific
re-qualification error. Re-qualification produces a new v2 digest and requires
new carrier, receipt, and author-acceptance bindings; the old recorded digest
does not survive the algorithm change.

Fable's round-4 review also caught a cycle inside the Rust structural mirror:
its test pinned C's exact commit, implementation-tree digest, candidate-facts
digest, and author-acceptance evidence digest as literals in `crates/snapback/src/`, which is
itself in `IMPLEMENTATION_ROOTS`. Those qualification-specific assertions are
removed. The mirror still requires lifecycle-appropriate carrier and receipt
schemas, capability, source-commit shape, digest shapes, exact target and
negative profiles, component list, and ordered evidence locator kinds/paths.
Exact cycle-dependent values live only in the receipt/carrier/anchor and
author-acceptance records in `PUBLICATION_CYCLE_ALLOWLIST`, where the JS checker
binds them. Consequently a candidate's implementation digest is stable when
those publication records are added or rotated, so the receipt can honestly
name the commit that qualified it. The checker self-test remains inside the
digest but constructs its review, verdict-history, benchmark, acceptance,
receipt, carrier, and anchor fixtures synthetically. It never opens the live
`llp/reviews/*` histories or pins their round population or commit, so appending
an honest review round needs no test edit and cannot rotate the implementation
digest for that reason.

The 2026-08-07 publication attempt at `75b0ec0b4`, using qualification commit
`fac516e9a`, is credited with surfacing the same structural class in the Rust
mirror's remaining live-artifact assertions. The test still required the live
derived anchor to be `withheld`, required `carrierSha256: null`, and pinned the
live receipt to v1. Flipping the allowlisted publication records to their valid
v2 `published` form therefore made the implementation-digest-covered test fail;
editing the test then changed the digest the records certified. The repaired
mirror parses all three live records without requiring either lifecycle state.
Synthetic legacy-withheld and v2-published chains exercise both branches; only
published binds the anchor to the carrier bytes and the carrier to the receipt
bytes, while withheld retains the documented null anchor digest and inert
carrier. Both schemas retain closed parsing and v1 remains acceptable only
behind a withheld anchor. The test separately reconstructs the target manifest
and requires the derived tuple to stay wholly `Missing`, with the capability GAP
present and the compiled distribution predicate false for every supported
distribution. The attempt also exposed that the Rust positive fork-axis enums
did not accept the receipt contract's exact `denyAll` and `notPromotable` wire
spellings; their serde names now match that already-documented tuple.
It recomputes every paired regression, bootstrap interval, idle gate,
absolute median/MAD/range, and contention percentile from the retained raw
observations before accepting the reported passed paired and absolute gates,
Acceptance rows 1–4/13/14, distinct Fable
and Codex `READY` verdicts, Charlie's scoped acceptance, and every wider fact
remaining `Missing`.

Every JSON artifact in either publication chain is structured, closed, and
fail-closed. **No publication-chain JSON is ever read non-canonically.** One
parser boundary requires an anchor, carrier, receipt, author acceptance,
evidence fixture, benchmark receipt, or verdict sidecar's complete bytes to
equal `JSON.stringify(parsed, null, 2) + '\n'` before any shape, value, digest,
or authority check. This rejects duplicate member names, alternate whitespace
or line endings, missing or extra final newlines, and every representation that
does not round-trip to exactly what the checker parsed. There is no weaker
publication-path JSON reader for a new artifact to select accidentally. The
fork-lifecycle bench emitter applies the same canonical form at the source:
integral floating-point observations serialize as integers, indentation is two
spaces, and exactly one trailing newline is present, so rerunning the evidence
cannot mint bytes the checker must reject.

Review verdict authority is structured, closed, and fail-closed. Each of the
four fixed prose review locators has exactly one fixed adjacent
`*.verdicts.v1.json` locator (the legacy locator spelling is fixed; publication
requires `schemaVersion: "snapback.review-verdicts.v2"` inside it). The prose remains mandatory human-facing review
evidence and remains digest-bound in the receipt, but **nothing in its body is
authoritative or parsed for a verdict**. Its sidecar has exact top-level keys
`schemaVersion` and `verdicts`; every verdict entry has exactly
`reviewArtifact`, `reviewArtifactSha256`, `family`, `round`,
`reviewedCommit`, `previousEntrySha256`, and `verdict`. Entries recorded after
the 2026-08-07 R9-2 hardening additionally require
`proseHistoryBinding: "frozen-per-round"`,
`reviewArtifactByteLengthAtRound`, and `reviewArtifactSha256AtRound`. The typed verdict is either the closed
Scope-1 map for LLPs 0163/0164/0165 or the closed Scope-2 publication status,
and its only values are `READY` and `NOT_READY`.

Every v2 history starts at round 1 and is stored in strictly increasing,
contiguous order. Round 1 has `previousEntrySha256: null`; each later entry
must name the SHA-256 of its predecessor's canonical
`JSON.stringify(entry, null, 2) + '\n'` bytes. A missing, duplicated, reordered,
or predecessor-mismatched round refuses; the highest numbered entry is
therefore unambiguously authoritative. Every entry binds the same fixed prose
path and the exact SHA-256 of the **current complete prose artifact**, retains
one recognized family throughout the history, and names a 40-hex reviewed
commit whose history is ancestry-monotonic. The twelve rounds that predate
R9-2 are admitted without a frozen prefix only when their stable path, family,
round, reviewed commit, and typed verdict exactly match the closed legacy
inventory; they cannot retroactively claim bytes that were not retained. Every
later round binds the artifact's exact byte length and SHA-256 as of that
round. Frozen lengths are strictly increasing, every digest must match the
current artifact prefix of that length, and the authoritative frozen round
must cover the complete current artifact. Appending prose therefore preserves
every older frozen digest, while rewriting any byte in a frozen prefix refuses
even if an actor recomputes the current-artifact digest, verdict predecessor
chain, receipt, carrier, and anchor.

`reviewArtifactSha256` remains the current-state binding for every round, so
appending prose still requires rewriting that field in all earlier entries,
recomputing their predecessor chain, and rotating the enclosing receipt chain.
The named-author accepted `(roundCount, headEntrySha256)` pair remains the root
of trust against deletion, restart, or replacement of an otherwise internally
valid history; frozen prefixes add byte-history integrity without weakening
that custody. The authoritative entry names the qualification commit C it
reviewed; under LLP 0189 D-5 (2026-08-07) the verdict binds the
claim-relevant content it reviewed, so a later C selected for reasons
unrelated to the reviewed semantics (rebases, out-of-scope churn, digest
re-scopes that only move coverage) does not invalidate a standing READY —
a fresh round is required only when the reviewed semantics or genuinely
new conflict-resolution work changed. The two fixed review pairs must
contain distinct Codex and Fable families, and the family must match the
fixed prose artifact.

The named-author acceptance v2 object additionally has an exact
`reviewHistoryHeads` map for all four fixed histories. Each value contains the
accepted `roundCount` and canonical `headEntrySha256`. The receipt binds that
acceptance object's bytes. Publication therefore validates the complete
history recorded by the reviewer/author chain: a prefix deletion, middle
truncation followed by renumbering/rechaining, wholesale round-1 restart, or
replacement changes the accepted count and/or head and refuses. Rebinding only
the sidecar, receipt evidence digests, carrier, and anchor is insufficient.
Missing or malformed JSON, any unknown field, an unknown status or family, a
prose-digest/path mismatch, a commit mismatch, an inconsistent history, a
same-family pair, or any authoritative `NOT_READY` refuses. The receipt and
named-author acceptance bind both the prose digest and sidecar digest, making
either artifact tamper-evident in the existing anchor → carrier → receipt
chain.

The residual trust assumption is explicit. Reviewer entries and named-author
acceptance are repository artifacts, not reviewer/author digital signatures or
an external append-only transparency log. The checker does not claim to resist
an actor with commit access who is willing and able to fabricate or replace
both the reviewer history and the named-author acceptance that declares its
head. It does detect accidental loss and adversarial truncation/restart relative
to the accepted chain, and it does not equate Git commit access with reviewer
or author identity.

The redesign is credited to the Codex and Fable round-4 reviews that first
caught the C/P, substring-verdict, and source-cycle defects; to the Codex
round-5 adversarial review that demonstrated four surviving full-chain
bypasses in v0.42; and to the Fable round-5 review that independently reopened
the prose parser and showed that the review chain did not name the qualified
commit. The round-6 Codex review is credited for demonstrating that v0.44 could
delete/restart an entire verdict history and that implementation digest v1 was
blind to Git entry mode/type. The four round-5 demonstrated full-chain shapes were a positive verdict inside
a fenced Markdown quotation, a lower-numbered historical round appended after
the real final round, tab-delimited CommonMark headings hiding a blocking final
round, and a second conflicting Scope-1 table ignored after a positive first
table. Those shapes are now structurally irrelevant because the checker never
interprets Markdown: changing the prose only changes the digest the structured
entry and receipt must bind, while authority stays in the closed JSON value. At
`b08e835f112517cf1629a842f5bcae12841ddcf0`, both families' Scope-1 verdicts
for LLPs 0163/0164/0165 were `READY`, and both Scope-2 verdicts were
`NOT_READY`. The reconciled histories now contain contiguous rounds 1–8.
Round 7 at `2a5a6291a137ca3df41cfc826017e4de324b65a5` and round 8 at
`0e778b9a85f26c45df8af0068979e355893baaa3` preserve the same result from both
families: Scope 1 `READY` for LLPs 0163/0164/0165 and Scope 2 `NOT_READY`.

The provenance gap is recorded rather than hidden. The same orchestration
error reset review worktrees before commit and lost three rounds' in-worktree
artifacts: round 4, round 7, and round 8. Round 4 was recovered verbatim from
the surviving session transcripts and unified-diff stream. Round 7 was
recovered from `/tmp/review-preserve/r7-codex/` and
`/tmp/review-preserve/r7-fable/`; round 8 from the corresponding `r8-codex/`
and `r8-fable/` directories. The Fable round-6 paragraph was separately
restored from the **last** transcript write at
`tasks/a1fb2c13d8caa32fa.output`, after the reviewer retracted the claim that
digest binding defeated deletion. The recovered round-7 and round-8 prose and
typed verdicts are verbatim; only the sidecars' current-prose and predecessor
digests were recomputed as their v2 schema requires. No verdict was altered,
invented, or renumbered.

Both anchors remain withheld. This convergence repair changes the qualified
implementation tree, so publication requires a fresh next round from both
families `READY` for their applicable scopes on the repaired claim-relevant
content (under LLP 0189 D-5 the round is owed to the changed semantics, and
its entries name the new qualification C; a still-newer C whose delta is
outside the reviewed claim surface does not restart this requirement),
fresh canonical platform receipts bound to C, and Charlie's new v2
named-author acceptance for the exact four history heads and implementation
digest. Only then may the receipt/carrier be constructed and the source
anchor be considered for `published`.

The older `agent_safe_storage_v1` review path has not migrated to these
structured sidecars. Its compatibility validator still consumes one fixed
Markdown document per family, but now requires **exactly one** occurrence of
every declared `**Label:**` field. A missing field or any duplicate — including
an appended later `**Verdict:** NOT_READY` after an earlier READY field —
refuses instead of selecting the first match. This closes the shadowing defect
without pretending the storage artifacts have round/history semantics. What
remains is explicit: the storage path has no authoritative append-only round
record, its two expected dated review artifacts are absent, and its anchor is
withheld. A future storage review workflow that appends rounds must migrate its
fixed locators, receipt bindings, author acceptance, and validator to a closed
structured history before publication.

The reviewed generated-publication leaf registry remains a separate,
fail-closed inventory check: it freezes each review manifest, its tracked
`consumer-committed` projections, and the pre-existing leaves of the explicitly
fully committed and admin-generated roots. It does not expand the C-to-P
custody claim beyond the receipt's implementation digest. Generated leaves
outside that digest may change concurrently and are not evidence that the
qualified implementation changed; any generated leaf inside the digest scope
is covered by the same exact P digest comparison.

The storage candidate is reconstructed in Rust and is exactly six facts: the
ordinary-mutation and host-child-mutation lanes across HostPlan and
IbexBuffered adapters, plus public-current-policy bounded explanation for the
generated `owned-crud.v1` / `owner.v1` create and update HostPlan profiles.
Performance is evidence gating those facts, not a seventh fact. Specialized
lanes, aggregate facts, wider explanation/diff/history/proof/replay/resource
classes, non-local targets, and public packages remain `Missing`. Its
app-effective projection additionally intersects the exact active two-lane,
four-adapter coverage record with the current function artifact's adapter and
host-child call reachability; marker-only owner metadata is insufficient.

The derived-deployment candidate vocabulary is independently and exactly
`DenyAll` / `NotPromotable` / `currentHead` / `HostMediated`. It never mints
derived app-effective support. The current implementation structurally returns
unsupported regardless of the derived JSON anchor: the storage absolute
recorder measures in-app `MaterializedBase`, not LLP 0158's end-to-end F0b
lifecycle. A later derived publication requires a code change with a distinct
performance/evidence contract and review. The carrier receipt records
Cloudflare, remote-service, and `public-package` negatives explicitly. LLPs
0158 and 0163–0165 keep their current statuses; their review and author-
acceptance gates are evidence inputs, not consequences of this machinery.

## Status

**Accepted** (2026-08-03, Charlie), after the seven-round dual-family
super-refine loop recorded in
`llp/reviews/0162-agent-safe-storage-profile.super-refine.md`; the v0.8
repairs entered acceptance unreviewed under the loop's declared stopping
rule, with both round-7 reviews prescribing at most a scoped re-read.
Acceptance changes document status only: per the §Summary claim boundary,
every capability remains `Missing` until the acceptance corpus passes on a
target. The sequencing step-0 baseline artifact, OQ13 snapshot-pinning spike,
and dated candidate/absolute-operation measurements were recorded on
2026-08-03; the residual Acceptance 13 legs and the extracted Specs'
(LLP 0163-0165) own acceptance still gate advertisement. This RFC neither changes the current
canonical local target nor claims that the profile ships, and it is not a
commission to implement — LLP 0130/0129/0155 own commissioning.
