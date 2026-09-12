# Integrated acquisition target harness

This directory holds a fixture-only performance harness for the full public
Snapback 3 SDK acquisition path. It is not product qualification by itself.
The binding public contract is [qualification-plan.md](./qualification-plan.md),
which specializes [LLP 2000 §16](../../../llp/2000-snapback3.rfc.md).

## Current source-binding status

V8 passes the complete acquisition target evidence contract. Its ten-pair
candidate median is **2,806.7 ms**, compared with **6,875.1 ms** for the fixed
package serial baseline. All ten candidate and all ten baseline trials passed
the exact data, search, worker-custody, and strict physical-reopen controls;
one candidate observation exceeded 3,000 ms. The exact v8 source also passed
both bounded source reviews, 83 combined tests / 338 assertions, nine
real-IndexedDB groups, five foreground/interruption scenarios, the 100k
scaling control, and the predeclared shaped-network control.

V7's first diagnostic took 2,870.9 ms, but it was excluded after two defects
were found: caller mutation of the declaration could redirect cancellation,
and a guarded memory clear could emit a false authority notification that
withdrew successor live state. Its full pair cohort and foreground controls
were deliberately not run. V6 and v5 remain earlier excluded evidence. The
variant-specific result files preserve every measurement and exclusion reason.

The harness copies the retained production Clique app and exact fixed
`u0500` fixture before modifying the copy. Its acquisition declaration uses
the fixture's actual operations and arguments:

```ts
client.acquire({
  id: 'clique-u0500-full-history',
  revision: 'exact-100-conversations-10000-messages-v1',
  root: pages('conversations.inbox', { c: null }, { key: 'u0500-inbox', cursor: 'c' }),
  expand: conversations => conversations.map(conversation =>
    pages('messages.page', { conversationId: conversation.id, c: null },
      { key: conversation.id, cursor: 'c' })),
})
```

The fixture auth request names persona `u0500`; the development auth provider's
observed principal ID is `dev:u0500`. Both values are asserted explicitly.

`app-acquire.ts` replaces only `src/acquire.ts` in the copied app. It imports
the production app's singleton client, waits on `Acquisition.completed`,
checks the terminal snapshot, forces that same client offline, and performs an
ordinary SDK `messages.page` query plus the app's existing substring search.
The controller starts its clock before page navigation, so the primary interval
includes production app and SDK loading, automated fixture persona auth,
React paint after auth, complete acquisition and its durable SDK checkpoint,
and first offline history plus the ordinary React screen's acquired-page search
and render usefulness.

A sparse observer installed before navigation records the first visible inbox
row and the first visible history row after a following animation frame. The
controller reports both against the same outer clock for baseline and
candidate. These are concrete DOM-usefulness observations; the earlier
`reactPaintAfterAuth` phase marker alone does not establish a useful inbox.
Here, visible means a nonzero viewport DOM box with visible CSS followed by an
animation frame; it is not a compositor-level paint measurement.

The owner process and exact copied fixture are started and readiness-probed
before the primary clock. “Fresh” or “cold” in a trial means a new browser
profile/storage and navigation. It does not include scale-to-zero owner startup
and does not establish a cold OS or database page cache.

For the primary endpoint, `client.setOnline(false)` deliberately forces the SDK
to use acquired evidence while the browser network remains enabled for
measurement instrumentation. Actual network-offline behavior is exercised only
by the separate physical reopen control below.

After the primary endpoint, the harness samples browser heap and performs the
non-timed search controls. It derives a narrow substring from the exact first
SDK history page, requires the React DOM IDs to match the proper nonempty SDK
subset, requires a guaranteed-absent term to render zero messages, and restores
the primary `busy` term. This qualifies only the existing acquired-page
substring search, not a full-history or cross-chat index.

The binding correctness audit then follows every acquired cursor through ordinary
offline SDK resources. It checks 100 unique conversations, 10,000 unique
messages, 151 pages, every valid intermediate cursor and final-page
completeness, the exact observed message field set, and full canonical-row and
ID digests. Intermediate capped pages are
correctly `complete: false` with a continuation; the audit requires a valid
cursor chain and a `complete: true`, no-next final page for each of the 101
chains. It rejects repeated cursors, more than the declared 151 pages, and any
page whose SDK sequence differs from the other pages. It does not inspect IndexedDB
or treat the acquisition accumulator as query evidence.

