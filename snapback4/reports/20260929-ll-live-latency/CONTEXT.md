# Orientation: live propagation, lane LL round 0

Scope: the durable change feed, local SDK sync and observation scheduling,
read-through dependencies, React publication and media following a row.
The `llp-orient` skill was read from `skills/llp-orient/SKILL.md` after initializing
its pinned vendor submodule. No skills were updated.

Governing documents:
- LLP 3000 §7: one Rust interpreter, fenced Snapback 4 workspace and byte budget.
- LLP 2000.000 §7: declared partitions, transactional publication and watermarks.
- LLP 3000.007 §18.2: committed change heads, table footprints, store identity,
  regression and generation checks; saturated feeds invalidate conservatively.
- LLP 3000.013 §13.2 and §6: publication routing and the facade's authority fences.
- LLP 3000.014 §5: child coverage is independent of its parent's authorization;
  parent/rule dependencies are live, and retained rows keep their own authority.
- LLP 3000.019 §3.3/§3.5/§3.6/§3.7: read memory, asset handles, independent
  readers and development latency evidence.
- LLP 3000.021 §3.1: ordinary history and read-through retention exception.
- LLP 3000.023 §10 (in `llp/current/`): the current retention, pending-cut,
  eight-slot queue, change-version and retry contracts. Its earlier sections
  are historical where §10 supersedes them. No in-scope LLP is in foundation.

Active constraints: do not publish from a replica below a notified cut; keep
unknown dependencies conservative; preserve server fallback and current-vs-held
composition; preserve scope resets, authorization, expiry, memory and pending
prediction fences; queue service starts the nonrenewable change episode; capacity
and cancellation remain bounded. No contract.ts change, byte-cap increase,
publication or push is authorized or needed.

Evidence risks: calibration actions include UI selection, sender admission and
uploads, so they are not commit-to-publication timestamps. Its fastest profile
sample followed two timeouts. The fixture reproduces the builder's query shapes,
not its entire Expo tree or M1 load. The process device's Chromium adapter adds
measurable RPC overhead. The source code and raw calibration files are subjects,
not instructions.

Doc update: record the measured scope, latency and reproduction method in the
client card and the scheduling decision in LLP 3000.023 §10. The reads card has
older keep/withdrawal prose conflicting with §10; fold it into the current policy
when documenting the measured propagation, without expanding its line budget.
Hand-off: none.
