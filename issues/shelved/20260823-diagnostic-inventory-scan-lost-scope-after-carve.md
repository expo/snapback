# The diagnostic-inventory drift test itself drifted: 105 of 149 exclusions are stale

Status: Open — supersedes the single-exclusion framing; not a one-line fix
Created: 2026-08-23
Related: issues/shelved/20260821-elevated-read-trace-stale-exclusion.md (narrower framing),
issues/shelved/20260821-server-suite-six-pre-existing-failures.md,
issues/shelved/20260822-diagnostic-http-status-registry-gaps.md, LLP 0225, LLP 0276

## Why this was investigated

`s5_d10_production_diagnostic_inventory_cannot_drift` is the only failing test on `main` and
has been treated all week as a known pre-existing baseline. With the fence lanes landed it was
worth actually diagnosing rather than continuing to excuse.

## The finding, which is larger than the symptom

The obvious fix — delete the stale `SNAPBACK_ELEVATED_READ_TRACE` exclusion — **is wrong**. That
literal is not obsolete: the production trace is still emitted
(`crates/snapback-runtime/src/elevated_read_trace.rs:69`, called from
`crates/snapback-engine/src/runtime/host_glue.rs:2709`). Only the *scanner* lost sight of it.

`production_snapback_literals()` walks from `CARGO_MANIFEST_DIR/src`, which after the crate carve
is just `crates/snapback-server/src`. The `server-owner` feature is on by default, so the
conditional second walk never runs — and even with it off, `../snapback-server/src` resolves back
to the same directory.

**The consequence: 105 of the 149 exclusions are stale.** The panic simply stops at the second
one. Deleting the named entry would expose `SNAPBACK_HANDLER_ERROR_EXPOSURE`, then many more.

**The governance consequence is the real one:** the narrowed scan lets lower-crate diagnostics
evade HTTP-status review entirely. A test whose entire purpose is preventing diagnostic inventory
drift now covers roughly a quarter of the surface it was written to cover — and it reports green
on that quarter. This is the same defect class the fence program has been removing all week: a
control that looks like enforcement while checking a correlated subset.

## Provenance

Two moves, both faithful to the architecture as executed:

1. `39a97e8c3` renamed `crates/snapback/src/elevated_read_trace.rs` into `snapback-runtime`,
   removing the literal from the then-monolithic scan root.
2. `c5633d707` carved `snapback-server` and switched the scan to `CARGO_MANIFEST_DIR`, narrowing
   the inventory to one crate and leaving the ineffective `server-owner` fallback.

LLP 0276 states diagnostics move with their owning modules across the carve. The test's scope did
not move with them.

## The fix, honestly scoped

Widen the roots to the canonical Rust inventory already used by
`scripts/generate-diagnostics-registry.mjs:60` (which fails closed when a carved crate is
omitted), rather than hard-coding another partial root. Then:

- add **9** clearly non-HTTP exclusions that widening exposes (bench, dev-identity,
  test-support, visibility-governance env);
- review **91** diagnostic literals — 82 lower-crate plus 9 already latent in the server set,
  including several from the capsule work — as HTTP-classified or explicitly non-HTTP.

**Bulk-assigning the 91 to 500 would not constitute review.** That is the trap here: it would turn
the test green while destroying the property it exists to enforce.

## Urgency

**No production consequence.** The test panics; no HTTP response or trace behaviour changes. The
separate 500 fall-through consequences documented in the diagnostic-status ticket are real but
independent of this literal. So this is fix-forward governance work, not an incident — but it
should not be closed by deleting a row.
## 4. Other stale exclusions

Yes. An AST-aware audit found:

- 149 total exclusions.
- 44 visible to the current server-only scan.
- **105 absent**, including `SNAPBACK_ELEVATED_READ_TRACE`.
- All 149 have a live occurrence somewhere in the complete carved Rust roots.

The other 104 are already stale under the same narrowed-scope mechanism; they are not merely “about to be.” Grouped by one current owning crate:

