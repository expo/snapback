# Integration 7 round 1 — muse

**Reviewer:** Muse Spark 1.3 Contributor
**Effort:** high
**Date:** 2026-10-13
**Reviewed source:** 016591ac229b0e790dfe4e565a60da84ad8de821
**Base:** 63b83fed6640739a215696879f2fef68fd7900fa
**Provenance:** ~/sb4-loop/muse-exec.sh --yolo --model muse-spark-1.3-contributor --reasoning-effort high --prompt-file review-brief.txt. Mutually blind; no coding delegated. Response below verbatim. Raw invocation transcript retained compressed in the integration proof archive; sha256 d8bbbde5ee70de8959353a69afae65657d864802090aa9c82543171cdb3a6006.

---

NOT READY — bound to immutable `016591ac22` (base `63b83fed66`, DX `094c00a205`, PAGE `b46e23757a`, MACFIX `016591ac22`).

Material finding 1 — no integration qualification on the integrated source. PAGE `verification.json` qualifies branch source `f6025c0c91`/`ee0e339c80` (Rust 4672 pass, native 20k zero disagreements, Lean 230 retained-family disagreements, wasm 690290 vs 690790, census 409/89). DX qualifies `282a676c79`/`6e0cbbb088` (373 Rust, 11 browser/Expo/upgrade, 22 README/API). MACFIX journal at [snapback4/JOURNAL.md](/home/ccheever/projects/snapback-sb4loop/snapback4/JOURNAL.md) states “Whole-publication qualification remains separate” and “No full scripts/test.sh”. The only pool run cited is 367/372 pass with 5 failures, then 167/167 targeted reruns; per instruction targeted reruns are not a green full suite. No `scripts/test.sh` or full client suite evidence exists on `016591ac22`.

Merge resolutions inspected and preserved, not verdict-blocking:

- HAND rejection intact: [cli_flags.rs](snapback4/crates/snapback4/src/cli_flags.rs) unknown-flag branches unchanged; DX only extends `witness` allowlist with `email password-env mutation` and adds empty-allowlist `upgrade`.
- Mutation envelopes: `mutation_reply` in `serve.rs:661` applied on all four paths (`serve.rs:1140,1356`, `serve_ephemeral.rs:106,281`); `generation`/`preserved`/`store_id`/`head` stamping retained (`serve.rs:691-722`). `wire.md` correctly documents omitted-id vs `result.id`.
- PAGE: `branch-membership-v1` in `capabilities.rs:90`, metered dependency pricing in `read.rs:metered_dependency_table`, expiring-source checks retained, `N_MAINTAIN_AUTHORIZATION`/`N_READ_DENIED→null` in `codes.rs`/`note_rank.rs:compact`, wasm ratchet `690790 = 690290 + 500` with full ledger in budget `why`.
- MACFIX: `canonical_directory` in `releases.rs`, version-gate `releaseStoreRefusal`, `doctor` without `--store`, WAL/SHM filtering — targeted logic reads correctly.

Minor: `E_UPGRADE` code string capitalizes “Repair” mid-sentence unlike sibling codes.

