**Reviewer family:** Grok (xAI)
**Provider / runtime:** grok CLI (`~/.grok/bin/grok`), `grok-4.6` at xhigh
reasoning effort, headless plain-output session, full terminal ban
(built-in file-read tools only)
**Date:** 2026-08-25
**Redacted:** no
**Method:** cli-runner (kill-proof detached dispatch)

# LLP 0314 cluster review artifact — Grok family

Lockstep cluster: `llp/0314-shipped-runtime-binary-size.research.md`
(primary) + `llp/0314.000-reduce-shipped-runtime-size.plan.md`. This is
the single verbatim preservation for the cluster; per-target verdicts
are inside the review body. 0314.000 has no separate grok artifact —
this file is authoritative for both targets.

## Round 1 — Review r1 (post status-flip)

- Revision under review: commit
  `235fabf283afb7fba4a228585279c2c0ab06577f`
  - 0314 sha256 `c55d05f0bebf07f58790507b4207cce63d73e87a339befdf9684f8e616cba028`
  - 0314.000 sha256 `8b67e3692560363facb5fc1b39c6ac31be9b28793cc657e788dff6df4cd93204`
- Capsule: live checkout at that commit, read in place with file tools
  only (terminal banned). No 0314 review artifacts existed anywhere in
  the tree at launch or during the run; blindness with respect to
  review artifacts was structural for this round. The instruction ban
  on reading `llp/reviews/` and other reviewers' output is additionally
  SELF-ATTESTED (and self-reported honored in the review body).
- Instruction brief sha256
  `80e51ab29a547ff7cdce80232b94a565b0e578d510c97de3677470b296dd4cc4`
  plus a grok-specific terminal-ban preamble.
- Independence: separate process and fresh session from the
  orchestrating reviser (Claude family); different model family from
  the second reviewer (codex gpt-5.6-sol), mutually blind.
- Runtime: ~16 minutes wall clock. Capture note: stdout preceded the
  review with brief progress narration, preserved verbatim here before
  the body; the review document below is the complete final output.

### Runner narration (verbatim)

I'll review both LLP 0314 documents independently from the files themselves—no shell, no other reviews—and start by reading the two targets in full.Both targets are in. Next I’ll check the load-bearing claims against Cargo profiles, packagers, CI pins, and the governing LLPs.I have the packagers and crate graph. Next I’ll check CI pins, guide embedding, and the governing LLPs the targets cite.The CI pin and packagers check out. I’m now reading the governing LLPs and the remaining load-bearing sources, staying out of `llp/reviews/`.I have enough to write the lockstep review: research diagnosis holds; the plan’s Phase 1/2 manufacture and Guide-carriage inventory does not. The full review is below.

---

### Verbatim review body

# Super-refine round 1 — LLP 0314 cluster (independent)

Reviewer: grok-4.6. Capsule constraints honored: no shell, no `llp/reviews/`, no other reviewer. Both targets read in full before this document was written. Load-bearing claims were checked against the checkout with file tools only.

**Targets.** `llp/0314-shipped-runtime-binary-size.research.md` (Research, Review). `llp/0314.000-reduce-shipped-runtime-size.plan.md` (Plan, Review).

**Verification method.** Confirmed against `Cargo.toml`, both `prepare-runtime.mjs` packers, `tests/ci_workflows_v0.mjs`, `.github/workflows/linux-runtime-package.yml`, `.eas/workflows/qualified-package-staging.yml`, `scripts/assemble-runtime-package`, `scripts/runtime-package-authority.mjs`, `scripts/binary-size-baseline.json`, `crates/snapback{,-server,-kernel,-types}/`, `crates/snapback-server/{build.rs,src/guide.rs,src/lib.rs}`, `packages/snapback-cli/{index.mjs,runtime-readiness.mjs}`, `scripts/path-migration-manifest.v1.json`, and the cited sections of LLPs 0000, 0010, 0041, 0061, 0126, 0141, 0189, 0232, 0276. npm registry tarball bytes, Mach-O `size`/`otool` section table, Hermes framework `stat`, and the checkout’s `target/debug/snapback` byte count are **not** re-measured in this pass (terminal ban). Those are judged on plausibility, not failed for being offline.

---

## Findings

### 1. minor — 0314, Evidence / F2 — Mach-O table not re-measured here; internal arithmetic is plausible

**Defect.** F2’s section table (`__text` 67,409,876, `__const` 38,058,440, `__LINKEDIT` 35,160,064, `nsyms` 241,187, `strsize` 28,510,400, file 159,336,256) and the “`dwarfdump --debug-info` is empty” claim cannot be confirmed without `size`/`otool` on `packages/snapback-runtime-darwin-arm64/bin/snapback`. Summing the listed pieces is ~158 MB before remaining Mach-O overhead, which is consistent with a 159,336,256-byte file. Empty DWARF plus a live `LC_SYMTAB` is the expected unstripped `--release` shape.

**Suggested fix.** None required for READY. Optionally bind the section table to a dated `otool -l` excerpt next to the 0.1.27 ledger so a later pass does not have to trust prose.

### 2. minor — 0314, Summary / F1 — mixed MB vs MiB labeling

**Defect.** npm `unpackedSize` 186,720,037 is reported as **~178 MB** (that is MiB). Linux 248,155,233 as **~237 MB** (also MiB). The Darwin server **~159 MB** is 159,336,256 decimal MB. The shape is right; the unit is not uniform.

**Suggested fix.** Pick one unit in the summary table (prefer exact bytes plus one labeled unit) so 178 vs 159 is not misread as a 19 MB “other files” remainder when part of the gap is 1024 vs 1000.

### 3. minor — 0314, F3 — Darwin packer is the cited example; the drift is the whole manufacture graph

**Defect.** F3 is correct that `packages/snapback-runtime-darwin-arm64/prepare-runtime.mjs` defaults to `target/release/snapback` (env override `SNAPBACK_RUNTIME_SOURCE_BINARY`) and that `tests/ci_workflows_v0.mjs` pins `SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --release --bin snapback`. The same `--release` → `target/release/snapback` producer also appears in:

- `packages/snapback-runtime-linux-x64/prepare-runtime.mjs` (default `target/release/snapback`, override `SNAPBACK_RUNTIME_LINUX_X64_SOURCE_BINARY`)
- `.github/workflows/linux-runtime-package.yml` (build **and** `runtime-readiness.mjs issue --binary …/target/release/snapback`)
- `.eas/workflows/qualified-package-staging.yml` (Darwin and Linux jobs; this string is **not** the `ci_workflows_v0.mjs` pin)
- `scripts/assemble-runtime-package` (`cargo build --release --bin snapback`)

F3’s conclusion (packaging drift, not a missing LLP 0276 design) still holds. The surface is wider than the Darwin packer plus one test pin.

**Suggested fix.** One sentence in F3: the unused production profile is a manufacture-graph miss (both packers, Linux workflow, EAS qualified staging, assemble-runtime-package), not only the Darwin default.

### 4. minor — 0314, F4 — “36 MB `__const`” vs the table; Guide size not re-`du`’d

**Defect.** The F2 table gives `__const` 38,058,440 (~36.3 MiB). F4 calls it “the 36 MB `__const` segment.” Fine as MiB rounding. The “~20 MB / ~20.6 MB of `.md`+`.json`” Guide walk was not re-measured; it is plausible. `guide/guide-flat.generated.md` and `guide/reference/expo-snapback-client.md` are already multi-thousand-line generated dumps, and LLP 0061 §4a itself says the corpus has grown far past the old ~130 KiB. `include_bytes!` of `embedded-guide.v1.bin` is real (`crates/snapback-server/src/guide.rs`, `build.rs` `emit_embedded_guide`, skip only `eval-runs/`). “Plausible majority of `__const`” is honestly hedged.

