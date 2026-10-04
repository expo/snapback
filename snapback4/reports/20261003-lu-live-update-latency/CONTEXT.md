# LU orientation

Scope: cross-client commit-to-render on the published web device/React path;
Following delivery, change notification, replica publication and observations.

Governing documents (read before implementation):

- LLP 3000 §7, `contended-read-serving`: ordinary engine holders, gate-free
  admission, cooperative 250 µs/2 ms chunks, CPU-based 7× pacing capped at
  100 ms, aged opportunities and read protection. Root and 3000.013/3000.023 are in current; 3000.029 is archived.
- LLP 3000.013 §4: durable Following work and edge epochs; a source mutation
  commits its own copy and asynchronous follower work.
- LLP 3000.023 §10 and §12: bounded observation capacity, published cuts,
  retained answers and immediate authority boundaries. This implemented owner
  supersedes the shelved LLP 3000.029; LV was reverted, not the current model.
- LLP 3000.001 and 3000.008.004: durable device publication; persistence failure
  cannot bless speculative memory.
- Current compiled guide cards `feeds` and `client`; CT round 4, BG rounds 0–9,
  RL report and LV report/reversion record; calibration #30 d-03 and #29.

Constraints: preserve reads under contention, authority and durability fences,
resource and wasm budgets. No new public contract or telemetry surface is needed.
Measurement-only instrumentation restores the Rust sources after building a
separate binary. Raw traces remain under ignored `target/`; no files above
256 KB, gzip files or movies are committed. No remote hosts, pushes or unrelated
process signals. All experiment processes inherit a verified <=16 CPU affinity;
burners belong to an exclusively created process group whose keeper cleans it.

Question at entry: which part of commit → delivery → change → replica → observation
→ React accounts for the loaded tail. The harness records overlapping stages
rather than assuming one serial chain. Update LLP 3000 §7 only if the server
contention policy changes. Hand-off: none.

## Round 1 orientation (2026-10-04)

Read both lu-r0 review records and Astra's retained probes. Their shared P1
invalidates the forward-key selector's progress claim, despite atomic slices
and finite-backlog convergence. Preserve CT pacing, read custody, transaction
bounds and delivered-contents completeness. Use existing Work.at as a durable
queue position: enqueue and requeue at max(pending position)+1, with a metered
engine-owned peek and no new schema/index. Prove a frozen-P service obligation,
including backwards clocks, multiple old tasks and restart. Arrival need not
follow event order; audit page reconciliation and notification/unread surfaces.
Repeat all three loads with 30 updates per shape; message improvements require
new evidence, not inference from repost. Full suite and locked wasm build are
required again. No machines outside eb1000 and no experiment outside 80–95.

Round-1 measurement correction: a live thread audit found Chromium GPU workers
resetting inherited affinity from 80–89 to 0–9. Discard the taskset-only first
round-1 run. Both fresh revisions and the suite witness now use confine.py to
refuse affinity changes in the whole owned descendant tree, plus read-only
thread audits. Keep rendering flags unchanged. The broader harness audit has
a filesystem follow-up; original round-0 confinement claims are corrected.
