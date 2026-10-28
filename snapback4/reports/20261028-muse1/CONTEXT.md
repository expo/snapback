# MUSE1 context pack and method

Scope: CLI proof packet emission, the start/workflow proof route, and existing
verify behavior. No engine, security binder, package root, Write<R> or generated
client surface change.

Governing: LLP 3000 §7 (candidate fence and decisions),
LLP 3000.011.003.000.000 §20 (packet coverage, edited-file custody, current facts,
real users and private staging lifecycle), LLP 3000.037.000 §14 (ordered first-red
verify loop and owner cleanup), §12 (bounded output), §11 (bounded workflow),
§15 (this amendment). LLP 0189 D-2 and LLP 0232 govern affected verification.
Source refs resolve to these constraints; the new default supersedes only the
old automatic emission/default route. Hand-off: scoped amendment/source reviews.

`parse.py` copies ~/sb4-loop/wave34r1-repro/tx/parse.py, retaining the Codex
issuing-call fix and adding npm-run-verify recognition before shell reads.
Use APPS, OUT and PAR=4 to reparse both waves identically. `analyze.py` reuses
that directory's agg.py, scripts/calls.py and scripts/docs.py and consumes the
two parsed outputs. The original scripts/wall.py informs the union-split tool
interval metric; it must not be imported because its top-level code writes its
original outputs. Builder provider timestamps/context usage come from archived
sessions, not grep counts of words. No source lane/store is edited.

The per-tool token estimate divides observed context growth between model output
and tool text, then weights tool text by remaining calls. It measures repeated
context exposure, not causality. First-tool purpose hides mixed shell commands;
masked failures and truncated command text make cycle counts a lower bound.
`paired.json.gz` retains per-idea sums, purposes, categories, cycles and feature
estimates. `decomposition.txt` is the readable comparison. Baseline tarballs and
native hashes are pinned in baseline-pins.json and checked against the reruns.

Replay selection is fixed before any new run: four largest Muse absolute input
regressions (019,032,026,035), plus Codex 001 and 014. New whole-session results
will be retained separately; these transcript comparisons are not replays.
