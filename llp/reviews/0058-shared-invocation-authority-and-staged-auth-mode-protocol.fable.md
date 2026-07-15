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

## Final implementation review — 2026-07-15

### Provenance

- Reviewer family: Anthropic Claude
- Provider/runtime: Claude CLI, model `claude-fable-5`
- Method: read-only Plan mode; high effort; no session persistence; blind to `llp/reviews/`
- Reviewed commit: `62a11cedfb1ff7ad0258dc3e6ce667989b88b819`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review

# LLP 0005 final review — LLP 0058 @ 62a11ce (blind, advisory)

## Overall assessment

This is a mature, unusually rigorous protocol spec, and the post-ENG-25001 revision has genuinely closed the prior material findings rather than papering over them. I verified the decisive implemented-boundary claims directly against code and committed tests at HEAD, and nearly everything checks out exactly as written — including the claims that earlier rounds found overstated, which are now accurate. It discharges LLP 0039's deferred obligation №3 point-by-point while respecting the frozen boundary. One spec-vs-code fidelity defect remains in a normative security-shape section, plus a small cluster of registry/hygiene items.

## Strengths

- **Fidelity to the frozen parent.** LLP 0039 `Protocol obligations deferred to implementation (item 3, `0039:1586-1609`) is discharged element-for-element: durable transition-state record, crash traces at every boundary, the ten-step pre-effect preflight, the rejection matrix including v1-dev and matching-hash negatives, MODE_PENDING refusal with privileged-only correction, and relocate-and-poison as a separate backstop. Items 4/5 scoping statements match 0039 exactly.
- **Evidence claims are now real and honestly framed.** `tests/acceptance/auth-mode-predecessor-v1.mjs` pins the claimed predecessor `1d6cafb…` and Ibex gitlink, builds it with locked deps, asserts exact `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` against fresh and v0-provisioned databases with direct DB+WAL byte snapshots, runs the poison third case, and deep-equals against the committed receipt. The corrupt-WAL regression (`src/storage/auth_mode.rs:2492-2530`) is genuine: `wal_autocheckpoint = 0`, corruption verified resident in the WAL, refused open, both files byte-compared. The handshake parity corpus is truly shared — Rust `include_str!` and the kit validator consume the same file, with ≥50-case and 17-member-census guards on both sides.
- **Code matches the security-critical constants and boundaries.** Exact poison bytes (`src/auth/mode.rs:18-19`); the four meta keys, mutated only in Immediate transactions on the write lane; 30 000/20 000 ms deadlines with a compile-time strictly-below assert, 408 mapping, and epoch-close body cancellation answered on the still-open connection; carrier validation implements every listed check including O_NOFOLLOW, single hard link, ACL rejection, inode/size stability, and 32 MiB; the raw loader's settled-dev-only seam and in-process sessions refusal are implemented and tested; all five normative gate types plus `PreparedConnectionAct` exist; the live-owner predicate compares both conjuncts under the owner lock with no `is_some()` short-circuit; `TargetCapabilityId` is closed to exactly eight ids with the two-pair emission.
- **Cross-corpus coherence.** 0053's `CompositeWitness` mapping, 0059's "durable witness floor," 0057's later-item seams, and 0060's hosted delegation all read consistently from both sides; all Related documents exist; `ref-check --verbose` reports 0 errors.

## Concerns

**MATERIAL-1 — `HandlerAuthProjection's "exactly" claim is stale against shipped code.** The spec pins the handler-visible projection to *exactly* `{userId, sessionId, isAuthenticated, provider?, roles?}` with "Own-key rules are exact." Shipped code projects two more own keys: `kind` (`"human"` for every real session and dev impersonation — `src/auth/invocation.rs:517-528, 605, 614`) and a nested frozen `actor` projection for delegated agents (`packages/snapback-harness/ctx-bootstrap.js:487-521`, allow-list of seven keys), governed by LLP 0055 — which is absent from 0058's Related list. The `Shared gate matrix test description ("expose only own non-accessor data keys" per the enumeration) and the handshake sentence "`authority` is the same `HandlerAuthProjection` constructor" inherit the stale shape. Unlike the readiness JSON and live-admission matrix, this section is not bracketed as an item-4 boundary exhibit, so it reads as a false current normative claim about the handler-visible authority surface — exactly the fidelity class ENG-25001 closed elsewhere. *Resolution:* amend `HandlerAuthProjection (and the two dependent passages) to either bracket the five-key shape as the item-4 boundary with `kind`/`actor` delegated to LLP 0055, or incorporate the extension; add LLP 0055 to Related.