**Suggested fix.** Say 38,058,440 / ~36 MiB. Optionally note the second, smaller embed: `include_str!("../../../guide/guide-manifest.generated.json")` in `guide.rs`.

### 5. minor — 0314, F5 / “What this is not” — Hermes exoneration is sound; 9.4 MB unverified

**Defect.** LLP 0000 still picks Ibex “anywhere binary size matters.” LLP 0141’s **74 MB** is `vendor/ibex/ios/Frameworks` vs crates.io’s 10 MB compressed limit, not the packaged framework. LLP 0126’s “~48 MB binary plus the framework” is the last retained product-size memory; calling today’s Darwin server a rough triple is fair as order-of-magnitude. Packaged Darwin `hermesvm.framework` **~9.4 MB** was not `stat`’d here; it is the right order for a Hermes dylib and is cheap next to 64 MiB `__text` + 34 MB `__LINKEDIT`.

**Suggested fix.** None for READY. Keep F5’s Darwin-vs-vendored distinction; do not let Linux ICU (F1 / OQ3) leak back into a Hermes indictment.

### 6. minor — 0314, F6 — ship-graph list is right; one extra `jsonschema` edge

**Defect.** Confirmed:

- `crates/snapback/Cargo.toml` enables `snapback-server` `test-support` and `snapback-services` `benchmark-support` on normal deps.
- Kernel `test-support` is empty and **not** on the umbrella’s production deps; kernel comments that published builds must not enable it.
- Server `test-support` is a small `#[cfg(feature = "test-support")] #[doc(hidden)]` module (`lib.rs`).
- `jsonschema` on `snapback` and `snapback-engine`; `schemars`; `image` + `kamadak-exif`; three KDFs on kernel; `tokio` `full` on multiple crates; kernel `rusqlite` bundled with those features; `clap` only on `snapback-cli`, which the `snapback` bin links.

Missed in the bullet list: `jsonschema` is also a normal dependency of `snapback-types` (kernel’s copy is `[dev-dependencies]` only, as the text already says for tests). F6 correctly refuses a crate-ranked cut list without `cargo bloat`.

**Suggested fix.** Add `snapback-types` to the `jsonschema` bullet. Do not promote F6 to a cut list.

### 7. minor — 0314, Summary — “LLP 0010: ~490–530 MB” is baseline + checkout, not 0010 text

**Defect.** LLP 0010 §Debug binary size metrology requires full split debug and report-only `BINARY_SIZE_DRIFT` (15% on bytes / `__LINKEDIT` / `strsize`). It does not state a 490–530 MB band. `scripts/binary-size-baseline.json` is exactly **489,895,784** bytes, `nsyms` 3,173,196 (2026-08-22). The checkout `target/debug/snapback` **530,235,976** claim is unverified here. The policy citation is right; the number range is local evidence.

**Suggested fix.** Attribute 489,895,784 to the baseline file and ~530 MB to the checkout `stat`, not to LLP 0010’s prose.

### 8. minor — 0314, F7 — comparables are the right neighborhood; versions unverified

**Defect.** PocketBase / PostgREST-class / Deno-Bun / MinIO / Cockroach as order-of-magnitude neighbors is the correct product shape. Peer bytes move; the research already marks confidence medium. npm tarball **~52 / ~70 MB** and client-only **~0.6 MB** were not pulled from the registry in this pass. `guide/guide-manifest.generated.json` `publishedClosure.newestPublished` is `"0.1.27"`, which matches the named closure.

**Suggested fix.** None. Keep “50 MB download is acceptable; 159 MB unstripped non-LTO with docs is large.”

### 9. minor — 0314, “What this is not” — boundary against 0010 / 0276 / 0141 / 0126 is right

**Defect.** None of decision quality. The four exclusions are correctly scoped:

- **0010** is debug-binary metrology, report-only, must not fail bootstrap.
- **0276** already named `cargo build --profile production -p snapback`; root `Cargo.toml` has `lto = "fat"`, `codegen-units = 1`, `incremental = false` on `[profile.production]`, and incremental `[profile.release]`.
- **0141** crates.io limit is Hermes carriage, not Snapback `__text`.
- **0126** 48 MB is historical product size, not a current budget.

0189 / 0232 are not in `Related:`; they belong on the plan, where they are.

**Suggested fix.** Optional: add 0061 to `Related:` because F4 is a 0061 §4a fact. Not required.

---

### 10. MATERIAL — 0314.000, Phase 1 — manufacture producers still emit `target/release/snapback`; the written procedure would break publication and repair

**Defect.** Phase 1 step 1 says: point both packers at `target/production/snapback`, and change the public-package command pinned in `tests/ci_workflows_v0.mjs` plus LLP 0041 assembly notes. That is the right **intent** (LLP 0276 ship profile; leave `[profile.release]` incremental). As a procedure it is incomplete in a way that fails closed.

The packers do not build; they copy. Today:

```36:39:packages/snapback-runtime-darwin-arm64/prepare-runtime.mjs
const defaultSourceBinary = resolve(
  process.env.SNAPBACK_RUNTIME_SOURCE_BINARY
    ?? join(repositoryRoot, 'target', 'release', 'snapback'),
);
```

Linux defaults to `target/release/snapback` via `SNAPBACK_RUNTIME_LINUX_X64_SOURCE_BINARY`. Changing that default without changing every manufacture producer yields `SNAPBACK_RUNTIME_BINARY_MISSING`.

Producers the plan does not name:

| Producer | What it still does |
|---|---|
| `.github/workflows/linux-runtime-package.yml` | `cargo build --release --bin snapback`, then issues the source receipt on `$GITHUB_WORKSPACE/target/release/snapback` |
| `tests/ci_workflows_v0.mjs` | **Two** pins: the cargo string **and** `--binary "$GITHUB_WORKSPACE/target/release/snapback"`. Updating only the cargo pin leaves the receipt on a stale/missing `target/release` while the packer wants `target/production` |
| `.eas/workflows/qualified-package-staging.yml` | Both `linux_runtime` and `darwin_runtime` run `SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --release --bin snapback`. This file is the qualified Darwin+Linux publication path. `ci_workflows_v0.mjs` does **not** pin that cargo string (it pins Hermes, attestation env, 16 KiB cap, etc.) |
| `scripts/assemble-runtime-package` | `cargo build --release --bin snapback`, then `prepare-runtime.mjs --source-test-staging --strict-clean-release`. This is the LLP 0041 / 0010 documented repair command |

`scripts/path-migration-manifest.v1.json` rows `s01-r005`, `s01-r024`, `s01-r025` are `changeKind: "verify-unchanged"` on those exact `--release` / `target/release/snapback` expressions. Phase 1 is an intentional change of those rows, not a silent edit.

**Must not be retargeted** (the plan’s own “publish path only” / LLP 0010):

- `packages/snapback-cli/index.mjs` source-checkout selection and repair still require `target/release/snapback` with a `release` identity.
- `packages/snapback-runtime-linux-x64/package.test.mjs` asserts source-checkout resolution is `target/release/snapback` (package seal is a different custody shape).
- Debug metrology / `scripts/binary-size-metrology.mjs` / `binary-size-baseline.json`.

Identity trap (do not “fix” as part of Phase 1): `BinaryIdentity.build_profile` is only `"debug" | "release"` via `cfg!(debug_assertions)` (`crates/snapback-types/src/identity.rs`). A `--profile production` binary already reports `"release"`. `assertRuntimePackageBuildIdentity` requires `buildProfile === 'release'`. Emitting `"production"` without a coordinated seal/schema change refuses every public package.

