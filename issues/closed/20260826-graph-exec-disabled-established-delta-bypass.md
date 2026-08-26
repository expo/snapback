# Established graph subscriptions bypass SNAPBACK_GRAPH_EXEC_DISABLED on the delta lane

- Status: resolved
- Created: 2026-08-26
- Area: graph live-query serving kill switch
- Found by: LLP 0309 Stage B re-derivation audit
- Related: `llp/0309.001-stage-b-audit.research.md`, LLP 0309.000 §5/§8,
  LLP 0209

## Finding

Fresh graph execution refuses when `SNAPBACK_GRAPH_EXEC_DISABLED` is raised at
`crates/snapback-engine/src/local/engine.rs:42349-42360`. An already established
graph subscription can nevertheless enter `try_graph_delta_fanout`, whose
admission checks at `crates/snapback-engine/src/local/engine.rs:34469-34495` do
not consult the switch, and call `evaluate_graph_delta_on` at `:34518-34526`.

The asymmetry matters because the switch is a serving kill switch, not merely a
fresh-subscription admission preference. It can therefore fail to stop graph
evaluation for existing subscriptions precisely when operators raise it in
response to a safety concern.

The Stage B audit reproduces the behavioral half without source inspection: it
establishes a real `issueSummary` graph subscription, raises the switch only
around an otherwise eligible mutation, and drains a `live_delta` frame whose
delivery observation reports the delta lane. The citations above explain why;
the executed frame is the reproduction.

This is LLP 0309 §D4.2 class **(b)**: a shipped defect. The operator reference
forms do not own deployment kill switches, so their maintain verdict does not
authorize bypassing consumer-owned execution policy.

## Required repair

Bind the switch at the common graph evaluation boundary or explicitly gate the
incremental fan-out before any pinned-view graph evaluator work. The disabled
disposition must use the established replacement/refusal policy without
publishing a graph delta.

## Acceptance

- Raising the switch after subscription establishment prevents subsequent
  `evaluate_graph_delta_on` execution.
- A regression observes the established-subscription case, not only fresh
  invocation.
- Clearing the switch restores the documented graph serving behavior.
- `cargo test -p snapback --test delta_semantics_stage_b_audit_v1` flips this
  executed class-(b) reproduction to the disabled disposition after repair.

## Resolution

Resolved 2026-08-26 by the landing named
`fix graph delta projection custody and kill switch`. The implementation commit
hash is pending because the linked worktree could not create its shared
`index.lock`; the landing orchestrator must replace this note with the committed
hash.

The graph delta candidacy gate now consults `graph_execution_disabled()` before
incremental evaluation, alongside `graph_delta_disabled()`. The regression
establishes a real subscription before raising the switch, proves that no delta
is published and no delta evaluator cost is incurred, then proves clearing the
switch restores the delta lane in a clean process.

Regression tests:

- `graph_exec_disabled_established_subscription_never_enters_delta_evaluator`
- `stage_b_rederivation_audit_is_fully_classified`
