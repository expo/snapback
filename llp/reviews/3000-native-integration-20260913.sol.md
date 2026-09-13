# Received native integration review

Reviewer: Codex gpt-5.6-sol, xhigh, client lane; 2026-09-13.
Inspected: `7c4cbfdc9`, static code only. This scoped integration review does not complete the earlier broad partition/meter review.

Three major lifecycle findings:

- A backend adoption left the previous native module/digest installed. The JavaScript replacement fetch silently ignored failures and install denials, allowing old module results under the new schema or suppressing online fallback.
- Opening an invalid kept module left its digest advertised even when compilation produced no module. The client saw the desired digest and skipped repair.
- Downloaded bytes were labeled with the schema digest without verifying the bytes. A schema/module rebuild race or cached stable URL could install one module under another digest.

No regression was found in the scoped metadata, transaction and meter paths: native server/device outcomes preserve `next_expiry`; device native queries use deferred read transactions; both native and Quarry device paths retain default ceilings and core accounting; a denied backend adoption still leaves JavaScript backend/generation unchanged.

Inspected files: core engine local/mod/native, device device/call/store/sqlite and native-read tests, package backend/local, server native descriptor/module route, meter/runner output accounting. No tests or probes were run. Implementation follow-up and qualification are recorded in the journal.

## Follow-up review — generation-bound cache

A separate Codex gpt-5.6-sol xhigh reviewer (language lane, which did not write these cache corrections) reviewed `ff50eb1ae809feefa2a89495ac4a959d32cccb52` against `7c4cbfdc9`, limited to device.rs, call.rs and native_reads.rs with the existing store contract. No other reviewer outputs, builds or tests were used in this static pass.

**Received verdict: NO MATERIAL FINDING.** SHA-256 is checked before compile/persistence and again on reopen; the JSON install requires a generation and refuses obsolete late installs. Bytes, digest and generation commit atomically before the in-memory swap. Adoption invalidates the triple in the backend install transaction, with no fallible post-install cleanup. Reopen exposes only a validated, compiled module from the same generation and otherwise deletes the cache or fails closed. The reviewer inspected the seven discriminating regressions, including interrupted adoption and a store that refuses post-install transactions.

All seven native-read regressions also passed in the separate complete-suite qualification at `669dc0c01`, whose native cache implementation is unchanged from the reviewed revision.
