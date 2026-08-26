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
