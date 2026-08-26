**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.149.0, `gpt-5.6-sol` at ultra
reasoning effort (confirmed in run-log header), read-only sandbox,
independent ephemeral session
**Date:** 2026-08-25
**Redacted:** no
**Method:** cli-runner (kill-proof detached dispatch)

# LLP 0314 cluster review artifact — Codex family

Lockstep cluster: `llp/0314-shipped-runtime-binary-size.research.md`
(primary) + `llp/0314.000-reduce-shipped-runtime-size.plan.md`. This is
the single verbatim preservation for the cluster; per-target verdicts
are inside the review body. 0314.000 has no separate codex artifact —
this file is authoritative for both targets.

## Round 1 — Review r1 (post status-flip)

- Revision under review: commit
  `235fabf283afb7fba4a228585279c2c0ab06577f`
  - 0314 sha256 `c55d05f0bebf07f58790507b4207cce63d73e87a339befdf9684f8e616cba028`
  - 0314.000 sha256 `8b67e3692560363facb5fc1b39c6ac31be9b28793cc657e788dff6df4cd93204`
- Capsule: live checkout at that commit, read in place. No 0314 review
  artifacts existed anywhere in the tree at launch or during the run;
  blindness with respect to review artifacts was structural for this
  round. The instruction ban on reading `llp/reviews/` and other
  reviewers' output is additionally SELF-ATTESTED (read-only sandbox
  spans the checkout).
- Instruction brief sha256
  `80e51ab29a547ff7cdce80232b94a565b0e578d510c97de3677470b296dd4cc4`
  plus a codex-specific read-only preamble.
- Independence: separate process and fresh session from the
  orchestrating reviser (Claude family); different model family from
  the second reviewer (grok-4.6), mutually blind.
- Runtime: ~16 minutes wall clock (both reviewers done at the same
  poll tick).
- Result: **0314 NOT READY (1 MATERIAL), 0314.000 NOT READY
  (8 MATERIAL), SET NOT READY.**

### Verbatim review body

# Independent review — LLP 0314 cluster, round 1

I reviewed both targets in full, checked the named implementation and policy surfaces, and did not consult review artifacts.

1. **MATERIAL — LLP 0314, F4 / Related / “What this is not.”** The byte diagnosis is correct, but calling the Guide an “inconsistent sibling” misstates why it is embedded. [LLP 0061 §4a](/Users/ccheever/projects/snapback/llp/0061-agent-first-snapback-guide.rfc.md:544) deliberately chose “embedded-in-binary, always served” so the server is the structural version authority and HTTP and MCP re-serve one build-matched corpus. The corresponding `@ref`s remain in [build.rs](/Users/ccheever/projects/snapback/crates/snapback-server/build.rs:128) and [guide.rs](/Users/ccheever/projects/snapback/crates/snapback-server/src/guide.rs:1). This omission materially changes the decision context and leads directly to Phase 2 treating a governed architecture choice as packaging drift.
   **Suggested fix:** Add LLP 0061 to `Related` and the boundary section. Rewrite F4 to say the approximately 20 MB cost is real but intentional, and record that replacement carriage must preserve always-available, build-bound, same-corpus HTTP/MCP semantics.

2. **minor — LLP 0314, “What core code has to do with this.”** The claim that the debug binary’s three million symbols are “those tests plus monomorphization” is incorrect. A normal `cargo build --bin snapback` does not compile integration tests or `#[cfg(test)]` modules into `target/debug/snapback`; enabled `test-support` features are a different matter.
   **Suggested fix:** Remove the test-source attribution. Say the test counts contextualize repository size but are not part of the ordinary binary, and attribute symbol growth only after an `nm`/bloat analysis.

