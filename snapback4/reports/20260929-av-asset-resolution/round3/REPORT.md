# Lane AV — asset resolution, round 3

2026-09-29; branch `sb4-intent/av-asset-resolution`. First fetched and merged
origin/main `6d8e530674f3cb69179d6784631da25493b0099f` into round 2
`957d7961cabbbd0b9e79ce89bb887bc2f54e9eb7`; local merge `8f937a1ee`.
Preserved both sides of the journal and LLP 3000.019 revision conflicts.
Regenerated the await fingerprint from the combined client rather than choosing
one lane's digest. RL, AG and AQ changes remain in the merged source.
Nothing pushed or published.

Read all prior prompts/reports and Astra's complete round-2 NOT READY review.
Grok had only progress notes at the start and completed READY WITH CHANGES
after the full run; its full review and final recheck are recorded below.
Orientation and governing constraints are in context.md.

## Both findings

**Buffered fetch/body allowance.** The five-second timeout now starts after
headers only for streaming bodies or refusal decoding. Successful streamless
Blobs get 60,000 ms plus Content-Length at 32 KiB/s, rounded up; absent/invalid
length uses the server's 64 MiB upload maximum. Larger sizes are clamped to
that maximum. The maximum opaque wait is 2,108,000 ms (35 min 8 s).

An arbitrary fetch can expose its first response and headers only after
buffering every byte. Before it resolves the downloader knows neither size
nor streaming capability, so that promise also uses the maximum opaque
allowance. This is an explicit responsiveness tradeoff: a host that never
returns headers is detected later too. It is impossible to enforce a
five-second first-response bound on that generic promise while permitting its
healthy buffered transfers. This is not a native progress API or a physical
React Native qualification.

Queue/backoff keeps a separate cumulative thirty-second budget that excludes
active transfer time. Only real byte progress replenishes it. Four attempts,
ten seconds cumulative backoff, positive jitter, six active bodies and
Retry-After custody remain. Calls are finite even if a custom fetch ignores
abort. Client/session cancellation still interrupts active opaque transfers;
late responses/Blobs are disposed without URL publication or retention.
Error-body decoding remains bounded at five seconds after headers.

The new Chromium hook regression streams a real HTTP PNG in twelve parts over
six seconds. It exercises two adapters: completion-only fetch and headers-first
streamless Blob. Each adapter resolves an ordinary and a one-view image through
real `createClient.asset` and `useAsset`. All four must reach ready and paint
with positive naturalWidth. Ordinary requests occur once; once requests have
one Range refusal followed by exactly one non-range request. The test fails on
merged round-2 source and passes with the fix; the first green run observes
6,000–6,002 ms per body. This tiny slow image models duration and buffering,
not bandwidth or native media-layout performance.

**Empty-chunk regression.** Production already ignored zero-length chunks.
The new test sends real bytes once, then empty chunks at two and four seconds.
At five seconds it requires abort and reader cancellation. It repeats through
all four attempts and requires a settled explained E_CLIENT, with no fifth
request. Replacing the guard with `if (true)` fails the cancellation assertion.
The mutation was restored before affected/full checks.

Additional virtual-time checks cross thirty and sixty seconds without ending
an opaque transfer, enforce a 92-second limit for a 1 MiB Content-Length,
enforce the maximum for missing/invalid/empty lengths and unresolved fetch,
dispose a late response/Blob exactly once, and enforce cumulative queue/backoff
rather than granting a new thirty-second allowance on every attempt. Existing
real progressing streaming, stalled-body Retry-After, revocation, rotation,
cooldown and ambiguous-once tests remain.

The multi-tier avatar fixture now injects a headers-received body stall for its
five-second timeout probe. Opaque never-settling-fetch recovery is independently
checked with virtual time at the documented finite deadline. The historical
round-1 measurements remain historical; they are not rewritten as new timings.

Updated LLP 3000.008.002.000 §6, guide media/assets and the operations manual.
No server authorization, view-consumption, retention-grant or contract.ts change.
The downloader's await inventory retains nine awaits; the local asset method
adds an await for refresh. These are outside delivery receipt custody. The
combined boundary fingerprints were regenerated and checked; no delivery fault
classification was removed. d-02's transient-failure mechanism remains
reproduced independently; original grader transport attribution remains unproven.

## Grok's completed review

Grok completed READY WITH CHANGES while the report was being finalized. Read
all 12,532 bytes and addressed both Medium findings and the Low. Its available
start and complete final texts and hashes are retained. No newer review approval
of this final implementation is claimed.

1. **Completed bytes across rotation.** Online keeps a completed handle if the
   captured known principal still equals the live principal. Local has one fixed
   principal and preserves the completed handle while still available. Neither
   case fetches again. Sign-out, close, store fences, unknown online principal
   and principal mismatch still fence the result. Local reconciles media and
   then awaits active refresh before capturing its bearer. This also makes a
   pre-dispatch E_AUTH retry wait for the successor instead of sending the old
   bearer at an intermediate revision. The successful-body policy is corrected
   in LLP 3000 §7 and LLP 3000.008.002.000 §6.
