# Make a verified prebuilt binary the kit's paved boot path

**Status:** Resolved (2026-07-25)
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

## Resolution (2026-07-25)

Implemented the LLP 0030 ladder in `startServer`'s command resolution
(`demos/_kit/server-process.mjs`, `resolveLaunchPlans` +
`launchServerAttempt`):

1. **Caller-configured** — new documented `serverBinary` option (or
   `SNAPBACK_SERVER_BINARY` env var); a missing path is a hard, named error.
   The binary boots even when its `/health` stamp drifts from the checkout —
   the drift is reported loudly and carried as
   `handle.identity.verdict === 'stamp-mismatch'` — which is the deliverable
   win: a broken/drifted checkout HEAD with a known-good binary still boots,
   honestly labeled.
2. **Verified prebuilt** — an existing `<cwd>/target/debug/snapback` is booted
   automatically only when the checkout is pinned (known commit, clean tree)
   AND the spawned binary's stamp fully verifies (`verified`); any weaker
   verdict tears the child down and falls back with a
   `PREBUILT SNAPBACK REJECTED …` diagnostic. This is where the companion
   injection fix pays off: the stamp actually carries information. A dirty
   checkout skips the rung (only a rebuild can contain local edits); a missing
   binary falls through silently to rung 3 (`handle.launch.rung` records which
   rung won).
3. **`cargo run`** — the source-tree fallback. `deps.launchSpec` was re-scoped
   to a test-only seam that substitutes this rung's command; the one real
   caller (`demos/partiful-matrix/tests/acceptance/providers.mjs`) migrated to
   `serverBinary`.

No download/publishing infrastructure was built — distribution stays future
work under LLP 0041, and the LLP 0030 amendment says so explicitly.

Docs: `demos/_kit/README.md` §"Server launch: the LLP 0030 command-resolver
ladder"; LLP 0030 §Server process ownership amendment (implemented form).

Lifecycle tests (`demos/_kit/tests/server-process-lifecycle.mjs`, POSIX
ladder block): prebuilt rung boots without the cargo rung (spy asserts it was
never invoked); a drifted prebuilt binary falls back to cargo; a dirty
checkout skips the rung; a configured binary boots on drift with the honest
verdict; a missing configured binary errors by name; missing-prebuilt default
lands on the cargo rung. `demos/_kit/tests/binary-provenance-drift.mjs`
additionally boots the real built binary through the configured rung without
any cargo compile in the loop.