**MINOR-1 — LLP 0012 registry lags two facts 0058 asserts under 0012's authority.** (a) The contract-data-manifest v1 exception is real — codegen emits `"schemaVersion": "snapback.v1"` — but 0012 still says only the schema and function manifests move to v1. (b) `SNAPBACK_SCHEMA_PARSE_FAILED`, relied on normatively in `Acceptance and asserted by the committed poison tests, is not registered in 0012. *Resolution:* land the 0012 amendment covering both, or record the pending amendment as a named obligation in 0058.

**MINOR-2 — the predecessor harness is not CI-wired.** The parity `.mjs` and all `cargo test` evidence run in CI via `scripts/verify-local-proof` → `.github/workflows/local-proof.yml:79`, but nothing invokes `tests/acceptance/auth-mode-predecessor-v1.mjs`. The spec's "committed, rerunnable" wording is accurate — this is not an over-claim — but the flagship predecessor/rollback evidence regresses silently unless someone remembers to run it. *Resolution:* wire it into CI or a named script (a scheduled or opt-in job is fine), or state its manual cadence in `Status.

**EDITORIAL-1 — "verified as the parent of the first staged-mode commit."** History contains two same-subject staged-mode commits (`17938c1` and the pinned `8da7b46`, apparent rebase divergence); `git log --follow src/auth/mode.rs` surfaces the other one. The harness pins `8da7b46` and self-asserts `parent == 1d6cafb`, so the claim is sound, but "the first" is ambiguous. *Resolution:* cite the pinned child SHA in the sentence.

## Readiness verdict

**NOT READY.** One MATERIAL concern remains — the un-bracketed stale exactness claim in `HandlerAuthProjection` versus the shipped `kind`/`actor` projection. It is narrow and mechanical to resolve (a bracketing paragraph or an incorporated extension, plus a Related-list entry); everything else I checked, including every previously-material area, is confirmed accurate. This review advises only — Status remains the author's call, and nothing here ratifies or changes it.

## Blind final cross-family review — 2026-07-15

### Provenance

- Reviewer family: Claude Fable
- Provider/runtime: Claude Code 2.1.210
- Model: `claude-fable-5`
- Method: read-only plan-permission CLI; blind to `llp/reviews/`
- Session: `89686fa0-715f-4702-b72e-2473b926ab37`
- Reviewed commit: `8f03e42`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review artifact

# Blind final implementation review — LLP 0058 @ 8f03e42

## Context

ENG-25001 asked for a blind final implementation review of
`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md` at exactly
commit 8f03e42, covering material correctness, coherence, security, feasibility, and
evidence gaps — with explicit inspection of LLP 0059's reentrant owner/peer resume
synchronization and its composed Contract regression. Nothing under `llp/reviews/` was
read; no files were modified. This is an assessment-only deliverable; the plan proposes
no code changes.

## Review

**VERDICT: READY** — no unresolved material issue remains.

**MATERIAL:** none.

### Verification performed

- Read LLP 0058 (1885 lines) and the LLP 0059 resume/custody sections in full.
- Implementation fidelity swept against code: four meta keys and exact poison bytes
  (`src/storage/auth_mode.rs:25-28`, `src/auth/mode.rs:18-19`), generation overflow
  fail-closed (`src/auth/mode.rs:199-203`), six-variant `ResolvedAppAuthority` and gate
  types (`src/auth/invocation.rs:272,814,1026,1114,1246`), null-prototype deep-frozen
  projection enforced JS-side (`packages/snapback-harness/ctx-bootstrap.js:480-521`,
  asserted `src/runtime.rs:3098-3102`), carrier hardening — O_NOFOLLOW, owner-only,
  nlink==1, no extended ACLs, 32 MiB (`src/secure_file.rs:298-395`,
  `src/auth/mode.rs:17`), closed 8-id capability registry and the two admissible pairs
  (`src/manifest.rs:2790-2830,3129-3138`), 30000/20000 ms deadlines with compile-time
  ordering assert (`src/auth/admission.rs:23`, `src/server.rs:4708-4711`), handshake DTO
  exactness/`const:1`/required-nullable members (`src/auth/handshake.rs:280-333`), raw
  loader closure (`src/local.rs:2567-2610`, `src/host_ops.rs:682,1507`), both-key live
  owner predicate with no `is_some()` short circuit (`src/local.rs:2195-2201`),
  fail-closed `DurableModeCommit` where only typed `RolledBack` re-arms reopen
  (`src/storage/auth_mode.rs:82-90`), sticky-overflow sentinel
  (`src/live_wire.rs:421-432`, `src/local.rs:8233`), and readiness derived-not-asserted
  (`src/auth/mode.rs:427-445`).
