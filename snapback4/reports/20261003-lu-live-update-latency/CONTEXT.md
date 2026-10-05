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

## Round 2 orientation (2026-10-04)

Scope: the 900-follower replay regression and the unrelated upload-disk test;
retain all round-1 service and web latency goals. Merged origin/main cleanly
by fast-forward to 2cc55e168c; exact pre-LU control is 848b645294^1 =
4353aa735cb1c752d08993268da9fa8a75f26c5c. Read the current CT/LU policy in
LLP 3000#contended-read-serving, LLP 3000.013#4-following-without-caps,
and the current feeds/client guide cards. RP's hidden-work reservations now
price enqueue on both hosts: preserve that integration and the device fence.

The replay fixture follows before any posts exist. timeline/online.rs does
not enqueue backfill for empty history, so the proposed 900-item queue is a
hypothesis to test, not an established explanation. Trace commits, kinds,
recipient-copy slices, requested pacing and final completion on both commits;
add a current-main FIFO-only control to separate rotation from other landings.
No change to the replay deadline or the upload socket timeout. All load and
experimental descendants stay on CPUs 80–89, through the inherited affinity
guard. Burners have an owned keeper/group, and only that group is stopped.

The bounded page scan must preserve all row/rule/meter checks, cursor atomicity,
edge epochs, P-visit fairness, CT deadlines/pacing, and fresh read admission
(LLP 3000#contended-read-serving and LLP 3000.013#4-following-without-caps).
Finite fan-out still requires proportional copies: there is no documented
width-independent physical completion time under arbitrarily large input or
OS starvation. Qualify the requested 900th-recipient shape and disclose that
limit rather than enlarge a timeout. Likely docs: LLP 3000 §7, REPORT Round 2,
JOURNAL. Hand-off: none.

Repayment refinement: cap each kind's CPU charge separately, preserve combined
debt beyond a single repayment, and append empty-cycle debt after any pause a
timed worker already scheduled. Every sleep stays at most 100 ms. Deterministic
tests conserve 240 ms of capped charges and cover the timed-worker overlap;
the final measurements/full suite follow this correction, with initial
candidate evidence retained separately.