3. **minor — LLP 0314, F7.** The comparison table lacks versions, platforms, and a consistent definition of “published binary.” Current official assets illustrate the problem: Meilisearch’s Apple-silicon executable is 116 MB, outside the stated 10–50 MB class; Deno and Bun expose 36.7 MB and 24.4 MB Darwin-arm64 ZIPs, which are not comparable to Snapback’s raw executable; MinIO’s 103 MB Darwin-arm64 executable does support its row. [Meilisearch releases](https://github.com/meilisearch/meilisearch/releases), [Deno releases](https://github.com/denoland/deno/releases), [Bun releases](https://github.com/oven-sh/bun/releases), [MinIO assets](https://github.com/minio/minio/releases/expanded_assets/RELEASE.2025-09-07T16-13-09Z).
   **Suggested fix:** Retain a dated table with version, architecture, raw-versus-archive labeling, and source URL—or remove the numeric peer table and keep the qualitative comparison.

4. **minor — LLP 0314, F2.** The `__gcc_except_tab` description specifically attributes bytes to “SQLite / Hermes glue” without retained symbol or compile-unit evidence. SQLite is C, Hermes contains C++, and Rust also emits unwind/LSDA metadata; the section is mixed.
   **Suggested fix:** Label it mixed Rust/C++ exception and unwind metadata until Phase 0 provides attribution.

5. **minor — LLP 0314, Summary / Evidence.** Units are inconsistent: 186,720,037 bytes is approximately 178.1 MiB, while 159,336,256 bytes is approximately 159.3 MB or 152.0 MiB. The ignored packaged binaries are also absent from the present checkout, so the F1/F2 measurements and the phrase “sitting in this checkout” cannot now be reproduced. This does not make the registry figures implausible.
   **Suggested fix:** Use exact bytes plus consistently labeled MB or MiB, and retain binary digests and raw `size`/`otool` output with the dated snapshot.

6. **minor — LLP 0314, F1 and LLP 0314.000, npm standing constraint.** LLP 0141 records more than the crates.io compressed-size problem: path dependencies, artifact acquisition, loader custody, qualification, and publication metadata also matter. The documents currently imply Hermes carriage is the only remaining reason.
   **Suggested fix:** Describe the 10 MB limit as one immediate blocker and state that shrinking or separately carrying Hermes would not, by itself, satisfy LLP 0141’s broader distribution requirements.

7. **MATERIAL — LLP 0314.000, Phase 1.** The proposed profile migration does not cover the authoritative manufacturing paths and conflicts with contributor-source custody. Both EAS platform jobs, the GitHub Linux workflow, [build-linux-runtime-release](/Users/ccheever/projects/snapback/scripts/build-linux-runtime-release:215), and [assemble-runtime-package](/Users/ccheever/projects/snapback/scripts/assemble-runtime-package:62) build `--release`; workflow receipts also name `target/release/snapback`. Meanwhile, linked-source CLI repair intentionally uses ordinary release. Merely changing both packer defaults to `target/production` will either leave publication lanes on the wrong artifact or break source repair.
   **Suggested fix:** Add an authoritative build-path inventory. Use production explicitly for public/native-artifact manufacturing, retain ordinary release for linked-source and `--source-test-staging` custody, update EAS/GitHub/scripts/receipt paths and pinned tests together, and make each lane pass its intended binary explicitly rather than relying on one global default.

8. **MATERIAL — LLP 0314.000, Measurement / Phase 1.** Production-profile use is not currently attestable. [BinaryIdentity](/Users/ccheever/projects/snapback/crates/snapback-types/src/identity.rs:52) reports only `debug` or `release` based on debug assertions, so both ordinary release and custom production report `release`. Existing package authority, readiness receipts, Linux transport, qualified assembly, and publication gates accept that coarse value; an overridden ordinary-release binary can therefore pass while the plan claims production.
   **Suggested fix:** Add a verifiable build-recipe or optimization-profile fact—without necessarily changing the compatibility-facing `buildProfile` field—and carry it through runtime qualification, package seals, Linux attestation, staging receipts, ledgers, and publication validators. Public-package assembly must require the production recipe.

9. **MATERIAL — LLP 0314.000, Phase 2 / Related.** Phase 2 reverses settled Guide and security-boundary decisions without naming or amending them. Besides LLP 0061, [LLP 0284](/Users/ccheever/projects/snapback/llp/0284-workspace-security-gate-threat-model.spec.md:590) makes the inert binary artifact, committed decoder, directly included manifest, and hash agreement part of the workspace security design. “Carriage only” is therefore inaccurate.
   **Suggested fix:** Add an explicit design checkpoint that amends LLP 0061 and LLP 0284 before implementation, then reconcile LLPs 0041, 0123, and 0276 plus Guide/capability/CLI documentation. Preserve the old properties explicitly: build/source binding, one validated corpus for HTTP and MCP, always-available packaged discovery, and inert bounded decoding.

10. **MATERIAL — LLP 0314.000, Phase 2 implementation contract.** The sidecar has no complete trusted production or consumption path. Current package manifests, atomic swap lists, readiness artifact candidates, EAS transports, Linux native attestation, final assembly, publication tarball reopening, and cold-install tests omit Guide data. The decoder currently compares the generated artifact with a separately compiled manifest; removing both compile-time inputs leaves no defined trust anchor. `scripts/runtime-build-inputs.txt` also classifies `guide` as a binary input, so conditionalizing `include_bytes!` alone cannot make Guide edits stop rebuilding or stop affecting dirty/build identity.
    **Suggested fix:** Define a deterministic artifact producer and stable format; a trusted `{sourceRevision, contentHash, artifactSha256}` tuple; direct-binary and CLI-launched path resolution; fail-closed no-fallback behavior; and shared HTTP/MCP identity. Add the artifact to both package manifests, swap/rollback inventories, readiness seals, native transport, publication validation, and platform tests. Split binary-input and package-input closures for public-package builds.

11. **MATERIAL — LLP 0314.000, Phase 2 / Expected outcome.** The unpacked-package and tarball projections double-count the sidecar as a saving. Moving approximately 20.5 MB out of the executable but into the same npm package reduces the executable/dyld image, not the unpacked closure. From the research’s exact values, current non-binary content is about 27.4 MB; a 90–110 MB binary plus that content plus a 20.5 MB Guide is roughly 138–158 MB decimal, not 110–130 MB. Compression should likewise leave the tarball approximately neutral for those bytes.
    **Suggested fix:** Show Phase 1 and Phase 2 effects separately. Describe Phase 2 as an executable mapping and rebuild-isolation improvement, and remeasure before assigning tarball/package ranges. If 110–130 MB unpacked is a real objective, choose carriage that does not reinstall the same raw corpus.

12. **MATERIAL — LLP 0314.000, Measurement / Open question 3.** The proposed blocking baseline lacks custody and ceremony parity. LLP 0189 D-4 requires metrology outside a claim digest to retain its own registered drift coverage; the plan names neither a semantic input closure nor an authorized baseline-update procedure. Defaulting the check to the fast path would also leave qualified staging as a bypass, contrary to LLP 0041’s shared publication assertions.
    **Suggested fix:** Define one shared validator used by every publication ceremony, a baseline schema and recompute-versus-committed gate, its frozen-record or claim-scoped custody, and an intentional-growth authorization protocol. Apply LLP 0189 D-6: green scoped evidence plus the newest eligible complete battery; unrelated reds remain ticketed rather than blocking.

13. **MATERIAL — LLP 0314.000, Phase 3 items 3–4.** Compile-time `assets` and KDF compatibility features do not fit a single prebuilt npm runtime. An installation cannot enable a Cargo feature based on whether its database contains bcrypt/scrypt hashes. Disabling compatibility strands accepted imported credentials; enabling it saves no shipped bytes. [LLP 0227](/Users/ccheever/projects/snapback/llp/0227-password-credential-auth.rfc.md:473) requires bounded bcrypt/scrypt verification and upgrade-on-verify, implemented in [auth_identity.rs](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_identity.rs:815). The assets proposal has the same one-binary problem.
    **Suggested fix:** Remove these from ordinary graph trimming. Retain compatibility and upload decoding unless a separate design supplies safe migration, distinct runtime variants, or dynamically carried capability modules.

14. **MATERIAL — LLP 0314.000, Phase 3 item 6.** `panic = "abort"` is presented as a byte optimization, but production behavior relies on `catch_unwind`. In particular, [commit_capsule.rs](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/commit_capsule.rs:866) catches panics to preserve commit-uncertainty state and perform reservation/after-local cleanup before resuming; writer and nested-mutation paths have similar boundaries. Abort disables those paths and skips normal unwinding. A size ranking cannot establish semantic safety.
    **Suggested fix:** Remove `panic = "abort"` from this plan’s routine cut list, or require a separate durability/safety decision with a complete production `catch_unwind` and `Drop` audit, crash/restart reconciliation proof, and governing LLP amendments.

15. **MATERIAL — LLP 0314.000, Measurement / Phase 0 / Linux parity.** Measurement promises Darwin and Linux evidence, but Phase 0 establishes only a Darwin ranking while Phase 1 changes and publishes both platforms. Linux has a different ELF, ICU, shared-library, attestation, and native qualification closure, so proportional movement is not an adequate exit condition.
    **Suggested fix:** Add native Linux pre-change and post-change evidence: ELF sections/symbols, executable and package bytes, tarball size, loader portability, runtime qualification, attestation, seal reopening, and cold-install proof. Crate ranking may remain Darwin-only if explicitly scoped, but Linux publication needs its own measured baseline.

16. **minor — LLP 0314.000, Phase 1 stripping.** “Cargo strip and/or packer strip” leaves the exact transform point ambiguous. LLP 0123 binds the final binary bytes after loader-relative CV-2 qualification; stripping after qualification invalidates the seal. Also, a useful dSYM or ELF debuginfo sidecar cannot be recovered after building without the needed debug information and stripping it.
    **Suggested fix:** Choose one deterministic pre-qualification strip point. If symbolized support is required, configure split debug information, generate and UUID/build-id-bind the sidecar before stripping, archive it outside npm, then run measurement, CV-2, attestation, sealing, and packing over the final stripped bytes.

17. **minor — LLP 0314.000, phase exits.** The plan correctly preserves LLP 0010’s report-only debug metrology, LLP 0276’s release/production split, optimistic landing under LLPs 0189/0232, and LLP 0041’s rapid-publication posture. Its exits should state those operational consequences rather than leaving them implicit.
    **Suggested fix:** Require affected checks before optimistic landing; prompt publication through the existing qualified path; scoped evidence plus LLP 0189 D-6 battery reference; and ticketing, rather than blocking, for unrelated reds.

Overall, the core research diagnosis is largely sound: F1 is plausible but not locally reproducible; F2’s section accounting is internally coherent; F3 is confirmed by Cargo profiles, packers, and workflows; F4’s byte measurement is sound; F5 correctly exonerates Hermes; and F6 correctly identifies the enabled graph while disclaiming unmeasured byte attribution. The research is not ready because it omits the governing rationale for its most consequential finding. The plan has a sensible high-level direction—production LTO, post-build stripping, measured graph work—but is not implementable safely as written: profile identity, publication custody, Guide authority, package arithmetic, Linux proof, compatibility, and panic semantics all need resolution first.

VERDICT 0314: NOT READY
VERDICT 0314.000: NOT READY
VERDICT SET: NOT READY

## Round 2 — delta round on revision r2

- Revision under review: commit
  `fca941e42dde56d5dd6919f946b8b79ba222c294`
  - 0314 sha256 `986225429eb6adbb5e284821fb3114210788004c0e3357f83b83c56bae72d5f1`
  - 0314.000 sha256 `1d945547af72c73901ddc06a8cbcb24fd027af21b0aca3f15abcee6096b23945`
- Capsule: `git archive` export of that commit with `llp/reviews/0314-*`
  removed (structural exclusion of the targets' review artifacts) and the
  enumerated delta `r2-delta.diff` (`235fabf28..fca941e42`) at the capsule
  root. Runner confinement to the capsule directory is instruction-based and
  SELF-ATTESTED. Instruction brief sha256
  `6e5c0b7da5edebfbc46f6b37159c2a209a79badc9bf7512c2abc945a53b02697`.
- Delta-round rules: every concern classified IN-DELTA vs PRE-EXISTING.
- Runtime: both reviews returned at the ~32-minute poll tick.
- Launch note: the first codex launch VOIDED on an infrastructure refusal
  ("Not inside a trusted directory" — the capsule is not a git repository; no
  review content was produced). Relaunched with `--skip-git-repo-check`;
  effort header "ultra" confirmed in the run log. Second launch of the cap.
- Result: **0314 NOT READY (1 MATERIAL, IN-DELTA), 0314.000 NOT READY
  (4 MATERIAL, all IN-DELTA), SET NOT READY. No PRE-EXISTING MATERIAL
  concern found** (reviewer's own statement).

### Verbatim review body (round 2)

## Findings

1. **MATERIAL — IN-DELTA — LLP 0314, F3 (“The publish path does not use the production profile”).** The newly widened “whole manufacture graph” incorrectly includes `scripts/assemble-runtime-package` as evidence of public-package drift. That script is the contributor/source-checkout repair path: it intentionally builds `target/release/snapback` and invokes package preparation with `--source-test-staging --strict-clean-release`. LLP 0010, LLP 0041, and the CLI recovery path all preserve that custody. Conflating it with public manufacture directly leads to the defective Phase 1 prescription below. **Suggested fix:** divide F3 into public manufacture—the packer defaults, GitHub/EAS jobs, and `build-linux-runtime-release`—versus intentional source-repair custody. Remove `assemble-runtime-package` from the npm ship-profile evidence.

2. **MATERIAL — IN-DELTA — LLP 0314.000, Phase 1 §§1a–1b.** Phase 1a explicitly moves `scripts/assemble-runtime-package` to production, while Phase 1b requires source-checkout custody to remain on ordinary release. The CLI hardcodes `target/release/snapback`, and this assembler is its named clean repair command. Retargeting it would produce/package a production artifact without repairing the binary that the linked CLI selects. **Suggested fix:** retain its ordinary-release build and pass an explicit release-binary override after packer defaults change, or create a separately named public-manufacture mode without altering contributor repair.

3. **MATERIAL — IN-DELTA — LLP 0314.000, Phase 1 §§1a–1b and exit evidence.** The prescribed Linux workflow becomes unpassable. Today its sole release build creates `target/release/snapback`, issues its sibling receipt, and then `package.test.mjs` calls `resolveRuntimeBinary()` and requires that source-checkout release plus receipt. Phase 1a moves the only build and receipt paths to `target/production`, while Phase 1b explicitly preserves the release assertion. A clean job will therefore have no qualified release artifact for that test. **Suggested fix:** either build and receipt a separate ordinary-release artifact for the source-custody assertion, or split that assertion into a source lane and let the public-package lane test installed-package custody only.

4. **MATERIAL — IN-DELTA — LLP 0314.000, Phase 2 “Pinned shape,” “Wiring inventory,” and “Build-graph split.”** The plan disables the only producer of the sidecar it proposes to ship. `crates/snapback-server/build.rs::emit_embedded_guide` alone creates `embedded-guide.v1.bin`, and only inside Cargo’s hashed `OUT_DIR`; `guide.rs` merely consumes it. Gating that function off for public builds leaves final assembly nothing to stage or seal. **Suggested fix:** extract a deterministic standalone encoder shared with contributor embedding; run it from the exact clean source revision in local and qualified final assembly; pin its output path, freshness checks, revision stamping, and native-transport/final-assembly handoff. Gate only Rust inclusion, not artifact production.

5. **MATERIAL — IN-DELTA — LLP 0314.000, Phase 2 “Pinned shape,” “Wiring inventory,” and governance amendment.** The revised “closed” design stops at package carriage and never defines how the runtime locates, authenticates, and safely loads the sidecar.

   - `guide.rs` currently uses unconditional `include_bytes!`; it has no filesystem branch or package-relative path.
   - The admin analogy works only because `runtimeSpawnEnvironment` validates package custody and sets `SNAPBACK_ADMIN_DIST`; no corresponding Guide seam or direct-binary behavior is specified.
   - The decoder checks `contentHash`, but LLP 0284 §3.7 explicitly says that hash does not bind individual pages, section flats, or non-`contentHash` manifest bytes. HTTP identity uses the binary commit while native/MCP identity reads the sidecar’s restamped manifest commit, so a same-content, wrong-revision sidecar can create contradictory identities unless the full seal tuple is enforced at load.
   - A simple binary-input/package-input split is insufficient: contributor binaries still embed Guide bytes, whereas public binaries do not. Custody must be distribution-conditional, and LLP 0010’s packaged readiness artifact set must be amended to include the sidecar.
   - External loading also needs total-size, record-count/length, regular-file/symlink, and read-once verification rules to preserve the promised bounded inert decoder.

   **Suggested fix:** pin the exact member path and executable-relative or authenticated-environment discovery contract; define common, contributor-embedded, and public-package input closures; amend LLP 0010 readiness and repair semantics; validate full artifact SHA and source revision against binary/package identity before parsing immutable bytes; and test installed CLI, bare launch, HTTP, MCP, and native `snapback guide` across missing, tampered, oversized, and wrong-revision sidecars.

6. **minor — IN-DELTA — LLP 0314.000, Phase 2 “Build-graph split” and expected outcome.** “Publish-path rebuild isolation” contradicts the decision to retain the content-derived Guide manifest as `include_str!`, and the text itself admits every Guide edit recompiles that unit. With nonincremental fat LTO, the production binary still relinks. **Suggested fix:** describe the benefit as reduced embedded/link payload, or externalize all Guide-derived binary inputs if true no-relink isolation is required.

7. **minor — IN-DELTA — LLP 0314.000, Measurement and OQ3.** The plan mandates a publication-blocking validator but leaves the exact tolerance, initial-baseline bootstrap, update authority, and durable authorization record unresolved. It also names staging lanes rather than explicitly guarding the final immutable tarballs accepted by publication. **Suggested fix:** settle those policy fields before Phase 1 publication and invoke the shared validator over the exact closure at the final publication gate.

8. **minor — IN-DELTA — LLP 0314.000, Phase 1c and OQ5.** “Profile + LTO recorded at build time” does not yet enumerate the complete normative recipe or its authority. A marker alone could reproduce the ordinary-release substitution problem; production also specifies `codegen-units = 1`, `incremental = false`, and now `strip = "symbols"`. **Suggested fix:** bind the attestation to the controlled Cargo command, toolchain/config digest, all normative profile fields, binary digest, and a policy forbidding relevant `CARGO_PROFILE_*` overrides.

9. **minor — IN-DELTA — LLP 0314.000, Phase 1a closed inventory.** The inventory omits `scripts/packaged-store-qualification.mjs`, whose direct default still calls `target/release/snapback` the clean public-package binary, plus path-migration rows `s01-r013` and `s07-r004`. The qualified wrapper supplies an explicit binary, so this is not a core-lane blocker, but the direct entry point and frozen inventory become stale. **Suggested fix:** require an explicit staged binary or retarget the default, update its help/tests, and revise both omitted rows.

10. **minor — IN-DELTA — LLP 0314 F6 and LLP 0314.000 Phase 3 item 2.** Both documents newly claim three normal-dependency `jsonschema` sites, including `snapback-types`. Its manifest places `jsonschema` under `[dev-dependencies]`; only `snapback-engine` and the umbrella `snapback` crate are normal-dependency sites. **Suggested fix:** correct both inventories and retain the Phase 0 ranking prerequisite.

11. **minor — IN-DELTA — LLP 0314, F7.** The new `executable` label makes the PocketBase row factually inconsistent with retained capsule evidence: the official PocketBase 0.39.9 macOS-arm64 executable is recorded as 30 MiB, not approximately 13 MB. The table also lacks exact peer versions/assets. **Suggested fix:** use approximately 31.5 decimal MB for that executable, or relabel 13 MB as a precisely identified compressed asset, and retain versions and byte counts for every comparison.

12. **minor — PRE-EXISTING — LLP 0314.000, Non-goals.** The unchanged “PocketBase (~13 MB)” statement carries the same incorrect executable comparison. **Suggested fix:** update it consistently with the corrected F7 record.

13. **minor — IN-DELTA — LLP 0314.000, Phase 4.** A hosted `snapbackd` with “no Guide sidecar duty” cannot also preserve LLP 0061’s always-available HTTP Guide when hosted deployment ships only that daemon. Because this is explicitly a deferred RFC-sized option, it need not block the present plan. **Suggested fix:** state that the daemon retains HTTP Guide loading/validation while omitting CLI/MCP, or require the future RFC to amend LLP 0061.

## Overall assessment

The revised research still misclassifies contributor repair as public manufacture. LLP 0314 is therefore NOT READY because Finding 1 is MATERIAL and IN-DELTA.

The plan’s Phase 1 custody inventories are mutually inconsistent, and Phase 2 lacks both a sidecar producer and an executable runtime custody design. LLP 0314.000 is therefore NOT READY because Findings 2–5 are MATERIAL and IN-DELTA. No PRE-EXISTING material concern was found.

VERDICT 0314: NOT READY
VERDICT 0314.000: NOT READY
VERDICT SET: NOT READY

## Round 3 — closure delta round on revision r3

- Revision under review: commit
  `4c48d0ca03ae841f759221c26e098c4ca11429a0`
  - 0314 sha256 `f7ace0dd861ae70c045f61ee9b1a5537e76479e1fb6f7a530e5a2ebb50a15c04`
  - 0314.000 sha256 `a6c4ee5f0503a84a2f9656726ba66a247fe2bf57b2166465fcbb407d66e2eb64`
- Capsule: `git archive` export of that commit with `llp/reviews/0314-*`
  removed (structural exclusion); enumerated delta `r3-delta.diff`
  (`fca941e42..4c48d0ca0`) at the capsule root. Runner confinement to the
  capsule is instruction-based and SELF-ATTESTED. Instruction brief sha256
  `d9ce621fb01a867d414b9e158f7a3c9666aca5c273d3a3b9c11d5472d44a4f0a`.
- Runtime: both reviews returned at the ~21-minute poll tick.
- Result: **0314 READY. 0314.000 NOT READY (3 MATERIAL, all IN-DELTA;
  minors include 3 PRE-EXISTING).** Effort header "ultra" confirmed;
  launched with `--skip-git-repo-check` from the start (single launch).

### Verbatim review body (round 3)

1. **MATERIAL — IN-DELTA — LLP 0314.000, Phase 1 §1c “Profile attestation.”** The proposed “compiler-authoritative” recipe stamp is not feasible as specified. The current build script can observe the selected profile but not Cargo’s effective `lto`, `codegen-units`, `incremental`, and `strip` tuple. Reading `Cargo.toml` would attest declared policy, not actual compiler inputs. Moreover, forbidding only `CARGO_PROFILE_*` leaves `CARGO_INCREMENTAL`, `RUSTFLAGS`, `CARGO_ENCODED_RUSTFLAGS`, wrappers, target configuration, and Cargo `--config` overrides capable of changing the artifact while preserving the claimed stamp. The repository already treats these as build-affecting in `prepared-runtime-reuse.mjs`.

   Suggested fix: choose an implementable authority model. Either capture and digest-bind the effective final `rustc` invocation through a mandatory attested wrapper, or explicitly attest a controlled build closure and reject every ambient profile/config/flag override channel. Add negative tests for ordinary release and each override class, including cross-host attestation transport.

2. **MATERIAL — IN-DELTA — LLP 0314.000, Phase 1 §1a versus §1b.** The closed inventories contradict each other about path-migration row `s01-r005`. Section 1a includes it among ship-profile rows that change, while 1b correctly says `scripts/assemble-runtime-package` must retain ordinary release. The manifest itself identifies `s01-r005` as that script’s `cargo build --release` command and says its target remains unchanged. This can retarget the source-repair path that r3 intended to preserve.

   Suggested fix: remove `s01-r005` from the production-retarget set and explicitly retain it as an ordinary-release source-custody row. If its metadata needs reclassification, distinguish that metadata-only change from changing its command or output path.

3. **MATERIAL — IN-DELTA — LLP 0314.000, Phase 2 “Staging semantics” and “Carriage selection.”** The new text says all final assembly and package seals require the sidecar, while contributor-source builds retain embedded carriage. `scripts/assemble-runtime-package` creates a final sealed package through `--source-test-staging --strict-clean-release` from a `contributor-source` binary. Following both rules therefore places embedded and external Guide copies in that package, contradicting build-distribution-selected carriage and “fail closed both ways.”

   Suggested fix: define three explicit modes: native-artifact staging omits the sidecar; public-package final assembly requires and seals it; contributor source-test assembly omits it and uses embedded bytes. Swapping into contributor mode must remove any stale `guide/` member. Test all three transitions.

4. **minor — IN-DELTA — LLP 0314.000, Phase 1 §1a Linux lane split.** The plan removes the source-checkout assertion from its only demonstrated lane but merely says it will run “where a source release build exists.” No replacement owner issues and verifies the sibling release receipt and then exercises source-topology resolution. `scripts/assemble-runtime-package` builds release but currently neither issues that receipt nor runs the assertion.

   Suggested fix: name a dedicated source-custody lane, or extend the assembler’s affected proof to issue/reopen the exact release receipt and run the source resolver test. Keep the public-package lane installed-custody-only.

5. **minor — IN-DELTA — LLP 0314.000, Phase 2 “Producer” and “Build-graph split.”** Requiring the producer to use the binary’s exact clean source revision is correct, but the plan does not assign authority for proving it after Guide paths leave the binary dirty closure. Existing packer admission sees only the binary-scoped commit and `gitDirty`; a dirty Guide record not covered by `contentHash` could otherwise be encoded and sealed under clean binary identity.

   Suggested fix: have the producer read from the immutable Git tree named by `identity.binary.gitCommit`, or require an independently checked package-input closure with clean status and HEAD equality. Add dirty-unbound-record and wrong-checkout refusal tests.

6. **minor — IN-DELTA — LLP 0314.000, Phase 2 “Build-graph split.”** “Sidecar-only edits do not restamp binary identity” is too broad. Both identity build scripts track Git refs and stamp the checkout commit; every committed Guide change still advances HEAD and restamps identity. The pathspec split only prevents package-only working-tree edits from changing the binary-scoped dirty bit.

   Suggested fix: state that the split scopes `gitDirty`, not commit identity or rebuilds, and retain the separate package-input cleanliness gate from finding 5.

7. **minor — IN-DELTA — LLP 0314.000, Phase 2 member-path inventory.** The new `guide/embedded-guide.v1.bin` package member requires a new ignored assembly directory, but neither runtime package’s `.gitignore` includes `/guide/`. Both EAS and Linux CI require preparation to leave `git status --untracked-files=all` empty, and package tests pin the exact ignore arrays.

   Suggested fix: add `/guide/` to both runtime-package `.gitignore` files and their exact tests, or stage the member outside the checkout.

8. **minor — PRE-EXISTING — LLP 0314.000, Phase 2 governing-document inventory.** R2 already made the Guide a package-seal member without requiring an LLP 0123 amendment. LLP 0123’s live seal contract still enumerates only the binary, Hermes header, and Hermes runtime, while adding the Guide also changes package verification and app-owned CV-3 rehashing.

   Suggested fix: add LLP 0123 to the same-landing amendments and test Guide drift through both package-seal reopening and `runtime-qualify --persist/--verify`.

9. **minor — PRE-EXISTING — LLP 0314.000, Phase 2 implementation inventory.** The plan calls `crates/snapback-server/src/guide.rs` the HTTP surface, but it owns decoding/data access. HTTP routing is in `server.rs`; MCP and native Guide consumers live in `guide_mcp.rs`, `guide_reference.rs`, and `guide_command.rs`, with user-facing “embedded Guide” wording elsewhere.

   Suggested fix: inventory these consumers and terminology migrations so every public-package path uses the same external loader and refusal semantics.

10. **minor — PRE-EXISTING — LLP 0314.000, Phase 1 test inventory.** The Darwin package test calls `resolveRuntimeBinary()` from source-checkout topology, so it may select or refuse on `target/release` instead of proving installed-package custody. Linux already passes a non-CLI package root to force the installed path.

   Suggested fix: mirror the Linux installed-custody test on Darwin and keep any source-checkout assertion in the named release lane from finding 4.

Overall, LLP 0314’s r3 corrections are sound: the manufacture/source-repair split matches the capsule, the `jsonschema` inventory now has exactly two normal-dependency manifests, and the PocketBase executable/archive distinction is corrected. LLP 0314.000 remains not ready because MATERIAL findings 1–3, all IN-DELTA, leave the recipe authority infeasible and the two custody inventories internally contradictory.

VERDICT 0314: READY
VERDICT 0314.000: NOT READY
VERDICT SET: NOT READY

## Round 4 — author-authorized extension: scope-freeze punch-list delta round

- Authorization: the author selected the extension option in reply to the
  terminal report (2026-08-26). The plan carries a dated freeze declaration
  (r4.1). Target: 0314.000 only; the converged research was context, with
  contradictions admissible only if diff-created.
- Revision under review: commit `368ab1a1f3063b18a2592331f3c84a0c1aef7c4c`
  - 0314.000 sha256 `78bbd7e0b3cbc02c95df39e670335e5a0dec1912daa3790f9cedf0b72620e377`
- Capsule: `git archive` export of that commit with `llp/reviews/0314-*`
  removed; enumerated delta `r4-delta.diff` (`fb0bddda9..368ab1a1f`, 233
  lines) at the capsule root. Runner confinement self-attested.
- Materials: common brief sha256 `cd8eba0199591d49f89b0ea24fadde77f3e6bca8b871a77ccefd45e22722bbfa`;
  this family's punch list only (cross-family blindness preserved).
- Runtime: both reviews returned at the ~12-minute poll tick.
- Punch list sha256 `d4ec57554a5bccf506f752f239382489a3f8dc82b1eeb3d6d749d206c8834ad0`.
- Result: **NOT READY — 8/10 dispositions VERIFIED, 2 DISPOSITION ERRORS
  (1c override channels incomplete; consumer inventory wrong — including
  refutation of the orchestrator's own REFUTED disposition: the consumers
  exist at `crates/snapback-cli/src/cli/guide_command.rs` and
  `crates/snapback-cli/src/guide_mcp.rs`), plus 2 MATERIAL diff findings
  (bare-sidecar integrity unsound under LLP 0284 §3.7; producer scope
  conflicts with contributor assembly mode 3).** Orchestrator verified the
  CLI-crate files exist and `guide_artifact.rs` is shared constants — the
  round-4 punch-list REFUTED was the orchestrator's error, not codex's.

### Verbatim review body (round 4)

## Punch-list dispositions

1. **DISPOSITION ERROR** — Phase 1 §1c still does not close all ways the compiled recipe can differ from the declared recipe. It omits at least `-C incremental` from the forbidden `RUSTFLAGS` set, Cargo configuration discovered through `.cargo/config{,.toml}`/Cargo home, and final-target overrides such as `cargo rustc -- -C …`. These can preserve `PROFILE=production` while changing the effective recipe, leaving the static Cargo.toml-derived stamp false. Require compiler-observed effective flags or exhaustively exclude these channels, with negative tests.

2. **VERIFIED** — The 1a set is exactly `s01-r013`, `s01-r024`, `s01-r025`, and `s07-r004`. `s01-r005` remains ordinary release under 1b, matching `scripts/assemble-runtime-package:63`.

3. **VERIFIED** — Phase 2 names all three assembly modes, omits the sidecar for contributor staging, requires stale `guide/` removal through the swap, and requires transition tests. A conflicting producer scope is reported below.

4. **VERIFIED** — The Linux source-custody assertion has a named home: a second ordinary-release build and sibling receipt in `linux-runtime-package.yml`.

5. **VERIFIED** — The producer owns a coded pack-time refusal for dirty package inputs and `HEAD`/binary-commit disagreement.

6. **VERIFIED** — The claim is correctly narrowed to binary-side `gitDirty`; committed Guide changes still advance and restamp the commit identity.

7. **VERIFIED** — Both runtime packages’ `.gitignore`, manifest-files assertions, and exact-ignore assertions are explicitly included.

8. **VERIFIED** — LLP 0123’s seal-member amendment and Guide-drift coverage through package-seal reopening and `runtime-qualify --persist/--verify` are required on the same landing.

9. **DISPOSITION ERROR** — The corrected HTTP ownership is accurate, but the consumer inventory is not. `guide_artifact.rs` contains shared producer/decoder constants and does not read through the loader. The actual native and MCP consumers do exist at `crates/snapback-cli/src/cli/guide_command.rs` and `crates/snapback-cli/src/guide_mcp.rs`. Correct the inventory to distinguish the shared artifact-contract module from the HTTP, reference, native-command, and MCP consumers.

10. **VERIFIED** — Darwin is explicitly changed from bare source-topology resolution to the forced-package-root installed-custody form.

## Diff findings

- **MATERIAL — Bare-sidecar integrity is unsound.** Phase 2 allows a bare binary to accept a sidecar using only compiled `contentHash` and binary `gitCommit`. LLP 0284 §3.7 explicitly says that `contentHash` does not bind individual page, section-flat, or non-`contentHash` manifest records. An attacker can alter such a record, retain the valid content hash and revision, and have the bare loader accept bytes that are not build-matched. This contradicts the preserved one-build-matched-corpus property and the promised tamper tests.  
  **Suggested correction:** bind a full deterministic artifact digest into the binary during the build, or otherwise bind every record through a compiled trust anchor, and require that binding for bare loads. Add a negative test that mutates an intentionally unbound record, not merely a core hash-domain record.

- **MATERIAL — Producer scope conflicts with contributor assembly.** The producer bullet runs the clean-source/HEAD-gated producer in every non-`--native-artifact-staging` preparation, which includes `--source-test-staging`. The assembly-mode bullet says contributor staging uses its already-embedded bytes and omits the sidecar; current LLP 0041 and package tests also admit contributor dirty/debug identities. As written, the plan either generates and validates a discarded artifact and rejects valid contributor cases, or violates the producer rule.  
  **Suggested correction:** run the pack-time producer and its clean-source gate only in public-package final assembly; source-test and native modes should merely ensure the swap removes any stale `guide/` member.

No additional post-freeze obligations.

VERDICT 0314.000: NOT READY
