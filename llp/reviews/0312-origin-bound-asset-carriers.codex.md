**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI, `gpt-5.5` at xhigh reasoning effort,
independent ephemeral sessions
**Date:** 2026-08-26
**Redacted:** no
**Method:** cli-runner

# LLP 0312 review artifact — Codex family

Target: `llp/0312-origin-bound-asset-carriers.rfc.md`

## Infrastructure attempt — void

- Revision presented: Draft r1, sha256
  `068804cd5d8ecd1ba9f20dc718cc21b3f7699353cda563b2dc4f253dbf4f19e2`.
- Reviewer: fresh `gpt-5.5` Codex CLI session at xhigh reasoning effort,
  read-only sandbox and read/reason-only instruction.
- Result: **VOID, not a content verdict.** The sandbox failed before every
  repository command with `bwrap: loopback: Failed RTM_NEWADDR: Operation not
  permitted`. The session correctly refused to invent evidence and returned
  `NOT READY` solely because it could not read the target.
- Disposition: retried in a new ephemeral session with the broken sandbox
  wrapper disabled and the same no-edit/no-build/no-test/no-network
  instruction. The void attempt is recorded for provenance and is not counted
  as review feedback.

## Round 1 — Draft r1

- Revision under review: Draft r1, sha256
  `068804cd5d8ecd1ba9f20dc718cc21b3f7699353cda563b2dc4f253dbf4f19e2`.
- Reviewer: fresh `gpt-5.5` Codex CLI session at xhigh reasoning effort,
  danger-full-access execution only to bypass the broken local sandbox wrapper;
  the review prompt and observed command log were read-only. No file edit,
  Cargo/build/test command, network call, or agent spawn occurred.
- Independence: separate process and fresh session from the authoring agent;
  same GPT model family, disclosed.
- Result: **READY**, no material findings and one non-material clarification.
- Capture note: the CLI emitted the final response twice byte-for-byte. One
  copy is preserved verbatim below; the exact duplicate is not repeated.

### Review body (verbatim)

**Material Findings**

No material blockers found. The RFC is actionable for implementation under its own landing boundary.

I verified the two-carrier choice against the repo. F145’s existing `AssetCallbacksServicePrincipal` is durable/reusable and currently public/`Clone` ([auth_asset_callbacks.rs](/home/ccheever/lanes/mdesign2/crates/snapback-kernel/src/storage/auth_asset_callbacks.rs:24)), while F272 is a split ticket/effect composition with public ticket construction/preparation ([assets.rs](/home/ccheever/lanes/mdesign2/crates/snapback-services/src/assets.rs:785)) and independent effect reservation ([invocation.rs](/home/ccheever/lanes/mdesign2/crates/snapback-sync/src/auth/invocation.rs:2194)). That supports the RFC’s decision not to use one generic wrapper.

The “cannot be constructed” invariant is sufficiently explicit: it covers private fields, `Default`, serde, `From`/`Into`/`TryFrom`, builders/factories, `dyn Trait`, doc-hidden paths, `cfg(test)`, and additive features ([0312](/home/ccheever/lanes/mdesign2/llp/0312-origin-bound-asset-carriers.rfc.md:82)). The current gaps it names are real: literal principal construction exists in sync tests ([invocation.rs](/home/ccheever/lanes/mdesign2/crates/snapback-sync/src/auth/invocation.rs:3746)), the doc-hidden raw kernel trait is public-reachable ([lib.rs](/home/ccheever/lanes/mdesign2/crates/snapback-kernel/src/lib.rs:52), [services_assets.rs](/home/ccheever/lanes/mdesign2/crates/snapback-kernel/src/services_assets.rs:176)), and additive test helpers expose mutation/replacement seams ([assets.rs](/home/ccheever/lanes/mdesign2/crates/snapback-services/src/assets.rs:826), [invocation.rs](/home/ccheever/lanes/mdesign2/crates/snapback-sync/src/auth/invocation.rs:1606)).

