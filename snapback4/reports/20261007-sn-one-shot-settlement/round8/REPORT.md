# SN round 8 — restore Following withholding checks

Base: `71f0bd35ef`; work stayed on eb1000. Only tests, test fixtures, mutation
controls and this report/journal change. No SDK, compiler, device, wasm budget,
or settlement-contract changes. Nothing pushed.

## Following custody coverage

Read Astra's round-6 review and full evidence at
`~/sb4-intent/reviews/sn-r6.astra.md` and
`~/sb4-intent/reviews/sn-r6.astra.evidence/REVIEW.md`. The review correctly
identified that final `postState` payload checks could not detect premature
publication: `{ liked: false, reposted: false }` stays the same across the write.

The eight Node variants (wasm/process × keep × waitSeconds) and four browser
variants (worker false/true × adopted follow/unfollow) now track both `cards`
and `postState`. Before releasing the POST, each fixture waits until each read
has entered the real custody wait or returned a premature result, then asserts
that both reads remain unsettled. A transparent wrapper calls the original
`QueryCustody.wait` with its original arguments and returns its original
promise; it only signals entry. No timer, queue, transport or custody decision
is replaced. Node restores the wrapper with the test mock lifecycle; browser
fixtures have separate page contexts.

After the POST outcome is saved and before sync/apply is released, the fixtures
start a fresh pair of reads, await the same causal boundary, and assert both
the original and new pairs are unsettled. This tests acknowledged-but-unobserved
custody independently of a still-sleeping original read. All original terminal
write, mounted observation and final one-shot assertions remain; new reads
also have final row/payload assertions. No assertion is replaced by a delay.
This exercises the existing LLP 3000.023 §11 contract without changing it.

## Negative controls

The original Astra loader was run unchanged from its evidence directory
(`early-post-state.mjs`, SHA-256
`90d30c526a8917bba5007fe19b3ea924f2775da968966790bbb91c5ee5b4d484`). Its exact
`postState` custody bypass now fails **8/8** Node variants at the new
before-execution assertion, with a logged complete result before POST release.
The same loader with its bypass disabled passes **8/8**.

[custody-bypass.mjs](custody-bypass.mjs) applies Astra's exact product mutation
through Vite for Chromium: **4/4** browser variants fail before POST execution.
Its additional receipt-only mutation bypasses `postState` custody only when a
successful but unobserved receipt exists. Admission checks pass, then **12/12**
Node/browser variants fail at the new before-apply checks. All **12/12** pass
with that control loader disabled. These are expected assertion failures, not
timeouts, loader failures, or changed final-answer expectations.

Logs: [Astra bypass](astra-bypass.log.gz),
[Astra disabled](astra-bypass-disabled.log.gz),
[browser POST bypass](browser-post-bypass.log.gz),
[receipt bypass](receipt-bypass.log.gz),
[Node/browser disabled control](custody-bypass-disabled.log.gz).

## Bounded-following time

Three groups per device host now start held reads concurrently, while the
fixture's writes and link state remain unchanged. Every read retains its real
30-second budget. All 219 assertion sites, all 20 declared timeout bounds, the
39 generated tests, and all online/offline, transport-failure, held-sync and
post-observation controls remain. No hold is released earlier. Raw-device
evidence selects the matching operation among evaluations since that read
started, so concurrency cannot substitute another query or an earlier phase.
[Assertion audit](assertion-audit.txt).

Before measurements come from the passing round-6 complete suite, with the same
product runtime and bounded-following source as the round-7 base; this is a retained
baseline, not a new baseline execution. [Extracted timings](bounded-before.json),
[original log](../round6/full-suite.log.gz). The final file run passed **39/39**
in **1,210.456 seconds**, down from **1,690.504 seconds**: **480.048 seconds
(28.4%) saved** on Linux. No macOS timing is claimed.

| Case | Wasm before → after | Native before → after |
| --- | --- | --- |
| Owned-event fallback | 128.6 → 38.5 s | 128.1 → 38.0 s |
| Speculative refusals and empty pages | 128.2 → 38.1 s | 128.1 → 38.2 s |
| Static and helper dependencies | 124.2 → 64.2 s | 124.3 → 64.3 s |

[Final timings](bounded-after.json), [final log](bounded-following-final.log.gz).
The helper case still includes its separately sequenced held-sync deadline.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Seven requested files | **267/267**, zero failures/skips | [Batch log](seven-files.log.gz) |
| Final bounded-following after restricting raw evidence to each new evaluation | **39/39**, zero failures/skips | [Final log](bounded-following-final.log.gz) |
| All `one-shot*`, dependency and query-publication/session regressions | **378/378**, zero failures/skips | [Log](one-shot-dependencies-publication.log.gz) |
| Original Astra bypass and browser equivalent | **8 + 4 expected assertion failures**; disabled Node control **8/8** | Logs above |
| Receipt-only bypass | **12 expected assertion failures**; disabled Node/browser control **12/12** | Logs above |
| `./ref-check`, `git diff --check` | Pass | [Ref log](ref-check.log.gz) |

The batch includes follow-window **24**, bounded-following **39**,
retained-history **78**, page-ready **3**, online-client-model **29** (the full
3,000 seeded interleavings), per-row-liveness **17**, and worker-regressions
**77**. During that batch, the bounded-following raw-evidence selectors were
tightened to exclude earlier evaluations; its final 39/39 rerun verifies that
last edit. The other six files were unchanged. Reruns are not additional unique
test counts. [Commands and intermediate-run notes](commands.txt).

No complete `scripts/test.sh` rerun: changes are confined to these tests and
fixtures plus mutation controls and report/journal evidence, as permitted by
the round-8 instruction. No new macOS run or full-suite qualification is claimed.
