# WD scope and governing context

Scope: witness preparation, process-group recovery and the native supervisor;
no engine, client-contract or simulator-selection change.

- LLP 3000 §4 and §7: Snapback 4's independent fence and existing verification
  policy; root not currently linked in foundation/current.
- LLP 2000.000 §12: bounded source and process; no new gate or publication.
- LLP 3000.030 §5: project/device custody through preparation and execution.
- LLP 3000.030 §15 (current, not foundation): native anchor retained unreaped,
  birth identities, recovery reaping lock, group-wide signals, two consecutive
  empty live snapshots, and kernel owner-death watches. This is the governing
  rationale for all three existing `@ref` annotations in scope.
- `guide witness`: published preparation, cancellation and recovery behavior.
- NX report rounds 8–9: unchanged late-member/shim/owner-death regressions and
  the explicit external-reaping/group-reuse residual. Earlier timing cohorts
  are historical, not WD comparison evidence.

The user's commission authorizes the load helper, regressions, local native
timings, report, journal, ticket closure and commit. Only lane-owned processes
and a unique `sb4-wd-20261003-` simulator prefix/private state directory are in
scope. No fleet machines, other worktrees, pushes or publication are needed.

Document update: extend the existing LLP 3000.030 §15 deadline/inspection
paragraph and `guide witness`; retain all existing custody residuals except
the removed external `ps` inspection dependency. No new LLP is warranted.
Hand-off: none. `@ref` destinations remain applicable; no broken or superseded
reference in scope was found.

## Round 1 context pack (2026-10-04)

- Scope: Linux process identity and membership parsing in `recovery.rs`;
  shared deadline diagnostics in `cleanup.rs`, `preparation.rs`,
  `process_group.rs` and `recovery.rs`; review evidence corrections.
- Governing LLPs: LLP 3000#4 (fence), LLP 2000.000#12 (bounded process),
  LLP 3000.030#15 (custody and deadlines). All three are in `current/`,
  none in `foundation/` in this checkout. `guide witness` remains consistent.
- Active constraints and rationale: LLP 3000.030#15 requires birth-bound group
  custody, group signaling, an unreaped anchor, two empty snapshots, bounded
  drains, and a refusal when inspection cannot establish safety.
- Risk: a `/proc` row may hide or corrupt facts; only a determined outside
  group or disappearance permits skipping it. Shared diagnostic call sites
  execute on Darwin as well, so their changed text awaits mini verification.
- Likely documentation: update LLP 3000.030#15, append the report and journal;
  withdraw the unreplayable slow-`ps` evidence. No new LLP or guide form.
- Authorization: the round-1 commission limits execution to eb1000, requires
  local commit only, and prohibits the three Macs. Hand-off: none.
