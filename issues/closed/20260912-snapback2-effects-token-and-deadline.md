# snapback2 effects hardening: host token RNG + sourceless evals run deadline-free

**Status:** Resolved
**Priority:** P2 (defense in depth)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** effects Ibex `host_channel_token` (`RandomState`/`SipHash`); pre-source evals (`stdlib`/`prelude`/`harden`/`verify`)

## What was reported

- The host-channel token (sole host gate; closure-held — the
  cannot-resolve-closure test passes) uses `RandomState`/SipHash instead of
  an OS RNG. Weaker than it should be for the one gate that matters.
- Pre-source evals (stdlib/prelude/harden/verify) run without a deadline —
  trusted-JS-only today, and source install already sets a deadline — but
  there is no defense-in-depth bound if that trust assumption ever slips.

## Suggested fix

- Mint the host-channel token from the OS RNG (`getrandom`).
- Add a deadline to pre-source evals matching the source-install pattern.

## Acceptance

- Token source is OS randomness; all eval entry points carry a deadline;
  existing Ibex tests pass.

## Resolution (2026-09-12)

The host gate now receives 256 bits from `getrandom::fill`; RNG failure refuses runtime construction. The existing job deadline is armed before trusted setup as well as source installation, and expired setup returns the retryable timeout. Regression witnesses cover expired setup, token shape/independence, host closure isolation and every existing effect behavior.

Validation: `CARGO_BUILD_JOBS=4 scripts/hermes test -p snapback2-effects -- --test-threads=1` — 81 passed, 8.18s, using prepared vanilla Hermes artifacts. No Hermes source rebuild.