Strip vs receipts: `produceRuntimePackageSeal` digest-binds the **staged** binary. Linux CI issues a **source** sibling receipt on the pre-pack file. `strip -x` in the packer after that issue desyncs source-receipt digest from packaged bytes. Cargo `[profile.production] strip = "symbols"` (or strip before `issue`) is the coherent order. Keep dynsyms for Hermes, as the plan already says.

**Suggested fix.** Rewrite Phase 1 as two closed lists: **manufacture switches to `--profile production` / `target/production/snapback`** (both packers + error strings, both env overrides, linux-runtime-package.yml build **and** receipt path, both `ci_workflows_v0.mjs` pins, both EAS native jobs, `assemble-runtime-package` step 2, path-migration rows above, LLP 0041 + 0276); **source-checkout stays `target/release`** (CLI resolver, Linux package.test source-custody assertion, `[profile.release]`, LLP 0010 debug/release metrology). State: strip/LTO the manufacture binary **before** seal and before any digest-bound source receipt. Do not change `BinaryIdentity.build_profile` in this phase.

### 11. MATERIAL — 0314.000, Phase 2 + Expected outcome — Guide sidecar is not wired through seal/transport, and the unpacked table double-counts it

**Defect.** Phase 2’s product decision is good: keep `/_snapback/guide/…` and MCP contracts; fail closed on missing/mismatched corpus like admin; public-package must not `include_bytes!` the Guide. The implementation contract is not.

**Governing RFC conflict.** LLP 0061 §4a / OQ3 resolved: the Guide is **embedded in the binary and always served**; that is the version-authority mechanism. LLP 0041 currently binds “the runtime binary and its **embedded Guide**.” Phase 1 lists docs to amend (0041, 0276). Phase 2 lists none — not 0061, not 0041’s embedded-Guide sentence, not `guide.rs`’s closed-table / path-escape invariant.

**Carriage vs admin is not the same pipeline.** Admin is omitted from `--native-artifact-staging` and added at final assembly. EAS Darwin currently packs:

```text
bin Frameworks include runtime-readiness.json
```

No `admin/`, and no future `guide/`. Darwin/Linux `swapStagedAssembly` entries are `bin`, `Frameworks`/`lib`, `include`, `admin`, `runtime-readiness.json`. `produceRuntimePackageSeal` digests those members. A Guide sidecar that is not on that inventory is either dropped on the qualified path (server fail-closes, which is what the plan wants — except the published artifact would be broken) or present on disk and **unsealed** (regresses “seal digests every member”).

“Opened at process start” plus “keep `guide.rs` as the decoder” implies the sidecar is the existing `embedded-guide.v1.bin` closed table, not a raw `guide/` tree. Raw files re-open path-escape unless the closed table is rebuilt at load. The plan does not pick the artifact format, who generates it on the publish path (build.rs currently always walks `guide/` and `cargo:rerun-if-changed=../../guide`), or which stage copies it (native artifact vs final assemble, mirroring admin).

**Wrong expected package bytes.** Phase 2 moves ~20 MB from `__const` onto package files. That shrinks `bin/snapback`. It does **not** shrink Darwin unpacked size by ~20 MB; the corpus is still on disk next to the binary, like admin. After Phase 1 the unpacked package is roughly (110–130 MB binary) + ~9.4 MB Hermes + ~4 MB admin + small seal files ≈ **130–150 MB**. Phase 2 leaves that unpacked number in place and cuts the **binary** toward 90–110. The outcome table’s Darwin unpacked **~110–130 MB after Phases 1–2** treats Guide-out as a package-size win. Tarball **~30–40 MB** can still be a Phase 1 (strip + LTO) story, because Guide remains in the tarball either way.

This is not a demand for more prose. It is a defective “done” picture plus a publication path that can ship a server whose Guide sidecar never made the EAS tarball or the seal.

**Suggested fix.**

1. Pin the sidecar format: ship the same `embedded-guide.v1.bin` (or an identical closed table) as a sealed package member; do not serve a loose `guide/` tree in v1 of this phase.
2. Name the inventory: packer staging/swap entries, `produceRuntimePackageSeal` / verify, EAS Darwin tar and Linux artifact transport, native-artifact-staging vs final assemble (pick admin-like or binary-like and stick to it).
3. Amend LLP 0061 §4a / OQ3 and LLP 0041’s “embedded Guide” on the same landing. Gate `emit_embedded_guide` / `cargo:rerun-if-changed=../../guide` on the public-package path so Guide edits do not rebuild `snapback-server` there.
4. Rewrite the outcome table: binary ~90–110 MB after 1–2 is the Guide-out win; unpacked package after 1–2 ≈ after Phase 1 (~130–150 MB planning), not 110–130; tarball savings credited to Phase 1.

### 12. minor — 0314.000, Standing constraints / Non-goals / Measurement — policy alignment is good

**Defect.** None of decision quality. The plan correctly:

- leaves LLP 0010 debug metrology report-only and does not fold ship size into `binary-size-metrology.mjs`;
- puts fat LTO only on the ship profile (LLP 0276);
- forbids a landing veto (LLP 0189 / 0232) and allows a **publication** refusal;
- keeps Ibex/Hermes and npm-as-distribution (0000 / 0141);
- uses LLP 0041’s “no current users depend on stability” for strip + Guide carriage, while freezing ready-file / health / Guide **URL** semantics.

OQ3’s default (fast-path pack refuses >15% vs a committed **production** baseline) matches 0010’s tolerance on a different file. Do not let that gate become a complete-proof-at-exact-HEAD check.

**Suggested fix.** When OQ3 is closed, name the exact script/workflow (fast-path publish vs EAS qualified staging) so it cannot be wired into pre-push.

### 13. minor — 0314.000, Phase 0 / 3 / 4 — ranking-first cuts and optional structure are the right altitude

**Defect.** Phase 0 Darwin `cargo bloat` / `bloaty` / Guide-blob line is the right unblocking measurement; Phases 1–2 correctly do not wait on it; Phase 3 correctly may become tickets. Measurement § asks for Darwin **and** Linux retain; Phase 0 is Darwin-only — acceptable if Linux ICU remains Phase 4, but say so. `panic = "abort"` on production only is correctly hedged against C++ `__gcc_except_tab`. Split-binary / `opt-level = "s"` as Phase 4 / RFC-sized is correct non-start-here.

**Suggested fix.** One line: Phase 0 may be Darwin-only for crate ranking; Linux unpacked delta stays Phase 4. Optional: note `jsonschema` also lives on `snapback-types` so a “only where Ask needs it” cut has three compile sites, not two.

### 14. minor — 0314.000, Phase 1 expected LTO/strip ranges — plausible planning numbers

**Defect.** 159 − ~34 `__LINKEDIT` ≈ 125, minus 15–25 `__text` from fat LTO ≈ 100–110, with 110–130 as “LTO underpays.” That is internally consistent and marked as planning, not a gate. Fat LTO on EAS `macos-large` / `linux-large` after a 900s `runtime-link-smoke` is the LLP 0276 trade; RAM/timeout is a real operational risk but not a defective decision. `strip = "symbols"` vs `strip -x` vs ELF `--strip-unneeded` is implementer detail as long as Hermes dynsyms survive.

**Suggested fix.** Record “prefer Cargo `strip` so source receipt and packaged bytes share a digest” in Phase 1 (see finding 10). No change to the 110–130 / 90–110 **binary** bands.

---

## Overall assessment

