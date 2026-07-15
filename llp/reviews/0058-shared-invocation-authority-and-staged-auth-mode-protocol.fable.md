**Reviewer family:** Claude (Fable)
**Provider / runtime:** fresh Claude Code workflow subagent — model claude-fable-5, reasoning effort max (explicit per-agent override); orchestrated by /llp-super-refine
**Date:** 2026-07-14
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** sub-agent

# LLP 0058 reviews — Claude family

## Round 1 — 2026-07-14

**Revision under review:** `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`, sha256 `250005ca03eedf10d343035745023d3ba6bbbc017653099db91cb2fc7bd05dfa` (committed at repo HEAD `b11a6fa`)
**Runtime detail:** workflow run wf_f4bfeeab-1c8, agent a050393447c79c05b, model claude-fable-5, reasoning effort max (explicit per-agent override); fresh context — no access to the orchestrating session, to archived reviews, or to the concurrent GPT-family round
**Verdict:** NOT READY

### Review body (verbatim)

I have completed my verification pass. I've read the full target document, the governing LLP 0039 sections it claims to discharge, the related LLPs (0031, 0012, 0053, 0057, 0059 outlines), and verified the load-bearing claims against the implementation. Here is my review.

---

# LLP 0005 Review — LLP 0058: Shared invocation authority and staged auth-mode protocol (Spec, Draft)

Reviewer: Claude (Fable 5), blind independent review, 2026-07-14. I did not read anything under `llp/reviews/` or any prior review of this document; all code citations were verified directly against the working tree.

## 1. Overall assessment

This is an unusually rigorous implementing Spec, and the design it pins is sound. It discharges LLP 0039's deferred obligation 3 (and parts of obligation 7) faithfully: one shared invocation gate producing immutable `PreparedAuthority`/`PreparedInvocation`, a durable four-key staged mode state machine with restart-gated transitions and crash traces, a closed paired artifact/auth tuple contract, relocate-and-poison as the pre-auth rollback backstop, and a computed-availability bootstrap handshake. The fail-closed posture is consistent throughout — the corrupt-state boundary that performs *no durable write at all* rather than guessing a repair is exactly right for a security-sensitive state machine.

Implementation fidelity is the best I have seen in this corpus: nearly every exact constant, record shape, and ordering rule I sampled matches the code byte-for-byte, and the code carries `@ref LLP 0058#...` annotations back to the owning sections (src/auth/mode.rs, src/server.rs, src/secure_file.rs, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-codegen/index.mjs).

The document is nonetheless not ready to advance. Two material issues remain: (1) parts of its normative Acceptance section — including the actual-predecessor runs that evidence load-bearing claim 4 — are not reproducible from the repository and are stated stronger than the committed tests; and (2) the document's own Status records thirteen untriaged material findings from a prior cross-family review and explicitly withholds author ratification. By the Spec's own standard ("prose alone would not have been sufficient"), these must close before acceptance.

## 2. Strengths

