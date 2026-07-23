**Reviewer family:** Codex (OpenAI)
**Provider / runtime:** codex-cli 0.145.0 (`codex exec`, read-only sandbox), invoked from the orchestrating /llp-super-refine Claude session; the orchestrating session did not author the document and Codex had no access to the concurrent Fable-family round or to llp/reviews/
**Date:** 2026-07-23
**Redacted:** no — repo-local review; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner (fresh context per round; prompt pinned the document sha256 and repo HEAD)

# LLP 0079 reviews — Codex (OpenAI) family

## Round 1 — 2026-07-23

**Revision under review:** `llp/0079-serverpod-course-corrections.plan.md`, sha256 `dfd91d494c972e7c17ed07770976773f7a81cfbbbc3a5e5623fc456ada33ffdb` (untracked working-tree file). The prompt pinned HEAD `3dd38c29`; a concurrent fleet commit landed LLP 0078 mid-round, so the reviewer observed and reviewed against HEAD `ded817f5` (a descendant; document bytes MATCH). `ded817f5` is recorded as the effective review baseline per the reviewer's own Concern 7.
**Runtime detail:** 143,706 tokens used; verified claims against LLP 0042, 0024, 0041, 0030, 0003, 0008, 0012, 0037, 0046, 0032, `packages/snapback-cli/index.mjs`, `src/cli.rs`, `src/guide_mcp.rs`, `tests/artifact_schemas_v0.rs`, `scripts/verify-local-proof`, and `.github/workflows/local-proof.yml`.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

Commands run:

```text
shasum -a 256 llp/0079-serverpod-course-corrections.plan.md
git rev-parse --short HEAD
```

Observed:

```text
dfd91d494c972e7c17ed07770976773f7a81cfbbbc3a5e5623fc456ada33ffdb
ded817f5
```

Expected:

```text
dfd91d494c972e7c17ed07770976773f7a81cfbbbc3a5e5623fc456ada33ffdb
3dd38c29
```

Document hash: **MATCH**. HEAD: **MISMATCH**. Overall revision check: **MISMATCH**, but the hash stop condition was not triggered. `3dd38c29` is an ancestor of the observed HEAD; `ded817f5` is the commit that added LLP 0078. LLP 0079 remains untracked, while LLP 0078 is tracked at the observed HEAD.

2. **Overall assessment**

The plan translates most of LLP 0078 faithfully, and several load-bearing audit claims check out. LLP 0042 omits diagnostics/log reading, acceptance execution, and client driving from its selected eight-tool slice; its lifecycle, ready-file, catalog, and authority descriptions match the RFC (`llp/0042-agent-mcp-surface.rfc.md:47-87`, `llp/0042-agent-mcp-surface.rfc.md:91-113`). `runDev` does watch, regenerate, hot-load, and emit the three claimed load states (`packages/snapback-cli/index.mjs:1190-1200`, `packages/snapback-cli/index.mjs:1262-1319`). LLP 0046 contains exactly the cited Docker/URL open question (`llp/0046-postgres-graduation-path.rfc.md:169-178`).

It is not yet executable from acceptance criteria alone. SC-1b conflates LLP 0042’s selected slice with LLP 0024’s larger pinned tool set and requires additions to be callable even though SC-1a may defer them. SC-2 treats an unbuilt Vite-plugin prerequisite as a medium wiring task and omits much of LLP 0030’s required lifecycle and authority boundary. SC-5 proposes a syntactic dependency check as enforcement of a broader semantic invariant.

The S estimates are credible for SC-1a, SC-3, and SC-4. SC-1b is at least L but lacks a stable scope; SC-2 is not credibly M if it includes the still-unbuilt LLP 0030 plugin; and SC-5 is S only for the proposed narrow scan, not for meaningful enforcement of the stated invariant.

3. **Strengths**

