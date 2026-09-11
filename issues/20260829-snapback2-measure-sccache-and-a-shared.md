# snapback2: measure sccache and a shared cargo build-dir across lanes

**Status:** Open
**Systems:** snapback2, build loop
**Severity:** P3
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-29
**Related:** LLP 1000, LLP 0316

Eliot's suggestion (relayed 2026-08-29): Mozilla's sccache (RUSTC_WRAPPER=sccache) caches rustc invocations for dependency crates across worktrees on a local disk cache; it does not cache incremental compilation and cannot cache bin/proc-macro/cdylib crates, so it speeds a lane's cold build, not the inner loop, and does not reduce disk. Cargo 1.97 has stable build.build-dir with {workspace-path-hash} for sharing intermediates. Measure both with snapback2/scripts/measure.mjs --cold on two lanes before adopting either; the first fix is the small dependency tree. Sources: https://github.com/mozilla/sccache/blob/main/docs/Rust.md, https://doc.rust-lang.org/cargo/reference/config.html

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — deferred optimization. **Triage priority:** P3.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

No adoption or paired cold-lane comparison is established. Current warm named lanes already avoid fresh-checkout cost; this is a measurement experiment, not a demonstrated product defect.

LLP 1002 §11 and snapback2/scripts/measure.mjs separate cold build, incremental build and consumer costs. Next: compare two warm named lanes with/without the proposed cache, keeping disk and incremental costs separate. Do not add a cache dependency from this ticket alone.
