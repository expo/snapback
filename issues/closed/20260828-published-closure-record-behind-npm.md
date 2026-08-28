# `guide/published-closure.json` records 0.1.27 while 0.1.29 is published on npm

**Status:** Closed
**Opened:** 2026-08-28
**Closed:** 2026-08-28
**Systems:** Guide, Packaging, Publication
**Related:** LLP 0061 (guide conventions), LLP 0041 (publication posture), LLP 0317

## The drift

`guide/published-closure.json` carries `"newestPublished": "0.1.27"`.

Snapback **0.1.29 is published**: the 2026-08-27 Clique matrix ran eight lanes
against published `@expo/snapback-cli@0.1.29` and
`@expo/snapback-runtime-linux-x64@0.1.29`, and this session pulled
`@expo/snapback-codegen@0.1.29` from the npm registry directly to verify two
declared types.

So the record is at least two closures behind reality.

## Why it matters

`guide/conventions.md` makes `newestPublished` load-bearing for the
availability fence: an unreleased section marker must be followed by a banner
naming **the literal newest published version**, a released marker may not name
a version newer than `newestPublished`, and a `maturity: shipped` page claiming
a surface absent from the newest published closure without a fence is a check
**failure**.

With the record two versions stale, every one of those rules is being evaluated
against the wrong baseline. Concretely, a surface that shipped in 0.1.28 or
0.1.29 must currently be fenced as "unreleased" and must name 0.1.27 in its
banner, which is false to a reader who can `npm install` it today. This ticket
was filed while landing exactly such a banner in
`guide/backend/schema-evolution.md`.

## Why this was not fixed here

`guide/conventions.md` says the npm promotion lane updates
`published-closure.json` **in the same change that publishes a new closure**.
Bumping it by hand outside that lane would retroactively change the fence
evaluation for every page in the corpus, which is a publication-lane decision
with a blast radius, not a papercut fix.

## What to resolve

1. Establish why the promotion lane did not update the record for 0.1.28/0.1.29
   — whether those closures went out through a path that bypasses it.
2. Bump the record through the proper lane, and re-evaluate every existing
   `unreleased` fence against the corrected baseline; several are probably now
   stale and must be removed or re-pinned per the convention.
3. Consider a check that fails when the recorded closure is behind the newest
   published package on npm, so this cannot drift silently again.

## Resolution (2026-08-28)

1. **Why the record lagged.** `scripts/snapback-fastpath-release.mjs` never
   writes `guide/published-closure.json`; the update protocol is a post-publish
   git commit (the 0.1.27 shape). 0.1.28 (`2026-08-27T13:43Z`) and 0.1.29
   (`2026-08-27T17:05Z`) both reached npm `latest` with **no**
   `fastpath-0-1-2X-*` holding tag. The isolated-worktree ceremony was not a
   buildable tree
   (`issues/20260827-fastpath-release-isolate-not-buildable.md`), and LLP 0041
   already records that 0.1.28 shipped the final runtime packages without
   packaged-store qualification receipts. Those closures went out through a
   path that bypasses the holding-tag ceremony, and nobody landed the
   follow-up record commit.

2. **Catch-up.** `newestPublished` / `publishedAt` advance to 0.1.29 /
   2026-08-27. `newestQualified`, `closureId`, `qualifiedSourceRevision`, and
   `ledgerSha256` stay the 0.1.27 ceremony identity. Stale 0.1.28 unreleased
   fences on `guide/auth/passwords.md` and `guide/auth/scoped-roles.md` are
   released (`authPasswordSet` is in the published 0.1.28/0.1.29 client). The
   0.1.30 password-policy successor refusal banner now names 0.1.29.

3. **Prevention.** `scripts/check-published-closure-registry.mjs` fails closed
   when `newestPublished` is not every identity-preset package's registry
   `latest`. Mocked fixtures run in `guide-published-closure-fixtures`; the
   live canary is complete-battery only (`published-closure-registry-canary`).