**0314 (research) is a sound diagnosis.** The waste is three stacked, distinguishable kinds: unstripped `--release` link (F2/F3), Guide `include_bytes!` (F4), and a genuinely large `__text` from the default crate graph (F6/F7). It is not a mistaken debug build, not a Hermes problem, not an LLP 0010 debug-metrology problem, and not a missing LLP 0276 profile. `[profile.production]` exists and is unused on the npm path; that is packaging drift. Numbers that could not be re-run offline are consistent with files that could (baseline JSON, packer defaults, CI pin, embed path, 0.1.27 in the Guide manifest, 0126/0141 citations). Remaining nits are units, citation hygiene, and “F3 is the whole manufacture graph.” No unresolved MATERIAL.

**0314.000 (plan) has the right program shape and the wrong implementer contract for the first two phases.** Constraints vs 0010 / 0189 / 0232 / 0041 / 0276 / 0141 are correct. Phase 0 ranking before Phase 3 cuts is correct. Phases 1–2 as “obvious carriage” before crate surgery is correct. What is missing is exactly what an implementer would hit on day one: the manufacture graph still produces and qualifies `target/release/snapback` in Linux CI, EAS qualified staging, and `assemble-runtime-package`, while source-checkout **must** stay on `target/release`; and Phase 2’s Guide sidecar is not a member of the seal/swap/EAS transport that actually publishes Darwin, while the outcome table spends the Guide’s 20 MB twice at package level. Those are defective procedures, not extra color. Fix them and this is a good plan.

Altitude: findings 1–9 and 12–14 are non-blocking. Findings 10 and 11 are MATERIAL on 0314.000 only.

---

- `VERDICT 0314: READY`
- `VERDICT 0314.000: NOT READY`
- `VERDICT SET: NOT READY`

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
- Result: **0314 NOT READY (1 MATERIAL, IN-DELTA), 0314.000 NOT READY
  (3 MATERIAL, all IN-DELTA), SET NOT READY. No PRE-EXISTING MATERIAL
  concern reported.**
- Capture note: stdout preceded the review with brief progress narration,
  preserved verbatim below.

### Runner narration (verbatim, round 2)

I'll review the full 0314 cluster and the r2 delta using only file-reading tools, then fact-check new claims against the capsule.I'll fact-check the delta's manufacture, custody, and Guide-carriage claims against the cited workflows, packers, and governing LLPs.Next I’ll open the manufacture-graph files and the governing LLP sections the delta newly cites.I have enough to judge the delta: the manufacture-graph rewrite is largely accurate, but a few closed inventories and the Phase 2 sidecar producer still don’t hold up against the capsule. Below is the self-contained review.

### Verbatim review body (round 2)

# Super-refine review: LLP 0314 cluster (delta round 2)

Reviewed documents: `llp/0314-shipped-runtime-binary-size.research.md`, `llp/0314.000-reduce-shipped-runtime-size.plan.md`. Enumerated delta: `r2-delta.diff` (`235fabf28` → `fca941e42`). Capsule-checked against the workflows, packers, identity/seal machinery, `Cargo.toml` graphs, Guide embedder/decoder, path-migration manifest, and LLPs 0010, 0041, 0061, 0123, 0141, 0189, 0227, 0276, and 0284.

## Findings

### 1. MATERIAL, IN-DELTA — both docs (research F6; plan Phase 3 item 2)

**Defect.** The r2 fold adds `snapback-types` as a third *normal* `jsonschema` site on the ship graph. That is false in this capsule.

`crates/snapback-types/Cargo.toml` puts `jsonschema` under `[dev-dependencies]`, the same as `crates/snapback-kernel/Cargo.toml`. The production sites are only:

- `crates/snapback-engine` (Ask)
- `crates/snapback` (umbrella `[dependencies]`)

Pre-delta F6 was right: engine + umbrella. The revision “widened” the inventory by grepping the crate without checking the section, then copied the error into Phase 3’s closed three-site list.

**Why it matters.** F6’s license is “these are on the ship graph.” Phase 3 item 2 is a cut inventory an implementer will treat as closed. A phantom production dep is a correctness defect in a list this revision just rewrote as precise.

**Fix.** State two normal-dep sites (engine, umbrella) and two already-dev-only sites (kernel, types). Do not send Phase 3 looking for a types production dep that is not there.

---

### 2. MATERIAL, IN-DELTA — plan, Phase 2 (pinned shape + build-graph split + wiring inventory)

**Defect.** Phase 2 pins the sidecar as today’s closed-table `embedded-guide.v1.bin`, then gates `emit_embedded_guide` **and** the `cargo:rerun-if-changed=../../guide` walk **off** on the public-package path. `crates/snapback-server/build.rs` is the only producer of that artifact; `guide.rs` `include_bytes!`s `OUT_DIR/embedded-guide.v1.bin`. Turning the producer off without naming a replacement leaves nothing to stage.

The rest of the new Phase 2 text does not close the hole:

- No pack-time (or other) producer, invocation site, or output path.
- No `cfg` on `include_bytes!`. If emit stops and the include stays, public-package builds fail.
- No on-disk member path (admin is `admin/`; the Guide sidecar is unspecified).
- No process discovery (binary-relative vs CLI-injected, analogous to `SNAPBACK_ADMIN_DIST`).
- “Refuse to serve if missing” is not pinned against the admin seam this phase claims to mirror. Native-artifact staging omits admin (`--native-artifact-staging` → `adminConsoleRequired: false`); EAS Darwin tar is `bin Frameworks include runtime-readiness.json`; CV-2/`build-identity` run on that tree. If public-package process start requires the sidecar, staging qualification breaks. If only final assembly and guide routes fail closed, that must be said.

LLP 0284 §3.7 currently requires consumption *only* through `include_bytes!`. Amending that is acknowledged; it does not substitute for a producer or a start-vs-route refusal rule.

**Fix.** Pin one shared packer (extract `emit_embedded_guide` so build.rs and pack-time share it): public-package rustc does not `include_bytes!` the blob; the packer/final assembler still generates the same v1.bin at the same revision as the compiled-in manifest `contentHash`. Pin the member (e.g. `guide/embedded-guide.v1.bin` next to `admin/`). Pin discovery (package-relative, CLI-injected, fail closed — no cwd/`guide/` tree). Pin the admin seam: native-artifact-staging, CV-2, and `build-identity` succeed without the sidecar; final assembly and seal require it; a packaged process without it refuses Guide HTTP/MCP with a coded diagnostic, and does not panic the handler-VM probe. Carry the split into `scripts/runtime-build-inputs.txt` **consumers** (`crates/snapback-types/build_identity.rs` and the other listed dirty-probe users) so sidecar-only edits do not restamp binary identity.

---

### 3. MATERIAL, IN-DELTA — plan, Phase 1a (“closed” manufacture / pin inventory)

**Defect.** 1a is offered as a closed producer/receipt/pin list. Against the capsule it is not closed.

Present and correctly named: both packer defaults and env overrides, Linux workflow cargo + both `--binary …/target/release/snapback` paths (issue *and* verify), EAS `darwin_runtime` / `linux_runtime` cargo lines, `tests/ci_workflows_v0.mjs`’s two existing pins, `scripts/assemble-runtime-package`, `scripts/build-linux-runtime-release`, packer error strings, LLP 0041 / 0276 notes.

Missing pins that will fire or silently aim at the wrong bytes:

- **`scripts/path-migration-manifest.v1.json` `s07-r004`.** Another `verify-unchanged` row over `.github/workflows/linux-runtime-package.yml:78,85-93` (`cargo build --release --bin snapback; target/…`). 1a lists `s01-r005`, `s01-r024`, `s01-r025` and presents that as the verify-unchanged set. Changing the workflow without `s07-r004` fails the path-migration check.
- **`s01-r013` / `scripts/packaged-store-qualification.mjs`.** Default public-package binary is `SNAPBACK_RUNTIME_BINARY` or `target/release/snapback`. After packers copy `target/production/snapback`, that default is the wrong artifact. The row is `verify-unchanged`; leaving it is a publication footgun, not a custody exception.

