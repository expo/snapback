# PUSH-01a: LLP 0143 device-token registry

**Status:** Closed
**Systems:** Runtime, Storage, Auth, Wire Protocol, JS client, Codegen
**Related:** LLP 0143 D1/D6,
`issues/closed/20260802-push-01-0143-implementation.md`

## Scope

Land the independently useful registry half of LLP 0143 without implying that
the Expo send lane, handoff ledger, receipts, hosted path, or first-class
notifications capability exists.

## Resolution — 2026-08-02

Implemented the declaration-gated, session-bound registry on top of the exact
auth catalog:

- `definePushSeam` emits only the declared app-scope tuple and bounded idle
  retention fact. An undeclared application has no push table, triggers,
  inspection SQL, or periodic registry work.
- Two session-only app-data routes register and explicitly unregister an Expo
  token. The storage transaction enforces one live owner, last-write-wins token
  rotation, exact session generation, cross-app-scope refusal plus a bounded
  leak indicator, and byte erasure at retirement.
- Logout/admin/session rotation and durable expiry-clock advancement retire
  the exact session generation inside the same SQLite transaction through
  catalog-validated triggers. The table, PK autoindex, four named indexes, and
  three triggers also match a once-built reference catalog at declared
  activation/reopen/inspection, including physical table/index pragma shape;
  forged schema text cannot hide a different index btree. Startup/periodic
  maintenance retires idle rows.
- Token bytes remain secret input: responses contain only token-row and
  installation identities, operator inspection exposes only cardinalities and
  allowlisted retirement reasons, auth backup physically overwrites registry
  custody rows before publication, and diagnostics never echo token bytes or
  provider prose. The backup proof scans the raw SQLite image for the fixture
  token, not only the logical table, and repeats the raw-byte proof after
  declaration removal so dropped-table free space cannot become an export
  bypass.
- The JS client mints a stable installation id through explicitly injected
  storage and exposes `client.push.registerToken`, `registerExpoToken`, and
  `unregisterToken`. It refuses without custody rather than silently choosing
  OQ2's production carrier/reset semantics; that author question is recorded
  in the decision packet. Unregister never mints: absent stored custody returns
  an exact local no-op without a storage write or network request. Client
  responses accept only exact `ptok_` ids and the server's nonnegative integer
  timestamp domain; extra fields, token echoes, and malformed ids fail closed.
- A DeviceNotRegistered retirement transition with allowlisted ticket/receipt
  references is tested and reserved for the send slice. No production provider
  response reaches it yet.

The capability index now has an honest local/partial registry row and surface
mapping. `notifications: false` is unchanged. No send API, audience resolver,
handoff ledger, receipt poll, or provider endpoint is present.

**Implementation commit:** `769e7139ec0583445c83866a879f810e6bb00f96`
(`feat(push): land declared device-token registry`)

## Proof

- `cargo test --locked --lib push::tests`
- `cargo test --locked --lib auth::runtime::tests::periodic_auth_maintenance_runs_declared_push_idle_retention`
- `cargo test --locked --lib storage::auth::tests::auth_backup_excludes_push_registry_custody_rows`
- `cargo test --locked --lib server::tests::push_registry_routes_keep_token_custody_and_logout_retirement_host_owned`
- `cargo test --locked --lib server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`
- `node packages/snapback-client/push-registry.test.mjs`
- `node packages/snapback-codegen/authoring-validation.test.mjs`
- `scripts/check-generated-artifacts`
- `scripts/check-generated-types`
- `node scripts/check-guide.mjs`
- `./ref-check --verbose`
- Full `npm test --prefix packages/snapback-client` and
  `npm test --prefix packages/snapback-codegen` pass.
- Full `cargo test --locked --lib`: 1,716 passed / 1 ignored. The three
  inherited live-matcher failures remain; an OBS-01 CLI target-descriptor test
  also races a missing telemetry table under the parallel full-suite run but
  passes immediately alone. The parent ticket records exact names. This slice
  changes only the private inspect projection in `src/local.rs`, not the live
  matcher or telemetry-store paths.
- Adding `definePushSeam` changes the codegen implementation-input digest. The
  resulting committed demo/comparator hash churn is reproduced exactly by
  `scripts/check-generated-artifacts`; it is not hand-edited fixture drift.