- The recommendation mapping is disciplined: the plan explicitly leaves auth and the validated DSL/serialization posture unchanged and translates the remaining recommendations into owned work (`llp/0079-serverpod-course-corrections.plan.md:12-23`; `llp/0078-serverpod-lessons.research.md:247-292`).

- SC-1b accurately reproduces LLP 0042’s lifecycle design: lifecycle operations reuse process control through `--ready-file`, `HostReadyDescriptor`, and nonce-verified stop rather than HTTP proxying (`llp/0079-serverpod-course-corrections.plan.md:60-65`; `llp/0042-agent-mcp-surface.rfc.md:59-65`). Its query-default/mutation-authority catalog requirement also matches LLP 0042 (`llp/0042-agent-mcp-surface.rfc.md:76-87`).

- The SC-2 ownership seam is accurate. LLP 0041 says the CLI owns watch/codegen while the Vite plugin owns frontend dev-server integration, with both sharing the ready-file/host-ops surface (`llp/0041-packaged-dev-loop.rfc.md:138-163`). The claimed server-side hot loop exists in code, including `generated-and-loaded`, `generation-failed`, and `generated-but-not-loaded` events (`packages/snapback-cli/index.mjs:1248-1259`, `packages/snapback-cli/index.mjs:1273-1306`).

- SC-3’s migration constraint is coherent with existing architecture: LLP 0003 already requires captured-read validation and atomic version-stamped commits (`llp/0003-local-code-hosting-and-storage-core.rfc.md:323-390`) while describing schema/function upload as artifact load rather than live data migration (`llp/0003-local-code-hosting-and-storage-core.rfc.md:419-429`, `llp/0003-local-code-hosting-and-storage-core.rfc.md:478-480`).

- SC-4 correctly preserves LLP 0046’s decision authority and acknowledges its prerequisite storage seam (`llp/0079-serverpod-course-corrections.plan.md:121-133`; `llp/0046-postgres-graduation-path.rfc.md:38-53`, `llp/0046-postgres-graduation-path.rfc.md:169-178`).

- The CI wiring claim is mechanically grounded: the canonical local proof runs `ref-check` and the artifact gates, and CI runs that canonical proof (`scripts/verify-local-proof:43-68`; `.github/workflows/local-proof.yml:115-118`). The existing schema snapshot test does compare committed schemas to current Rust-generated schemas (`tests/artifact_schemas_v0.rs:569-579`).

- The repo-owned MCP implementation search supports LLP 0078’s claim: the CLI’s MCP command dispatches only to the read-only guide server (`src/cli.rs:611`, `src/cli.rs:786`; `src/guide_mcp.rs:1-8`). The other MCP-named files are tests, configuration, documentation, or guide-generation support—not another server implementation.

- The process framing correctly states that the plan itself accepts none of the owner-document amendments (`llp/0079-serverpod-course-corrections.plan.md:159-161`).

4. **Concerns**

1. **Major — SC-1b has no unambiguous implementation scope.** LLP 0042’s selected slice contains eight tools (`llp/0042-agent-mcp-surface.rfc.md:47-57`), while LLP 0024’s pinned MCP table contains twelve, including reload, explain, and acceptance (`llp/0024-agent-operating-surface.spec.md:392-410`). SC-1b requires “the pinned LLP 0024 tool set plus the SC-1a additions” to be callable (`llp/0079-serverpod-course-corrections.plan.md:69-74`), but SC-1a permits each addition to be explicitly deferred and says client driving is an Exact-side seam, not a Snapback tool (`llp/0079-serverpod-course-corrections.plan.md:43-56`). Those requirements cannot all be satisfied simultaneously. Resolve this with an explicit mandatory/deferred tool matrix, making clear whether SC-1b builds eight tools, all twelve LLP 0024 tools, or another amended set, and excluding any Exact-side deferred seam from “callable” acceptance.

