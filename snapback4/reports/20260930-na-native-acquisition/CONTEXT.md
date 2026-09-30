# NA scoped orientation

Scope: native device SQLite staging, atomic snapshot publication, row/index maintenance and process framing. Explicit lane authorization includes the device core. No public contract change, push or publication.

Governing LLPs: LLP 2000.000 §7.2 (partition and durable outbox); LLP 3000.007 §18.2 (private snapshot and catch-up, retained history), §18.4 (Node transport), §20.4 (both persistence hosts); LLP 3000.001 (publication and prediction visibility); LLP 3000.019 §3.4–3.5 (residency and media); LLP 3000.030 §13 (BN witness). The latter three are in current; none is in foundation. Snapback 4 has its own fence; root inventories and Ibex bootstrap do not apply.

Constraints and rationale: LLP 3000.007#18.2 requires complete rows, indexes, history and boundaries before acquired publication; a restart must discard orphaned staging or resume through existing owner/cursor checks. LLP 3000.001 binds prediction replay and acknowledgement to publication. LLP 3000.007#20.4 binds web saves to strict atomic persistence and requires complete indexes before queries/predictions. LLP 3000.002 keeps the wasm size ratchet and measured memory claims. LLP 3000.030#acquire requires offline coverage equality and zero reconnect downloads. Read the live bounds and sync guide cards and native dispatcher before changing them.

Risks: final publication may dominate; changing SQLite durability is not justified without measurement. CPU load, warm caches and tracing overhead must be separated from product timings. Direct replay must use the same captured pages. Crash tests must check facts before restarting, not only eventual convergence.

Doc updates: existing LLP 3000.007, bounds guide, one journal entry and this report. Hand-off: none.