**Fix.** Expand 1a to every `verify-unchanged` row whose `currentPathExpression` is the ship `--release` command or `target/release/snapback` as the public-package binary (at least `s07-r004` and `s01-r013`), and retarget the qualification default to the production path. Keep 1b’s source-checkout `target/release/snapback` exceptions explicit so those rows are not “fixed” by accident.

---

### 4. minor, IN-DELTA — plan, Phase 1c / OQ 5

**Defect.** 1c correctly requires a build-time recipe fact (production + fat LTO) because `BinaryIdentity.build_profile` is only `debug`/`release` via `cfg!(debug_assertions)` (`crates/snapback-types/src/identity.rs`), and `assertRuntimePackageBuildIdentity` requires `release`. OQ 5 then frames the carrier as “new receipt field vs. seal line.” Those are ceremony documents. `SNAPBACK_BUILD_DISTRIBUTION` is already an honor-system compile env (`build_identity.rs`). A workflow-written seal line has the same spoof 1c is written to prevent.

**Fix.** Authority is a rustc/cargo-derived stamp (Cargo `PROFILE` / equivalent, not a new env). `build-identity` emits it; receipts, seals, Linux attestation, ledgers, and assembly *copy* it. OQ 5 only chooses which documents persist the copy. Public-package assembly reads the fact from the bytes being packed.

---

### 5. minor, IN-DELTA — plan, Phase 1 Expected vs outcome table

**Defect.** Phase 1 Expected still calls Darwin **~90–110 MB** a success “if LTO pays the top of the range,” while the rewritten table stacks conservative Phase 1 **~110–130** then Phase 1–2 **~90–110** (Guide relocation). 159 − ~35 strip − ~25 LTO ≈ 99, then Phase 2 − ~20 ≈ 80 — below the table’s 1–2 band. Planning ranges, not gates, but the success criterion is ambiguous.

**Fix.** Keep the table as the stacked planning target. Treat Phase 1 ~90–110 as an LTO upside, not a second success line that Phase 2 also claims.

---

### 6. minor, IN-DELTA — plan, Phase 1d strip policy vs Phase 0

**Defect.** Phase 0 measures `strip -x` (Darwin non-global symbols). Phase 1d pins Cargo `[profile.production] strip = "symbols"`. Those are not the same operation; `symbols` is closer to `strip -s`. The “keep dynsyms Hermes loading needs” caveat is right (dyld/`LC_LOAD_DYLIB` / `.dynsym` vs local `LC_SYMTAB`) but untested here.

**Fix.** Phase 0 and Phase 1d use the same strip policy, or Phase 0 records both. Confirm a production-stripped Darwin binary still loads `hermesvm.framework` and Linux still loads `libhermesvm.so` before sealing.

---

### 7. minor, IN-DELTA — research, Related

**Defect.** F4 now depends on LLP 0284 (inert artifact, committed decoder, directly-included manifest). Related added 0061 but not 0284.

**Fix.** Add LLP 0284 to Related.

---

### 8. minor, IN-DELTA — plan, Phase 2 wiring inventory wording

**Defect.** The “closed list” includes “EAS Darwin tar member list and Linux native-artifact transport” *and* “mirror admin: added at final assembly.” Admin is not on the Darwin tar. If the sidecar follows admin, those native transports must **not** gain the member; final assembly and `packagedRuntimeArtifactCandidates` must. As written, an implementer can add it in both places or neither.

**Fix.** One sentence: native tars stay as they are (binary/Hermes/header); sidecar is a final-assembly member like `admin/`, required by `files`, `swapStagedAssembly`, and seal candidates when `adminConsoleRequired` would be true.

---

### 9. minor, PRE-EXISTING (prose refreshed IN-DELTA) — research F2 / Evidence

**Defect.** F2 is still a one-off `size`/`otool` of a staged 0.1.27 Darwin binary. r2 honestly says the binary is not in the checkout and asks future snapshots to keep digest + raw output. The table remains unreproducible from the capsule.

**Fix.** Already the right request: land digest + `size`/`otool` (and Linux `readelf`) with Phase 0. No further design change.

---

## What the r2 fold got right (not findings)

Checked and holding:

- Decimal MB unification matches the evidence-table bytes (`186,720,037` → ~187; `248,155,233` → ~248; `__text` 67,409,876 → ~67 MB).
- F3’s manufacture graph matches the capsule: both packers default to `target/release/snapback`; Linux GHA builds `--release` and receipts that path; both EAS native jobs build `--release`; `assemble-runtime-package` and `build-linux-runtime-release` do too. `tests/ci_workflows_v0.mjs` does **not** currently pin the EAS cargo strings; the plan’s “pin them when changed” is accurate.
- F4’s 0061 §4a / OQ3 reframing matches the RFC (embedded-in-binary, always served; original ~130 KiB). `guide.rs` does `include_str!` the committed manifest and hash-matches the blob. 0284 §3.7 matches the inert-decoder story. Carriage change is an amendment, not drift.
- 1b source-checkout exceptions match `packages/snapback-cli/index.mjs` (`target/release/snapback`, `cargo build --release`) and the Linux `package.test.mjs` assertion. Do not retarget those.
- 1c’s `buildProfile` trap is real; do not emit `production` into that field this phase.
- 1d pre-receipt Cargo strip is the right digest discipline (Linux GHA issues a source receipt on the pre-pack file; packer-after-seal strip would desync).
- Outcome table no longer double-counts Guide: Phase 2 moves bytes from the Mach-O into package files; unpacked/tarball stay roughly flat. Arithmetic holds (187 − 159 = 28 non-binary; 110–130 + 28 = 140–160; 90–110 + 28 + 20 ≈ 140–160).
- Phase 3 demotions match the tree: LLP 0227 requires bounded bcrypt/scrypt verify + upgrade-on-verify; `catch_unwind` is load-bearing in `commit_capsule.rs` / writer gates; a single npm binary cannot feature-gate `image`/exif per install.
- 0141’s crates.io 10 MB line is the immediate blocker; path deps, Hermes carriage, loader custody, and publication metadata are real additional blockers (0141 D6). Shrinking `__text` does not make a crates.io server crate viable.
- 0189 D-4 applied to a ship-path size baseline (own drift coverage, not a claim digest; publication-only validator; not a landing veto) is the right cadence.

The research is now a coherent diagnosis. The plan is much closer to implementable than a “flip the packer default” sketch. It is not yet a closed manufacture + carriage plan.

## Overall assessment

r2 did the work the documents needed: units, 0061 honesty, manufacture-graph width, Phase 1 inventories and attestation, Phase 2 as a governed amendment, outcome-table math, and the KDF/assets/panic demotions. Remaining MATERIAL issues are all introduced or locked in by that fold: a false `jsonschema` site, a Phase 2 sidecar with the producer switched off, and a Phase 1a “closed” pin list that omits at least one verify-unchanged row (and a publication-binary default) the landing will hit.

Those are small, local edits — not a new design. Until they are in the text, an implementer can still ship a spoofable “production” ceremony, fail path-migration, or take the Guide embedder out of rustc with nothing to put in the tarball.

---

- `VERDICT 0314: NOT READY` — MATERIAL finding 1 (IN-DELTA).
- `VERDICT 0314.000: NOT READY` — MATERIAL findings 1, 2, and 3 (all IN-DELTA).
- `VERDICT SET: NOT READY` — both documents have unresolved MATERIAL concerns (findings 1–3).

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
- Result: **0314 READY. 0314.000 NOT READY (2 MATERIAL, both IN-DELTA;
  one PRE-EXISTING minor).**
