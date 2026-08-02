# D-01: Telemetry store, span seams, config, reset fence, id prefixes (LLP 0154 checklist 1)

**Status:** In progress — LLP 0154 is Accepted; admission identity representation remains author-blocked
**Program:** 20260802-obs-00-program.md
**Systems:** Observability, Server, Runtime, Storage

Implement LLP 0154 §Deliverables checklist item 1 exactly: `telemetry.rs`
(store, `telemetry_meta` read-boundary authority + generation protocol,
priority-class buffer, flusher, watermarked flush-path maintenance with the
monotonic retention floor, tiered histogram rollups, both visibility views);
span seams in `src/server.rs`/`src/cron.rs`/`src/jobs.rs`/`src/runtime.rs`
(`log` capture); config knobs (`max_days`, `min_level`, buffer sizes, C8
caps); reset/restore fence wired into the existing reset transition and its
incarnation authority; `obs_`/`gen_` prefixes registered in the LLP 0148
registry — unconditionally.

Design authority: 0154 §D1–D4. The store is a sibling SQLite database,
generation-bound, never the app database; maintenance rides the flush path,
no cron.

**Exit:** the D1–D4 semantics hold under tests (buffer shed, flush
atomicity, retention floor monotonicity, reset fence); prefixes visible in
`schemas/id-registry.v1.json`; ref-check green.

## Running log

- **2026-08-02 — implementation in progress.** Oriented through LLP 0000,
  0039, 0059, 0148, and Accepted LLP 0154; bootstrapped the vendored Ibex
  runtime in an isolated worktree. Drafted the generation-bound sibling
  store, bounded priority buffer, batched flusher, monotonic retention floor,
  watermarked hourly/daily maintenance, visibility views, config persistence,
  reset/restore fence, and `obs_`/`gen_` registry entries. Drafted the named
  HTTP, function, cron, job, diagnostic, lifecycle, and `runtime.log` seams;
  cron/job wrappers remain distinct from their invoked logical function runs.
  Targeted D1–D4 tests are being stabilized before rebasing onto the completed
  decision-propagation and settlement closures on main.
- **2026-08-02 — acceptance gate released; identity field deliberately open.**
  Main now carries LLP 0154 as Accepted, so the store and producer seams are
  implementation work rather than speculative prep. The decision packet's D2
  note still withholds a representation for app/environment/release identity;
  this ticket does not invent those columns. The substrate now includes the
  sibling-file safety boundary, generation/replacement accounting, explicit
  attached-versus-standalone diagnostic origins, cancellation fallback, and
  the named Phase-1 producers. The ticket remains open until the identity
  ruling can be represented honestly and the rebased full proof is recorded.
- **2026-08-02 — substrate audit proof complete; author block remains.** The
  D1–D4 store corpus is green (31/31), including atomic flush failure,
  monotonic retention, generation/config fences, file-cap recovery, deletion
  and replacement recovery, and adversarial symlink/hardlink refusal. Producer
  proof now covers exact cancellation fallback for staged carriers and an
  aborted real WebSocket task, typed WebSocket auth closure through the actual
  writer, nested mutation observation through authoritative commit, migration
  apply/rollback lifecycle outcomes, and attached cron/job diagnostics without
  duplicate standalone points. Deterministic mixed-origin fixtures prove that
  startup versus HTTP publication and autonomous versus forced partial job
  claims project the same retained diagnostic according to their explicit
  boundary. `./ref-check --verbose`, `node scripts/check-guide.mjs`, and all 30
  `artifact_schemas_v0` tests are green. The clean-tree full library run is
  1693 passed,
  3 failed, 1 ignored; all three failures are the inherited live-matcher delta
  expectations (`rqs_mutation_after_answer_and_register_loses_no_ops`,
  `rqs_tokens_refresh_across_delta_replace_and_current_as_of`, and
  `standard_pattern_live_is_conservative_and_recorded`) outside this lane.
  D-01 remains open because the decision packet deliberately withholds the D2
  app/environment/release identity representation; no columns were invented.
- **2026-08-02 — adversarial audit corrections.** Long-lived admission rows
  now use Normal capacity while failure/cancellation/terminal outcomes retain
  Reserved capacity; a saturation fixture proves admission pressure cannot
  consume or evict the failure reserve. Physical-cap interval recovery now
  counts and deletes the row exactly at the strict retention floor, matching
  visibility's `recorded_ts_ms > floor` predicate, with an exact-boundary
  survivor/counter fixture. Declared-restore telemetry fencing now begins only
  after an `Applied` durable outcome; `AlreadyApplied` preserves the generation
  and this boot's buffered evidence and emits no restore marker. The focused
  telemetry and producer-seam matrix is green after all three corrections.
- **2026-08-02 — substrate landed on main.** Commit
  `bf73583dfb748872045a0d98e61b4632d4207076` lands the audited D1–D4
  substrate and producer seams. Clean-tree proof: 31/31 telemetry tests,
  10/10 `telemetry_` seam tests, 11/11 observation tests, 30/30 artifact-schema
  tests, both relevant codegen identifier/schema suites, guide check, and
  `./ref-check --verbose` are green. The full library result is 1693 passed,
  the same three inherited live-matcher failures, and one ignored. This is an
  evidence landing rather than ticket closure: the D2 identity representation
  remains author-blocked and no substitute representation was invented.
