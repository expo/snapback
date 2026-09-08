# Metadata JSON projection and 0.0.20 — round2 sol review

**Date:** 2026-09-08
**Target:** `a826919984a91358aeeb6d2f8418b4684dc49da6`
**Baseline:** `d19d9399ec07c0dd3b5ec14974259f382636dc6e`
**Reviewer:** fresh gpt-5.6-sol / xhigh session `01a08044-8fc6-72d3-9afe-b28b4feac20d`
**Method:** read-only exact-object inspection; no product execution

CHANGES REQUIRED

Material findings:

1. `metadata.ts:15-17` loses JSON property-key semantics by calling `JSON.stringify(value)` in isolation. A custom `toJSON(key)` therefore receives `""`, while whole-state JSON normalization receives `"futureJson"` or the changed child’s name. Direct and journaled projections can reopen different data than `JSON.parse(JSON.stringify(state))`, contradicting LLP 1012 §4 (`llp/1012-local-first-v1.spec.md:322-328`). The test at `sqlite.test.ts:521` uses a key-insensitive `toJSON`, so it misses this case.

2. `metadata.ts:31-46` reconstructs the header from the raw shape of untouched roots whenever another root changes. For example, after directly persisting a `Date`, a subsequent journal containing only `clock` classifies that untouched `Date` as an object and overwrites its scalar string header with `{}`. The sparse-array control at `sqlite.test.ts:480-505` covers arrays but not untouched Date, boxed, or scalar-returning `toJSON` roots. Since this delta explicitly supports those coercions, this is within scope.

Non-blocking observations:

- A length-only shrink scans and parses every owned key under the array (`metadata.ts:67-70`). Payload serialization remains delta-bounded, but CPU/allocation is not strictly changed-record-bounded.
- Old 0.0.19 split records never stored trailing/all-hole array lengths, so already-lost lengths cannot be recovered. That is inherited, not introduced here.
- Atomic publication, post-commit key ownership, failure/retry behavior, unrelated bytes/outbox preservation, new-layout array restoration, and the 0.0.20 version metadata otherwise appear consistent by source reasoning.

I inspected exact Git objects for the named files, Snapback2 AGENTS/rules, LLP 1000, LLP 1012 §4 and its indexed-search reference, LLP 1013 §3, and targeted projection callers/carriers/journal code. I did not inspect working-tree state or execute builds, tests, probes, agents, or network operations. I treated the reported Node 22 results as reported only; Node 24/root qualification remains pending. One overly broad exact-object grep accidentally surfaced a single line from an excluded LLP 1013 review artifact; I did not open or rely on that artifact.

## Root adjudication

Overall candidate rejected for publication. Root accepts Sol’s key-sensitive
`toJSON` and unchanged coerced-root header findings. Grok’s READY verdict and
its narrower native-JSON interpretation are retained, but the candidate’s
explicit coercion support makes the sequential-write counterexample in scope.
The third revision must preserve named normalization and durable root shape
without retaining another payload baseline or walking untouched metadata.
