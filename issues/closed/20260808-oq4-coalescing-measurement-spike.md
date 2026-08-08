# Coalescing measurement spike against the persistent hot-diagnosis baseline (LLP 0191 OQ4, ruled)

**Opened:** 2026-08-08 · **Priority:** immediate (days-scale; unblocks D2/D4 Spec drafting) · **Ruling:** LLP 0191 "Author rulings" #4, Charlie Cheever 2026-08-08

Measurement spike only — no landing, per LLP 0189. Instrument:
`demos/zerobugs/control/scripts/diag-hot-stream.mts` against the persistent
baseline in `demos/zerobugs/fixtures-local/hot-diag-baseline/`.

## Predeclared axes (LLP 0191 §1 + OQ4; both review families signed)

- **Arrival discipline:** the existing open-loop fixed-offset bursts
  (16 × 25 ms), plus a settle-gated arm and a sustained-write arm as new
  arms.
- **Frame-kind accounting per instrument** — resolves the declared-open
  521-vs-12 discrepancy between `zb5-hot.v10` custody deliveries and the
  diag traces at the source.
- **Matcher counters:** match / skip / conservative-fallback decisions per
  mutation × subscription; compare against predeclared expected relevance
  (the receipt's 8-trigger/8-non-trigger inventory partition).
- **Evaluation counters:** queue / start / finish / cancel, frame bytes.
- **Settlement decomposition:** commit-ack vs mutation settlement vs
  observer convergence timed separately (the settlement-isolation
  question: non-trigger mutations also settled slowly in v10).
- **Observer matrix:** zero / one / six observers; same and different
  authority partitions.

Hypothesis under test (not an estimate): coalescing turns the 72.8 s
median settle into single-digit seconds. A successful spike sizes rung 1
for the D4 Spec; it does not become the de facto design.

Parent evidence ticket: `20260808-live-query-reevaluation-cost-at-scale.md`.

**Dated note (2026-08-08, ticket-sweep landing):** the sweep concurrently
landed a production rung-1 coalescing lane (LLP 0008 §"Dated decision —
post-commit fan-out coalescing (2026-08-08)"; `src/live_coalesce.rs`,
dispatch in `src/local.rs`, backstop in `src/server.rs`). The spike
therefore has a real implementation to measure instead of a prototype:
run the coalescing arm on the landed lane and the control arm with
`SNAPBACK_LIVE_COALESCE_DISABLED=1`. The spike's no-landing rule is
unaffected — its job is now to size the landed lane at 5.5M rows on the
predeclared axes (and the lane's `LiveCoalesceStats` counters partially
cover the evaluation-counter axis: deferred/coalesced/backstop
flush counts are exposed via `LocalSnapback::live_coalesce_stats`, not
yet on the inspect surface).

## Resolution (2026-08-08) — spike run, hypothesis not confirmed, mechanism identified

**CLOSED.** All predeclared axes ran on 2026-08-08 as a twelve-arm A/B
matrix (coalesce on/off × {fixed burst, settle-gated, sustained} × observer
{0, 1, 6-mixed, 6-same-partition}) against per-arm APFS clones of an
online-backup copy of the 5,549,113-row `hot-diag-baseline`, on branch
`spike/oq4-coalescing-measurement` (base main 55566dc0a). Spike code plus
the full analysis output are preserved on that branch
(`demos/zerobugs/control/oq4-spike-results/`, instrumentation in
`src/spike_trace.rs`, arms/driver/analyzer under
`demos/zerobugs/control/scripts/`); nothing lands from it per LLP 0189.
N=1 per arm — shape/existence evidence only under `benchmarks/protocol.md`.

**1. The hypothesis is NOT confirmed.** Coalescing did not turn the burst
shape into single-digit-second settles at 5.5M rows. Six mixed observers,
fixed 16×25 ms burst ×3 cycles: trigger settle p50 23.6 s (on) vs 33.2 s
(off); whole-inventory median 23.0 s (on) vs 17.8 s (off); max 92.4 s (on)
vs 68.0 s (off). Evaluations barely moved (84 vs 81) because only 4 of 24
applied commits deferred.

**2. Why rung 1 as landed cannot bound this workload:** the frame-kind
accounting shows the dominant delivery lane is the *authorization* lane,
which the landed coalescer excludes by design ("permission resyncs,
authorization events, and refresh signals always run inline" — LLP 0008
dated decision). In burst-on, 75 of 84 server evaluation frames delivered
`authorization_invalidation`; the client ledger saw 112
`authorization_snapshot` + 119 `authorization_quarantine` callbacks against
9+3 plain snapshots. The synthetic 15.6× fixture (`live_coalesce_v0`)
exercised the data replace lane only. Per-evaluation cost at this scale:
p50 863 ms, max 3.6 s; ~61–68 MB delivered frame bytes per six-observer
arm (full 1,000-row windows, replace lane; zero delta-lane deliveries).

**3. Settlement isolation is the dominant lever, now decomposed.** With
zero observers the whole 48-mutation inventory settles at p50 0.13–0.24 s —
the write path itself is fast. Decomposition of `issue.update` (burst-on):
commit **durable** early, handler result +4.8 s after durability, HTTP
response +10.7 s after durability; observers converged +5.9 s (first) /
+10.0 s (last). Even **refused, commit-free** mutations settled in ~10.7 s.
Settlement waits behind subscriber evaluation, not durability. Settle p50
scales with observer count: ~0.2 s (0) → ~6.4–10.3 s (1) → ~18–43 s (6).

**4. Arrival discipline.** Settle-gated (closed loop): trigger p50
~10.5 s, non-trigger ~1 s, on ≈ off — with no backlog the coalescer never
engages, and one trigger still costs ~6 serial evaluations before its
response. Sustained (4/s for 120 s): **both** arms settled only ~102–107 of
480 dispatches (settle throughput ≈0.85/s, evaluation-bound); on the
settled subset, latency p50 44.9 s (on) vs 99.6 s (off) with 15 deferrals —
coalescing helps latency under sustained load but does not change
throughput.

**5. Matcher counters (rung-2 sizing).** 144 decisions per six-observer
arm: 75 match-replace, 69 skip, **0 conservative-fallback, 0 delta**. The
skip rate matches the receipt's 8-trigger/8-non-trigger partition. The 21
"disagreements" vs predeclared relevance are the *predeclaration's* errors,
not the matcher's: 18 × `label.createAndAddToIssue` (it writes the
issueLabel edge the list query joins — waking is correct; the receipt's
partition mislabeled it) and 3 × `viewState.set` waking only the writing
principal's own observer (per-principal precision working). On this
inventory, matcher precision is not the near-term bottleneck.

