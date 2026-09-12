# Acquired history becomes inaccessible offline after a later send

Status: Open
Date: 2026-09-12
Scope: Snapback3 resource ownership, normalized storage and offline pagination
Related: [LLP 2000](../../llp/2000-snapback3.rfc.md), [focused Clique run](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/README.md), [independent assessment dispositions](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/coordinator-audit.md)

The fixed experimental package at source
`409954115f151a72dd95e897c5f00f36877f11e0` fails a complete acquired-history
offline check when a foreground send advances the sequence after substantial
acquisition. The independent assessor reproduced the failure twice on the
10,000-message account. A startup-send control passed.

Both failed runs fetched every expected message ID. After the later send,
IndexedDB held 503 normalized rows, including 402 message IDs and diagnostic
additions. Closing and reopening the page with the network disconnected left
only 200 of the 10,000 fixture messages reachable through offline pagination;
9,800 were inaccessible. This is not server data loss or a measurement of
9,800 physical rows deleted. First-page offline reads still passed.

Reproduction is retained in the run's
[grader driver](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/grader/grading/measure-acq-grader.mjs)
and both full records:
[first](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/grader/grading/evidence/gacq-1789230357769/u0500-1.json),
[repeat](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/grader/grading/evidence/gacq-1789230955890/u0500-1.json).
On a copy of the frozen app and fixture, run
`ACQUIRE_ACTOR=u0500 ACQUIRE_REPS=1 FG_DELAY_MS=20000 node grading/measure-acq-grader.mjs`
with the documented owner and web server. Keep failed and successful attempts.

The sequence-wide fence in `resource/storage.ts` clears stored rows and
resources before admitting a different sequence. `FactPool.prepare().commit()`
likewise clears its prior pool when the sequence advances. This source behavior
is consistent with the observed replacement by currently live resources.
Removing those fences without a sound authority/completeness model is not a
proposed repair.

Resolve the retention contract and SDK behavior together. A declared acquired
dataset must remain usable after unrelated authorized writes, or explicitly
become unavailable and reacquire before reporting durable readiness. The
application should not have to reconstruct cache ownership across every send.
Verification must cover sends after early, middle and late acquisition;
offline all-page reads after physical reopen; exact IDs and content; unchanged
operation identity and once-only settlement; and account, authorization,
revocation and generation transitions. Do not accept a fetched-ID accumulator
or one available page as evidence of full durable acquisition.

No repair was applied during the pinned-package benchmark.
