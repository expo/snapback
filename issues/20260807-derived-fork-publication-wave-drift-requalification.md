# Requalify derived-fork publication after wave drift

**Status:** Open
**Opened:** 2026-08-07
**Owner:** Charlie Cheever
**Systems:** Instance forks, capability publication, LLP governance
**Related:** LLP 0158, LLP 0162, LLP 0185,
`issues/closed/20260806-derived-fork-publication-author-gate.md`

## Problem

Publication landing `7cada777b` validly bound qualification C `ad0ad5874` and
implementation digest
`sha256:fc6e3e58453b4700ce06c647aaef87132879e0da336e560eca834d1d42c5459a`.
The later wave integration changes nine covered proof/checker/metrology files.
The combined-tree oracle therefore refuses with publication digest
`sha256:5e6ed9beda2067a7da8dbb6a3a133f91f532bb4323fd6b24805be18d0a74e9ab`.

The changed leaves are not a fork runtime correctness regression. They are
still deliberately covered by the v2 digest, so this ticket must not exclude
them, weaken the custody rule, rewrite old review histories, or treat old
platform measurements as evidence for new bytes.

## Current posture

- The source anchor is `withheld` and the capability-index target is `none`.
- Historical receipt, carrier, platform measurements, review histories, and
  named-author acceptance remain retained but make no current claim.
- `agent_safe_derived_deployment_fork_v1` remains wholly `Missing` in every
  target manifest.
- No fork runtime code was changed as part of the withdrawal.

## Exit

1. Select a fresh qualification C containing the wave changes.
2. Produce fresh canonical release-profile lifecycle evidence on exactly
   `macos/aarch64` and `linux/x86_64`.
3. Obtain fresh independent review heads naming that exact C and digest.
4. Obtain named-author acceptance binding the new platform evidence, review
   heads, implementation digest, candidate facts, and component scope.
5. Rebuild the dated receipt/carrier/anchor chain atomically and move the
   capability-index row to `local` only after
   `node scripts/check-agent-safe-publication.mjs` reports the derived-fork
   record `published` on a clean tree.
