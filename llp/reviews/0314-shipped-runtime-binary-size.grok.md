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