2. **Local deadlines are not network outages.** SDK queue/transfer deadlines
   use E_CLIENT, leaving the local link and retained handles intact. Explicit
   socket failures retain E_OFFLINE, its offline transition and cached fallback.
   Other server refusals keep their existing invalidation rules. If queue/backoff
   expiry interrupts an admission cooldown, the previous refusal and absolute
   Retry-After survive; there is no newly minted E_OFFLINE or early retry.
3. **Ordinary construction can recover.** The internal successful download
   carries whether its request was ranged. Retention or display exceptions are
   E_CLIENT and retryable only for those ordinary transfers. An ambiguous
   one-view construction failure remains non-retryable. No public type changed.

Real online/process/wasm regressions preserve completed ordinary and once bytes,
including a once body completing while the successor reply is still withheld.
Exactly one non-range once transfer occurs, and a deliberate subsequent read is
E_ASSET_VIEWED. Process/wasm tests start another download during that withheld
refresh and require no old-bearer request and no retained-handle invalidation.
Separate saturation tests hold six bodies, expire the seventh call's admission
wait, and require the link and held URL to stay live; then actual ECONNRESET
must emit offline and recover the receipt-confirmed cached bytes. That integration
compresses only the thirty-second admission timer; exact cumulative timing is
checked separately with virtual time.

Before-fix controls reproduce discarded success on all three tiers, admission
minimum loss and ordinary retention non-recovery. Removing just the local refresh
wait fails both local tiers. Reclassifying local deadlines as E_OFFLINE also fails
both. Disabling the queue timer fails its budget assertion; forcing construction
retryability false fails ordinary retention. Removing the actual socket-offline
transition is checked separately. All mutations are restored. The failure ledger
also records the first probe's fixture mistakes; none is hidden as environmental.

## Verification

The single complete `scripts/test.sh` run exited **0**, with the exact summary:

```text
== 0 failure(s) in 1404 s
```

Rust: **4,329 passed, 0 failed, 33 ignored**. Clients: **4,819 passed, 0 failed,
10 skipped, 0 cancelled**. Final models: **79/79**. Fixture wrappers: **9/9**.
Every stage passed. Full-suite failures: **ours 0, baseline 0, environmental 0**.
This run includes both Astra corrections and precedes Grok's later corrections.
**It is not a final-tree full-suite qualification.** The user requested one full
run; the later corrections receive the scoped verification below. Starting
source hashes, their pre-Grok unchanged check and final source hashes are separate
artifacts. No test count, assertion, timeout or wasm ceiling was relaxed. The
inherited 60-second suite target remains exceeded; conditional skips are not
qualifications.

- Initial buffered/retry checks: **33/33**; expanded initial retry checks: **35/35**.
- Initial broader React/media/session/pressure checks: **178/178**.
- Grok detecting regressions: **11/11**.
- Expanded Grok affected group: **352/352**, including the entire React, overload,
  Blob, online-session, terminal and seam suites plus real buffered readiness.
- Whole guide after final timing, rotation and refusal documentation: **99/99**.
- Final retention/avatar/pressure/retry group: **98/98**, after narrowing cache
  preservation to E_CLIENT while keeping other server-refusal handling intact.
- Package build/typecheck and delivery-await classification pass after the Grok
  changes. Final ref-check: **523 LLP docs, 9,887 refs, 29,169 files, zero errors
  and zero unchecked**. Whitespace checks pass.

Canonical wasm rebuilt by the complete run: **2,040,529 B raw / 592,975 B gzip-9**,
**744 B below** the unchanged **593,719 B** cap. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
No subsequent engine/wasm source change. See wasm.json and the canonical build
stage in test-sh.log.gz.

Commands from snapback4/ on Node v24.13.1, 96 available CPUs:

```sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/asset-buffered.test.mjs packages/snapback4/test/asset-retry.test.mjs
node --test packages/snapback4/test/react.test.mjs packages/snapback4/test/asset-avatars.test.mjs packages/snapback4/test/asset-pressure.test.mjs packages/snapback4/test/asset-lists.test.mjs packages/snapback4/test/asset-blob-lifecycle.test.mjs packages/snapback4/test/online-session.test.mjs packages/snapback4/test/online-terminal-entrypoints.test.mjs
node --test --test-name-pattern='every delivery await' packages/snapback4/test/delivery-fault-matrix.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Logs are retained as deterministic gzip. FAILURES.md classifies every red
execution, including deliberately failing controls and probe setup errors.
Both final review files are read, retained and hashed in review-checks.json.
The local commit carries Co-Authored-By: GPT-6 Astra <noreply@openai.com>.
Nothing pushed or published.
