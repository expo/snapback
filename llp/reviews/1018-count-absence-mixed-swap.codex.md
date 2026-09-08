# LLP 1018 count absence and mixed-swap review — Codex

**Reviewer:** independent collaboration session `/root/invalidation_audit`
**Model provenance:** Codex; exact model variant and reasoning effort unavailable
**Date:** 2026-09-07
**Targets:** initial `d405ecdf6`; fixed `06a07784d`; final `886f41706`
**Method:** read-only source review; reviewer made no edits and ran no builds

## Initial finding

An equal-sequence absence can overwrite tombstone provenance within one atomic
swap. `recordNegative` used `<=`; tombstones were processed before full delivery
absences. An admitted overlay at sequence 2, followed by a batch containing both
a tombstone and a nonduplicate full absence at sequence 2, therefore retained
its `admitted: true` marker and remained visible. The two negative facts agree
about row absence, so fact-conflict rejection does not enforce tombstone priority.

Preserve tombstone dominance on equal sequences and add a mixed-swap control.
The other inspected custody paths appeared appropriately bounded: exact
row/sequence and durable admission order, later authority, cold persistence,
answer GC, and extent/viewed protections.

## Received final verdict

**READY for `886f41706`; no material findings in the final bounded delta.**

The sequence comparison preserves newer evidence and gives tombstones priority
on equal sequences, matching downstream overlay retirement. The regression
exercises the original mixed-swap failure and checks warm and cold projection.
LLP 1012 accurately records the behavior. UTF-8 byte counting matches the
identity limit; the `ensureOpen` compaction preserves behavior.

This is source-review approval. At review time, the integrating owner reported
custody 90/90 passed; the normal public harness remained unqualified after its
startup timeout, with diagnostic and native results pending.

## Implementer disposition and verification

Accepted and fixed in `06a07784d`; `886f41706` preserves the 1,500-line file
budget. The new mixed-swap regression failed before the source change with
row `one` at value 9 still visible. After the change the full store-custody
file passed 90/90 in 26.112 seconds. The package build passed.

On the combined runtime, native `public_count_` tests passed 12/12; the filtered
Cargo command exited successfully. The complete local runtime measured 249,121
minified bytes and 80,828 gzip bytes with Node 24.18.0 and esbuild 0.25.9:
below the 82,000 ceiling and above the 80,000 working target.

Ref-check passed (416 documents, 7,783 references, no errors). Snapback 2's
changed file meets its cap. Repository-wide caps still fails on the inherited
Snapback 1 `snapback-agent-safe-paired.rs` overrun; that file is outside this fix.
The initial normal public run failed its 10-second owner-startup deadline. A
30-second diagnostic attempt then failed on a Cargo build lock caused by the
concurrent native test build; the temporary harness edit was restored exactly.
The architecture integration owner separately retains its own prior public
Count qualification; this record does not claim a full suite or publication.

The final isolated public run on Node 24.18.0 passed at the unchanged 10-second
owner-startup deadline: one test, no skips, 17.038 seconds total (10.167 seconds
in the test body). It proves cold-zero receipt acquisition, visible prediction,
a second cold reopen, repeated allocation through cap 3, overflow rejection,
and a 290-byte maintained Ref through cold read, prediction and replay.
The raw result is retained in
[`zero-count-mixed-swap-public.log`](../../benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/zero-count-mixed-swap-public.log).

The initial delivery was a bounded handoff to the architecture owner. Before
this follow-up landed, main incorporated the broader authority join from
`3a66182cd`, through architecture integration `3891a97b1`. Its shared
`recordOverlayAuthorityEvidence` already preserves equal-sequence tombstone
priority for both the latest fact and strongest negative. This landing keeps
that implementation and ports the exact mixed-swap warm/cold regression plus
the governing LLP note. The qualification numbers above remain historical
evidence for `886f41706`, not measurements of the subsequently evolved main.
