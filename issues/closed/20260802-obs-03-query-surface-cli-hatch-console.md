# D-03: Typed operations, routes, CLI, MCP projection, SQL hatch, Health/Logs pages (LLP 0154 checklist 3)

**Status:** Closed — implemented 2026-08-02
**Program:** `issues/closed/20260802-obs-00-program.md`
**Depends on:** 20260802-obs-01 (store), 20260802-obs-02 (registry)
**Systems:** Observability, API, CLI, Admin console

Implement LLP 0154 §Deliverables checklist item 3 exactly: typed operations
with pinned JSON Schemas + fixtures; local routes with LLP 0031 registry
rows (stats = OperatorMetadata; events/export = AdminSecretRead +
no-store); the variance envelope; `snapback telemetry` CLI; host-op +
control-MCP projection; the local-only SQL hatch (read-only open,
deny-by-default authorizer, budgets, adversarial tests, rusqlite `hooks`
declared explicitly); Health and Logs console pages; Inspect gains the
buffer-state fields.

0154's posture is binding: acceptance coverage exercises the operations,
CLI, and SQL hatch directly — agents are the tested consumer, the console
is not the proof. The network SQL endpoint was deliberately deleted in the
v0.3 restructure (`PRAGMA query_only` is not an authorization boundary) —
do not reintroduce it under any spelling.

**Exit:** operations/CLI/hatch adversarially tested; route rows registered;
console pages render from the same typed operations.

## Resolution

Landed in commits
`7797c23930c8f2e1396fbaeed7dd61f64fb7636e` (typed query surfaces),
`5d89e0083b073aa6b8ed9f9fe25c5db9fc7372cd` (finite agent export carrier),
and `8279bd443b9b2e8ac0dac2b2000850aed74b64e7` (schema, MCP, route-policy,
diagnostic, and guide-join proof gates), with closure recorded by
`994e20c487a2811b6dc2e3b646074d59ce6b1081`.

The result includes the Rust-owned typed events/stats/export/SQL contracts;
schema-generated request, response, finite-page, and fixture artifacts; the
AdminRead/AdminSecretRead route split with no network SQL carrier; bounded
frozen export continuation; CLI and host-op/control-MCP projections; and the
Health/Logs Contract projection. The control MCP now presents the managed
admin token when it mints a scoped secret-read lease. Its real-process test
uses the deliberately unbound compatibility start and therefore pins the
honest `SNAPBACK_TELEMETRY_IDENTITY_UNBOUND` export refusal; the successful
finite page/continuation path is exercised through an explicitly
TargetDescriptor-bound native host-op fixture. No new identity authority was
invented.

## Closing proof — 2026-08-02

- `scripts/bootstrap-ibex-runtime` on the final rebased commit: exact link,
  launch, and restricted no-eval handler-VM qualification passed with
  `SNAPBACK_IBEX_RUNTIME_LINK_OK`.
- 22/22 focused Rust library tests passed: retained-edge/raw-tail stats,
  typed events/cursors/freshness, frozen streaming and finite agent export,
  query validation/work bounds, all three adversarial SQL-hatch gates,
  route authority/no-store and host-op projection, CLI parsing,
  TargetDescriptor-to-store-meta identity, route registry, and diagnostic
  inventory.
- 5/5 artifact gates passed: agent-export fixture validation, committed schema
  drift, committed instance drift, schema file-set closure, and representative
  value validation.
- `node packages/snapback-cli/mcp-control.test.mjs` passed against the final
  qualified binary; both admin UI credential/Contract binding smoke tests
  passed.
- `node scripts/check-guide.mjs` passed (46 pages, 142 snippets, 94 routes and
  32 host operations joined). Only the six new surface-map entries landed
  here; the top-level observability capability correctly remains a GAP for
  D-04's guide/evidence work.
- `./ref-check --verbose` passed: 158 LLP documents, 2,792 references, zero
  errors or unchecked references; `git diff --check` passed.
- A practical pre-final remote `cargo test --locked --lib` ran 1,756 tests:
  1,749 passed, one was ignored, and six failed. The two OBS-owned failures
  (AdminSecretRead registry invariant and telemetry diagnostic inventory)
  were repaired and pass exactly. The TargetDescriptor race now carries the
  upstream main fix and passes exactly. The remaining failures were unrelated
  fresh-Linux/fixture conditions: secret-read foreign-inode cleanup, absent
  ignored generated demo artifacts, and `/proc/self/fd` SQLite backup opening.
