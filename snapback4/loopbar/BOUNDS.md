# Running the bounds bar

From `snapback4/`, with Node 24 on PATH, the lead's shell runs:

```sh
node loopbar/bounds.mjs --n 3 --version 0.2.27 --root ~/projects/snapback-boundsbar-before/runs
```

A fresh agent receives only the pinned npm package, `bounds-brief.md`, and the
frozen logical-input generator `bounds-seed.mjs`. The runner reuses
`ceremony-process.mjs`, schema/loop extraction from `ceremony-metrics.mjs`, and
`prepareVerificationLane` from `run.mjs`. It records installation, agent and
verification wall times; authored milestones; 30-second load samples; packet and
installed-package hashes; independent checks; and the bounds-specific metrics in
`metrics/boundsbar.jsonl`. Runs are serial, N must be at least three, and existing
run directories are refused. Missing `green=` records a failed trial. Errors,
timeouts and unsupported search protocols remain visible. Reverification writes
separate evidence, not another calibration trial:

```sh
node loopbar/bounds.mjs --reverify /path/to/run-1
```

The 60-minute builder budget includes installation and seeding. The independent
seed has a 15-minute timeout and acceptance 30 minutes. These are stop limits,
not performance gates. The inherited 1,200-second ceremony comparison is also
reported. Read/acknowledgement latency ratios have no pass threshold.

Each fresh verification copy owns its own server and uses `dev --memory`; the
runner never stops a discovered server. `check`, builder acceptance, and runner
probes have separate copies. Probe setup allows 180 seconds for the observed
first-launch dyld delay. Failed checks do not prevent the other tasks from being
probed. The full per-request counter trace lives in `runner-result.json` and the
JSONL record; its `complete` summary discharges only meter cuts carrying a
followed continuation. All raw `complete`, `cut`, `next` presence, `examined` and
`indexEntries` observations remain intact. `searchProtocol`/`followingShape` and
per-task source ranges are explicitly builder-declared; schema counts, numeric
tokens, code occurrences, narrative vocabulary and wire answers are extracted.
Permissive derived-table rules include read and write rules and retain source
lines; declared derived columns supplement automatically detected maintains.

A calibration is not yet recorded by this lane. A sandbox cannot start the
fresh nested `codex exec`; run the command above from the lead's shell. The
reference witness below is instrument qualification, not N=1 builder evidence.

## Qualifying the instrument

The tests import Node built-ins and local loopbar modules only. The package test
file is a two-line entry point; cases and the reference app live in `loopbar/`.
Set `BOUNDS_BINARY` to a published 0.2.27 executable, or unpack it under
`target/w13d-bin/package/snapback4`. If neither is present, only the integration
case is explicitly skipped; the other tests run. This lane's qualification has
zero skipped tests. Do not point the witness at a repository build.

```sh
node --test packages/snapback4/test/loopbar*.test.mjs
BOUNDS_OUTPUT="$PWD/target/w13d-measurements.json" node loopbar/fixtures/bounds/measure.mjs
```

The measurement script takes `--tiny` for the small reference seed. Both modes
use the published binary, fresh copied apps, mutation-based seeding, and 60
measured reads/writes after three warm-ups. Tests use three samples to exercise
the instrument quickly. The tiny seed has 24 hub chats so even the one-cursor
query must continue; the two-cursor witness must advance both cursor domains.
The hub witness tests the same contract at full scale. Its five source tables
and two maintains are an instrument fixture, not a recommended serving design.
Singleton group fragments in its two-cursor answer preserve the native result
cursor; the verifier concatenates them without sorting or deriving answers.
The fixed seed has distinct positive top scores, so this witness does not
qualify arbitrary tie-breaking or a zero-like-only ranking.

Qualification used `TMPDIR=/private/tmp` for the fresh copies. This is a local
execution setting; it does not alter the seed, application, or wire protocol.

## Published 0.2.27 witness, 2026-09-17

Binary SHA-256: `ae7838c7ed3a9a4b4be3fa454af69e9cacb792b5a23ad81d12386ec7e3fd2be7`.
Obtained with `npm pack snapback4-darwin-arm64@0.2.27`; `--version` returned
`snapback4 0.2.27`. Base checkout: `e246af6e602004ec74823b3e2a3d7273def728f6`.
Full raw measurements are local ignored evidence at
`target/w13d-measurements.json`; seed output is not committed.

