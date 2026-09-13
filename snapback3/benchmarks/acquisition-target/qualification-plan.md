# Acquisition target qualification contract

This public plan specializes [LLP 2000 §16](../../../llp/2000-snapback3.rfc.md)
for the frozen Clique acquisition target. It is the reviewable contract for
this benchmark; private `.llp/ship-runs/` notes are supporting run records.

## Fixed inputs

- Build the candidate SDK with Rolldown and TypeScript and the native worker in
  Rust release mode. Bind every result to the package archive, package source,
  native binary, app source, production bundle, harness, fixture database/WAL,
  schema, compiled project, and seed hashes.
- Use the copied retained production Clique React app and its normal singleton
  SDK client, auth provider, query hooks, and IndexedDB adapter. Remove the
  ambient `SNAPBACK3_WORKER` override from each owner environment and record the
  exact installed worker path, hash, PID, and start tick.
- The 10k target is the authorized `u0500` projection: 100 conversations and
  10,000 messages. Its fixed ID digest is
  `ba91d208c55f77a1a4b792e2eb09407fe774a9814b1358981bbad7950ec984ac`;
  its canonical full-row digest is
  `86cc3d45609124219c7a74101015da00a96568e06d9b1341b418129fed5a38f2`.
- The comparator uses the fixed old package archive SHA-256
  `719eba5bfaffeebf117ca3e10d60d830da2ca4ca735693ea0e46f0d6317fcb4e`
  and the byte-identical retained serial walker SHA-256
  `15c84e41c0d4ea595e991922fc6f06fdca5ab30f115b91d36dfb4761ec351fa4`.

## Primary endpoint

Start the clock before browser navigation. The interval includes production
app and SDK loading, automated fixture persona authentication, React mount,
declared public `client.acquire(...)`, its completed durable checkpoint, the
first ordinary SDK query after `client.setOnline(false)`, and the existing
React acquired-page substring search/render. The browser network stays enabled
for CDP measurement during this endpoint.

The owner process, exact fixture copy, and manifest readiness probe occur
before the clock. A fresh trial means a new browser profile, browser storage,
and navigation. It does not include scale-to-zero owner startup and does not
claim a cold OS or database page cache.

A sparse observer records the first visible inbox row and first visible
history row after a following animation frame. Visible means a nonzero DOM box
with visible CSS; this is not a compositor paint timestamp.

## Binding correctness after the clock

- Traverse all 151 pages and 101 chains through ordinary SDK resources while
  the SDK is offline. Reject repeated cursors, more than 151 pages, mixed SDK
  sequences, wrong field sets/counts/digests, and any chain without a final
  complete/no-next page. Intermediate capped pages may be incomplete with a
  continuation.
- Sample browser heap before this full audit.
- Derive a proper nonempty substring subset from the exact first acquired
  message page and compare exact React DOM message IDs. Also require a
  guaranteed-absent term to render zero rows, then restore `busy`. This is a
  first-acquired-page search control, not a cross-chat search index.
- Close the browser, reopen the same persistent profile with the context
  network offline before navigation, and require navigation status 200 from
  the exact content-bound service worker. Repeat the full 151-page/10k SDK
  audit and both digests. The worker caches only explicit shell assets, never
  API, auth, event, or query responses.

## Performance cohort

Run ten alternating pairs on one otherwise idle EPYC host. Odd pairs run
baseline then candidate; even pairs reverse the order. Each trial gets fresh
browser storage. The pair runner has no target-based early stop and retains
every slow or failed trial. Diagnostic runs may stop after a result above three
seconds, but they never enter this cohort.

Qualification requires all ten candidate and all ten baseline trials to pass
every binding check. If any trial fails, a median over successful trials does
not qualify the candidate. With 10/10 candidate successes, the primary
criterion is candidate median below 3,000 ms. Report all values, median, range,
and failure count. Ten observations do not support a population p95 claim.

The fixed baseline is useful only within this shared harness. Its history is
selected after acquisition, while the historical grader selected a busy
history before acquisition. Host/cache conditions also differ, so do not claim
a matched ratio against retained 33–35 second observations.

## Separate controls

- Run the exact authorized `u0001` 100k projection separately. Require 1,000
  conversations, 100,000 unique messages, 1,069 pages, 1,001 complete chains,
  one SDK sequence, ID digest
  `bc5bc9ebf4e85d8594f1361bf3d61ae60ff01cdf96987c3a2441341970edfcfd`,
  and canonical full-row digest
  `e9e96a61efc9a4a19fb1830807f64cb20cbceedaf2a79976b41f9a9a816997f9`.
  Repeat those values after physical offline reopen. Report timing and memory as
  scaling evidence, never against the 3-second 10k target.
- Run one separately labeled CDP shaped-network diagnostic with `offline:
  false`, 50 ms latency, 1,250,000 bytes/s download, 625,000 bytes/s upload,
  and `connectionType: "wifi"`. Report first useful inbox/history, completion,
  full app bytes, acquisition bytes, and all correctness controls. This browser
  model does not reproduce WAN routing, loss, jitter, or server contention.
- Foreground-write, interruption, denial, failed-persistence, account,
  generation, and invalidation controls remain required product evidence but
  are recorded outside this performance harness.

## Evidence and cleanup

Write each completed boundary to `result.partial.json`; a later failure must
not erase an earlier timing or progress result. Keep raw profiles, databases,
and large page evidence private on the benchmark host. Publish small summaries
with hashes for every raw result, cleanup receipt, and source input. Record
owner, worker, and Chromium PID/start-tick custody and kill only matching owned
processes. No local Commonroom process or port 4383 participates.