2. **Major — SC-2 is mis-sequenced and under-specified relative to LLP 0030.** LLP 0030 still lists defining the plugin package/config, implementing lifecycle modes, building the guarded HTTP/WebSocket proxy, exposing sanitized state, and migrating a demo before codegen/watch integration (`llp/0030-managed-snapback-vite-dev.rfc.md:660-695`). Its current status calls that managed-dev plugin the immediate next step and explicitly says codegen/watch/hot push follows only after lifecycle and authority boundaries are sound (`llp/0030-managed-snapback-vite-dev.rfc.md:825-840`). SC-2 instead presents the work as wiring existing pieces and tests only visible hot updates and load states (`llp/0079-serverpod-course-corrections.plan.md:76-90`). An agent could satisfy that criterion with an unsafe process spawn while omitting attach ownership, proxy allowlisting, WebSocket behavior, target fencing, and teardown. Resolve by making LLP 0030’s MVP an explicit dependency or part of SC-2 acceptance, naming the first client arm, and adding its authority/lifecycle/proxy tests. If included, resize SC-2 to L or split it.

3. **Major — SC-5 does not enforce the invariant it claims to guard.** The standing rule covers all persisted and wire encodings, including enum-like values, fields, columns, and variant tags (`llp/0079-serverpod-course-corrections.plan.md:98-102`), but the proposed test only looks for `serde_repr` and `#[repr(...)]` serialization patterns in `src/` (`llp/0079-serverpod-course-corrections.plan.md:135-147`). The schema snapshot test merely proves that committed JSON Schema equals what current Rust types generate (`tests/artifact_schemas_v0.rs:569-579`); updating both to an ordinal encoding would pass. Legitimate non-serialized FFI `#[repr(C)]` types already exist (`src/instance_lock.rs:1166-1172`; `src/runtime.rs:436-443`), making a textual `repr` scan noisy as well. Resolve with semantic regression tests that reorder representative enum variants and manifest fields while proving persisted/wire values remain stable, plus a narrowly parsed dependency/attribute guard for known ordinal serializers. State which manually implemented and non-Rust encodings are covered.

4. **Moderate — part of SC-3 is already an explicit rule, not an emergent property.** LLP 0008 already says `live_delta` is additive and must not break `live_replace` (`llp/0008-local-first-sync-and-realtime.rfc.md:239-263`). LLP 0012 already requires future transport lanes to be additive rather than breaking the WebSocket path (`llp/0012-headless-integration-contract.spec.md:562-571`). LLP 0008 also hides transport and change-notification mechanics behind the generated-client contract (`llp/0008-local-first-sync-and-realtime.rfc.md:565-588`). Therefore SC-3 item 3 overstates the missing documentation (`llp/0079-serverpod-course-corrections.plan.md:110-117`). Resolve by framing it as a dated rationale reinforcement citing external evidence, or identify the exact stronger normative sentence that is absent.

5. **Moderate — SC-4 introduces candidate technologies not supported by LLP 0078 and blurs “real Postgres.”** LLP 0078 supports an embedded/child-process Postgres harness and records Serverpod’s lifecycle/concurrency tradeoffs (`llp/0078-serverpod-lessons.research.md:149-156`, `llp/0078-serverpod-lessons.research.md:272-278`). LLP 0079 adds vendored binaries, an unspecified embedded-Postgres crate, and PGlite-class wasm builds (`llp/0079-serverpod-course-corrections.plan.md:125-130`). A PGlite-class substitute may not satisfy the stated goal of testing against real Postgres. Resolve by making candidate discovery an explicit research subtask and requiring each candidate to state whether it exercises actual PostgreSQL server semantics relevant to LLP 0007’s conformance contract.

6. **Moderate — the status reference is not a general process rule.** LLP 0079 says its status advances “per LLP 0032’s rules” (`llp/0079-serverpod-course-corrections.plan.md:159-161`), but LLP 0032 describes its own accepted living-plan registers and phase-boundary ledgering, not a generic lifecycle for other Plans (`llp/0032-decision-and-implementation-hardening.plan.md:1722-1731`). This matters especially because SC-3 amends accepted LLP 0037 (`llp/0037-schema-source-of-truth.decision.md:135-141`). Resolve by citing the actual LLP process document, spelling out who moves LLP 0079 from Draft, and stating that amendments to accepted owner documents require their normal ratification—not merely a status-board update.

