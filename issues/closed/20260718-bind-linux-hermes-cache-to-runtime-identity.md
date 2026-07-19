# Bind the Linux Hermes cache to the complete runtime identity

**Status:** Closed
**Severity:** P1
**Systems:** CI, Build, Native runtime, Security
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-18
**Closed:** 2026-07-18
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

## Resolution

The local-proof workflow hashes the authoritative Hermes pin, patch-application
and Linux-build scripts, the complete carried patch stack, and the Cargo input.
It has no broad restore prefix, so a changed runtime identity cannot restore an
older engine artifact.

Snapback commit `a5ed6ebd05766b10607937a1c010352d79eea4b0` passed GitHub Actions
local-proof run `29674515103` with that exact-identity policy on 2026-07-18.
The companion cold-clone run `29674515105` also passed from the same commit.