The separate reopen control closes the browser, opens the same persistent
profile, switches the browser context to actual network-offline mode before
navigating, loads the service-worker-cached production shell, restores the
normal SDK client, repeats the offline history/search query, and then follows
all 151 SDK pages again to bind the physical reopen to the same full-row and ID
digests. The generated worker intercepts only the same-origin, content-bound
shell allowlist; it passes API, auth, event, and query routes through without
caching. The controller asks the active worker for its cache version before
both close and offline use. Its interval is reported separately from the
primary target.

The first candidate diagnostics are intentionally bounded. A primary interval
over 3 seconds stops later repetitions. A follow-up run with
`SNAPBACK3_PROFILE=1` captures a CPU profile separately; profiled attempts are
not members of the ordinary cohort. Stable candidate and fixed-package serial
baseline alternating pairs use `pairs.mjs`, which does not stop on a slow or
failed trial and preserves the full fixed sequence. A final cohort is invalid
if any trial fails; a median over successful trials cannot rescue it. These
pairs must not be mixed with the early-stop diagnostics.

All run output goes to a caller-selected new directory. It includes app and
package hashes, phase timestamps, request/byte counters, acquisition progress,
post-timer audit evidence, the separate physical reopen result, failures, and
PID/start-tick cleanup receipts. Browser profiles and databases remain private
on the EPYC machine. Each completed boundary is also written to
`result.partial.json`, so a later audit or reopen failure does not erase an
earlier primary interval or its progress and network evidence.

The separately named shaped-network control is predeclared as Chrome CDP
`Network.emulateNetworkConditions` with `offline: false`, 50 ms added latency,
1,250,000 bytes/s download (10 Mbit/s), 625,000 bytes/s upload (5 Mbit/s), and
`connectionType: "wifi"`. It reports first visible inbox/history, full
completion, and encoded acquisition bytes. It is not tuned or folded into the
idle local-owner cohort. CDP emulation is a browser-level approximation and
does not reproduce WAN routing, loss, jitter, server contention, or a remote
owner; the ordinary cohort itself uses an otherwise idle EPYC host and a
loopback owner.

This harness does not claim safety controls, 100k behavior, comparative wins,
or complete candidate qualification. It does not alter product source, the
retained fixture, any frozen benchmark, LLP, guide, or diary.

## Candidate v1 diagnostic

The first complete unprofiled run took **3,594.8 ms**, so it missed the target
by 594.8 ms and the harness stopped further ordinary repetitions. The public
SDK acquisition itself consumed 2,868.0 ms. It completed 151 pages across 101
chains at sequence 1; the post-timer audit matched all 10,000 message IDs and
all canonical full rows.

The separate profiled run took 3,642.9 ms. Its 29 loopback acquisition turns
used 680.3 ms of summed wall time and transferred 322,011 encoded bytes / 3.50
MB decoded. The existing public storage adapter observed approximately 855 ms
across 33 writes after acquisition began. CPU sampling attributes large shares
to SDK hash/UTF-8 work, value/index evaluation, protocol validation,
persistence JavaScript, and SDK frames that could not be mapped uniquely from
the minified Metro bundle. These intervals overlap and the source mapping is a
qualified inference; they are attribution clues rather than additive clocks.

The profiled attempt's actual-network-offline cached-shell reopen queried all
151 pages again and matched both expected 10,000-row digests. Full values,
hashes, remote raw paths, preserved harness failures, and explicit omissions
are in `results/candidate-v1.json`.

That v1 worker cached every successful GET, including API responses. The v1
reopen observations therefore do not qualify as strict shell-only offline
boots, despite actual browser-offline mode and the complete IDB row audit. The
allowlisted, content-bound worker and exact-version handshake were added after
v1; the strict control must be rerun with the next candidate.

## Candidate v2 diagnostic