7. **Minor — the requested review baseline and actual baseline differ.** The document bytes match, and the observed HEAD is a descendant of the expected HEAD, but the owner corpus/code reviewed was at `ded817f5`, not `3dd38c29`. Resolve by recording `ded817f5` as the review baseline or rerunning the review at the expected checkout before treating this as the requested revision’s review.

5. **Suggestions**

- Give every code item named test commands or test files, not just behavioral prose. The natural canonical gate is `scripts/verify-local-proof`, which CI already runs (`scripts/verify-local-proof:43-68`; `.github/workflows/local-proof.yml:115-118`).

- Split SC-3 into independently statusable owner-document amendments. LLP 0037 is Accepted, while LLP 0041, LLP 0008, and LLP 0012 remain Draft; bundling them behind one status obscures different review requirements (`llp/0079-serverpod-course-corrections.plan.md:92-117`).

- For SC-1b, resolve LLP 0042’s open package location, catalog-serving model, and multi-root stop behavior before implementation or explicitly add them as implementation-owned decisions (`llp/0042-agent-mcp-surface.rfc.md:162-171`).

- Add a diary requirement to SC-2 if it substantially changes a demo application, consistent with the repository’s demo-diary policy.

6. **Open questions**

1. Does “pinned LLP 0024 tool set” in SC-1b mean all twelve MCP tools, or only LLP 0042’s eight-tool first slice?

2. Is SC-2 intended to include implementation of LLP 0030’s currently unbuilt managed Vite plugin, or depend on a separate plugin task?

3. What constitutes “interactive verbs” for SC-2—a TUI, stdin keybindings, signals, or ordinary CLI commands—and what acceptance test proves them?

4. Is SC-5 intended to protect only Rust/serde representations, or also manual SQL encodings, JavaScript-generated artifacts, and client wire decoders?

5. Should this review be attached to the actual `ded817f5` baseline, or repeated at `3dd38c29`?

7. **Verdict**

`NOT READY`

## Round 2 — 2026-07-23

**Revision under review:** `llp/0079-serverpod-course-corrections.plan.md`, sha256 `56a04384de49288bef2a7b82ba78cbf557c306842fbb69606b043acf7c9050db` (untracked working-tree file at HEAD `68b15705`; round-1 revisions applied).
**Runtime detail:** codex-cli 0.145.0 (`codex exec`, read-only sandbox), fresh context; verified claims against LLP 0042, 0024, 0030, 0041, 0037, 0008, 0012, 0000, 0046, 0007, 0078, `src/manifest.rs`, `src/live_wire.rs`, `schemas/schema.manifest.schema.json`, `demos/shindig/snapback/generated/schema.manifest.json`, `packages/snapback-contract/build-preset.mjs`, `tests/artifact_schemas_v0.rs`, `Cargo.toml`, and `scripts/verify-local-proof`.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

- Ran `shasum -a 256 llp/0079-serverpod-course-corrections.plan.md`.
  - Observed: `56a04384de49288bef2a7b82ba78cbf557c306842fbb69606b043acf7c9050db`
  - Expected: `56a04384de49288bef2a7b82ba78cbf557c306842fbb69606b043acf7c9050db`
  - Result: **MATCH**
- Ran `git rev-parse --short HEAD`.
  - Observed: `68b15705`
  - The command emitted read-only macOS cache/FSEvents warnings but returned successfully.
- I did not read anything under `llp/reviews/` or any credential material.

2. **Overall assessment**

