# Package-owned comparator acceptance kit

**Status:** Resolved (2026-07-30)
**Impact:** 4  
**Urgency:** 3  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P2  
**Systems:** Acceptance testing, Client integration, Realtime, Ephemeral state, Packaging  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0010, LLP 0012, LLP 0013, LLP 0034; `demos/_kit/harness.mjs`

Snapback has strong internal harness and provider-live conformance evidence,
but ordinary apps cannot invoke one published profile for the five properties
backend comparisons routinely need. Signal Desk copied a repository-private
six-check suite instead of declaring its generated refs and domain assertions
to a package-owned helper.

## Desired resolution

- Publish a comparator profile and command, tentatively
  `snapback accept comparator`.
- Accept generated query/mutation/presence refs plus bounded fixture callbacks
  for domain-specific before/after assertions.
- Own isolated database/server lifecycle, app provisioning, two client
  identities, native live transport, timeouts, cleanup, receipt writing, and
  capability-GAP classification.
- Require named checks for cross-client native live delivery, atomic declared
  write set, rejected mutation rollback/no visible version change, TTL plus
  disconnect presence cleanup, and ephemeral publish not advancing the durable
  version.
- Retain expected-check/non-vacuity enforcement, transport attribution,
  cleanup attestation, stable exit codes, and machine-readable receipts.

## Acceptance

- Green packaged fixture and deliberate failure fixtures exist for every named
  property, missing capability, zero/short execution, dead server, timeout,
  cleanup rejection, polling masquerading as push, and stale receipts.
- Receipt schema is Rust-owned or otherwise governed per LLP 0037 and validates
  exact target/artifact/binary identity, checks, timings, cleanup, and
  nonclaims.
- Signal Desk's Snapback acceptance becomes a thin configuration of the kit and
  keeps its six claims.
- One documented command works from a packed/public installation without
  repository-relative imports.

## Implementation checkpoint — 2026-07-28

The package-owned `snapback accept comparator` profile now owns the isolated
server/database lifecycle, generated-reference admission, two-client native
live proof, rollback and durable-version observations, presence cleanup,
ephemeral/durable separation, cleanup attestation, receipt writing, and stable
diagnostics. Its package suite retains a green fixture plus deliberate
failures for incomplete execution, missing capability, dead server, timeout,
cleanup rejection, polling attribution, stale identity, and each named
property.

Signal Desk is a thin `snapback-comparator.config.mjs` configuration and keeps
its six domain claims without importing the repository-private harness. The
earlier staged-package cold-install receipt at
`demos/signal-desk/acceptance/cold-install-react.v1.json` proved the CLI
closure installed without sibling-source resolution, but did not execute the
installed comparator's default local-target path. When that stronger
revalidation was added, the packaged dev-mode green fixture failed before any
check because the runner tried the session provider unconditionally.

The runner now reads the process-scoped `/auth/session` handshake and selects
the existing auth-mode-specific client mechanism: body-carried asserted users
for `dev`, provider-minted bearers for `sessions`. The package suite executes
the default managed lifecycle against the deliberately dev-mode packaged
fixture and requires all five checks, target/binary identity, and cleanup to
pass. Verified from source with:

- `SNAPBACK_RUNTIME_BINARY=packages/snapback-runtime-darwin-arm64/bin/snapback node packages/snapback-cli/comparator-profile.test.mjs`
- `node packages/snapback-cli/cli.mjs accept comparator --config packages/snapback-cli/fixtures/comparator/green.config.mjs --receipt /tmp/snapback-comparator-dev-after.json --timeout-ms 15000 --json`

This source-tree verification is not a replacement for the installed-package
cold proof. Close this ticket again only after the release lane reruns the
staged/public-style cold install and retains its refreshed receipt.

## Resolution — 2026-07-30

The public `0.1.1` package proof reran the comparator through the installed
CLI on independently provisioned Darwin/arm64 and Linux/x64 hosts:

- `demos/partiful-matrix/acceptance/evidence/step5-package-public-darwin-arm64.json`
  and `step5-package-public-linux-x64.json` both report
  `packagedComparatorProfile: true` against registry-downloaded package bytes.
- Each retained `comparatorReceipt` passes all five named properties:
  cross-client native live delivery, atomic declared writes, rejected-mutation
  rollback without a durable-version advance, TTL plus disconnect presence
  cleanup, and ephemeral/durable version separation.
- The receipts bind the exact target, artifact, and runtime binary identities;
  cleanup is managed and successful, with the leader exited and temporary
  state removed.
- The public publication ledger
  `demos/partiful-matrix/acceptance/evidence/step5-package-publication.json`
  binds the same nine-package `0.1.1` closure to both platform receipts.

This is the installed-package revalidation the reopening required. Signal
Desk remains a thin package-owned comparator configuration, and the public
proof no longer relies on repository-private imports or a source-tree-only
client path.
