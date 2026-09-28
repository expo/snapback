# LV round 3 — complete read dependency footprints

Implemented on `sb4-intent/lv-hook-retention`, from `4c09767cc`. First ran
`git fetch origin && git merge origin/main`; already up to date. Read the
rounds 0–2 prompts, reports, journal and LLP 3000.029, and Astra's full round-2
NOT READY review. Grok was still running at the initial check; its completed
review was read in full during the work and checked again before completion.
Both reviews' findings are addressed. [Input digests](./inputs.json).
Local commit only, with the GPT-6 Astra co-author trailer; no push/publication.

## Implementation

[LLP 3000.029 §9](../../../../llp/3000.029-hook-retention-with-invalidation.rfc.md#9-round-3-complete-footprints-by-construction)
states the missing premise of the fence proof: every reported footprint must
include every table on which authorization or the answer can depend.

The compiler starts from all lowered query read sites, including untaken
branches, helper calls, joins and alternate indexes. It takes a fixed-point
closure over read-rule probes, read-through parents, all maintained sources,
row-key/parent-key dependencies, private maintained-column sources and timeline
sources/work. Sources are unconditional, independent of expiry, occupancy,
authorization success or local coverage. Cycles terminate by visited set.

The certificate is `schema.operations[name].reads`. It is computed before
private derivations are removed from the public device projection. The shared
Rust runner unions it into read metadata on server and device after evaluation,
preserving existing word-read meter charges. Native queries conservatively
cover all visible tables; raw/legacy programs without a certificate cover all
schema tables. Explicit empty certificates prove constant queries. The SDK
uses the same certificate for pre-evaluation fences and registers the engine's
reported tables for existing observations. Its legacy metadata path also closes
over parents and maintains. Runtime expiry bookkeeping remains separate.

Thus authoritative parent/source evidence withdraws child points, aggregates,
private maintained columns and overlapping aliases, and blocks new evaluations
against the old replica until apply. Maintained sources also inherit their own
parents, rules and sources. No new authorization or row-independence exemption
is introduced. Execution fact types moved from `schema.rs` to `schema/execution.rs`
to keep the source cap; `schema.rs` is 1,430 lines, `local.ts` 1,488 and `read.rs`
1,500. No package dependencies were added; runtime meter limits and the wasm
cap are unchanged.

Sync now captures already-outstanding predictions by table as well as the
revision covering admissions/settlements during the request. Relevant or
unknown effects invalidate a public-put proof; an already-pending notes write
does not invalidate `myProfile`. Missing queue entries or an incomplete pending
capture fail closed. The comparative's actual profile schema is used on process
and wasm, with a held notes send and a later profile update.

Grok's low-priority receipt cost finding is also fixed. A shared validated cut
lets contiguous known mutation receipts visit only affected index buckets.
First/unknown/gapped receipts retain the full interval check; new bodies still
meet the client publication floor. Four hundred unrelated receipts over four
hundred watches visit **400** owners total; a subsequent gap withdraws all old
owners. Scope reset clears the shared receipt cut.

## Independent evidence

- The compiled-schema census builds a separate graph from serialized table
  declarations and read roots from serialized IR. It does not call the
  production walker or consume its `reads` certificate as the expected answer.
  It bounds compiler/server/device dependencies for every query in the fixture,
  including helper/alternate-index/join/untaken paths, transitive parents and
  sources, rule probes, cycles, timeline inputs and private column projection.
  HTTP process/wasm censuses additionally assert identical engine metadata.
- Real online, process and wasm tests hold changes and sync, delete the
  child/parents or source, and deliver an authoritative remote `null`. Existing
  tree, non-expiring sum and private-column observations withdraw. New local
  aliases cannot return the old value; all recover after apply.
- Both already-pending comparative profile cases retain data without a loading
  publication. Unknown/relevant/missing prediction capture is separately tested.
- The independent history model now applies intermediate replica cuts, rather
  than always jumping to the newest cut. A named finite-fence test checks every
  intermediate cut below each evidence cut 3–50, including newly opened aliases.

Against the exact round-2 server/client and round-2 wasm, the initial new suite
fails **10** cases: six tree/sum host cases, two censuses and two profile cases.
The private-column regression separately fails on all three clients. The
baseline test harness imports the new standalone capture helper only to load
the test module; the old local implementation never calls it. Deliberately
releasing finite fences early fails **17** tests (16 independent seeds plus the
named regression). Restoring the receipt scan fails **160,000 versus 400**.
All expected failures and setup details are in [FAILURES.md](./FAILURES.md).

## Verification

Ran `bash scripts/test.sh` from `snapback4/` **exactly once**. Exact summary:

```text
== 2 failure(s) in 1724 s
   cargo test
   client tests
```

[Full log](./test-sh.log.gz), exit 1. This is an intermediate red run, not a
green final-tree full qualification. There are ten Rust failures (old dependency
lists/schema bytes), six Following metadata assertions and one delivery await
classification failure. The new queue capture also deadlocked the matrix's
test-only hold; only that stuck child was terminated in the full and affected
runs. Main client summary: **4,240 tests / 4,223 pass / 7 fail / 10 skipped**,
with the matrix incomplete. Acquisition/server shards all pass. The subsequent
full-count client models pass **79/79**. All other top-level build, wasm,
typecheck, release-guard, docs-budget and fixture-wrapper stages pass.

Every failure is **ours**, including fixtures and verification setup; there is
no baseline or environmental product-test exemption. Each name, disposition
and evidence link is in [FAILURES.md](./FAILURES.md) and
[failures.json](./failures.json). Final checks below cover the fixes. Counts in
different scopes overlap and must not be added except where explicitly split.

| Final scope | Result |
| --- | --- |
| Broad affected client run, all cases outside the interrupted matrix | **1,221 pass**, including old/new retention tests, both existing browser gates, acquisition, authority/assets, Following, maintained columns, timelines, word search and client seams. [Exact command](./affected-command.json), [original log](./affected.log.gz). The log's 1,253 passes also contain 32 partial matrix cases, and its sole failure is the stale boundary. |
| Complete repaired delivery matrix | **315/315**, all 157 awaits classified and tested transiently/persistently. [Log](./delivery-matrix-final.log.gz). Combined with the preceding disjoint non-matrix cases: **1,536 affected tests pass**. |
| Focused retention/census/model/cost tests | **66/66**: 14 real footprint/profile cases, 43 history/fence cases, 9 index/cost cases. [Log](./retention-final.log.gz). |
| Whole guide + Rust census + read-through review + historical schema compatibility | **98 + 3 + 35 + 1 pass**, zero failures. [Log](./guide-final.log.gz). |
| Core aggregate metadata; native server/device parity; frozen search fixture | **3 + 8 + 1 pass**, zero failures. [Core](./core-final.log.gz), [native](./native-final.log.gz), [search](./search-final.log.gz). |
| Client build/declarations | Pass. [Log](./client-qualified.log.gz). |
| Reference and whitespace audit | 523 LLPs, 9,873 references, zero errors/unchecked; `git diff --check` passes. [Log](./ref-check.log.gz). |

Product semantics were frozen for the broad affected run; a final trailing blank
line cleanup in `schema/execution.rs` has no semantic effect. Subsequent test
edits repair the delivery matrix inventory/hold, qualified by its complete rerun.
No known failing affected test remains. Source digests are recorded in
[qualified-sources.json](./qualified-sources.json). Only reads-06 changes in the
guide fact-home snapshot. The maintained word fixture differs only by the new
compiler certificates. No new Expo/iOS UI qualification is claimed.

## Wasm and custody

Final canonical wasm: **2,042,203 bytes raw / 593,640 bytes GNU file-input gzip-9**.
The unchanged cap is **593,719**, leaving **79 bytes**. SHA-256:
`ac18ec094d1c596bda96caa164870f25192a1463397f5bd97f57e436338fe0bc`.
[Measurement](./wasm-measurement.json), [build log](./wasm-qualified.log.gz).
This is +1,204 raw / +427 gzip bytes over round 2. Earlier over-budget designs
were replaced, not granted a larger budget.

No shared tool install, push, deployment or publication. Generated wasm,
isolated counterfactual builds and test stores remain uncommitted under their
ordinary ignored paths; report logs are compressed without editing their content.
