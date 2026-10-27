# SEC13 evidence and deadline questions

Six calibrated wave-32 shapes are now witnessed in default output. Five safe
variants have no corresponding witness. Required evidence uses SEC11 item 1's
nonblocking witnessed-question class, not a new deployment veto. Acknowledgment
requires a current evaluable replay and the exact existing witness answer.

`actual-lanes-transcripts.json.gz` retains default text and redacted witnesses.
The copies in `crates/snapback4-lang/tests/security/sec13/` preserve original
lane hashes; `tools/qualify-lanes.py` defines the safe transformations. The real
source directories were read-only. Default native output is 3–6 lines for the
actual lanes, 2–5 for safe variants.

`survey-summary.json` and `survey-800-comparison.json.gz` compare 800 identical
source hashes using SEC11 tooling, check-only. Gate identities and exits are
unchanged: zero newly introduced/false gates. Two baseline watchdog timeouts
were retried with the same binary and a longer outer timeout, not more work.
Private original/composed records remain at the provenance path.

The semantic binary measured median 3 / p90 8 lines (baseline 3 / 7). Joining
each existing default witnessed card into one complete line fixes that budget.
The ignored Rust corpus test re-renders all captured cards, asserting their IDs
and complete summaries remain present; its **renderer replay/projection** is
median 3 / p90 6 / max 12. This is not a fresh native final-binary 800 run.
The final native ten-case lane/safe run checks the actual format. No questions,
answer templates or witnesses are truncated to achieve the budget.

Latency acceptance remains **unqualified**. The launch base lacks SEC11L's
performance changes; loaded-host cold-50 review p90 rose 37.489→43.277s,
deploy fell 61.667→55.841s. These are not no-regression evidence against SEC11L.
See `latency.json`, raw rows and the open SEC13 latency ticket.

Ordinary differential 2k has zero disagreements. Lean 2k reproduces SEC11's
18 known disagreements with identical signature counts (5/8/5), not a clean
Lean PASS. Source reviews round 4 and display reviews round 5 are independently
READY from Muse and fresh Codex; all earlier responses remain verbatim.

Retained compressed logs show 128 guide tests, 32 CLI integration tests,
28 decision tests, the corrected installed security proof (3/3), and all
800 formatter replays passing. The first packed run's new assertion wrongly
expected exit 1 instead of the established usage refusal 2; the retry fixes
the test, not product semantics. Final scoped selection and additional results
are described in the workstream report. The canonical affected plan expands
to prohibited full pools; the disclosed scoped runner preserves that original
plan, omissions and receipts, and never calls it a complete canonical PASS.
No version bump, publication, Mac run, or push.