The plan is materially improved and mostly faithful to LLP 0078. SC-1b’s eight-of-twelve scope is exact; SC-2a matches LLP 0030’s stated MVP; SC-3 correctly distinguishes already-normative additive evolution from the missing app-facing lifecycle rule; SC-4 honestly tags its candidate mechanisms as plan-added; and the sequencing/status language generally respects owner-document authority.

It is not ready as-is, however. Three load-bearing ambiguities could cause incorrect implementation: SC-1a does not decide whether diagnostics means strengthening the already-selected `snapback_inspect` operation or adding a new operation that LLP 0024 must own; SC-2b calls its first arm “Vite/React” despite SC-2a building and validating the seam through a Contract demo; and SC-5 incorrectly describes every `FieldType` encoding as a variant-name scalar even though `FieldType::Id` is a name-keyed object.

The broad dependency graph and S/L estimates are credible. SC-2b’s M estimate cannot be evaluated reliably until its target surface and interactive/machine-readable verb acceptance are pinned.

3. **Strengths**

- SC-1b’s arithmetic and unimplemented behavior are exact. LLP 0042 selects eight tools ([LLP 0042 lines 47–69](/Users/ccheever/projects/snapback/llp/0042-agent-mcp-surface.rfc.md:47)); LLP 0024 pins twelve, including `snapback_acceptance_run` ([LLP 0024 lines 392–415](/Users/ccheever/projects/snapback/llp/0024-agent-operating-surface.spec.md:392)); and the five currently unbuilt host operations already return `SNAPBACK_HOST_OP_UNIMPLEMENTED` over HTTP ([LLP 0024 lines 36–40](/Users/ccheever/projects/snapback/llp/0024-agent-operating-surface.spec.md:36)). The plan’s conditional four-tool remainder is therefore correct ([LLP 0079 lines 78–85](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:78)).

- SC-2a accurately transcribes LLP 0030’s MVP: ready-file consumption, mode-aware setup, explicit app-route allowlisting, structured diagnostics, and one Contract demo, with codegen/watch deferred to step 9 ([LLP 0030 lines 660–695](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:660), [lines 825–840](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:825)). The security-sensitive exclusions in the plan also match LLP 0030’s validation matrix ([LLP 0030 lines 735–752](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:735)).

- SC-2b identifies the correct ownership seam: LLP 0041 assigns watch/codegen orchestration to the CLI and frontend integration to the Vite plugin, with neither owning a private lifecycle dialect ([LLP 0041 lines 138–163](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:138)). Its dependency on SC-2a also agrees with LLP 0030’s step ordering.

- SC-3’s substantive framing is sound. LLP 0037 currently governs artifact authority and schema drift but contains no declaration-order/name-keying rule ([LLP 0037 lines 67–94](/Users/ccheever/projects/snapback/llp/0037-schema-source-of-truth.decision.md:67)). `live_delta` is already explicitly additive beside `live_replace` ([LLP 0008 lines 247–263](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:247)), and LLP 0012 already requires future read lanes to be added beside WebSocket rather than breaking it ([LLP 0012 lines 562–571](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:562)). DK-10 already places live subscription ownership in the Contract adapter ([LLP 0000 lines 270–283](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:270)).

- SC-4 precisely targets LLP 0046’s open Docker-versus-URL question ([LLP 0046 lines 169–178](/Users/ccheever/projects/snapback/llp/0046-postgres-graduation-path.rfc.md:169)) while preserving LLP 0007’s cross-engine conformance purpose ([LLP 0007 lines 569–588](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:569)). Its warning that a candidate must demonstrate relevant PostgreSQL semantics is appropriately more rigorous than silently equating every “embedded” mechanism with PostgreSQL.

