# CT round 2 orientation

Scope: HTTP pool exit accounting, Darwin scheduling diagnostics and Node probe;
qualification observers and mixed maintenance/read measurements. Read the report's
round-0/1 sections before source. No core interpreter, transaction, writer FIFO,
read authority or admission limits change.

Governing documents (current, not foundation):

- LLP 3000 §7 `contended-read-serving` and `http-overload-diagnostics`: original
  permits/refusals own queued jobs, utility exec clamp, intake readback, ordinary
  maintenance, idle-cost decision remains the operator's.
- LLP 3000.019 §3.6/3.7: fresh detached snapshots and existing latency meanings.
- LLP 3000.013 §4: FIFO and bounded cooperative maintenance slices.
- LLP 3000.026 §2/4: delivery is asynchronous; only reader backfill/cleanup marks
  Following incomplete; atomic adoption is separate from post-birth delivery.

Paved surfaces read: `guide/feeds.md` Following contract, `guide/reads.rs`,
`guide/maintains.md`; live dev host status and doctor. The feed contract orders by
(event time, event id), permits new-event delivery after acknowledgement and
states normally within a second on idle hosts, with no hard maximum. A complete
answer does not certify drained new-event delivery.

Open risks: prolonged delivery after preparation/restart must be measured from
queue state, not inferred from repeated hashes. Shared-host timing cannot decide
the operator's Mac idle/loaded trade-off. Mac runtime evidence from f5353623a2 is
operator-owned; this round does not rerun workloads on the Mac.

Doc updates: LLP 3000 §7 exit refusal/diagnostics and qualification; append-only
journal and round-2 report. Hand-off: none.

Final affected-scope audit: checked the changed worker-pool and priority `@ref`s
against LLP 3000 §7 and the report. The existing feeds card and LLPs 3000.013,
3000.019 and 3000.026 continue to describe the implemented behavior; no delivery,
snapshot or completeness contract changed. LLP 3000 now states partial-exit
refusal, class/time diagnostics, independent startup evidence, settlement
observation and the unfavorable maintenance/read results. One journal entry
records this round. Final `ref-check --verbose`: 525 LLP docs, 10,071 refs,
0 errors and 0 unchecked. No corpus reconciliation remains in this scope.
