# Diary 0112: Sol-high Clique local-main 0.1.25 — both profiles

**Date:** 2026-08-22
**Run:** `benchmarks/runs/2026-08-22-clique-local-main-0125/`
**Lanes:** GPT-5.6 Sol high, Clique M1–M3, Explicit + Familiar, serial
**Backend:** local source `9a30362362ca` as candidate closure 0.1.25
(`bakeoff-0-1-25-9a30362362ca`) via a run-private loopback npm registry;
nothing published
**Outcome:** both lanes M1–M3 green — Explicit 58m05s / 20 loops,
Familiar 1h25m29s / 18 loops

This consolidates both lanes of the rerun; diaries 0104/0105 covered the
2026-08-20 predecessors.

## What changed since 0820 — from the lane's seat

The big wins were invisible until they didn't happen. No lane ever saw
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`; no lane drowned in
`MIGRATION_PENDING` advisories (zero vs 19/17 last time); no lane hit the
nullable-point-query or membership-`_id` Guide drifts. The Familiar lane in
particular stopped fighting the framework: 46 correction events became 18.
Whatever landed between `708e2e5c` and `9a303623` for live-query stability and
write-posture summaries worked in this sample.

## Delivery upgrade worth keeping

This was the first benchmark run where lanes consumed an **unpublished**
closure through the exact publication shape: `snapback-publish.mjs` dry-run
packed the full candidate closure including the sealed clean-release runtime,
and a ~150-line loopback registry served those tarballs with public passthrough.
Lanes scaffolded with plain `npm create snapback-app@0.1.25`. The debug-binary /
`SNAPBACK_RUNTIME_BINARY` machinery from 0820 disappeared entirely, and its
setup-defect class (missing packages, missing prepack outputs) is structurally
gone — the packer refuses incomplete closures. The registry server lives only
in the private run dir; if unpublished-closure runs become routine it should be
promoted into `benchmarks/tools/`.

## What still fought every lane

The Expo dev supervisor remains the shared tax. Both lanes had to abandon the
supervised path because it hardcodes bootstrap/Metro auxiliary ports outside
any declared budget (`SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE`, one
structured excursion to forbidden port 54050) and wrap or split the backend
from the web server by hand. This is now the top recurring cost across three
consecutive runs; the fixed-origin ticket owns it.

New this run: authored refusal codes die at the client envelope.
`DUPLICATE_HANDLE` arrived as `SNAPBACK_APP_REFUSAL`, membership denial as
`SNAPBACK_HANDLER_FAILED` — each collapse cost a real correction loop because
the lane couldn't distinguish product behavior from harness mismatch. And one
Guide example per profile was rejected by codegen (`whereApplicable` index
option; scalar live-query result contract), so guide↔codegen reconciliation
still has residue.

## Orchestration experience

Staging hit one genuine instrument gap: the consumer skill body (10,534 B)
now exceeds LLP 0259's own 10 KiB ceiling, which lane-setup enforces — Rung A
landed after the emitter was written. Trimmed with disclosure; ticket filed.
Everything else in the harness chain (lane-setup against a `git archive`
instrument snapshot, first-edit markers, preflight, metering) worked
unchanged from the documented procedure.

One process note: a separate session's published-0.1.24 xhigh run was
mid-flight when this run staged, and it aborted on a browser-control handoff
failure before any green. These lanes queued behind it via a watcher; serial
execution held, but the machine still hosted unrelated ultra-effort agent
work throughout, so wall-clock carries the usual ambient-load caveat
(one-minute samples retained).

## Comparison notes (vs Convex-shaped alternatives)

The Familiar essay's verdict is the sharpest one-line assessment yet:
"Snapback's novelty is not mainly in writing a query; it is in the disciplined
chain from authored source to generated artifact, admitted runtime, live
client, and identity-bound evidence." When that chain works — as it did this
run — the strictness reads as reassurance rather than cost. Explicit's essay
praised set-state edges and conversation surfaces as naturally idempotent and
reviewable, costing ceremony only where declarations are genuinely load-bearing.
