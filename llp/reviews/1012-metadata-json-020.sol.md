# Metadata JSON projection and 0.0.20 — Sol review

**Date:** 2026-09-08
**Target:** `170ebacd5411bef1345845a4f141c71c57634a52`
**Baseline:** `d19d9399ec07c0dd3b5ec14974259f382636dc6e`
**Reviewer:** fresh gpt-5.6-sol / xhigh CLI session `01a0801b-4a54-7aa1-bc0a-e638f750f103`
**Method:** mutually blind read-only review of frozen git objects; no product execution
**Raw response SHA-256:** `93f5cca5a8dd3d16c6265a6d5caeff2b4e5f2a06200682462ec0dcd702eb84d1`

CHANGES REQUIRED

Confirmed material findings:

1. Journaled writes are no longer changed-record bounded when unrelated array metadata exists. At `170ebacd:snapback2/packages/snapback2/src/store/metadata.ts:31-44`, any root change—such as the routine `clock` change during an outbox swap—rebuilds the shared header and materializes every unchanged array as `Array(item.length).fill(null)`. `ProjectionCache.prepare` then serializes and writes that dense header. Thus an outbox-only change can perform O(array length) allocation and I/O for untouched metadata, contrary to LLP 1012 §4 and LLP 1013 §3. The new journaled test at `sqlite.test.ts:424-428` never combines an unrelated root change with an array, while existing outbox controls count statements rather than serialized bytes.

2. Cold restoration still violates generic JSON object semantics for an own `__proto__` child. At `metadata.ts:89-95`, assigning `(result[field] ??= {})[item] = value` invokes the inherited `__proto__` setter instead of creating an own property. A projected object with an own `__proto__` member therefore reopens with different JSON and altered local prototype state. This is reachable through generic future metadata and concretely through user-keyed metadata such as `onceColumns`; Quarry accepts underscore identifiers and deliberately constructs special-name-safe schema maps. This defect is inherited from the baseline, but it is in scope for the candidate’s newly documented generic JSON projection guarantee. The added object tests cover only ordinary keys.

No verdict finding depends on a hypothesis, and I found no separate inherited unrelated issue requiring mention. The four version/lock files consistently move the workspace, package, platform dependencies, and lock metadata from 0.0.19 to 0.0.20.

I inspected the complete exact-object delta from `d19d9399ec07c0dd3b5ec14974259f382636dc6e` to `170ebacd5411bef1345845a4f141c71c57634a52`, the frozen source and relevant callers, tests, release metadata, Snapback2 instructions/rules, LLP 1000, LLP 1012 §4 and its indexed-store material, and LLP 1013’s carrier contract. I did not inspect mutable working-tree state, peer reviews, or benchmark-builder context, and ran no builds, tests, probes, benchmarks, network operations, or writes. The reported 6/6, 23/23, and 2/2 checks were treated only as author-reported execution.
## Root adjudication

Both findings accepted. The routine clock/header path can serialize unchanged
array length, violating the journaled work bound. Own `__proto__` restoration
is inherited but violates the generic JSON contract now being repaired.
Candidate `170ebacd5411` is rejected for publication despite passing functional
tests and full-engine package qualification. Revise these paths with focused
regressions, then qualify and independently review the revised source. The
independent Grok READY verdict does not resolve these concrete findings.
