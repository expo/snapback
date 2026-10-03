# Snapback 4: decorationExpiry breaks three published capability-fence comparisons

Status: Open
Date: 2026-10-02
Scope: SJ device query reply, `packages/snapback4/test/schema-capabilities.test.mjs`
Observed by: NX round 9 merging main `5e12646aeefa`

The canonical mini suite and an unchanged isolated run both fail:

- `published 0.2.33 capability fence: timeline-v2`
- `published 0.2.33 capability fence: recorded-attribution`
- `published 0.2.33 capability fence: maintained-column`

Each reaches `sameAnswer` from line 222. The actual current query reply contains
`decorationExpiry: null`; the published 0.2.33 reply has no such key. The
comparison permits the documented additive `scopes` and commit-only
`preserved` evidence, but otherwise requires exact query keys.
`crates/snapback4-device/src/call.rs:144` includes the new key unconditionally.
The SJ history includes `90c6b168b6` and `5929c5d164`.

This is attributed to the incoming baseline by source identity: the complete
core/device trees, capability test and current reply producer are unchanged
from fetched main. The additional isolated run was on the merged mini tree,
not a separately compiled main-only Darwin binary. The four UB Rust failures
were independently reproduced on main alone; they are a separate ticket.

Decide whether ordinary undecorated replies should omit this field, or whether
the same-version compatibility allowance should admit it with an explicit
contract. Do not loosen unrelated key checks or skip the published fence.
NX round 9 changes neither the reply nor the assertion.

Evidence: `snapback4/reports/20261001-nx-export-proves-native/round9/`
`capability-followup.log`, `baseline-attribution.json`, and the canonical
full-suite log identity. Original bytes are retained in that report's external
`EVIDENCE-ARCHIVE.tsv` archive; small committed log views preserve the failures.