Logical input rows: chats **1,300**, members **1,349**, messages **99,390**,
authors **1,000**, follows **1,411**, posts **50,000**, likes **98** (154,548
logical records). This reference has no separate chat/author table: its five
source tables receive **152,248 rows**, plus two engine-owned maintains. It has
**0 jobs**, **1** permissive derived-table rule (`trend`'s read), and **63**
chosen integer literal occurrences (including seed-input type bounds). The
hub contains **99,090 coffee messages**; all 200 hidden newer matches are excluded;
sparse finds exactly five matching chats. Mutation seeding took **12.049156583 s**
and **12.787857166 s**, respectively, in two fresh memory stores.

Counters below sum each whole walk. All raw pages were `complete:true`, `cut:null`;
each walk observed a `next` and exhausted it. Trending's three requests are its
initial, changed-like and unlike first pages, not a walk beyond the top ten.

| Task | One cursor: requests / examined / indexEntries | Two cursors: requests / examined / indexEntries |
| --- | ---: | ---: |
| Hub search: 1,000 groups, 99,090 messages | 50 / 100,139 / 2,000 | 5,005 / 2,131,075 / 198,200 |
| Sparse search: 5 groups, 5 messages | 5 / 109 / 105 | 10 / 213 / 105 |
| Following 5: 250 posts | 13 / 1,195 / 0 | 13 / 1,195 / 0 |
| Following 500: 25,000 posts | 1,250 / 1,899,000 / 0 | 1,250 / 1,899,000 / 0 |
| Following celebrity: 250 posts | 13 / 1,195 / 0 | 13 / 1,195 / 0 |
| Roster plus unread: 50 members / 50,000 unread | 4 / 2,052 / 0 | 4 / 2,052 / 0 |
| Trending, all three exact top tens | 3 / 36 / 0 | 3 / 36 / 0 |

Trending initially returns `p000000`…`p000009`, scores 12…3. After 20 likes,
`p000011` leads with 21, followed by `p000000`…`p000008`; after removing one
like its score is 20. The old 20-like post never appears. Following's first-page
examined counts are **115 / 1,540 / 115** for small / wide / celebrity under both
search protocols; the query implementation is identical in the two copied apps.

Latencies in milliseconds, 60 samples after three warm-ups, measured on the
shared loaded host. The reference uses merge-on-read. No latency ratio gates.

| Read/write | One cursor p50 / p95 | Two cursors p50 / p95 |
| --- | ---: | ---: |
| Following 5 | 2.870 / 17.129 | 2.451 / 3.000 |
| Following 500 | 6.650 / 17.042 | 7.220 / 15.855 |
| Following celebrity | 2.605 / 3.175 | 2.679 / 19.053 |
| Post acknowledgement, 900 followers | 2.540 / 6.274 | 2.805 / 9.701 |
| Post acknowledgement, 5 followers | 2.660 / 7.176 | 2.595 / 7.951 |
| Following 500 / 5 ratio | 2.317× / 0.995× | 2.945× / 5.285× |
| Celebrity read / small ratio | 0.908× / 0.185× | 1.093× / 6.351× |
| Celebrity acknowledgement / small ratio | 0.955× / 0.874× | 1.081× / 1.220× |

Instrument regression: the first two-cursor reference used `group(page, 'roomId')`
after the merge. It returned no result continuation and silently lost messages;
the stronger multi-page test failed (`11 pass, 1 fail`). Returning shaped
singleton group fragments preserved continuation; the same suite passed
(`12 pass, 0 fail`). A subsequent test also covers metered empty pages, working
continuations, and a terminal incomplete answer; see the final suite result in
the journal. This was a fixture authoring error, not an engine change or a claim
of a pre-existing repository test failure.

Two brief corrections matter when interpreting this record: the retained
September 13 ceremony **before and after records both describe three successful
runs**, not empty attempts; and LLP 3000.007 §21.5 calls one task a digest whereas
this lane's concrete brief asks for roster plus total unread. This instrument
implements the latter, adds the four requested derived-data counters, and makes
no digest-job or device-acquisition claim.
