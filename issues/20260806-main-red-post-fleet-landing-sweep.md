# Main-red follow-ups after the Fleet landing sweep

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Fleet Observatory, App CLI, Authentication, Packaging, Testing
**Date:** 2026-08-06
**Related:** `llp/0184-fleet-observatory.plan.md`,
`issues/20260806-commands-profile-blocks-all-metrology-writers.md`,
`issues/closed/20260806-client-bundle-metrology-red-on-main.md`

## Summary

A keep-going local-proof sweep at baseline `83f7a7119` repaired the mechanical
Rust, demo-materialization, and carrier-publication drift. The sweep also
rebuilt and readiness-qualified `target/debug/snapback` before rechecking the
dependent acceptance gates. Two failures remain owner-sensitive and should
not be repaired by changing their assertions opportunistically.

## Open owner actions

### Fleet Observatory Move-1 qualification and receipt

`node tests/acceptance/fleet-observatory-move1-v1.mjs --check
--require-qualified` rejects the retained PASS receipt because
`controlledRun.runtime.serverBinarySha256` is not the SHA-256 of the freshly
built server. The exact binding is enforced at
`tests/acceptance/fleet-observatory-move1-v1.mjs:979`; the retained artifact is
`tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json`.

**Owner:** Fleet Observatory Move-1 lane. Re-run the controlled qualification
against the intended landed commit and its exact readiness-qualified server,
then issue the receipt and associated evidence together. Do not relax the
binary binding or rotate this receipt from the general main-red sweep.

**2026-08-06 release-attempt-6 recurrence.** The complete 0.1.11 release
proof at clean `origin/main` `1250b7a6a8e918bb3ca3fe3b2f50da45aec5e9f8`
stopped at this gate after 26 PASS. The retained receipt now fails before the
runtime check: it binds `packages/snapback-client/index.mjs` to SHA-256
`40f0d7a4ac9b7e2010c7f309f8ba95fa84e42f20445bc1b7b83cd4d0d7662e39`,
while the candidate's tracked file is
`688ec4d231dd23e02ea0311d91ec0da89c6659074d0274e282b82e194187c0ae`.
The final carrier-refresh commit repaired the three publication carriers but
did not and should not rewrite this independent Fleet controlled-run receipt.
The owner action above remains exact: issue the Fleet receipt and its evidence
against one final tracked source tree and its readiness-qualified binary.

### App CLI served journey dev-principal contract

`node tests/acceptance/app-cli-served-journey.mjs` reaches the real server but
fails `sessionsTargetRefusesDevAssertion`. The journey expects
`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` at
`tests/acceptance/app-cli-served-journey.mjs:299`, while the request is refused
earlier with `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` because the DEV arm in
`packages/snapback-app-cli/auth.mjs:459` constructs `SnapbackAppDataClient`
without declaring the now-required auth-client protocol.

**Owner:** App CLI/auth-client integration lane. Decide whether the DEV arm
must declare a protocol while preserving the intended legacy-body-auth
negative test, or whether the served-journey contract should now expect the
earlier profile-client refusal. Both are plausible policy choices, so this
sweep does not guess.

### Metrology E2 ticket reconciliation

The still-open E2/metrology pointer is
`issues/20260806-commands-profile-blocks-all-metrology-writers.md`. Its named
writer blocker has been fixed, and the follow-on disposition ticket now lives
at `issues/closed/20260806-client-bundle-metrology-red-on-main.md`; the open
ticket explicitly remains pending the final gate/owner reconciliation.

**Owner:** Packaging/metrology E2 lane. Re-run the current check at the chosen
carrier and either record any genuinely current blocker or close the stale
umbrella. Do not track the already-landed governed rollover as still missing.

## Gates cleared during this sweep (not open actions)

- `node targets/cloudflare/test/local-suite.mjs` passed all 29 checks without a
  Cloudflare change. Its earlier failure was not reproducible after the Rust
  build was repaired; there is no remaining Cloudflare owner action here.
- `SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback npm --prefix
  packages/snapback-cli test` passed in isolation against the rebuilt binary.
  One concurrent qualification run timed out in the Expo dev-loop successor
  authority query, but the complete isolated rerun passed, so this is treated
  as a timing/staleness cascade rather than an owned main-red defect.
- The carrier receipt now records Fleet as an honest qualification-pending GAP
  while retaining 16 independently proven PASS applications. Fleet's fresh
  receipt remains the first open action above; the carrier check itself is
  green.

## Re-scope under LLP 0189 (2026-08-07)

The Fleet Observatory Move-1 receipt above is exactly the failure mode LLP
0189 D-3/D-4 rule out: it already rotated once because unrelated
`packages/snapback-client/index.mjs` bytes changed, and "issue the receipt
against one final tracked source tree" re-creates the HEAD-chasing loop. The
owner action is re-scoped: bind the controlled-run receipt to its
claim-relevant surface only (the controlled-run runtime plus the checkers
defining the Move-1 claim's semantics); departing wave-shared/pinned source
files leave the binding only in the same change that lands (or names) their
qualifying frozen-record drift gate; then re-issue the receipt once. Future
unrelated landings must not rotate it. "One final tracked source tree" and
"the intended landed commit and its exact readiness-qualified server" are
superseded by this form; the binary/readiness binding itself is unchanged.