- Acceptance evidence: parity corpus dual-executed Rust+kit and wired into
  `scripts/verify-local-proof` (85, 128) / `.github/workflows/local-proof.yml`
  (`tests/artifact_schemas_v0.rs:449-528`,
  `demos/_kit/tests/auth-session-schema-parity.mjs:24`); corrupt DB/WAL byte regression
  (`src/storage/auth_mode.rs:2493-2529`); predecessor harness pins all three SHAs,
  concurrent port sentinel, receipt format 2 fresh at 2026-07-15 with matching harness
  SHA-256 (`tests/acceptance/auth-mode-predecessor-v1.mjs:18-96,162-182,362`); same-mode
  witness/floor, paused-body, clear-retained-sentinel, lease-revalidation tests present
  (`src/storage/auth_mode.rs:2087`, `src/auth/admission.rs:1312-1339`,
  `src/local.rs:8702-8728`).
- LLP 0059 reentrant resume (explicit ask): fix
  `packages/snapback-contract/auth-coordinator.mjs:688-745` handles both the
  transition-owner resume reload (exact settled revision+epoch+authority-key match →
  capture; mismatch → `SNAPBACK_CLIENT_AUTHORITY_STALE`) and the peer-adoption reentrant
  synchronize (re-read under ownership instead of awaiting its own promise). Ownership is
  released before resume (`auth-coordinator.mjs:1203-1208`), so no lock deadlock.
  **Empirically verified**: against the pre-fix coordinator (8f03e42^, run in a /tmp
  copy), `auth-coordinator.test.mjs` fails with `SNAPBACK_AUTH_TRANSITION_FAILED` and the
  composed `auth-coordinator-contract.test.mjs` (single + multi-live surfaces on one
  coordinator) hangs to timeout; both pass at HEAD and are wired via
  `scripts/verify-local-proof:150` → package `test` script.
- Cross-document ownership: 0039 is Draft/FROZEN with the exact deferral section; 0012
  registers `SNAPBACK_REQUEST_BODY_TIMEOUT` (408), kit-produced
  `SNAPBACK_AUTH_HANDSHAKE_INVALID`, 503 `_INVALIDATION_CLIENT_UNSUPPORTED`, and the
  must-understand auth-mode exception; 0053 owns `CompositeWitness` and lease constants;
  0055's dated amendment matches 0058's projection rules; 0059 owns the required nullable
  `deploymentIdentity` and reciprocally credits 0058 for staged mode/handshake; 0060 owns
  hosted security. No contradictions.

### MINOR findings and resolution criteria

1. **Cache-Control spelling** — code emits `no-store, private` (`src/server.rs:4601`);
   spec pins `no-store` (llp/0058 §Exact response DTO). Safe superset. *Resolve:* align
   spec text (or trim code) in the next 0058 revision.
2. **`AuthorizationCommitWitness` shape decomposed** — spec pins version + deployment
   identity + incarnation as one record (llp/0058:794-803); code carries identity in the
   sibling `NetworkDeploymentCommit.state` (`src/storage.rs:270-282`,
   `src/storage/auth_mode.rs:58-70`). Facts all delivered. *Resolve:* reword the spec to
   "returns to the transition owner" as a composed result, or name both types.
3. **Per-fact readiness negation overclaim** — Acceptance says every item-1…5 fact is
   "independently negated and blocks consume" (llp/0058:1765-1767); the committed test
   negates one fact (`src/auth/mode.rs:547-570`); the other nine are covered structurally
   via `validate()` recomputing the derived AND (`src/auth/mode.rs:440-445`). *Resolve:*
   loop the negation over all ten facts, or soften the acceptance sentence.
4. **Predecessor freshness gate is manual-only** — disclosed in-spec (manual cadence +
   `--require-current-evidence` at ratification/release), but nothing automated flags the
   receipt aging past 31 days; `verifiedAt` is date-only. *Resolve:* acceptable as
   written; optionally note date-only granularity in the spec.
5. **One-directional supersession pointer** — 0058 says 0055 "supersedes" its item-4
   baseline; 0055 never names 0058. *Resolve:* optional one-line Related/amendment note
   in 0055.

None of these blocks ratification-readiness of the implementation reconciliation; the
Draft still requires the author's own ratification per its Status section, which this
review does not perform.

## Verification (if minors are actioned later)

`scripts/verify-local-proof` (runs cargo test + kit + contract package tests);
`scripts/verify-auth-mode-predecessor --require-current-evidence` before ratification.

## Blind final2 review — 2026-07-15

### Provenance