- Capture note: stdout preceded the review with one line of progress
  narration, preserved verbatim below.

### Runner narration (verbatim, round 3)

I'll review both LLP 0314 documents and the r3 delta against the capsule, using only file-reading tools. Starting with the targets, the diff, and the cited sources.Documents and the delta are in. Next I’ll check the cited source files and related LLPs so I can classify each concern as in-delta or pre-existing.I’m checking Cargo.toml dependency tables, path-migration rows, packers, and the identity/attestation machinery next.I’m tracing identity, receipts, admin discovery, and the Guide/LLP constraints that Phase 2 claims to preserve.# Super-refine round 3 — LLP 0314 cluster (delta review)

### Verbatim review body (round 3)

Reviewed the full research and plan, then checked `r3-delta.diff` against the capsule: packers, Linux/EAS workflows, `tests/ci_workflows_v0.mjs`, `scripts/assemble-runtime-package`, path-migration rows, identity/attestation, Guide encoder/decoder, runtime-build inputs, and LLPs 0010, 0041, 0061 §4a, 0123, 0276, and 0284 §3.7.

The r3 fold is mostly the right shape. Public manufacture vs source-repair is now a real split, jsonschema sites and PocketBase units match the tree, 1c’s compiler-derived stamp is the right authority, and Phase 2 now has a producer, member path, admin-shaped staging, and a test matrix. Two Phase 1 inventory defects from this fold remain.

---

## Findings

### 1. MATERIAL — IN-DELTA — `llp/0314.000` Phase 1a / 1b

**Defect.** r3 correctly moved `scripts/assemble-runtime-package` into **1b** (keep ordinary `--release`, pass that binary explicitly once packer defaults move). The same revision still lists path-migration row **`s01-r005`** under **1a** as a ship-path `verify-unchanged` row that “changes intentionally.”

That row’s consumer is `scripts/assemble-runtime-package:63`, and its `currentPathExpression` is `cargo build --release --bin snapback` — the source-repair command 1b just preserved. Capsule check: the script builds `--release` with no `SNAPBACK_BUILD_DISTRIBUTION`, then calls `prepare-runtime.mjs --source-test-staging --strict-clean-release`.

An implementer following the 1a “at least …” list will retarget that command (or its migration row) to `--profile production`, which is exactly the source-repair/manufacture mix-up r3 was meant to close.

**Suggested fix.** Drop `s01-r005` from the 1a change list. Keep it under 1b as *verify-unchanged* (command stays `--release`; at most record an explicit `SNAPBACK_RUNTIME_SOURCE_BINARY=…/target/release/snapback` once packer defaults move). Restrict the 1a list to rows whose expression is the *public-package* ship command or the public-package binary path: `s01-r013`, `s01-r024`, `s01-r025`, `s07-r004`.

---

### 2. MATERIAL — IN-DELTA — `llp/0314.000` Phase 1a Linux lane split / 1b

**Defect.** The lane split is the right *problem* statement and the wrong *closed inventory*.

Today `linux-runtime-package.yml` is the only CI home that (1) builds `target/release/snapback`, (2) issues the named sibling receipt, and (3) runs `packages/snapback-runtime-linux-x64/package.test.mjs`, whose source-checkout assertion requires `resolveRuntimeBinary()` → `target/release/snapback`. Darwin’s `package.test.mjs` has no such assertion.

1a still retargets that workflow’s cargo build **and** both `--binary …/target/release/snapback` receipt steps, and it retargets the `tests/ci_workflows_v0.mjs` pin that currently requires that binding. 1b forbids retargeting the test assertion. The new default then says the assertion “runs where a source release build exists” without naming a job, step, or workflow.

After the manufacture switch, no remaining Linux CI producer in this capsule still builds ordinary `--release` for that assertion (EAS `linux_runtime` is also in the 1a switch). “Where a source release build exists” therefore collapses to local `assemble-runtime-package`, and the only Linux CI coverage of LLP 0010 source-checkout resolution is dropped without an explicit decision.

**Suggested fix.** Close the inventory with one named home, for example:

- In `linux-runtime-package.yml`, keep a **second** ordinary `--release` build + sibling receipt solely for the existing source-checkout assertion; production remains the pack/seal path; split `package.test.mjs` so the public-package lane asserts installed-package custody only; or
- Name another existing Linux job that already builds source-checkout `--release` and move the assertion there; or
- Explicitly drop Linux CI coverage of that assertion (Darwin/local only) in one sentence.

Do not leave “where a source release build exists” as the landing instruction.

---

### 3. minor — IN-DELTA — `llp/0314.000` Phase 1c

**Defect.** Authority is correctly the compiler, not the ceremony. The normative fields (`lto`, `codegen-units`, `incremental`, `strip`) are not Cargo build-script environment. Cargo sets `PROFILE` (and `OPT_LEVEL` / `DEBUG`); `CARGO_PROFILE_*` is a *user override* channel, not a report of the resolved recipe. `crates/snapback-types/build_identity.rs` already stamps via `cargo:rustc-env`; that is the right emitter, but the plan still reads as if rustc will hand back those four fields.

**Suggested fix.** Stamp `PROFILE` plus the `[profile.production]` recipe as declared in root `Cargo.toml` (production currently has `incremental = false`, `lto = "fat"`, `codegen-units = 1`, and no `strip` until 1d). Forbid `CARGO_PROFILE_PRODUCTION_{LTO,CODEGEN_UNITS,INCREMENTAL,STRIP,OPT_LEVEL}` (and `RUSTFLAGS` `-C lto=` / `-C strip=` if you want the same spoof class closed). Public-package assembly requires `PROFILE=production` and those declared field values.

---

### 4. minor — IN-DELTA — `llp/0314.000` Phase 2 load validation vs bare-binary tests

**Defect.** The full seal tuple `{sourceRevision, contentHash, artifactSha256}` cannot live on **binary** identity: `artifactSha256` is only known after pack-time production, and compiling it in would put sidecar bytes back on the binary input set. `qualified-staging-assemble` already binds `gitCommit` to `HEAD`; the compiled-in manifest already binds `contentHash` (LLP 0284 §3.7). Bare-binary tests in the new matrix have no package seal, so they cannot check the full tuple.

**Suggested fix.** Split the check: compiled-in manifest `contentHash` + binary `gitCommit` vs sidecar-stamped revision on every load; `artifactSha256` only when a package seal exists. State that a valid bare-binary load is env-injected sidecar + those two binary facts, not a seal.

---

### 5. minor — IN-DELTA — `llp/0314.000` Phase 2 member inventory

**Defect.** The member list (package `files`, `swapStagedAssembly`, seal candidates) matches admin’s *seal* surface and misses the adjacent pins that will fail when `guide/` is added:

- Darwin `package.test.mjs` `manifest.files` and `.gitignore` (`/admin/`, `/bin/`, …)
- Linux `package.test.mjs` `manifest.files`
- both packages’ `.gitignore` (linux-runtime-package.yml fails closed on a dirty tree; a new un-ignored `guide/` member will red that lane)

**Suggested fix.** Add those pins to the Phase 2 inventory, mirroring `admin/`.

---

### 6. minor — IN-DELTA — `llp/0314.000` Phase 2 discovery (“SNAPBACK_ADMIN_DIST pattern”)

**Defect.** CLI injection of a package-relative path is the right analog (`runtimeSpawnEnvironment` sets `SNAPBACK_ADMIN_DIST` from `bin/../admin` after seal checks). The full admin pattern also includes `default_admin_dist()`: a compile-time `CARGO_MANIFEST_DIR/../../admin-ui/dist` existence probe. Copying that onto `guide/` would be checkout-tree discovery, which this phase forbids.