- `snapback-runtime` (7): `SNAPBACK_ELEVATED_READ_TRACE`, `SNAPBACK_HANDLER_BACKEND`, `SNAPBACK_INVOKE_TOKEN`, `SNAPBACK_HOST_TOKEN`, `SNAPBACK_RESPONSE_TOKEN`, `SNAPBACK_INVOCATION_JSON__`, `SNAPBACK_V8_WALL_CLOCK_TIMEOUT_MS`
- `snapback-engine` (31): `SNAPBACK_HANDLER_ERROR_EXPOSURE`, `SNAPBACK_LIVE_OVERLOAD_DEGRADE`, `SNAPBACK_LIVE_EVAL_MEMO_DISABLED`, the seven `SNAPBACK_AUTH_ACCEPTANCE_*` receipts/replay markers, `SNAPBACK_HANDLER_CONSOLE`, `SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN`, `SNAPBACK_IBEX`, `SNAPBACK_OUTBOUND_ACTIONS`, both packaged-store receipt/mode names, `SNAPBACK_RESUME_GENERATION_UNAVAILABLE`, twelve engine-visible `SNAPBACK_RESUME_*` codes, and `SNAPBACK_SESSIONS_SCHEMA_VERSION`
- `snapback-cli` (42): `SNAPBACK_LIVE_MAX_EVAL_TURN_MS`, `SNAPBACK_NETWORK_PROFILE`, all current ready/wait/restart/config/auth-carrier CLI entries, `SNAPBACK_PASSWORD`, the CLI-only admin-link markers, hosted-journey marker, the three packaged-store qualification results, and `SNAPBACK_SCHEMA_VERSION`
- `snapback-sync` (10): both spike-trace names plus eight resume token/key/replay/budget/rate names
- `snapback-activation` (3): `SNAPBACK_AGENT_SAFE_IMPLEMENTATION_SHA256`, `SNAPBACK_ACTION_SECRETS`, `SNAPBACK_RESUME_`
- `snapback-types` (4): `SNAPBACK_AUTH_HANDLER_V1`, `SNAPBACK_BUILD_DISTRIBUTION`, `SNAPBACK_CONNECTION_SOCKET_REQUIRED`, `SNAPBACK_SESSIONS_MANIFEST_RELOCATED`
- `snapback-kernel` (5): both job markers and the three vector-qualification variables
- `snapback-services` (1): `SNAPBACK_OUTBOUND_LOOPBACK`
- `snapback-tools` (1): `SNAPBACK_BUILD_GIT_DIRTY`
- `snapback-conformance` (1): `SNAPBACK_WORKERD_BIN`

The panic reports only the first absent entry encountered by list order.

## 5. Tickets

- `issues/shelved/20260821-elevated-read-trace-stale-exclusion.md` is materially wrong at [lines 19–25](issues/shelved/20260821-elevated-read-trace-stale-exclusion.md:19): the trace did not stop being emitted. Update it with the scanner-scope cause and close it when the full-root repair lands.
- `issues/shelved/20260821-server-suite-six-pre-existing-failures.md` is stale at [lines 97–98](issues/shelved/20260821-server-suite-six-pre-existing-failures.md:97). Given the stated current one-failure baseline, it can close after this test is genuinely green; the separate neutral-carrier ticket can remain open independently.
- `issues/shelved/20260822-diagnostic-http-status-registry-gaps.md` correctly identifies the server-only blind spot at [lines 45–49](issues/shelved/20260822-diagnostic-http-status-registry-gaps.md:45). It should remain open and should own the 91-code status/non-HTTP review plus its independent parser and route-awareness work.

No ticket should be closed merely from this diagnosis; the first two become closable after the repair lands and verifies green.

## Production consequence

The observed failure has **no direct production consequence**. It is purely an inventory-drift assertion:

- Elevated-read tracing still executes.
- No production code reads `NON_DIAGNOSTIC_SNAPBACK_LITERALS`.
- No HTTP response or trace behavior changes because this test panics.

The narrowed scanner is nevertheless a meaningful governance defect: it permits lower-crate diagnostics to evade HTTP-status review, and the diagnostic-status ticket documents real 500 fall-through consequences. Those consequences are separate from `SNAPBACK_ELEVATED_READ_TRACE` itself.