- Reviewer family: Claude Fable
- Provider/runtime: Claude Code / claude-fable-5
- Method: read-only blind review; archived verbatim from `/private/tmp/eng25001-final2-fable-0058.md`
- Session: `not recorded in supplied artifact`
- Reviewed commit: `3ac047322d055fad03e8308fdc0905d758eb9f61`
- Human authorization: ENG-25001 completion request
- Secrets or redactions: none

### Verbatim review artifact

All evidence gathered. The shared closed DTO claim is confirmed (both WS frames and the HTTP twin decode `SessionSubscribeRequest`/`SessionPublishRequest`/`SessionDeleteRequest` with `deny_unknown_fields` and no legacy identity fields). Every sampled ENG-25001 closure matched the implementation, both delayed synchronize-result cuts are fenced with dedicated regression tests, and the spec language conforms. Producing the final verdict.

VERDICT: READY

MATERIAL:
- None.

MINOR:
- `packages/snapback-contract/auth-coordinator.mjs:1206-1214` — in `#finishClearingOwned`'s catch, `this.#activeBarrier = null` runs before the `SNAPBACK_AUTH_TRANSITION_FAILED` details object is built, so its `phase` detail is always `'unknown'` (the parallel catch in `#resumeAfterOwnership`, lines 1288-1298, orders this correctly via `finally`). Diagnostic detail only; `causeCode` is preserved. Fix by capturing the phase before clearing the barrier.
- The 3ac0473 adopt-path fence (`localAtRead`/`publicationPausedAtRead` and the exact-and-exposed confirmation branch, `auth-coordinator.mjs:1239-1256`) has no dedicated regression test; the post-barrier test (`auth-coordinator.test.mjs:662-703`) exercises only the non-adopt plain-capture path. Reachable interleavings funnel to tested confirmation/stale outcomes and `#adoptSettled`'s regression guard backstops it, but a direct delayed-adopt-delivery fixture would pin the fence.
- `transition()`'s same-successor idempotent return (`auth-coordinator.mjs:1030-1033`) and `compareAndRotateBearer` (`auth-coordinator.mjs:913`) call `#adoptSettled` with default `expose: true`, which can lift `#publicationPaused` if invoked while a local barrier's phases are still running (peer-adoption phases run outside storage ownership); `compareAndCommit` already preserves pause via `{ expose: !this.#publicationPaused }` (`auth-coordinator.mjs:856`). Pre-existing, narrow, not an ENG-25001 regression — suggest the same expose symmetry as hardening.
- LLP 0059's acceptance narrative (`llp/0059...spec.md:2024-2031`) describes the owner/peer changed-durable resume races but does not enumerate the two delayed-delivery regressions baaf890/3ac0473 added; the normative rule (0059:1390-1402) covers the behavior, so the acceptance text understates committed coverage rather than overclaiming. Editorial doc catch-up.