- SC-5’s two-layer approach is mechanically plausible. `FieldType` uses ordinary serde name encoding ([src/manifest.rs lines 702–738](/Users/ccheever/projects/snapback/src/manifest.rs:702)); `LiveDeltaOpKind` is explicitly lower-case name encoded ([src/live_wire.rs lines 116–132](/Users/ccheever/projects/snapback/src/live_wire.rs:116)); existing artifact tests serialize representative live-delta operations ([tests/artifact_schemas_v0.rs lines 2308–2370](/Users/ccheever/projects/snapback/tests/artifact_schemas_v0.rs:2308)); `serde_repr` is absent from the direct dependencies ([Cargo.toml lines 15–41](/Users/ccheever/projects/snapback/Cargo.toml:15)); and `cargo test` already runs in the local proof ([scripts/verify-local-proof lines 89–99](/Users/ccheever/projects/snapback/scripts/verify-local-proof:89)).

- The process framing correctly says that this plan accepts nothing and that modifying Accepted LLP 0037 requires separate ratification ([LLP 0079 lines 270–276](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:270)). The three deferred research questions are also retained as watch items rather than lost ([LLP 0079 lines 278–284](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:278)).

4. **Concerns**

1. **Major — SC-1a does not identify the owner or identity of its diagnostics operation.** The plan describes diagnostics reading as a new “verb” and makes it part of SC-1b’s additional non-deferred tool set ([LLP 0079 lines 43–57](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:43), [lines 78–85](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:78)). But LLP 0024 explicitly owns control-plane MCP names and mappings ([LLP 0024 lines 69–82](/Users/ccheever/projects/snapback/llp/0024-agent-operating-surface.spec.md:69)), while LLP 0042 merely selects its subset ([LLP 0042 lines 16–22](/Users/ccheever/projects/snapback/llp/0042-agent-mcp-surface.rfc.md:16)). Moreover, the existing selected `snapback_inspect` maps to `app.inspect`, whose pinned result already includes recent diagnostics ([LLP 0024 lines 130–133](/Users/ccheever/projects/snapback/llp/0024-agent-operating-surface.spec.md:130), [lines 397–410](/Users/ccheever/projects/snapback/llp/0024-agent-operating-surface.spec.md:397)). An executor cannot tell whether to enhance `snapback_inspect`, add a separate log operation, or do both. Resolve this by choosing one: either define the minimum as an extension of `app.inspect`/`snapback_inspect`, or add LLP 0024 to SC-1a’s owner documents and require it to pin the new operation id, MCP tool name, arguments, result shape, and authority.

2. **Major — SC-2b does not pin which client arm is actually being built.** It names a “Vite/React arm,” while SC-2a’s implementation and acceptance migrate an existing Contract demo ([LLP 0079 lines 122–134](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:122), [lines 136–161](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:136)). LLP 0030 likewise frames the first MVP around a Contract demo while allowing the generic plugin to serve React later ([LLP 0030 lines 82–103](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:82), [lines 688–694](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:688)). Calling the implementation React-first also sits awkwardly with the governing Contract/Exact-first rule ([LLP 0000 lines 394–410](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:394), [lines 730–733](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:730)). Resolve this by naming the exact demo/surface and invocation in SC-2b acceptance. If React is intentionally first, tag that as a plan-added sequencing decision and explain why SC-2a’s migrated Contract surface is insufficient.

3. **Major — SC-5 misstates `FieldType`’s current wire representation.** The acceptance rationale says the pinned representative enums serialize as the variant name ([LLP 0079 lines 232–240](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:232)). That is true for unit variants such as `"String"`, but `FieldType::Id { table }` is a data-bearing variant ([src/manifest.rs lines 710–738](/Users/ccheever/projects/snapback/src/manifest.rs:710)) encoded as `{"Id":{"table":"…"}}`, not as a scalar variant name ([schema manifest schema lines 237–274](/Users/ccheever/projects/snapback/schemas/schema.manifest.schema.json:237), [generated example lines 53–67](/Users/ccheever/projects/snapback/demos/shindig/snapback/generated/schema.manifest.json:53)). An executor could either omit this variant or incorrectly normalize it to a string. Resolve this by pinning exact expected JSON examples: at least one unit `FieldType`, the data-bearing `Id` form whose object key remains name-keyed, and every `LiveDeltaOpKind`.