- **Exact durable protocol with verified crash discipline** (§The four keys, §Exact mode-state record, §Crash and publication traces). The record shapes, closed enums, per-state invariant table, and generation overflow fail-closed rule all match `src/auth/mode.rs:15–260` exactly, including the `sessionsEverActivated`↔poison cross-check (`src/storage/auth_mode.rs:1171–1230`, `require_legacy_poison` at :1413). Crash/rollback tests exist at the storage layer (`consume_crash_rolls_back_catalog_poison_and_mode_then_retry_settles`, `failed_stage_rolls_back_ddl_and_both_mode_records`, `seed_failure_rolls_back_stage_ddl_and_state`, src/storage/auth_mode.rs:1636–2087).
- **The poison design** (§Normative vocabulary, §The four keys). Choosing a JSON *string* — valid JSON of the wrong top-level type — so the pre-auth `SchemaManifest` parser fails structurally rather than lexically is elegant; the exact bytes are pinned in `src/auth/mode.rs:18–19`.
- **Pair-list capability authority** (§The two admissible tuples). Rejecting Cartesian-product authorization (`supportedArtifactAuthPairs`, src/manifest.rs:2787+) and deriving the closed eight-id `TargetCapabilityId` registry from code-owned positive predicates, never candidate artifacts (src/manifest.rs:2612–2729), forecloses a classic capability-negotiation bug class.
- **The carrier trust rule** (§Cold startup artifact carrier) is implemented precisely: `O_NOFOLLOW`, effective-uid ownership, no group/other write, exactly one hard link, conservative rejection of every extended ACL, 32 MiB cap, and an inode/size stability recheck after read (src/secure_file.rs:313–396, src/auth/mode.rs:17).
- **Admitted-body ingestion** (§Admitted body ingestion) closes a real quiescence-starvation hole, and the "strictly below" relationship is a *compile-time* assert (src/server.rs:4246–4249), with the two trip reasons (408 timeout vs `SNAPBACK_AUTH_MODE_PENDING` on epoch close) implemented as specified (src/server.rs:4251–4291).
- **Handler projection hardening** (§HandlerAuthProjection). The null-prototype, own-data-property, deep-frozen projection is implemented exactly, using pre-captured trusted intrinsics so polluted `Object.prototype` cannot interfere (packages/snapback-harness/ctx-bootstrap.js:480–502).
- **Two-sided handshake closure** (§Exact response DTO, §Exactness). The all-members-required schema, `transports: ["bearer"]`, and the shared accept/reject corpus executed against both the Rust schema and the shipped kit validator are real (src/auth/handshake.rs:161, 238–253, 333; tests/artifact_schemas_v0.rs:443; demos/_kit/tests/auth-session-schema-parity.mjs:22), and the kit-side per-request offer/echo comparison exists (demos/_kit/client.mjs:458–465, 605–612). The honestly-labeled residual looseness on `AuthorityDescriptor` is a credibility signal.
- **Disjoint v1 identity namespaces** (§Disjoint v1 identity strings) match codegen exactly, including the v0 preservation of truncated `sha256:` spellings and the three framed leading items (packages/snapback-codegen/index.mjs:3001–3029; src/auth/mode.rs:21–23, validate at :103–114).
- **Coherent corpus placement** (§Summary, §Scope and ownership). The document justifies its own existence against 0039's freeze, 0031's registry role, and 0057's declared seam; its gate table is consistent with 0031's route registry rows (llp/0031:327–330) and with 0039's deferred-obligation text (llp/0039:1583–1606). The provisioning-ingress closure of `functions/load` (no raw-loader exception under sessions) is implemented and tested (src/host_ops.rs:916, 1507; src/server.rs:4521).

## 3. Concerns

**1. MATERIAL — Acceptance evidence is stated stronger than what the repository can reproduce.**
Evidence: §Acceptance/"Artifact and predecessor matrix" states "The pinned actual unmodified pre-auth predecessor **runs** in its provisioning-allowed `dev` profile against (a) a fresh database and (b) an identical-content v0-dev database…"; §"Stage, consume, poison, and downgrade" requires "a pinned pre-auth binary failing database open with `SNAPBACK_SCHEMA_PARSE_FAILED`, binding no listener, and mutating nothing"; §Status claims "actual-predecessor runs … provide its implementation evidence." I found no harness, script, pinned SHA, or CI workflow anywhere in the repository that builds or executes a pre-auth predecessor binary (searched tests/, scripts/, .github/workflows/, Cargo config). The committed stale-version tests exercise only the *current* binary rejecting foreign version strings (tests/auth_artifacts_v1.rs:63–110; tests/ensure_auth_v1.rs:496–560; tests/local_v0.rs:2431–2461). Similarly, §Corrupt-state boundary pledges "Tests compare all four values and the database/WAL **byte-for-byte** before and after this refusal," but the committed test compares the four meta values logically, not database/WAL bytes (src/storage/auth_mode.rs:2044–2067), and the ensure-suite fingerprint is a logical projection (tests/ensure_auth_v1.rs:156–169). This matters because load-bearing claim 4 (a pre-auth binary fails parsing instead of silently reopening under body authority) rests precisely on *actual predecessor* behavior, and the Spec's own Status asserts prose alone is insufficient.
Resolution criterion: either (a) commit a rerunnable predecessor harness (pinned predecessor SHA, the two-database ensure matrix, and the DB-open poison case) plus genuine byte-comparison fixtures, or (b) amend the Acceptance and Status text to explicitly separate committed executable coverage from one-time recorded evidence, with provenance (predecessor SHA, where the run log is archived, e.g. the ENG-24597 Linear record).