Producer/consumer coverage is also adequate and honest. The raw unchecked width path is real: `asset_resolve_width_variant` calls `stage_width_variant_plan_proved_guarded` with `|| Ok(())` ([engine.rs](/home/ccheever/lanes/mdesign2/crates/snapback-engine/src/local/engine.rs:15661)), and five public engine methods reach it ([engine.rs](/home/ccheever/lanes/mdesign2/crates/snapback-engine/src/local/engine.rs:15811)). The intended sink is separate ([engine.rs](/home/ccheever/lanes/mdesign2/crates/snapback-engine/src/local/engine.rs:15759)), and the production routes pair neither-alone-sufficient values today ([asset_routes.rs](/home/ccheever/lanes/mdesign2/crates/snapback-server/src/server/asset_routes.rs:613), [asset_routes.rs](/home/ccheever/lanes/mdesign2/crates/snapback-server/src/server/asset_routes.rs:822)). I also verified the checked-in test fixture surface: 18 calls across eight engine tests, from [engine.rs](/home/ccheever/lanes/mdesign2/crates/snapback-engine/src/local/tests/engine.rs:12496) through [engine.rs](/home/ccheever/lanes/mdesign2/crates/snapback-engine/src/local/tests/engine.rs:13316).

The graph-identity and fork analysis is correct. `EngineAppStateGraphIdentity` is currently `Arc<()>`-based ([engine.rs](/home/ccheever/lanes/mdesign2/crates/snapback-engine/src/local/engine.rs:3211)), cloned for same-graph claims ([engine.rs](/home/ccheever/lanes/mdesign2/crates/snapback-engine/src/local/engine.rs:7031)), checked with pointer equality ([engine.rs](/home/ccheever/lanes/mdesign2/crates/snapback-engine/src/local/engine.rs:3487)), and rebuilt with a fresh `Arc` ([engine.rs](/home/ccheever/lanes/mdesign2/crates/snapback-engine/src/local/engine.rs:27376)). The RFC’s added process identity requirement is necessary for POSIX fork.

**Non-Material Observations**

The RFC’s “captured authority” wording for F272 should be implemented as “no live reservation/permit across render/blob I/O.” The RFC already says the render preparation retains no live effect reservation or `LocalSnapback` ([0312](/home/ccheever/lanes/mdesign2/llp/0312-origin-bound-asset-carriers.rfc.md:342)), which aligns with LLP 0058’s rule that width source-read/render and blob PUTs run outside permits ([0058](/home/ccheever/lanes/mdesign2/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1391)).

I did not run dependent attack tests because the review instructions forbade tests/builds. LLP 0303 revision (s) requires executed alternate-route evidence for implementation closure; the RFC correctly carries that as future acceptance evidence, not as a claim already satisfied.

Independence disclosure: this was a fresh-session independent review, but still same-GPT-family independence, not cross-family evidence.

READY

## Round 1 disposition

- **Non-material — captured authority:** folded in Draft r2. The render step now
  says explicitly that no reservation, authority permit, commit guard, or
  `LocalSnapback` crosses rendering; the captured `PreparedAuthority` is a
  recipe that revalidates when it later reserves, not a live permit.
- **Non-material source wording:** corrected the broad statement that the
  server re-exports width ticket types. The types are public in
  `snapback-services`; the server's route re-exports are crate-private.

## Round 2 — Draft r2 delta review

- Revision under review: Draft r2, sha256
  `0a78dc22db42a3050ae157dc3a5ec662ebebcbb52642b5ff293831e268d25cf7`.
- Reviewer: fresh `gpt-5.5` Codex CLI session at high reasoning effort,
  read/reason-only instruction. No file edit, build, test, network call, or
  agent spawn occurred.
- Scope: the captured-authority clarification, server re-export correction,
  and whether either change introduced a material concern.
- Result: **READY**, no material concerns; the Round-1 verdict still holds.
- Capture note: the CLI emitted the final response twice byte-for-byte. One
  copy is preserved verbatim below; the exact duplicate is not repeated.

### Review body (verbatim)

Verified current target hash matches `0a78dc22db42a3050ae157dc3a5ec662ebebcbb52642b5ff293831e268d25cf7`.

Narrow delta review only. The R2 clarification at [llp/0312-origin-bound-asset-carriers.rfc.md:346](/home/ccheever/lanes/mdesign2/llp/0312-origin-bound-asset-carriers.rfc.md:346) resolves the Round 1 ambiguity: rendering retains no live reservation/permit/guard/`LocalSnapback`, and captured `PreparedAuthority` is explicitly only a later-revalidating recipe. The re-export correction at [llp/0312-origin-bound-asset-carriers.rfc.md:129](/home/ccheever/lanes/mdesign2/llp/0312-origin-bound-asset-carriers.rfc.md:129) is internally consistent: width ticket types are public in `snapback-services`; server route re-exports are crate-private.

Material concerns: none. The Round 1 READY verdict still holds for this delta.

Independence disclosure: fresh-session independent review, but same GPT/Codex model family, not cross-family.

READY
