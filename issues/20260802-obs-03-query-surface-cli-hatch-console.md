# D-03: Typed operations, routes, CLI, MCP projection, SQL hatch, Health/Logs pages (LLP 0154 checklist 3)

**Status:** Open — gated on LLP 0154 Status: Accepted
**Program:** 20260802-obs-00-program.md
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