EVIDENCE:
- LLP 0058 read completely (1893 lines at 3ac0473): Revised/ENG-25001 header (lines 22-26), §Summary claims 1-5, §Complete candidate-pair preflight (365-410), §Cold startup artifact carrier (660-694), §Consume ordering incl. safe post-consume/pre-bind interval (696-731), §Same-mode provisioning composed witness (766-841), §Exact response DTO/Exactness (1221-1348), §Activation-readiness (1421-1519), §Acceptance/predecessor evidence (1563-1659), §Status/Review triage (1832-1893).
- Governing context: LLP 0059 §Coordinator interface (1301-1351), §Cross-context ownership incl. the exact-or-stale resume-reload rule and "begun before the barrier but completing after settle" sentence (1353-1402), §Transition barrier (1457-1568), §Diagnostics `SNAPBACK_CLIENT_AUTHORITY_STALE` row (1842), §Coordinator and two-context races (1977-2031); LLP 0039 `#protocol-obligations-deferred-to-implementation` heading (0039:1560); LLP 0012 registration of `SNAPBACK_REQUEST_BODY_TIMEOUT` (408) and kit-produced `SNAPBACK_AUTH_HANDSHAKE_INVALID` (0012:646-648); LLP 0057/0055 edits in 5c23b44.
- Cut 1 (synchronize completing during resume): reentrant-resume ownership re-read in `synchronize()` (`auth-coordinator.mjs:688-713`, from 8f03e42 broadened in 5c23b44), in-barrier adopt confirmation/stale (`auth-coordinator.mjs:1227-1238`, 5c23b44), non-adopt fence (baaf890 diff adding the `#activeBarrier !== null` exact check). Tests: `auth-coordinator.test.mjs:412-448` (owner resume exact reload, resume runs once), 450-490 (peer-adoption resume), 492-545 (changed durable during owner resume → `SNAPBACK_AUTH_TRANSITION_FAILED`, stays clearing, later clean sync adopts successor), 547-600 (peer variant → `SNAPBACK_CLIENT_AUTHORITY_STALE`), 602-660 (pre-barrier read delivered during held resume → STALE, capture stays CLEARING).
- Cut 2 (synchronize result completing after the resume barrier): 3ac0473 diff makes the non-adopt exactness check unconditional (was gated on `#activeBarrier !== null` from baaf890) — `auth-coordinator.mjs:1260-1277` ("stale even once the barrier is no longer active") — and adds `localAtRead`/`publicationPausedAtRead` capture in `synchronize()` (733-746) plus the adopt-path post-barrier fence and exact-confirmation branch (1239-1258). Regression test added in 3ac0473: `auth-coordinator.test.mjs:662-703` (delivery after `activeBarrier` gone → `SNAPBACK_CLIENT_AUTHORITY_STALE`, settled successor capture unchanged, fresh synchronize returns successor). Interaction verified: 3ac0473 subsumes baaf890's during-barrier semantics unchanged; pre-3ac0473 the post-barrier delivery returned the obsolete predecessor capture, violating 0059:1398-1402, now conformant.
- Contract composition (5c23b44): single/multi-live resume participants `await coordinator.synchronize()` inside the closed barrier (`packages/snapback-contract/index.mjs:2395,3908` regions); each real participant resumed exactly once (`auth-coordinator-contract.test.mjs` diff); intent-backed same-user recovery strands non-replayable/rerecordable (`client-store-authority.test.mjs` diff), matching 0059:1255-1263.
- ENG-25001 closures verified in implementation: raw loader (`src/local.rs:2567-2609`; carriers `src/server.rs:10070-10089`, `src/server.rs:10505-10568`; in-process refusal `src/host_ops.rs:916`; tests `src/server.rs:16278,16634`), prepared generation (`src/local.rs:2361-2443`; fresh-VM probe `src/runtime.rs:1672-1702`; publish-after-consume `src/local.rs:2617`), seed provenance (`require_fresh_seed_target`, `src/storage/auth_mode.rs:1574-1599`, enforced at 535-559), composed gate (`InvocationGate::prepare_admitted_authority`, `src/auth/invocation.rs:1114`; `PreparedConnectionAct` in `src/server.rs`), session ephemeral DTO closure (`src/server.rs:12575-12655`, HTTP twin at 13711), live-owner effect fence (`is_owned_by`, `src/local.rs:2195-2201`, enforced at 4595/4875/5184), handshake schema exactness (`src/auth/handshake.rs:139-209`; generic descriptor stays `u32` at `src/manifest.rs:2424`, matching baaf890's corrected 0058 text), shared corpus (`tests/conformance/auth-session-parity.corpus.json` consumed by `tests/artifact_schemas_v0.rs:450` and `demos/_kit/tests/auth-session-schema-parity.mjs:24`), `Cache-Control: no-store, private` (`src/server.rs:4601`), poison bytes (`src/auth/mode.rs:19`), 30000/20000 ms deadlines (`src/auth/admission.rs:23`, `src/server.rs:4708,4743`), carrier boundary (`src/secure_file.rs:313-393`: O_NOFOLLOW, owner-only, nlink==1, ACL rejection, inode/size stability), startup recovery diagnostics (`with_expected_deployment`, `src/cli.rs:61-71`; pre-bind downgrade audit `SNAPBACK_AUTH_MODE_DOWNGRADE_COMMITTED`, `src/cli.rs:349-359`), readiness derivation/inventory equality (`src/auth/mode.rs:396-460`; construction-receipt negation injections from c095370 in `src/auth/runtime.rs`, `src/cli.rs`).
- Predecessor evidence gate: `scripts/verify-auth-mode-predecessor` execs `tests/acceptance/auth-mode-predecessor-v1.mjs` (pins `1d6cafb6`/`8da7b46b`, `MAX_EVIDENCE_AGE_DAYS = 31`, `--require-current-evidence` line 397, `--update-receipt` line 387); receipt format 2 with three cases, `listenerBound:false`, and dated provenance `2026-07-15` — matching 0058:1588-1628.
- Commit sequence audited (stats/diffs, llp/reviews excluded): c095370 → 8f03e42 → 5c23b44 → baaf890 (also corrected 5c23b44's momentary descriptor-schema overstatement in 0058:1316-1324) → 3ac0473; HEAD confirmed `3ac047322d055fad03e8308fdc0905d758eb9f61`, clean tree; coordinator regression suite wired into the proof inventory (`scripts/check-package-test-inventory.mjs:42`).