**Suggested fix.** Name a new env (do not reuse `SNAPBACK_ADMIN_DIST`). Discovery = (1) CLI-injected package-relative `guide/embedded-guide.v1.bin` after seal membership checks, (2) that explicit env, fail closed. No `CARGO_MANIFEST_DIR` / cwd / loose `guide/` fallback.

---

### 7. minor — IN-DELTA — `llp/0314.000` Phase 2 producer

**Defect.** “Final assembly runs [the encoder] from the exact clean source revision the binary was built from” is the right constraint (EAS assemble already refuses Darwin `gitCommit !== HEAD`). It is not a coded assembly refusal if the checkout is dirty, or if `prepare-runtime.mjs` (the actual final-assembly caller via `snapback-publish` prepack) encodes a tree that does not match `identity.binary.gitCommit`. Runtime wrong-revision refusal is a backstop, not a substitute for failing the seal.

**Suggested fix.** Pack-time producer runs inside non-`--native-artifact-staging` prepare (both platforms), refuses dirty package-input pathspecs or `HEAD !== identity.binary.gitCommit`, and is the same Rust encoder `build.rs` calls.

---

### 8. minor — IN-DELTA — `llp/0314.000` Phase 0 vs 1d strip

**Defect.** 1d now requires Cargo `strip = "symbols"` (or Phase 0 records both transforms). Phase 0’s goal bullet still leads with `strip -x (or equivalent)`. Root `[profile.production]` currently has no `strip` key.

**Suggested fix.** Make Phase 0’s primary transform Cargo `strip = "symbols"` on the production binary; mention `strip -x` only as an optional extra measurement row.

---

### 9. minor — PRE-EXISTING — `llp/0314` F2 / measurement custody

**Defect.** The F2 table is still not locally re-runnable (staged Darwin `bin/snapback` is not in the checkout). The research already says future snapshots should retain digest + raw `size`/`otool` output. That remains a custody hole, not a new r3 contradiction.

**Suggested fix.** Land the first Phase 0 snapshot with those raw artifacts as the research already asks; no prose change required for READY.

---

## Overall assessment

**0314 (research).** The r3 diagnosis fold is sound. F3’s public-manufacture vs source-repair split matches `assemble-runtime-package` and the CLI’s `target/release` source-checkout path. F6’s jsonschema inventory matches Cargo.toml (`snapback-engine` and `snapback` normal; kernel and types `[dev-dependencies]` only). F7’s PocketBase row is internally consistent with the plan’s non-goal. No MATERIAL defect.

**0314.000 (plan).** Phases 0, 1c–1e, 2’s admin-shaped carriage, 3, and 4 are implementable enough for a plan. The r3 Phase 1 closed-inventory claim is not closed: `s01-r005` is still on the manufacture change list after its consumer was moved to source-repair, and the Linux source-checkout assertion has no named CI home once the only Linux workflow that builds `--release` is retargeted. Those are defects of this fold, not leftover r1 text.

---

- `VERDICT 0314: READY`
- `VERDICT 0314.000: NOT READY` (MATERIAL findings 1 and 2, both IN-DELTA)
- `VERDICT SET: NOT READY` (blocked by 0314.000 findings 1 and 2)

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
- Punch list sha256 `9b8189712da5bf0a447e08c8f822b6b2885e3b6c5a3f4465ebd277b8b558c8ee`.
- Result: **READY — all 9 dispositions VERIFIED, no MATERIAL diff defect,
  4 non-blocking obligations** (producer placement restated to mode 2; OQ5
  wording restore; forbidden-channel enforcement point; Phase 0 snapshot
  custody). Grok's non-blocking note 2 independently identified the same
  producer/mode-3 tension codex reported as MATERIAL.
- Capture note: stdout narration preserved verbatim below.

### Runner narration (verbatim, round 4)

I'll review the plan, delta, punch-list dispositions, and cited capsule sources using file-read tools only—no shell.The plan and delta are in hand. Next I’ll check the cited sources the punch-list dispositions depend on.The 1a/1b row claims look plausible; next I’ll confirm the remaining path-migration rows and the package, identity, and LLP citations.The producer vs. source-test tension needs a closer look against prepare-runtime flags, admin discovery, and the cited LLP sections.I’ll search the capsule for the cited symbols (`default_admin_dist`, seal members, `emit_embedded_guide`) without using the shell.

### Verbatim review body (round 4)

# Super-refine round 4 — Grok family punch-list delta review

**Target:** `llp/0314.000-reduce-shipped-runtime-size.plan.md` (r4 fold + r4.1 freeze declaration)  
**Materials:** full plan, `r4-delta.diff`, parent research `llp/0314-shipped-runtime-binary-size.research.md` (context only)  
**Capsule checks:** path-migration rows `s01-r005` / `s01-r013` / `s01-r024` / `s01-r025` / `s07-r004`; `scripts/assemble-runtime-package`; `.github/workflows/linux-runtime-package.yml`; both `package.test.mjs` and `.gitignore` files; `crates/snapback-types/build_identity.rs`; `crates/snapback-server/{build.rs,src/guide.rs,src/admin.rs}` and Guide consumers; root `Cargo.toml`; LLPs 0010, 0041, 0061 §4a, 0123 package-seal landing, 0284 §3.7.

Post-freeze rule applied: punch-list dispositions first; outside findings only as disposition errors or MATERIAL contradictions created by this diff. New normative closure is recorded as `OBLIGATION:`, not a READY veto.

---

## Punch-list dispositions

### 1. (MATERIAL) `s01-r005` still in the 1a change list — **VERIFIED**

Phase 1 §1a now restricts the intentional path-migration change set to `s01-r013`, `s01-r024`, `s01-r025`, `s07-r004`. `s01-r005` is named as **not** in that set; its consumer is `scripts/assemble-runtime-package:63`; it stays `verify-unchanged` on `--release`.

Capsule: `s01-r005` is exactly `scripts/assemble-runtime-package:63` / `cargo build --release --bin snapback`. That script is still the contributor repair path (`prepare-runtime.mjs --source-test-staging --strict-clean-release`). The other four rows are the public-package / Linux-workflow pins. §1b independently keeps `assemble-runtime-package` on ordinary release and requires it to pass the release binary explicitly once packer defaults move.

### 2. (MATERIAL) Linux lane split had no named CI home — **VERIFIED**

§1a now names `.github/workflows/linux-runtime-package.yml` as the home of a **second** ordinary `--release` build plus sibling receipt, solely for the existing source-checkout custody assertion (LLP 0010). Production is the pack/seal path. `package.test.mjs` splits so the public-package lane asserts installed-package custody only. Darwin’s `package.test.mjs` is required to take the Linux-style forced-package-root form instead of bare `resolveRuntimeBinary()`.

Capsule: the workflow today dual-uses one `SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --release` plus one sibling receipt on `target/release/snapback` (commented as source-CLI custody; `tests/ci_workflows_v0.mjs` pins that order). Linux `package.test.mjs` currently asserts **both** source-checkout (`target/release/snapback`) and installed custody (`cliPackageRoot`). Darwin currently does `resolveRuntimeBinary().binary ===` the package binary with no forced root. §1b still lists the Linux source-checkout assertion. That is the named-home reconstruction the finding asked for.

### 3. (minor) 1c normative fields are not build-script env — **VERIFIED**

