# Integration 7 round 2 — muse

**Reviewer:** Muse Spark 1.3 Contributor
**Effort:** high
**Date:** 2026-10-13
**Reviewed source:** e759005d33fb816d8aaac0f7339f641d71558f60
**Base:** 63b83fed6640739a215696879f2fef68fd7900fa
**Provenance:** ~/sb4-loop/muse-exec.sh --yolo --model muse-spark-1.3-contributor --reasoning-effort high --prompt-file review-r2-brief.txt. Mutually blind; review only, no coding delegated. Response below verbatim. Qualification remains a separate gate. Raw invocation transcript sha256 fe6d8651ddc59f70518872696d957d8437a1b2fb33bbdd4af767b7f8d9603a00, retained compressed in the integration proof archive.

---

READY — source verdict bound to immutable `e759005d33` only. Tests are separate and still required.

I inspected the frozen objects with `git show`, not the worktree, against both parents and the `016591ac22..e759005d33` repairs. No material source defect found. Full-suite and Mac qualification remain an open final gate and are not counted here.

Material source findings (all pass):

- Shared sink amendment (LLP 3000.002): [json_codec.rs](snapback4/crates/snapback4-core/src/json_codec.rs) `to_sink(&mut dyn Write)` is a pure erasure over `serde_json::to_writer` — canonical bytes unchanged. `to_text_preallocated` keeps exact-capacity overflow (`exceeded`) and underfill (`did not fill`) refusal; `value_bytes` Counter and [branch_merge.rs](snapback4/crates/snapback4-core/src/engine/branch_merge.rs) `HashWriter` now route through it with failure propagation covered by new `sink_tests` (escaped `line\n\"\\é`, off-by-one preflight, `sink refused`).
- Allowlist is exactly one new writer: [attribute-wasm.mjs](snapback4/scripts/attribute-wasm.mjs) `counterFamily` changed from `Counter`-specific to `&mut dyn std::io::Write`; `allowed` still only `Value`/`ObjectFields serialize`; envelope logic and reader refusal unchanged. Pinned by [wasm-families.test.mjs](snapback4/packages/snapback4/test/wasm-families.test.mjs) (`only Value and ObjectFields may add exactly the shared bounded sink`, refuses typed containers/extra readers).
- HAND unknown-flag rejection preserved while allowing DX flags: [cli_flags.rs](snapback4/crates/snapback4/src/cli_flags.rs) keeps shared `validate` before store work, `witness` gains `email/password-env/mutation`, `upgrade` added, unknown flags still `E_INPUT`; new test asserts `--unknown-wave9` errs for both verbs and `--password-env` without value errs.
- Merge resolutions union correctly: PAGE `read.rs` keeps metered dependency pricing plus CUT `20.24.7`; `note_rank.rs` unions `N_NO_PRODUCTION_WRITER`/`N_REFERENCE_UNCHECKED`/`N_MAINTAIN_AUTHORIZATION`; `capabilities.rs` retains `branch-membership-v1`; [releases.rs](snapback4/crates/snapback4/src/verbs/releases.rs) keeps MACFIX `canonical_directory` fence; `deploy.md` keeps REL hot activation/rollback/generation plus DX password/admin/upgrade recipes; delivery boundary regenerated for `witness-web.ts` (`app.mutate` + `onWrite`).
- Budget: measured 2291429/698492, budget file 698992 (measurement + 500, no ceiling change); 698492 < 698992 passes.

Minor: `wasm-budget.json` `why` head still reads Integration 2 (new measurement present later in text); `wasm.jsonl` last row records pre-bump budget 698493 at `016591ac22` — historical, not governing.

Execution evidence still required (not code defects): global full Rust suite green on `e759005d33` itself; Mac ordinary-pool-plus-model suite; remeasured locked Linux wasm on the final `to_sink` source with budget/why reconciled; publication full client suite (targeted 43/43, wasm absence, Lean 68/58/7, native 20k, devices 0–999, Lean20k 3/68/132/27 cited in the round are branch/targeted evidence, not the integrated full suite).