4. **Moderate — plan-added work is not consistently identified, and the work-item count is still wrong.** The summary says six actionable recommendations produce six work items, but the status board contains seven rows ([LLP 0079 lines 13–23](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:13), [lines 29–39](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:29)). SC-5 is additional enforcement beyond R5, which only recommends documenting the rule ([LLP 0078 lines 279–285](/Users/ccheever/projects/snapback/llp/0078-serverpod-lessons.research.md:279)). The non-deferrable ring-buffer diagnostics minimum likewise goes beyond R3’s recommendation to add logs/diagnostics and acceptance execution ([LLP 0078 lines 264–271](/Users/ccheever/projects/snapback/llp/0078-serverpod-lessons.research.md:264)). Resolve this with an explicit recommendation-to-work-item mapping and tag SC-5 and the ring-buffer/non-deferral policy as plan-added execution decisions.

5. **Moderate — SC-1b delegates two architectural choices without decision criteria.** Packaging and static-versus-served catalogs remain implementation-owned choices ([LLP 0079 lines 87–94](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:87), [lines 293–296](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:293)); both are still explicit LLP 0042 open questions ([LLP 0042 lines 162–171](/Users/ccheever/projects/snapback/llp/0042-agent-mcp-surface.rfc.md:162)). Either outcome could satisfy the current acceptance. Resolve by settling them during SC-1a or providing evaluation criteria and requiring the resulting decision to be recorded in LLP 0042 before SC-1b implementation lands.

6. **Moderate — SC-2b’s acceptance drops part of LLP 0078 R1.** The narrative promises interactive and machine-readable loop verbs, but acceptance checks only the two failure/load states ([LLP 0079 lines 138–160](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:138)). R1 explicitly requires the loop’s verbs to be surfaced through both channels ([LLP 0078 lines 247–254](/Users/ccheever/projects/snapback/llp/0078-serverpod-lessons.research.md:247)). Resolve by enumerating the required verbs and adding tests for both an interactive projection and a structured projection. Reassess the M estimate after that surface is explicit.

7. **Minor — `build-preset.mjs` is not purely a static-build preset.** It already defines Vite dev diagnostics and proxy configuration plugins ([build-preset.mjs lines 669–721](/Users/ccheever/projects/snapback/packages/snapback-contract/build-preset.mjs:669)), although it does not implement managed backend lifecycle and no managed Vite package exists. Resolve by describing it as an existing build/dev-proxy preset that is not the LLP 0030 managed lifecycle plugin.

5. **Suggestions**

- Add a compact mapping table from R1–R7 to SC items, including “no action” and watch-only outcomes. It would expose the seven-row arithmetic and plan-added enforcement immediately.
- Make SC-5’s allowlist format concrete: specify which files are scanned, whether only direct `Cargo.toml` dependencies count, and where the deciding `@ref` must appear.
- Clarify that the Plan becomes `Implemented` only after all required SC items are complete, while partial progress remains represented by the status board; the current “Implemented as items land” wording is susceptible to premature interpretation ([LLP 0079 lines 270–276](/Users/ccheever/projects/snapback/llp/0079-serverpod-course-corrections.plan.md:270)).
- Add the exact local-proof command to each code item’s acceptance rather than only naming `scripts/verify-local-proof`.

6. **Open questions**

1. Is SC-1a intended to strengthen `snapback_inspect`/`app.inspect`, or to introduce a distinct log-reading operation?
2. Which concrete surface must SC-2b launch: the Contract demo migrated by SC-2a, a named React demo, or both?
3. Which interactive loop verbs are in SC-2b’s required first slice?
4. Should SC-5 pin every current `FieldType` encoding, including `Id`, or only representative unit and data-bearing forms?
5. Must SC-1a settle MCP packaging and catalog delivery before SC-1b begins, or is executor discretion intentional?

7. **Verdict**

`NOT READY`