Candidate v2's fresh-acquisition optimization removed the full validation pass.
Three fresh diagnostic endpoints took **3,001.1, 3,317.9, and 3,072.5 ms**
(median 3,072.5 ms, range 316.8 ms). All three remain above the strict target.
Their acquisition phases took 2,264.2, 2,547.9, and 2,329.0 ms, using 15–17
traverse-only `/api/acquire` requests. All exact 10,000-row audits passed.

Every v2 physical reopen used actual browser network-offline mode and the
specific content-bound shell cache
`snapback3-acquisition-target-fc0a1732181431f47a4f4798`. Each then traversed
all 151 ordinary SDK pages and matched both expected digests. Exact values,
input and raw-artifact hashes, and caveats are in
`results/candidate-v2.json`. These three diagnostics are not the planned
ten-pair qualification cohort and do not support a p95 claim.

## Candidate v3 and baseline preflight

Candidate v3 produced three under-target diagnostics: 2,616.6, 2,822.7, and
2,896.4 ms. Independent review then found safety defects, so v3 was not
admitted to the final cohort. The complete inputs, raw evidence manifest, and
limitations are in `results/candidate-v3-diagnostic.json`.

A later, separately labeled v3 harness preflight took 3,099.1 ms after the
final-cohort harness corrections. It successfully exercised the shared visible
inbox/history milestones, exact acquisition-mode binding, nonvacuous search,
cursor/page/sequence guards, progressive result checkpointing, and strict full
physical reopen. It remains outside every performance cohort and does not
change v3's exclusion. Its small record is
`results/candidate-v3-harness-preflight.json`.

The fixed-package serial baseline preflight took 6,964.5 ms, including a
6,266.5 ms walker. It validates the alternating-pair machinery rather than
replacing the retained historical baseline. The common wrapper preserves the
retained walker's sequential `fresh` resource cadence and cursor order, but it
used a faithful wrapper rewrite that kept a page count instead of every
per-page timing object and omitted the `lastFetched`/`lastDurable` marker
assignments. After that preflight, final-pair preparation replaced the rewrite
with a byte-for-byte copy of the retained walker (SHA-256
`15c84e41c0d4ea595e991922fc6f06fdca5ab30f115b91d36dfb4761ec351fa4`).
The common harness adds the before-navigation timer, auth, React mount, first
offline query, UI search, and post-timer audits. It selects the busy history
after acquisition; the historical grader selected that history before starting
acquisition. The client configuration and public storage wrapper are unchanged.
Host and cache conditions differ from the historical 33–35 second observations;
a warm OS database cache is one possible influence, but this harness did not
establish it as the cause. No matched historical-to-candidate ratio is claimed.
Exact recorded-preflight details are in `results/baseline-preflight.json`.

The first ordinary success predates a `/proc` parser correction, so its owner
and Chromium custody files contain PIDs without start ticks. Cleanup completed
and the ports were verified free, but that attempt does not claim exact
PID/start-tick custody. The profiled attempt records both PID and start tick for
the owner and Chromium and has an exact cleanup receipt.

## Candidate v4 first diagnostic

The frozen v4 package's first corrected-harness diagnostic took **2,824.5 ms**.
It used 12 acquisition responses and passed the exact 151-page/10,000-row
binding audit, proper-subset and negative search controls, and the full strict
physical reopen. This is an admission diagnostic for the planned alternating
cohort, not a cohort member. Exact input, app, package, source, raw-result, and
cleanup hashes are in `results/candidate-v4-first.json`; that record also keeps
the two pre-timing snapshot/package setup failures.

## Candidate v5 diagnostics

The first guarded v5 diagnostic took 3,096.5 ms. Its complete ten-pair run then
measured candidate median 2,865.4 ms (range 2,673.0–3,085.4) and fixed-package
baseline median 6,949.3 ms (range 6,707.1–7,265.6). All 20 trials passed exact
10k audits and full strict reopens; two candidate trials were above three
seconds. The cohort had no external activity overlap and supports no p95 or
historical-33-second ratio claim. Independent review subsequently found an SDK
barrier defect, so these measurements are diagnostic and excluded from final
qualification. See `results/candidate-v5-first.json` and
`results/candidate-v5-pairs-diagnostic.json`.

