# Established graph subscriptions bypass SNAPBACK_GRAPH_EXEC_DISABLED on the delta lane

- Status: open
- Created: 2026-08-26
- Area: graph live-query serving kill switch
- Found by: LLP 0309 Stage B re-derivation audit
- Related: `llp/0309.001-stage-b-audit.research.md`, LLP 0309.000 §5/§8,
  LLP 0209

## Finding

Fresh graph execution refuses when `SNAPBACK_GRAPH_EXEC_DISABLED` is raised at
`crates/snapback-engine/src/local/engine.rs:42323-42344`. An already established
graph subscription can nevertheless enter `try_graph_delta_fanout`, whose
admission checks at `crates/snapback-engine/src/local/engine.rs:34454-34480` do
not consult the switch, and call `evaluate_graph_delta_on` at `:34503-34510`.

The asymmetry matters because the switch is a serving kill switch, not merely a
fresh-subscription admission preference. It can therefore fail to stop graph
evaluation for existing subscriptions precisely when operators raise it in
response to a safety concern.

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

