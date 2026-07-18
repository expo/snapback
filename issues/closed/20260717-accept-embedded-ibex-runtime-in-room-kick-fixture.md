# Accept the embedded Ibex runtime in the protected-room kick fixture

**Status:** Closed
**Severity:** P2
**Systems:** Tests, Ibex, Auth, Ephemeral rooms
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0053; `src/local/auth_room_kick_acceptance.rs`
**Marker:** acceptance, capability, embedded-runtime, portability

The protected-room membership-kick acceptance fixture required every function
load diagnostic to be `SNAPBACK_IBEX_FUNCTIONS_LOADED`. A supported checkout
without the optional Ibex CLI also emits the informational
`SNAPBACK_IBEX_CLI_UNAVAILABLE` capability diagnostic while executing the same
handlers through the vendored embedded runtime. The fixture therefore failed
all five room-kick cases even though no error or fatal diagnostic was present.

The fixture should accept the same closed pair of successful informational
codes already used by the neighboring authorization acceptance fixtures. It
must continue to reject any other diagnostic so a real function-load failure
cannot be hidden.

**Done when:**

- The room-kick fixture accepts both supported function-load information codes.
- Any warning, error, fatal, or unknown information code still fails setup.
- All five protected-room membership-kick acceptance tests pass without an
  optional Ibex CLI binary.
- The canonical local proof passes.

## Resolution

The setup assertion now admits only `SNAPBACK_IBEX_FUNCTIONS_LOADED` and the
supported embedded-runtime capability notice `SNAPBACK_IBEX_CLI_UNAVAILABLE`,
matching the neighboring authorization fixtures without broad severity-based
filtering. All five protected-room kick cases passed through the embedded
runtime as part of the 1,102-test Rust library suite.
