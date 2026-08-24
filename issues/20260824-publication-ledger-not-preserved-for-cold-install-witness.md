# Publication ledgers are not preserved, blocking post-hoc npm cold-install witnesses

**Status:** Open
**Systems:** Packaging, Verification, Release
**Date:** 2026-08-24
**Related:** LLP 0283 (F-3), LLP 0041, `scripts/snapback-package-cold-install.mjs`,
`.github/workflows/public-package-proof.yml`

## Gap

LLP 0283 F-3 requires the npm closure/cold-install witnesses as part of the
LLP 0276 Phase 4 battery. The canonical witness is
`node scripts/snapback-package-cold-install.mjs --install-source public
--ledger <publication ledger>`, and the eligibility check (mirrored in
`public-package-proof.yml`) requires a `snapback.package-publication.v1` /
`snapback.package-candidate-ledger.v1` ledger with `mode: "publish"`,
`sourceDirty: false`, and the 40-hex publication revision.

The 0.1.25 publication (closure recorded at `52ecabae5`) did not preserve its
`dist-publish/publish-ledger.json` anywhere durable: `dist-publish/` is
gitignored, the `llp-ship/20260823-publication-repair` worktree is gone, and no
`snapback.package-publication.v1` document for 0.1.25 is committed. The public
cold-install witness for the live published closure therefore **cannot run**,
and F-3's npm witness stays open through no fault of the witness tooling.

## Fix directions

1. **Preserve the ledger at publication time.** The publication flow should
   land the publish ledger (or a digest-bound copy) with the closure record —
   e.g. alongside `guide/published-closure.json` or under
   `tests/acceptance/receipts/` — so any later session can drive the public
   cold-install proof. The ledger is already immutable evidence
   (`sourceDirty: false`, pinned revision); committing it matches how other
   publication receipts are retained.
2. **Backfill 0.1.25 if practical.** If the publishing machine still has
   `dist-publish/publish-ledger.json` for 0.1.25, commit it per (1) and run the
   witness. Otherwise the first publication after this ticket lands preserves
   its ledger, and the witness runs against that closure instead.

## Acceptance

- A committed, digest-valid publication ledger exists for the newest published
  closure.
- `node scripts/snapback-package-cold-install.mjs --install-source public
  --ledger <that ledger>` runs (pass or fail on its own merits) without
  requiring artifacts private to the publishing session.
- LLP 0283 F-3's npm cold-install witness row cites the run.
