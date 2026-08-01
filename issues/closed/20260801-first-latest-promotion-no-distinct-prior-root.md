# First terminal-scope `latest` promotion has no distinct prior root — npm already assigned `latest` at first publish

**Status:** Resolved (2026-08-01; author decision: record and move on)
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 5
**Severity:** P1
**Systems:** Packaging, Testing
**Author:** Claude (Fable 5), promotion/5-rebuild lane (SD-6)
**Date:** 2026-08-01
**Related:** LLP 0041, LLP 0115, LLP 0130,
issues/20260731-sd6-scope-migration-and-rebuild.md,
issues/20260801-promote-v3-lease-pin-refuses-v4.md
**Marker:** parity-moves, sd-6, promotion, author-decision

## Registry fact (observed 2026-08-01, read-only `npm view`)

All nine `@expo/snapback-*` packages already carry
`latest: 0.1.7` in addition to the candidate tag
`bakeoff-0-1-7-fdd49db8abf1: 0.1.7`. The publish lane never touched
`latest`; the npm registry assigns `latest` to the first-ever publication of
a package even under a non-default `--tag` — the exact behavior
`scripts/snapback-promotion-core.mjs` `validatePriorDependencyAlias`'s
docstring anticipates. The 2026-08-01 publish record verified the candidate
tag but did not observe `latest`, so this surfaced when the promotion lane
read the prior vector.

Two consequences:

1. **The material goal of the leased promotion already holds.** The default
   vector is `0.1.7` on all nine packages. There is no tag movement left for
   `snapback-promote` to perform for 0.1.7 — only the leased lineage record
   and the promotion-bound proof matrix are missing.
2. **The leased-promotion machinery categorically refuses this degenerate
   (bootstrap) case.** `scripts/snapback-promote.mjs` `loadLatestProofPlan`
   requires a distinct signed prior CLI root and refuses
   `expectedPriorVersion === newVersion` (and `null`) for
   `@expo/snapback-cli`; with the observed prior vector all-`0.1.7`, the
   verbatim preflight refusal is:

   ```
   snapback-promote: latest-root proof preflight refused: latest-root proof has no distinct signed prior CLI root
   ```

   `validateClosedLatestProofPlan` likewise requires a version-shaped
   `expectedPriorRootVersion`, and the promoted-installability barrier and
   `classifyLatestRootObservation` are built around witnessing a
   prior-to-new transition. The refusal fires in preflight, before authority
   acquisition and before any registry mutation. The machinery was designed
   for promotions where a prior `latest` generation exists under the same
   names (true throughout the `@ccheever` lineage); the first promotion
   under a new scope cannot satisfy it.

## Standup prerequisites discovered for any real next promotion (0.1.8+)

Recorded so the first executed promotion does not rediscover them:

- **Committed ledger at a pushed clean HEAD.** `loadLatestProofPlan`
  requires the candidate ledger at a repo-relative path (refuses `../`),
  a clean checkout equal to `plan.expectedHeadSha`, and the
  `public-package-proof.yml` dispatch checks out that pinned ref on GitHub —
  so the candidate ledger must be landed in-repo and pushed to
  `expo/snapback` before promotion. The 0.1.7 ledgers currently live only
  at `~/snapback-release-ledgers/` (committed home still to be decided).
- **HTTPS-only authority origin.** `snapback-promote` accepts only an HTTPS
  authority origin (no loopback-HTTP opt-in, unlike the lease request
  client), and the lease binds the origin at issue time — so a locally run
  authority needs local TLS termination for the whole flow, trusted via
  `NODE_EXTRA_CA_CERTS`, or the authority must be genuinely HTTPS-hosted.

## Author decision needed

How the first terminal-scope default vector gets its lineage and proof:

- (i) accept `latest: 0.1.7` as promoted-by-first-publish, record that as an
  explicit non-leased lineage entry (LLP 0041 amendment defining the
  bootstrap case), and give slice 5-rebuild (LLP 0115 CV-1 exit) a
  standalone dispatch path for the public-package-proof matrix against the
  committed 0.1.7 ledger, decoupled from a promotion; or
- (ii) extend the leased-promotion machinery with an explicit bootstrap path
  (prior == new tolerated as a no-op mutation with its own witness shape);
  or
- (iii) defer both to the first real version bump (0.1.8), whose promotion
  has a genuine distinct prior root, and let CV-1's external rebuild bind
  that first-executed promotion.

Until decided, the leased promotion for 0.1.7 cannot execute, and
`issues/20260801-promote-v3-lease-pin-refuses-v4.md` blocks any promotion at
all.

## Note (2026-08-01, fast-path lane)

0.1.8 was published OUTSIDE the leased ceremony under Charlie's same-day
fast-path decision (LLP 0041 §Fast-path pre-consumer release (2026-08-01)):
all nine packages staged dry-run from clean main `5d5c6b71` and
npm-published directly to `latest` (now `latest: 0.1.8` on all nine). This
ticket stays OPEN as the bootstrap-lineage author decision for the ceremony
machinery; note the fast-path publication also means the next leased
promotion (0.1.9+) WILL have a distinct prior root (0.1.8), so option (iii)
resolves itself naturally once the v3-pin ticket is fixed.

## Resolution (2026-08-01) — RESOLVED by author decision: record and move on

Author decision (Charlie, 2026-08-01): none of options (i)/(ii) — **no
bootstrap path is built**. The registry fact (npm auto-assigns `latest` on
a package's first-ever publish, even under a non-default `--tag`) is
recorded as dated lineage in LLP 0041 §First-publication `latest`
bootstrap lineage (2026-08-01), beside the fast-path section. The
2026-08-01 fast-path publication of 0.1.8 already means every future
leased promotion under the current nine names has a genuine distinct
prior root, so the machinery's distinct-prior-root preflight refusal
stands unmodified as designed. The degenerate case can recur only when a
future brand-new package name joins the closure; the bootstrap path gets
designed at that point, against that publication's facts.

The standup prerequisites recorded above (committed ledger at a pushed
clean HEAD; HTTPS-only authority origin) remain live guidance for the
first executed leased promotion, and
`issues/20260801-promote-v3-lease-pin-refuses-v4.md` still gates any
promotion at all — both unaffected by this closure.
