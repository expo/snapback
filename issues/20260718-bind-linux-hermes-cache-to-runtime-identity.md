# Bind the Linux Hermes cache to the complete runtime identity

**Status:** In Progress
**Severity:** P1
**Systems:** CI, Build, Native runtime, Security
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** LLP 0013 §Upstream tracking and re-derivation; `.github/workflows/local-proof.yml`
**Marker:** ci, cache, hermes, linux, supply-chain

The canonical Linux proof cached the built Hermes source tree, installation,
and repository artifacts under a key derived only from
`build-hermes-linux.sh` and `vendor/ibex/Cargo.toml`. The key omitted the
authoritative upstream commit in `hermes-version.sh`, the patch-application
logic, and the complete carried `patches/hermes/*.patch` fork. An exact-key
miss also used the broad `${runner.os}-hermes-` restore prefix, allowing an
older cache entry to repopulate all three paths after the runtime identity
changed.

That can make CI exercise stale native code while reporting success for the
current commit. It is especially unsafe for security-sensitive Hermes changes,
because the JavaScript/Rust sources under review can disagree with the cached
engine that actually executes the proof.

**Done when:**

- The cache key covers `hermes-version.sh`, `apply-hermes-patches.sh`,
  `build-hermes-linux.sh`, and every carried `patches/hermes/*.patch` file.
- Adding, removing, or changing a carried patch invalidates the cache.
- CI cannot fall back to a cache built for a different Hermes identity.
- The remote canonical Linux local-proof workflow completes successfully with
  the exact-identity cache policy.

## Implemented; remote verification pending

The local-proof workflow now hashes the authoritative pin, patch application
and Linux build scripts, the complete carried patch stack, and the existing
Cargo input into its Hermes cache key. The broad restore prefix has been
removed, so a changed identity must download or rebuild the matching runtime
instead of reviving an older artifact.

Keep this ticket open until a replacement `main` run completes the canonical
Linux proof with the exact-identity cache policy.