§1c now states that Cargo hands `PROFILE` but not the resolved `lto` / `codegen-units` / `incremental` / `strip` tuple. `build_identity.rs` (already the `cargo:rustc-env` emitter) stamps `PROFILE` plus the `[profile.production]` recipe **as declared** in root `Cargo.toml`. Forbidden override channels are enumerated (`CARGO_PROFILE_PRODUCTION_*`, `CARGO_INCREMENTAL`, `RUSTFLAGS`/`CARGO_ENCODED_RUSTFLAGS` touching `-C lto`/`-C strip`/`-C codegen-units`/`-C opt-level`, `cargo --config`, rustc wrappers), with negative tests per class. Public-package assembly requires `PROFILE=production` with the declared values. `buildProfile` is still not repurposed.

Capsule: root `[profile.production]` is `inherits = "release"`, `incremental = false`, `lto = "fat"`, `codegen-units = 1` (no `strip` yet; 1d adds it on the same landing). `build_identity.rs` already emits rustc-env stamps; it does not currently see resolved profile knobs.

### 4. (minor) Full seal tuple cannot live on binary identity — **VERIFIED**

Phase 2 §Load validation splits the tuple: every load checks compiled-in manifest `contentHash` **and** binary `gitCommit` against the sidecar’s stamped revision; `artifactSha256` only where a package seal exists; a bare-binary launch may load an env-injected sidecar on those two binary facts alone. Same-content wrong-revision refusal and LLP 0284 §3.7 (`contentHash` does not bind every record) are retained.

Capsule: `emit_embedded_guide` already injects `buildIdentity.commit` into the blob’s copy of the manifest, so “sidecar’s stamped revision” has a home in the **existing** closed-table format without a magic/version bump. `include_str!` of `guide/guide-manifest.generated.json` remains the compiled-in `contentHash` anchor. Bare-binary tests have no seal; skipping `artifactSha256` there is the right split.

### 5. (minor) Member inventory missed `manifest.files` / `.gitignore` — **VERIFIED**

Phase 2 §Assembly modes (2) adds `/guide/` to both packages’ `.gitignore` and the `guide/` member to both `package.test.mjs` `manifest.files` / exact-ignore assertions, mirroring `admin/`.

Capsule: Darwin files/ignore are `admin`, `bin`, `Frameworks`, `include`, `runtime-readiness.json`; Linux the same with `lib` instead of `Frameworks`. No `/guide/` today. `swapStagedAssembly` lists are `['bin', 'Frameworks'|'lib', 'include', 'admin', 'runtime-readiness.json']` — the plan also names those lists as gaining the member.

### 6. (minor) Discovery must not copy `default_admin_dist()` — **VERIFIED**

Phase 2 §Discovery requires a **new** env (not `SNAPBACK_ADMIN_DIST`), CLI-injected with the package-relative `guide/embedded-guide.v1.bin` after seal membership checks, fail-closed: no cwd, no loose `guide/` tree, **no** `CARGO_MANIFEST_DIR` probe. It explicitly cites `default_admin_dist()` as the forbidden checkout-tree fallback.

Capsule: `default_admin_dist()` is `env!("CARGO_MANIFEST_DIR")/../../admin-ui/dist` if `index.html` exists; `SNAPBACK_ADMIN_DIST` is the contributor override. Copying that pattern would re-open source-tree Guide discovery.

### 7. (minor) Producer must refuse at assembly time — **VERIFIED**

Phase 2 §Producer places a pack-time producer inside non-`--native-artifact-staging` `prepare-runtime.mjs` on both platforms, using the shared encoder `build.rs` already calls, with a **coded assembly failure** if package-input pathspecs are dirty or `HEAD != identity.binary.gitCommit`. Runtime wrong-revision refusal is a backstop.

Capsule: `emit_embedded_guide` is the only producer today (`OUT_DIR`). Both preparers already branch on `--native-artifact-staging` vs `--source-test-staging` vs default. The clean-source gate is the finding.

See OBLIGATION 1 for a placement-clarity restatement against mode 3; that is not a miss of this fold.

### 8. (minor) Phase 0 strip must match 1d — **VERIFIED**

Phase 0 now ranks `cargo bloat` / `bloaty` before and after Cargo `strip = "symbols"` — “the same transform Phase 1d ships.” `strip -x` is an optional extra measurement row, not the primary.

### 9. (minor, PRE-EXISTING) Research F2 not locally re-runnable — **VERIFIED** (RECORDED-AS-OBLIGATION)

No new prose, as claimed. Research F2 already directs future snapshots to retain digest + raw `size`/`otool` output. Plan §Measurement items 1–4 require file/section bytes, `nsyms`, package/tarball bytes, and digest + raw `size`/`otool -l` (or `readelf`) with each dated snapshot; Phase 0 is the first such snapshot. Parent research is not under verdict; this does not contradict it.

---

## Diff findings

No MATERIAL defect. Non-blocking notes:

1. **§1c vs Open question 5 (wording drift).** r4 restates 1c as `PROFILE` + **declared** `[profile.production]` recipe. OQ5 still says “compiler-derived recipe stamp” and “from Cargo’s profile facts.” Authority (stamp originates in `build-identity`; ceremony copies; `buildProfile` untouched) is unchanged. Restoration only.

2. **Producer placement vs assembly mode 3 (clarity).** The Producer bullet says the pack-time producer (with dirty/`HEAD` refusal) runs inside every non-`--native-artifact-staging` prepare. Mode 3 says `--source-test-staging` **omits** the sidecar because the contributor binary already embeds the Guide; Darwin source-test admits debug/dirty fixtures. Naive intersection would refuse dirty source-test assemblies. The unique reconstruction is: producer runs in **mode 2** (public-package final assembly); modes 1 and 3 omit. Mode 3 is the more specific rule in the same section.

3. **1d leftover hedge.** After Phase 0’s primary transform was pinned to Cargo `strip = "symbols"`, 1d still says “or Phase 0 records both it and `strip -x`.” Not contradictory (`strip -x` remains optional), just stale.

4. **LLP 0123 “only binary and Hermes.”** 0123’s 2026-08-06 landing text does enumerate binary + Hermes header/runtime at reopen. Live `produceRuntimePackageSeal` also seals admin members. The r4 amendment of 0123’s member set for the Guide sidecar is still the right landing; “only” under-counts admin in **code**, not in 0123’s own prose. Not a plan/research contradiction.

5. **Carriage-selection sentence moved, not dropped.** r3’s pinned-shape “fail closed both ways, no silent fallback” was deleted next to Load validation. OQ2 and the Producer/`cfg` still require in-tree embed vs public-package sidecar, fail closed both ways.

**Research:** the r4 fold does not contradict LLP 0314. F3 already carved `assemble-runtime-package` out as source-repair; 1a/1b match. F4 already required a governed 0061/0041/0284 amendment; adding 0123 is extra, not conflicting. F2’s non-replayability is the recorded obligation above.

---

## Obligations (non-blocking)

- **OBLIGATION:** In Phase 2 §Producer, restore the pack-time producer to **public-package final assembly (mode 2)** — not `--native-artifact-staging`, not `--source-test-staging` — so the dirty/`HEAD` refusal cannot be read as applying to contributor source-test. Correction/restoration of r4 wording, not new closure.

- **OBLIGATION:** Restore Open question 5 to §1c’s restatement: the stamp is `PROFILE` plus the **declared** `[profile.production]` recipe, not compiler-resolved profile knobs.

- **OBLIGATION:** Name the fail-closed enforcement point for 1c’s forbidden override channels (build-script refuse vs assembly refuse vs CI wrapper). Negative tests per class are already required; the point of refusal is an implementation choice, not new product scope.

- **OBLIGATION:** (pre-existing, item 9) First Phase 0 snapshot must land digest + raw `size`/`otool`/`readelf` so F2 becomes locally re-runnable. Already directed by research and plan §Measurement 1–4.

---

`VERDICT 0314.000: READY`
