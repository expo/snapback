# D-01: Telemetry store, span seams, config, reset fence, id prefixes (LLP 0154 checklist 1)

**Status:** Open — gated on LLP 0154 Status: Accepted (GAP row landable now)
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
