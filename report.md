# Auth-invalidation client advertisement report

**Date:** 2026-08-16
**Ticket:** `issues/closed/20260816-react-provider-missing-auth-invalidation-protocol.md`

## Outcome

`SnapbackClient` now advertises authorization-invalidation protocol v1 by
default, so headless, React, and Expo/app-data arms inherit the capability.
Passing `authInvalidationProtocol: null` is the explicit legacy embedded
integration opt-out. React surfaces protocol/profile negotiation refusals as
terminal diagnostics and does not retry unchanged mounted demand.

## Promise verification

The default was enabled only after checking LLP 0053's invalidation
obligation, LLP 0095's transition catalogue, LLP 0096's `auth/live` profile,
and the server refusal paths in `src/server.rs` and `src/local.rs`.

The server assumes a v1 client will:

- offer v1 at connection open and on every sessions live lifecycle request;
- give auth-scoped materializations a stable authorization namespace;
- consume invalidations from both live-stream and polled delivery;
- quarantine affected rows before they can be observed;
- install the replacement snapshot or terminal deletion before acknowledging;
- retain per-scope invalidation high-water state; and
- synchronously blank prior-principal memory and remove selected durable
  materializations across an authority transition.

The library implements all of those duties in `SnapbackClient.liveQuery`, its
authorization-invalidation fence/ACK state machine, auth materialization
registration, and the auth transport participant used by principal changes.
No application callback, React hook, or provider-specific behavior is needed.
The capability advertisement is therefore truthful without app cooperation.

## Implementation evidence

- The `SnapbackClient` constructor defaults `authInvalidationProtocol` to `1`.
- External-session and app-data factories no longer overwrite an explicit
  `null`, so all arms inherit the library default while preserving opt-out.
- Public declarations expose `authInvalidationProtocol?: 1 | null` and
  document `null` as the legacy embedded-integration escape hatch.
- HTTP 400 protocol/profile negotiation refusals are marked non-retryable by
  the client and classified as terminal by the React registry.
- A terminal React subscribe publishes an error snapshot, records the
  provider diagnostic, and holds a timer-free failure sentinel until demand is
  deliberately released/remounted.
- The React starter was not changed: no option remains app-visible by default.

## VERIFY (verbatim)

- `packages/snapback-client package.test.mjs + tsc fixtures`: PASS.
  - `node packages/snapback-client/package.test.mjs`
  - `node_modules/.bin/tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler packages/snapback-client/exact-reference-types.fixture.ts packages/snapback-client/push-registry-types.fixture.ts packages/snapback-client/auth-identity-types.fixture.ts packages/snapback-client/app-client-types.fixture.ts`
- `packages/snapback-react full suite`: PASS under the repository's canonical
  Node 24 after process-isolating the three fixture-generation prerequisites,
  then running `commands.test.mjs` and the complete package `test` script body
  with `npm test --ignore-scripts`. Every React JavaScript test and every
  TypeScript fixture passed.
  - Qualification: the unmodified `prepare-type-fixtures.mjs` entrypoint runs
    multiple `generate()` calls in one process and currently fails before the
    React suite with
    `SNAPBACK_CODEGEN_DEFINITION_OBJECT_PROTOTYPE_INVALID` on
    `tests/fixtures/familiar-todo-explicit`. Each identical generator job
    passes in its own process. This ambient pretest defect is outside the auth
    change; it was not hidden or changed here.
- `snapback-cli template static acceptance if it pins provider wiring`: PASS.
  - `node packages/snapback-cli/templates/react/acceptance.static.mjs`
- `node --check on changed files`: PASS for every changed `.mjs` implementation
  and test file.

Additional affected-scope checks:

- `node scripts/check-guide.mjs`: PASS (19 checks; freshness warnings only).
- `./ref-check --verbose`: PASS (0 errors, 0 unchecked).
- `./scripts/check-generated-artifacts`: PASS.
- Focused real-wire provider test: PASS; connection open and live subscribe
  both carry invalidation v1 without provider/app configuration.
- Focused terminal-refusal regression: PASS; one attempt, surfaced diagnostic,
  and no retries across render churn plus 120 seconds of simulated time.
