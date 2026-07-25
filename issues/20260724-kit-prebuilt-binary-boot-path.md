# Make a verified prebuilt binary the kit's paved boot path

**Status:** Open
**Severity:** P2
**Systems:** Local server lifecycle, Testing, Packaging
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** LLP 0030 §Server process ownership, LLP 0041 §Runtime distribution, expo-jam-allaboard issues/0003
**Marker:** all-aboard-external-review

`demos/_kit/server-process.mjs` boots the engine with `cargo run` against
the live checkout (`server-process.mjs:195-197`), so any moment the
checkout's HEAD does not compile takes every consumer down with it. The
All Aboard matrix external review (Kimi, 2026-07-24) hit exactly this
(expo-jam-allaboard `issues/0003`), and every non-JS arm independently
rebuilt the same workaround: launching `target/debug/snapback` through
the `deps.launchSpec` escape seam (one real caller today:
`demos/partiful-matrix/tests/acceptance/providers.mjs:26`). The reviewer's
verdict: the workaround should be the paved path.

The design already exists in the corpus — LLP 0030's command-resolver
ladder (configured binary → installed/packaged binary → `cargo run` only
for source-tree development) — but it was scoped to the Vite plugin, and
LLP 0041's prebuilt runtime packages are scoped to external app authors.
A 2026-07-24 amendment to LLP 0030 declares the ladder applies to the
kit's shared server lifecycle too; this ticket is the implementation.
The sibling Exact project's checksum-verified per-commit artifact cache
(`~/Library/Caches/exact/hosts/`, ENG-23311) is proven precedent for the
verified-binary rung.

**Done when:**

- `startServer` resolves its launch command by the LLP 0030 ladder:
  caller-configured binary/command first, then a verified prebuilt or
  cached binary when available, with `cargo run` as the source-tree
  fallback rather than the default and only path.
- The verified-binary rung checks provenance for real (see
  `20260724-kit-identity-stamp-env-injection-tautology.md` — the two
  fixes compose: a prebuilt binary is exactly the case where the
  build-time stamp is meaningful).
- `demos/_kit/README.md` documents the ladder and the `launchSpec` seam.
- A kit lifecycle test exercises the prebuilt rung (a stale/broken
  checkout with a good binary boots; a missing binary falls back with a
  clear diagnostic).