The v5 100k oracle established 1,000 conversations, 100,000 unique messages,
1,069 pages, 1,001 complete chains, and the exact ID/full-row digests later
candidates must match. Its primary diagnostic took 21,970.2 ms; a full strict
offline reopen repeated every count and digest. Heap and private IndexedDB
directory observations are reported with their limits in
`results/candidate-v5-100k-oracle.json`. No 1k cohort was measured.

The predeclared v5 shaped-network diagnostic took 5,475.6 ms, with the first
visible inbox at 2,287.1 ms and history at 5,407.7 ms. It transferred 2,187,707
encoded bytes for the full page and 252,668 encoded acquisition bytes. Its
exact CDP parameters, correctness controls, and network-model limitations are
in `results/candidate-v5-shaped-network.json`.

## Candidate v6 measured evidence

The exact v6 package is
`fcc08d11c34a7619c4c62a31512b71138978bd862c5bf6fb8b4c64dc460b3d3b`
(package-source digest
`f2df8a3252437d9de36807d1c2444642441cb128f070c23b4078ac295108e25a`).
Its source-files manifest is
`7f99ef5a5c5d0a2dbaf5aa816b12a4610056c62bda9301bf888f343b8145608d`;
the two performance-path source files are bound by client digest
`05e6374c9575d6099a67e4926e2f830a7e19c7d788937e780af1b27f5cdccaab`
and acquisition digest
`5de8e5cdf29bb8f603813839a85bf8b13df6876e2d887d9d30facffbeaf01e56`.
The packaged native worker digest is
`8790d8a7a4b0c979921f05321ff0fb6b97beb0693509215f7bb6221a3e48a7e6`.
The production-app wrapper digest is
`eedb9a530efe3a2ca11d824981decf6603163feadbe81d33ce08e3afcd19acf7`,
and the v6 Metro bundle digest used by the pairs is
`b891ac686feca1e0e3826b4c7f49a1a9eb2f7f2f9f909ceab5b6497a9c56737b`.

The admission diagnostic took 3,107.4 ms and passed every data, search,
strict-reopen, and process-custody check. The complete alternating cohort then
retained all ten candidate primary times, in plan order:

`2494.326, 3086.138, 2870.377, 3101.856, 2862.175, 2793.456, 3117.529,
2833.898, 2861.361, 2875.472 ms`.

The candidate median was 2,866.3 ms (range 2,494.3–3,117.5); three of ten
trials exceeded 3,000 ms. The fixed-package serial baseline median was 7,072.5
ms (range 6,922.6–7,190.2). All ten candidate and all ten baseline trials
passed. The candidate's first useful inbox median was 436.5 ms and first useful
history median was 2,799.6 ms. Its inner acquisition interval, from the React
paint after auth through acquisition completion, had median 2,149.8 ms (range
1,728.2–2,335.3). The first ordinary offline SDK query had median 11.6 ms.

The post-primary full audit was outside the target timer and had median 282.3
ms. Browser heap used before that audit ranged from 56,201,840 to 85,177,900
bytes (median 65,478,216). The strict physical-reopen outer interval had median
1,464.7 ms; it starts before the fresh browser launch and includes browser
launch, actual-offline navigation, the specific service-worker/cache-version
handshake, first ordinary offline SDK use, and the complete 151-page audit. It
ends before closing the reopened browser. Within it, first offline use had
median 744.0 ms and the full audit portion had median 185.4 ms. Every primary
and reopen audit matched exactly 100 independently expected conversation IDs
`g0001` through `g0100`, 10,000 unique message IDs, all eight observed message
fields, and the fixed message-row digest. The row and ID digests bind messages;
they do not claim a full-field digest for conversation objects.

