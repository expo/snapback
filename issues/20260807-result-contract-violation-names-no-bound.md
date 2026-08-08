# SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION should name which constraint failed

**Opened:** 2026-08-07
**Area:** `src/result_contract.rs` diagnostics
**Severity:** DX papercut (P3) — correctness is fine; diagnosis cost is the issue

## What happened

During the Zerobugs zb5-large v2 live run, `fixtureIngestBatch` failed after
6,041 successful batches with:

```
SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION: handler
"zerobugs-control:fixtureIngestBatch" returned a value outside its declared
result contract
details: {functionId, resultContractHash, path: "$"}
```

The result contract was `results.value(v.json())`, whose generated form is
`{kind: "json", maxBytes: 1048576, maxDepth: 16}`. The actual defect was a
**size** violation: the seam echoes all committed rows, and an
issueSearchDocument batch echo crossed the 1 MiB `maxBytes` bound.

Diagnosing that from `path: "$"` alone required ruling out, by hand: interior
NUL bytes, unpaired surrogates, non-finite numbers, `undefined` returns, the
65,536-node validation budget, the 16-level depth bound, and the 4 MiB result
ceiling — a scan of 1.2 GiB of fixture data plus reading
`result_contract.rs`, because the error names neither the violated constraint
nor the observed magnitude.

## Ask

Include in the violation details (all deliberately value-free, consistent with
the existing no-echo redaction discipline):

- `constraint`: which bound failed — `type` | `maxBytes` | `maxDepth` |
  `maxItems` | `nodeBudget` | `requiredField` | `extraField` …
- For size/budget violations: `limit` and `observed` (numbers only).

`path` alone is enough for type/field mismatches but is actively misleading
for whole-value size violations, where it degenerates to `"$"`.

## Notes

- The 1 MiB `v.json()` bound itself is working as designed (codegen refuses
  larger bounds; LLP 0108 owns the vocabulary). This ticket is only about
  naming the violated constraint.
- Found by LLP 0183 Stage 0.5 Lane 8 (zb5-large v2 FAIL receipt,
  `demos/zerobugs/evidence/snapback-control-large.zb5.v2.json`).

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.
