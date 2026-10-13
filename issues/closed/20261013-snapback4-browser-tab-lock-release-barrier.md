# Snapback 4 browser journal fixture races Chromium tab lock release

**Status:** Resolved
**Date:** 2026-10-13
**Scope:** online-journal-browser.test.mjs; LLP 3000.013.000 §4.5

Integration 7's second full Linux client pool (96 CPUs, 24 file slots) timed
out the last recovery scenario at 122000 ms: the peer reopened after page.close
but never adopted the localStorage capture. The same complete file passed in
the first full pool and a diagnostic rerun. No product source changed between
those runs. This was not a clean second full-stage pass.

A diagnostic rerun directly observed the closed owner's runtime lock still
in navigator.locks.query().held **after page.close resolved**. The closed
owner runtime was 01M4SKQXVDHDE4GFF5H0B7V9PX; its held lock was exactly
snapback4-online-runtime:01M4SKQXVDHDE4GFF5H0B7V9PX. This establishes that
page.close is not a synchronous Web Locks release barrier on this Chromium.
Whether it caused the earlier timeout is an inference consistent with the
capture implementation's one opening snapshot and refusal to adopt any
record whose owner is still held/pending. There is no evidence of port or
file-limit exhaustion. Logs are retained in the Integration 7 proof archive.

Resolution: retain the live-peer/no-execution assertion and exact once-only
recovery assertion. After closing the owner, poll the real Web Locks snapshot
for that owner's absence before reopening the peer. No lock is released or
forged by the fixture, no product timeout/assertion is relaxed, and the same
hang guard diagnoses a missing release. Record the after-close snapshot for
future failures. This makes the intended dead-owner precondition explicit.
The repaired full client pool and Mac results are recorded in WORKSTREAM-REPORT.