The separate v6 100k run took 22,944.2 ms. It traversed 1,000 conversations,
100,000 unique messages, 1,069 pages, and 1,001 chains, with 68 legitimate
incomplete intermediate pages. It matched the v5 oracle's message-ID digest
`bc5bc9ebf4e85d8594f1361bf3d61ae60ff01cdf96987c3a2441341970edfcfd`
and full-message-row digest
`e9e96a61efc9a4a19fb1830807f64cb20cbceedaf2a79976b41f9a9a816997f9`
in both the primary audit and the full strict reopen. Before the primary audit,
the browser heap used 290,618,764 bytes. The private IndexedDB LevelDB path
occupied 93,007,716 bytes after the reopen; that filesystem observation is not
an in-timer write-byte measure and can vary with LevelDB compaction. The
corresponding v5 snapshot was about 47 MB, but the storage source was unchanged
and the harness did not measure LevelDB lifecycle or compaction, so the two
snapshots do not establish storage growth or a cause. The
projection manifest independently fixes the 1,000-conversation count. It does
not publish all conversation IDs, so the matching primary/reopen observed-set
digest is a consistency control rather than an independent expected-set proof.
No 1k cohort was measured.

The predeclared v6 shaped-network run took 5,302.5 ms, with first useful inbox
at 2,337.1 ms and history at 5,232.1 ms. It recorded 2,188,127 total encoded
bytes and 251,867 encoded / 3,254,295 decoded acquisition bytes over 13 acquire
responses. It passed the same exact 10k data, search, and strict full-reopen
controls. Exact phase data, every pair trial, raw hashes, and cleanup receipts
are in `results/candidate-v6-first.json`,
`results/candidate-v6-pairs-final.json`, `results/candidate-v6-100k.json`, and
`results/candidate-v6-shaped-network.json`.

The separate guarded v6 foreground/interruption controller passed all five
scenarios against the same package and native worker; its controller digest is
`884f8860b78da12fdcd50bec6b04262538d917bc552b2fd6d49e4782f24460ee`
and raw result digest is
`6cae26420e145a8c102f227f6e446f6188bb0b07cc15c7dfc0283431b4819411`.
Those controls and the performance time result remain useful evidence, but
they do not cover the three lifecycle defects found in the later v6 review.
V6 remains unqualified; v8 supersedes it with corrected source and a fresh
final qualification cohort. No isolated speedup is attributed to v6's
decoded-envelope reuse because its median is effectively equal to v5's.

## Candidate v7 diagnostic

V7 bound package
`8cce9c949efe48e489ca638e7601d0d2ce250822357296f8abccfad2224e7489`
to package-source digest
`46c06798781f6719940577cae2b5f42140e1085dc31e7069dbc8370c3794e658`,
native worker
`8790d8a7a4b0c979921f05321ff0fb6b97beb0693509215f7bb6221a3e48a7e6`,
and production bundle
`a9a0fba49c9bfb8773fe9d545202490a7a8c7feee758a13a84129f2bd0ec2756`.
Its first diagnostic took 2,870.9 ms, reached the first useful inbox at 414.5
ms and history at 2,764.7 ms, and completed the public SDK acquisition at the
2,505.2 ms page mark. Fourteen acquire responses transferred 252,652 encoded
and 3,254,732 decoded bytes.

The post-timer audit matched all 100 expected conversation IDs, 10,000 message
IDs, and canonical full message rows across 151 pages and 101 chains. The
strict actual-offline reopen returned status 200 from the bound service worker,
performed its first SDK use in 725.0 ms, and repeated the complete audit. The
real-IndexedDB control suite separately passed all nine groups. The full
twenty-trial pair cohort, 100k run, shaped-network run, and five foreground
controls were not run for v7 after the mutable-declaration custody defect was
reproduced. Exact evidence and cleanup hashes are in
`results/candidate-v7-first.json`; the harmless first package-command PATH
failure is retained in `results/v7-package-attempt-1-failure.json`.

## Candidate v8 qualification evidence