**2. MATERIAL — The document records its own unresolved material review findings and withholds ratification.**
Evidence: §Status: "verdict: NOT READY — thirteen material spec-vs-code fidelity and security findings … its material findings await author triage" and "It still needs an LLP review scaled to its stakes and explicit author ratification; this reconciliation performs neither on the author's behalf." The Revised header repeats "material findings remain for author triage." (Per the blind protocol I did not read the archived artifact; this concern is about the recorded pending state, which is the document's own testimony.)
Resolution criterion: each archived finding is dispositioned (fixed, rebutted, or re-scoped) with the document revised accordingly and the disposition recorded, followed by explicit author ratification. Until then the Spec is, by its own account, unsettled.

**3. MINOR — `AuthorizationCommitWitness` is used normatively but defined nowhere in the corpus.**
Evidence: §Same-mode provisioning requires the transition to receive "that transaction's exact `AuthorizationCommitWitness` plus minimum commit-version floor." A corpus-wide search shows no LLP defines this record — only 0058 mentions it. LLP 0053 defines the witness vocabulary as `CompositeWitness` (llp/0053:828, 837) and LLP 0059 speaks of the "durable witness floor" (llp/0059:848). The type exists only in code (src/storage/authorization.rs, src/storage/auth_mode.rs; test `same_mode_network_commit_returns_the_exact_activation_witness_and_floor`, src/storage/auth_mode.rs:1800).
Resolution criterion: define the record's shape and ownership here (0058 owns same-mode activation) or cite the owning document and map the name to 0053's witness vocabulary.

**4. MINOR — The §Activation-readiness JSON presents item-4-boundary values in unqualified present tense.**
Evidence: "The capability/runtime authority carries these exact facts:" followed by `connectionBinding/twoPhaseRevocation/authCoordinator/sessionActivationReady: false`. Item 5 has since landed (§Summary claim 5, §Status), and the code composes later-item facts as true (src/auth/mode.rs:354–397, `item4()` vs `new()`). Elsewhere the document brackets boundary-vs-current carefully; this exhibit does not.
Resolution criterion: label the JSON as the item-4-boundary exhibit and state that later items flip their facts, mirroring the framing used in §Live and replay admission.

**5. MINOR — The fixed 20 s admitted-body deadline's collateral refusal class is undiscussed.**
Evidence: §Admitted body ingestion pins exactly 20000 ms, unconfigurable, for *every* admitted managed-route body (src/server.rs:4245). The security motivation is well argued, but the document does not name the accepted collateral class (a legitimate slow client sending a large payload — e.g. future LLP 0044 asset flows or big mutations over slow links now receives 408 where it previously succeeded), nor why an absolute deadline was chosen over a minimum-throughput bound.
Resolution criterion: one paragraph naming the collateral class, the local-target payload/link profile that makes 20 s acceptable, and where a per-route override would live (LLP 0031 policy) if ever justified.

**6. MINOR — Kit-produced `SNAPBACK_AUTH_HANDSHAKE_INVALID` has no registry home.**
Evidence: the Revised header and §Exactness/kit prose use the code normatively; the §Diagnostics table omits it; it appears in no other LLP's registry (grep across llp/0012, 0057, 0059). The kit produces it (demos/_kit/client.mjs:164, 463+). §Diagnostics says LLP 0012 remains the owning registry and every new code "must register … before it can ship."
Resolution criterion: state which registry owns client-produced codes and register it there, or add it to this Spec's diagnostics table explicitly marked kit-produced.

**7. EDITORIAL — Revision-history and density ergonomics.**
Evidence: the Revised header is a single ~40-line run-on paragraph; LLP 0039 uses a scannable §Changelog. §Same-mode provisioning packs the barrier, witness, private projection admission, backlog conversion, and failure postures into dense prose while §Consume ordering demonstrates the clearer numbered-transaction style.
Resolution criterion: adopt a changelog section; renumber §Same-mode provisioning's activation sequence as ordered steps. Non-blocking.

## 4. Suggestions

- **Make the document's JSON exhibits executable.** The mode-state record, staged record, carrier, and handshake DTO examples could be lifted verbatim into a conformance corpus validated against the Rust schemars types, exactly as `tests/conformance/auth-session-parity.corpus.json` already does for the handshake. That converts the doc's most drift-prone content into fixtures and would have caught the item-6/7/8 DTO omissions the ENG-24991 amendment had to repair.
- **Property/fuzz the corrupt-state classifier.** The read-only four-key cross-validation is an ideal fuzz target (arbitrary bytes in the four keys → assert refusal is total, write-free, and never panics). Cheap, and it hardens the one code path that runs before any invariant holds.
- **Name the sanctioned recovery from `SNAPBACK_AUTH_MODE_STATE_CORRUPT`.** The no-repair-guessing rule is correct, but the document never says what an operator *does* next (presumably restore a consistent LLP 0057 backup). One sentence prevents "fail closed" from reading as "bricked," and a read-only `auth doctor` CLI mapping the four keys + carrier to the exact startup diagnostic would follow this repo's `ibex-doctor` precedent.
- **If predecessor-run cost is the blocker, make it a nightly CI job** (build the pinned SHA in a cached toolchain, run the two-database matrix and the poisoned-open case) rather than per-push — repeatability matters more than frequency for this evidence.
- **Consider (and record the decision on) eventual split-out.** This Spec owns four separable protocols across nine Systems in ~1650 lines. Since 0039 item 4 bundles them, keeping one implementing Spec is defensible — but say so explicitly, so the next maintainer doesn't relitigate it.

## 5. Open questions

1. Where is the actual-predecessor run evidence recorded today, and which predecessor SHA was pinned? Should it become a committed harness (my recommendation) or stay one-time evidence with provenance?
2. What is the author's disposition of the archived review's thirteen material findings, and which sections of this Spec change as a result?
3. Is the 20 s ingest deadline compatible with the largest legitimate managed-route payloads on realistic links (demo apps today, LLP 0044 flows tomorrow), and which document owns a per-route override if one is ever needed?
4. Who owns the normative definition of `AuthorizationCommitWitness` and its floor — this Spec, LLP 0059, or LLP 0053's `CompositeWitness` vocabulary?
5. What is the sanctioned operator recovery path from corrupt mode state, given repair-guessing is (rightly) forbidden?
6. As later items keep flipping readiness facts, should §Activation-readiness track current reality or stay frozen as a boundary exhibit — and which choice keeps `ref-check`-style doc/code drift detectable?

## 6. Readiness verdict

The architecture, protocol discipline, and implementation fidelity are excellent; none of my concerns is about the design's shape. But two material issues remain: the Acceptance/Status sections claim evidence (actual-predecessor runs; byte-for-byte comparisons) that the repository cannot reproduce and that in places overstates the committed tests (Concern 1), and the document itself records thirteen untriaged material findings plus withheld author ratification (Concern 2). Concerns 3–6 are non-blocking polish. Once Concern 1 is resolved by harness-or-provenance and Concern 2 by recorded triage plus ratification, this Spec is a strong candidate for Accepted status.

READINESS VERDICT: NOT READY

## Round 1 — 2026-07-14

**Revision under review:** `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`, sha256 `250005ca03eedf10d343035745023d3ba6bbbc017653099db91cb2fc7bd05dfa` (committed at repo HEAD `b11a6fa`)
**Runtime detail:** fresh Claude Code workflow subagent (run wf_f4bfeeab-1c8), model claude-fable-5, reasoning effort max (explicit per-agent override); fresh context, blind to all archived reviews and to the concurrent GPT-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY

### Review body (verbatim)

I have completed my verification pass. I've read the full target document, the governing LLP 0039 sections it claims to discharge, the related LLPs (0031, 0012, 0053, 0057, 0059 outlines), and verified the load-bearing claims against the implementation. Here is my review.

---

# LLP 0005 Review — LLP 0058: Shared invocation authority and staged auth-mode protocol (Spec, Draft)

Reviewer: Claude (Fable 5), blind independent review, 2026-07-14. I did not read anything under `llp/reviews/` or any prior review of this document; all code citations were verified directly against the working tree.

## 1. Overall assessment

This is an unusually rigorous implementing Spec, and the design it pins is sound. It discharges LLP 0039's deferred obligation 3 (and parts of obligation 7) faithfully: one shared invocation gate producing immutable `PreparedAuthority`/`PreparedInvocation`, a durable four-key staged mode state machine with restart-gated transitions and crash traces, a closed paired artifact/auth tuple contract, relocate-and-poison as the pre-auth rollback backstop, and a computed-availability bootstrap handshake. The fail-closed posture is consistent throughout — the corrupt-state boundary that performs *no durable write at all* rather than guessing a repair is exactly right for a security-sensitive state machine.

Implementation fidelity is the best I have seen in this corpus: nearly every exact constant, record shape, and ordering rule I sampled matches the code byte-for-byte, and the code carries `@ref LLP 0058#...` annotations back to the owning sections (src/auth/mode.rs, src/server.rs, src/secure_file.rs, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-codegen/index.mjs).

The document is nonetheless not ready to advance. Two material issues remain: (1) parts of its normative Acceptance section — including the actual-predecessor runs that evidence load-bearing claim 4 — are not reproducible from the repository and are stated stronger than the committed tests; and (2) the document's own Status records thirteen untriaged material findings from a prior cross-family review and explicitly withholds author ratification. By the Spec's own standard ("prose alone would not have been sufficient"), these must close before acceptance.

## 2. Strengths

- **Exact durable protocol with verified crash discipline** (§The four keys, §Exact mode-state record, §Crash and publication traces). The record shapes, closed enums, per-state invariant table, and generation overflow fail-closed rule all match `src/auth/mode.rs:15–260` exactly, including the `sessionsEverActivated`↔poison cross-check (`src/storage/auth_mode.rs:1171–1230`, `require_legacy_poison` at :1413). Crash/rollback tests exist at the storage layer (`consume_crash_rolls_back_catalog_poison_and_mode_then_retry_settles`, `failed_stage_rolls_back_ddl_and_both_mode_records`, `seed_failure_rolls_back_stage_ddl_and_state`, src/storage/auth_mode.rs:1636–2087).
- **The poison design** (§Normative vocabulary, §The four keys). Choosing a JSON *string* — valid JSON of the wrong top-level type — so the pre-auth `SchemaManifest` parser fails structurally rather than lexically is elegant; the exact bytes are pinned in `src/auth/mode.rs:18–19`.
- **Pair-list capability authority** (§The two admissible tuples). Rejecting Cartesian-product authorization (`supportedArtifactAuthPairs`, src/manifest.rs:2787+) and deriving the closed eight-id `TargetCapabilityId` registry from code-owned positive predicates, never candidate artifacts (src/manifest.rs:2612–2729), forecloses a classic capability-negotiation bug class.
- **The carrier trust rule** (§Cold startup artifact carrier) is implemented precisely: `O_NOFOLLOW`, effective-uid ownership, no group/other write, exactly one hard link, conservative rejection of every extended ACL, 32 MiB cap, and an inode/size stability recheck after read (src/secure_file.rs:313–396, src/auth/mode.rs:17).
- **Admitted-body ingestion** (§Admitted body ingestion) closes a real quiescence-starvation hole, and the "strictly below" relationship is a *compile-time* assert (src/server.rs:4246–4249), with the two trip reasons (408 timeout vs `SNAPBACK_AUTH_MODE_PENDING` on epoch close) implemented as specified (src/server.rs:4251–4291).
- **Handler projection hardening** (§HandlerAuthProjection). The null-prototype, own-data-property, deep-frozen projection is implemented exactly, using pre-captured trusted intrinsics so polluted `Object.prototype` cannot interfere (packages/snapback-harness/ctx-bootstrap.js:480–502).
- **Two-sided handshake closure** (§Exact response DTO, §Exactness). The all-members-required schema, `transports: ["bearer"]`, and the shared accept/reject corpus executed against both the Rust schema and the shipped kit validator are real (src/auth/handshake.rs:161, 238–253, 333; tests/artifact_schemas_v0.rs:443; demos/_kit/tests/auth-session-schema-parity.mjs:22), and the kit-side per-request offer/echo comparison exists (demos/_kit/client.mjs:458–465, 605–612). The honestly-labeled residual looseness on `AuthorityDescriptor` is a credibility signal.
- **Disjoint v1 identity namespaces** (§Disjoint v1 identity strings) match codegen exactly, including the v0 preservation of truncated `sha256:` spellings and the three framed leading items (packages/snapback-codegen/index.mjs:3001–3029; src/auth/mode.rs:21–23, validate at :103–114).
- **Coherent corpus placement** (§Summary, §Scope and ownership). The document justifies its own existence against 0039's freeze, 0031's registry role, and 0057's declared seam; its gate table is consistent with 0031's route registry rows (llp/0031:327–330) and with 0039's deferred-obligation text (llp/0039:1583–1606). The provisioning-ingress closure of `functions/load` (no raw-loader exception under sessions) is implemented and tested (src/host_ops.rs:916, 1507; src/server.rs:4521).

## 3. Concerns

**1. MATERIAL — Acceptance evidence is stated stronger than what the repository can reproduce.**
Evidence: §Acceptance/"Artifact and predecessor matrix" states "The pinned actual unmodified pre-auth predecessor **runs** in its provisioning-allowed `dev` profile against (a) a fresh database and (b) an identical-content v0-dev database…"; §"Stage, consume, poison, and downgrade" requires "a pinned pre-auth binary failing database open with `SNAPBACK_SCHEMA_PARSE_FAILED`, binding no listener, and mutating nothing"; §Status claims "actual-predecessor runs … provide its implementation evidence." I found no harness, script, pinned SHA, or CI workflow anywhere in the repository that builds or executes a pre-auth predecessor binary (searched tests/, scripts/, .github/workflows/, Cargo config). The committed stale-version tests exercise only the *current* binary rejecting foreign version strings (tests/auth_artifacts_v1.rs:63–110; tests/ensure_auth_v1.rs:496–560; tests/local_v0.rs:2431–2461). Similarly, §Corrupt-state boundary pledges "Tests compare all four values and the database/WAL **byte-for-byte** before and after this refusal," but the committed test compares the four meta values logically, not database/WAL bytes (src/storage/auth_mode.rs:2044–2067), and the ensure-suite fingerprint is a logical projection (tests/ensure_auth_v1.rs:156–169). This matters because load-bearing claim 4 (a pre-auth binary fails parsing instead of silently reopening under body authority) rests precisely on *actual predecessor* behavior, and the Spec's own Status asserts prose alone is insufficient.
Resolution criterion: either (a) commit a rerunnable predecessor harness (pinned predecessor SHA, the two-database ensure matrix, and the DB-open poison case) plus genuine byte-comparison fixtures, or (b) amend the Acceptance and Status text to explicitly separate committed executable coverage from one-time recorded evidence, with provenance (predecessor SHA, where the run log is archived, e.g. the ENG-24597 Linear record).

**2. MATERIAL — The document records its own unresolved material review findings and withholds ratification.**
Evidence: §Status: "verdict: NOT READY — thirteen material spec-vs-code fidelity and security findings … its material findings await author triage" and "It still needs an LLP review scaled to its stakes and explicit author ratification; this reconciliation performs neither on the author's behalf." The Revised header repeats "material findings remain for author triage." (Per the blind protocol I did not read the archived artifact; this concern is about the recorded pending state, which is the document's own testimony.)
Resolution criterion: each archived finding is dispositioned (fixed, rebutted, or re-scoped) with the document revised accordingly and the disposition recorded, followed by explicit author ratification. Until then the Spec is, by its own account, unsettled.

**3. MINOR — `AuthorizationCommitWitness` is used normatively but defined nowhere in the corpus.**
Evidence: §Same-mode provisioning requires the transition to receive "that transaction's exact `AuthorizationCommitWitness` plus minimum commit-version floor." A corpus-wide search shows no LLP defines this record — only 0058 mentions it. LLP 0053 defines the witness vocabulary as `CompositeWitness` (llp/0053:828, 837) and LLP 0059 speaks of the "durable witness floor" (llp/0059:848). The type exists only in code (src/storage/authorization.rs, src/storage/auth_mode.rs; test `same_mode_network_commit_returns_the_exact_activation_witness_and_floor`, src/storage/auth_mode.rs:1800).
Resolution criterion: define the record's shape and ownership here (0058 owns same-mode activation) or cite the owning document and map the name to 0053's witness vocabulary.

**4. MINOR — The §Activation-readiness JSON presents item-4-boundary values in unqualified present tense.**
Evidence: "The capability/runtime authority carries these exact facts:" followed by `connectionBinding/twoPhaseRevocation/authCoordinator/sessionActivationReady: false`. Item 5 has since landed (§Summary claim 5, §Status), and the code composes later-item facts as true (src/auth/mode.rs:354–397, `item4()` vs `new()`). Elsewhere the document brackets boundary-vs-current carefully; this exhibit does not.
Resolution criterion: label the JSON as the item-4-boundary exhibit and state that later items flip their facts, mirroring the framing used in §Live and replay admission.

**5. MINOR — The fixed 20 s admitted-body deadline's collateral refusal class is undiscussed.**
Evidence: §Admitted body ingestion pins exactly 20000 ms, unconfigurable, for *every* admitted managed-route body (src/server.rs:4245). The security motivation is well argued, but the document does not name the accepted collateral class (a legitimate slow client sending a large payload — e.g. future LLP 0044 asset flows or big mutations over slow links now receives 408 where it previously succeeded), nor why an absolute deadline was chosen over a minimum-throughput bound.
Resolution criterion: one paragraph naming the collateral class, the local-target payload/link profile that makes 20 s acceptable, and where a per-route override would live (LLP 0031 policy) if ever justified.

**6. MINOR — Kit-produced `SNAPBACK_AUTH_HANDSHAKE_INVALID` has no registry home.**
Evidence: the Revised header and §Exactness/kit prose use the code normatively; the §Diagnostics table omits it; it appears in no other LLP's registry (grep across llp/0012, 0057, 0059). The kit produces it (demos/_kit/client.mjs:164, 463+). §Diagnostics says LLP 0012 remains the owning registry and every new code "must register … before it can ship."
Resolution criterion: state which registry owns client-produced codes and register it there, or add it to this Spec's diagnostics table explicitly marked kit-produced.

**7. EDITORIAL — Revision-history and density ergonomics.**
Evidence: the Revised header is a single ~40-line run-on paragraph; LLP 0039 uses a scannable §Changelog. §Same-mode provisioning packs the barrier, witness, private projection admission, backlog conversion, and failure postures into dense prose while §Consume ordering demonstrates the clearer numbered-transaction style.
Resolution criterion: adopt a changelog section; renumber §Same-mode provisioning's activation sequence as ordered steps. Non-blocking.

## 4. Suggestions

- **Make the document's JSON exhibits executable.** The mode-state record, staged record, carrier, and handshake DTO examples could be lifted verbatim into a conformance corpus validated against the Rust schemars types, exactly as `tests/conformance/auth-session-parity.corpus.json` already does for the handshake. That converts the doc's most drift-prone content into fixtures and would have caught the item-6/7/8 DTO omissions the ENG-24991 amendment had to repair.
- **Property/fuzz the corrupt-state classifier.** The read-only four-key cross-validation is an ideal fuzz target (arbitrary bytes in the four keys → assert refusal is total, write-free, and never panics). Cheap, and it hardens the one code path that runs before any invariant holds.
- **Name the sanctioned recovery from `SNAPBACK_AUTH_MODE_STATE_CORRUPT`.** The no-repair-guessing rule is correct, but the document never says what an operator *does* next (presumably restore a consistent LLP 0057 backup). One sentence prevents "fail closed" from reading as "bricked," and a read-only `auth doctor` CLI mapping the four keys + carrier to the exact startup diagnostic would follow this repo's `ibex-doctor` precedent.
- **If predecessor-run cost is the blocker, make it a nightly CI job** (build the pinned SHA in a cached toolchain, run the two-database matrix and the poisoned-open case) rather than per-push — repeatability matters more than frequency for this evidence.
- **Consider (and record the decision on) eventual split-out.** This Spec owns four separable protocols across nine Systems in ~1650 lines. Since 0039 item 4 bundles them, keeping one implementing Spec is defensible — but say so explicitly, so the next maintainer doesn't relitigate it.

## 5. Open questions

1. Where is the actual-predecessor run evidence recorded today, and which predecessor SHA was pinned? Should it become a committed harness (my recommendation) or stay one-time evidence with provenance?
2. What is the author's disposition of the archived review's thirteen material findings, and which sections of this Spec change as a result?
3. Is the 20 s ingest deadline compatible with the largest legitimate managed-route payloads on realistic links (demo apps today, LLP 0044 flows tomorrow), and which document owns a per-route override if one is ever needed?
4. Who owns the normative definition of `AuthorizationCommitWitness` and its floor — this Spec, LLP 0059, or LLP 0053's `CompositeWitness` vocabulary?
5. What is the sanctioned operator recovery path from corrupt mode state, given repair-guessing is (rightly) forbidden?
6. As later items keep flipping readiness facts, should §Activation-readiness track current reality or stay frozen as a boundary exhibit — and which choice keeps `ref-check`-style doc/code drift detectable?

## 6. Readiness verdict

The architecture, protocol discipline, and implementation fidelity are excellent; none of my concerns is about the design's shape. But two material issues remain: the Acceptance/Status sections claim evidence (actual-predecessor runs; byte-for-byte comparisons) that the repository cannot reproduce and that in places overstates the committed tests (Concern 1), and the document itself records thirteen untriaged material findings plus withheld author ratification (Concern 2). Concerns 3–6 are non-blocking polish. Once Concern 1 is resolved by harness-or-provenance and Concern 2 by recorded triage plus ratification, this Spec is a strong candidate for Accepted status.

READINESS VERDICT: NOT READY
### Orchestrator disposition (round 1, outside the verbatim body)

Both families rate design/fidelity highly. Concern 1 (acceptance over-claim:
actual-predecessor runs and byte-for-byte comparison not reproducible from the
repo) → resolved by separating committed coverage from recorded ENG-24597
evidence, with a rerunnable harness and byte-identity fixture named as
obligations. Concern 2 (untriaged findings) → the round-2 §Review triage records
a disposition for every material finding of both families. Concern 3
(AuthorizationCommitWitness undefined) → defined here and mapped to LLP 0053's
CompositeWitness. Concern 4 (item-4 readiness JSON present tense) → labeled the
boundary exhibit. Concern 5 (20 s deadline collateral) → named. Concern 6
(SNAPBACK_AUTH_HANDSHAKE_INVALID registry) → registered as an LLP 0012
obligation, marked kit-produced. Concern 7 (changelog/density) → non-blocking.