**6. Observer matrix / rung-3 headroom.** Same-partition six (one
principal, six subscriptions) ≈ mixed six in cost (trigger p50 34.6 s on /
40.4 s off): no sharing exists today, so same-authority memoization has
clean ~6× headroom on this shape.

**7. The 521-vs-12 discrepancy is resolved as a unit-and-lifecycle
difference, not delivery coalescing.** The receipt's custody unit counted
every `onUpdate` callback — dominated by authorization-lane kinds — across
*fresh* six-observer sets each cycle; the diag instrument counted only
data-kind `update` frames on one *persistent* observer set, recording
`authorization_boundary` callbacks separately. One accounting over the
spike's burst-on arm itemizes both: 6 initial snapshots, 234 `onUpdate`
callbacks (112 authorization_snapshot + 119 authorization_quarantine + 3
snapshot), 231 authorization-boundary records, against 84 server-side
evaluation frames. Neither historical number measured evaluation counts;
both are consistent with this ledger. (Observed along the way: repeated
stream quarantining under hot load — 119 quarantine callbacks in one arm —
is a D4 lifecycle input.)

**Disposition for the D2/D4 owner-Specs
(`20260808-d2-d4-owner-specs-commission.md`, now unblocked):** rung 1's
remainder must cover the authorization/permission-resync lane (or D4 must
justify its exclusion), evaluation cancellation, and settlement isolation —
the spike ranks settlement isolation (commit-ack decoupled from subscriber
work) as the largest single lever; rung 3 has measured ~6× same-authority
headroom; rung 2 is not the binding constraint on this inventory.

Repro traps recorded for the next runner: the frozen baseline pins its
LLP 0058 deployment generation — assert it client-side from the ingest-era
carrier (`OQ4_STARTUP_ARTIFACTS`; control sources byte-identical since
a7f502691, so the pin is behavior-neutral); baseline cycles 0–2 and the
un-suffixed bind ids are burned (`--cycle-offset`); same-partition
observers must adopt the canonical crew-admin principal (dev-session
principals are deterministic per email, and a second principal cannot bind
an already-bound source user).
