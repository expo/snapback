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

- `node cloudflare/test/local-suite.mjs` passed all 29 checks without a
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