The exact v8 package is
`6eb3ca7780286a861d8e79e0f6e1322c37734036add5078011c6c05a72c44562`
with package-source digest
`70eb6314b7d61fa1527bf86c3ac3919f25cc2073a32ede5b15f55ab9084b2d9f`.
The final client and storage source digests are respectively
`de9f1441744b2774d475ad47263ead06b0cf77789d16dcd783d89fd9d0940ad2`
and `f6c37ba1044464424ec49d1e5c0606a8d027c39605a1216aeee7dc3d8578700c`;
the selected source manifest digest is
`5a03c78be80116d39c012ea660c3469a020ad6603250bf4f19589a1a46a21ecd`.
The native worker remained
`8790d8a7a4b0c979921f05321ff0fb6b97beb0693509215f7bb6221a3e48a7e6`,
and the production-app bundle was
`10da8b6fb481316df596e35014fb0b538273cf669a5da340827badf98eea359f`.
The package smoke test used a fresh external install and passed its dev-health,
seeded-query, settled-mutation, binary, and strict type-export checks.

The admission diagnostic passed in 2,794.3 ms. The complete fixed-order
candidate values were:

`2461.139, 3045.718, 2964.858, 2710.566, 2835.502, 2772.368, 2820.194,
2568.605, 2843.284, 2793.167 ms`.

Their median was 2,806.7 ms (range 2,461.1–3,045.7), with one of ten above
3,000 ms. All ten passed; no run was removed or replaced. The ten fixed-package
baseline values had median 6,875.1 ms (range 6,446.4–7,625.8) and all passed.
This supports the declared median criterion, not an every-trial ceiling or
population p95 claim.

For the candidate cohort, first useful inbox had median 435.0 ms and first
useful history 2,718.1 ms. The inner post-auth-paint acquisition interval had
median 2,061.5 ms (range 1,687.8–2,303.8), and the first ordinary offline SDK
query had median 11.5 ms. Browser heap used before the post-timer audit ranged
from 56,355,564 to 83,618,680 bytes (median 66,825,308). The post-timer full
audit had median 276.8 ms.

The strict physical-reopen outer interval had median 1,477.1 ms. As defined
above, it includes browser launch, actual-offline navigation, shell/version
handshake, first offline SDK use, and the full audit, and ends before browser
close. First offline use had median 734.8 ms and the full 151-page audit portion
had median 183.9 ms. Every primary and reopen traversal in all 20 trials matched
the exact `g0001`–`g0100` set digest, 10,000 unique message IDs, the eight-field
message schema, and the canonical full-message-row digest.

The v8 100k scaling control passed in 23,825.3 ms. It matched 1,000
conversations, 100,000 unique messages, 1,069 pages, 1,001 chains, the fixed
message-ID digest, and the fixed full-message-row digest before and after a
strict actual-offline reopen. Browser heap used before audit was 285,493,460
bytes. The private IndexedDB LevelDB path occupied 47,596,591 bytes after the
reopen; this is a filesystem snapshot, not logical contents or write bytes,
and the run did not measure compaction.

The predeclared v8 shaped-network control passed in 5,420.7 ms, with first
useful inbox at 2,342.3 ms and history at 5,351.8 ms. It recorded 2,191,127
total encoded bytes and 253,259 encoded / 3,255,169 decoded acquisition bytes
over 15 responses, then passed the exact 10k and strict reopen controls.

The same package passed nine of nine real-IndexedDB groups and five of five
foreground/interruption scenarios. Their raw result digests are
`652516a34adc376f15890ce51b5929c08908a7e194d2710817154d128ae6e78b`
and `54aca96c26fa89eecc8a5290ba066aa40857f26b77a720bfaee6c44d4ff8733a`.
Both bounded v7-to-v8 source reviews approved/accepted the delta, and the
combined affected suite passed 83 tests / 338 assertions plus the typed guide.
The complete compact evidence is in `results/candidate-v8-first.json`,
`results/candidate-v8-pairs-final.json`, `results/candidate-v8-100k.json`, and
`results/candidate-v8-shaped-network.json`. The root coordinator independently
recomputed the public statistics, all 20 primary/reopen bindings, cleanup
records, larger controls, and source hashes in
[coordinator-audit.json](./coordinator-audit.json), digest
`8c9654b9dc6abd37e72c6e43d972e226a8455574e4ed2d3ff310214fb354e774`.
