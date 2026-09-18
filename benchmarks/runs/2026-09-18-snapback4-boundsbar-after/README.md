# The bounds bar — "after", on `snapback4@0.2.29`

**Status: complete — three runs, three green; nothing invalidated.** Serial
runs of the bounds bar (`snapback4/loopbar/bounds.mjs`, LLP 3000.007 §20.22.7
and §21.5) on the pin published after every wave-13 landing, with the instrument
byte-identical to the "before"
(`benchmarks/runs/2026-09-17-snapback4-boundsbar-before/`, on 0.2.27). The bar
measures what a fresh builder pays to write reads that must work at hub scale,
and separates bounds *met* (the runner's own `complete`/`cut`/`next`/meter
observations) from bounds *narrated* (the vocabulary of the builder's own
report). The difference between the two records is what wave 13 is judged by.
N = 3, calibration, not a magnitude claim.

## Packet

| | |
| --- | --- |
| Instrument | the same eight files as the "before" (`bounds-brief.md`, `bounds.mjs`, `bounds-seed.mjs`, `bounds-metrics.mjs`, `bounds-probes.mjs`, `ceremony-metrics.mjs`, `ceremony-process.mjs`, `run.mjs`); the `packet` hashes in each `runner-result.json` are identical to those in the "before" record (`c9075707ce`), checked by the launcher before the run and by the reader after it |
| Pin | `snapback4@0.2.29`, `snapback4-darwin-arm64@0.2.29` (published 08:11 UTC 2026-09-18, ~35 minutes before run-1); binary SHA-256 `fede2fce…be55`, README SHA-256 `d54f748d…2287`; the pin unchanged after every run (`installedAfter` = `installedBefore`, `pinUnchanged: true`). The published package was separately fetched back from the registry and re-probed by the derived-data session (`08292107c4`): the horizon repair and ruling 32 are in it |
| Agent | `~/.volta/bin/codex exec`, `gpt-6-astra`, reasoning effort medium; the brief as the whole prompt; the installed package, its README, `npx snapback4 guide` and `why` as the whole packet; a 60-minute budget including install and seed — unchanged |
| Seed | `generateSeed()`, deterministic and unchanged: 1,300 chats (the hub persona in 1,000, every message `coffee`; 200 newer hidden matches in chats it is not in), 1,349 memberships, 99,390 messages, 1,000 authors × 50 posts, 1,411 follows (a 900-follower author), 98 likes — imported through the builder's own mutations |
| Runner | serial; install → agent → independent reverification on fresh copies (`check`, the builder's acceptance, the runner's wire probes: the whole hub and sparse search walks by the builder's declared protocol, the three Following walks, roster + unread, Trending before and after 20 likes and one unlike, 60-sample latencies after 3 warm-ups) → metrics; one JSON line per attempt in `boundsbar.jsonl` — unchanged |
| Host | Apple M5 Max, 18 cores, macOS 26; shared and loaded throughout (three wave-13 Codex lanes building and testing, the device-diet program's S3 landing and its suites, a fourth session's lane): load average at each start below, 1-minute peaks of 74 / 76 / 81 during the runs |
| Launched from | the lead's shell, `boundsbar-after.sh` (`node loopbar/bounds.mjs --n 3 --version 0.2.29 --root …/runs` from the pin's worktree, after confirming the pin on npm and the instrument's hashes); 08:14:35–08:44:48 UTC 2026-09-18 |
| Retained | `run-*/`: `runner-result.json` (every number, the packet and pin hashes, the verification tails; the per-request traces trimmed to their first and last entries — the full traces stay local), the builder's `run-log.md` and `final-report.md`, its `snapback/*.q`, every saved `check` output (`checks/`); `runner.log`; `boundsbar.jsonl` (trimmed the same way) |

## Attempts

| Attempt | Wall s | Agent s | Verify s | Green | Loops (snapback4-defect / docs / agent / env / ambiguous) | Search protocol | Following | Load at start |
| --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| run-1 | 644.9 | 642.2 | 69.6 | yes, every probe | 0 / 0 / 3 / 0 / 0 | one cursor (grouped page) | merge-on-read | 51.7 |
| run-2 | 497.7 | 495.0 | 71.6 | yes, every probe | 0 / 0 / 0 / 0 / 0 | one cursor (grouped page, `where exists`) | merge-on-read | 70.4 |
| run-3 | 465.3 | 463.1 | 63.2 | yes, every probe | 0 / 0 / 1 / 0 / 0 | one cursor (grouped page) | merge-on-read | 60.7 |

Every run: `check` clean, the builder's acceptance green on a fresh copy, and
every runner probe green — the whole 99,090-message hub walk with hidden matches
absent (`answerExact: true`, 1,000 groups), the sparse walk (5 of 5), the three
Following walks (250 / 25,000 / 250 posts), the 50-member roster and the 50,000
unread total, Trending's three exact top tens (p000011 at 21 likes after the
20, at 20 after the unlike). Every run stayed inside the ceremony bar's envelope
(≤ 1,200 s wall, ≤ 1 Snapback-attributed loop) — with zero Snapback-attributed
loops. The four loops across the three runs are all the builders' own transport
probes: a guessed root package export, bare arguments instead of the `{args}`
envelope, a request before the server was ready, a probe seed against a server
that already held a follow, and one acceptance assertion that named the wrong
index. Three "before" builders of four paid the same first loop.

## Bounds met (the runner's own observations, whole walks)

| Task | run-1 · run-3 (one cursor) | run-2 (one cursor, `where exists`) | Every page complete | Any cut |
| --- | ---: | ---: | --- | --- |
| hub search, 99,090 hits: requests / examined / index entries | 50 / 100,139 / 2,000 | 51 / 101,090 / 4,000 | yes | none |
| sparse search, 5 hits in 100 chats | 5 / 109 / 105 | 1 / 110 / 115 | yes | none |
| Following, 500 follows, whole walk | 1,250 / 1,899,000 | same | yes | none |
| Following, 5 follows and the celebrity follower | 13 / 1,195 | same | yes | none |
| roster + unread | 4 / 53 (run-1) · 4 / 2,055 (run-3) | 4 / 2,055 | yes | none |
| Trending, three first pages | 3 / 102 | 3 / 102 | yes | none |

Not one page of any verified walk was cut. Every builder wrote the search
card's grouped one-cursor page — the protocol one "before" builder of four
found for itself — and the 99,090 hits cost 50 or 51 requests in every run. The
two-cursor walk the "before" card paved, which three of four builders chose
there (5,005 requests, 2,131,075 examined and 198,200 index entries for the
same hits), is not on the 0.2.29 card and nobody wrote it. run-2's
`where exists (messages[.roomId] matching q)` conjunct drops the empty groups
— the sparse walk is one page — at twice the index entries on the hub.

## Bounds narrated (the builders' own text)

| Run | Chosen integer literals | `check` notes printed, all saved invocations | Bound vocabulary in run log + final report (total) | Cards read (lines) |
| --- | ---: | --- | --- | ---: |
| run-1 | 34 (`128` ×13, `0` ×7, `4000` ×6, `1` ×4, `256` ×3, `100`) | none (3 invocations) | complete 4, cut 3, ceiling 2, lanes 2, bound 1, cap 1, meter 1, cursor 1 — 15 | 1,872 |
| run-2 | 41 (`120` ×10, `128` ×9, `0` ×8, `4000` ×6, `1` ×5, `512` ×2, `100`) | N_MAINTAIN_DELTA ×1 (1 invocation) | meter 8, complete 4, cut 4, cap 3, bound 2, ceiling 2, cursor 2, horizon 2, incomplete 1, lanes 1 — 29 | 4,797 (README 2,925) |
| run-3 | 44 (`128` ×14, `0` ×10, `80` ×7, `4000` ×5, `1` ×5, `256` ×2, `100`) | none (1 invocation) | cap 6, meter 4, complete 4, cursor 2, lanes 2 — 18 | 2,772 (README 751) |

"Cards read" counts the lines the builder's own log requested (a range read
twice counts twice; run-2's README figure exceeds the README's 1,977 lines).
Not one report names `N_WIDE_MERGE` or `N_SPARSE_FILTER`; the "before" reports
named both, every run, as limits not met. What the reports narrate instead:
the meter-bounded lane source's own sentence, in two runs of three (run-1:
"Following discovers all followed-author lanes on each page; sufficiently wide
follows can cut during opening without a continuation"; run-3: "Following
rediscovers author lanes on every page and can exceed the opening meter at
larger fanout"); the 32-word expansion bound, in all three; a crowded-hour
Trending cut no walk met (run-1: "A densely populated rejected part of the
oldest hour can exhaust the 8,192 examined ceiling"; run-2: "a crowded boundary
hour can exhaust the meter while rejecting older or future rows"); and, in
run-2, wave 13's own starved-preview rule, read off the reads card: "The
returned outer shape owns continuation, so a meter-starved nested shape can be
retried through the native continuation. A whole room still has to fit within
one read's heap and examined limits." Between 34 and 44 integer literals a run
were the builder's to choose (35–55 before): key and body lengths, batch sizes,
caps.

## Schema shape

| Run | Tables | Maintains | Jobs | Operations (q / m / j) | Quarry lines | Per-task lines (search / following / roster+unread / trending) |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| run-1 | 5 | 1 (`unreadTotals`) | 0 | 5 / 7 / 0 | 147 | 50 / 49 / 53 / 67 |
| run-2 | 5 | 1 (`messageCounts`) | 0 | 5 / 7 / 0 | 138 | 45 / 45 / 52 / 61 |
| run-3 | 5 | 1 (`messageCounts`) | 0 | 5 / 6 / 0 | 123 | 38 / 43 / 48 / 49 |

The same five source tables, no jobs, no per-reader copies, one maintain each
(two in three "before" runs of four), 123–147 lines of Quarry (148–164 before).
Trending converged: all three merged 25 hour lanes over an index keyed
`hour(at), -likes, -at, key` on the post row itself — no `postHours` maintain
(the "before" runs that partitioned by hour did so behind one) and no single
rank index with a time filter (the shape that fired `N_SPARSE_FILTER`); the
three first pages examined 102 rows against 870 and 33. Unread split as before:
run-1 stored a per-membership `unread` summed by an engine maintain (53
examined); runs 2 and 3 subtracted `readOrdinal` from an engine-maintained
per-room count over the membership walk (2,055).

## Surface

The wave carried a surface budget (LLP 3000.007 §20.22.7: card lines, codes a
reference app emits, literals its author had to choose — "all of which must
fall"). Measured on the two installed pins, `npx snapback4 guide <card> | wc -l`:

| Card | 0.2.27 | 0.2.29 | Δ |
| --- | ---: | ---: | ---: |
| README | 1,657 | 1,977 | +320 |
| search | 320 | 242 | −78 |
| reads | 208 | 274 | +66 |
| language | 449 | 508 | +59 |
| feeds | 1,174 | 1,265 | +91 |
| bounds | 44 | 73 | +29 |
| indexes | 82 | 142 | +60 |
| programs | 80 | 89 | +9 |
| maintains | 152 | 165 | +13 |
| personas / types / writes / shapes | 94 / 104 / 255 / 36 | same | 0 |

Only the search card fell (the two-cursor walk left it). The other cards grew
249 lines net and the README 320; the builders read more of them (1,872–4,797
lines requested against 1,380–2,494), with the README the largest single read
in two runs of three. Codes a reference app emits: none (the "before" builders'
saved checks printed `E_QUARRY_SYNTAX` ×5 and `E_QUARRY_TYPE` ×5 across four
runs; here every saved invocation is clean but run-2's disclosure note).

## Findings, against the "before"

- **The `group(page, …)` dead end: 4/4 → 0/3.** Every builder wrote the
  search card's grouped one-cursor form (runs 1 and 3 verbatim, `last 256`;
  run-2 with `where exists …` and `last 512`), whose nested `messages[.roomId]
  matching q` groups by construction; no builder reached for `group`. Ruling 34
  (lane W13i, not in this pin) still covers whoever writes `group(page, …)`;
  on this bar the card's form took the occasion away.
- **The two-cursor walk: 3/4 → 0/3**, at 50 or 51 requests for the 99,090 hits
  against 5,005 — the card no longer offers it (ruling 26 as amended, W13e).
- **The Snapback defect: 2/4 → 0/3.** No run paid a Snapback-attributed loop;
  the `$value1` lane-source seek refusal was fixed in W13c. Loops 3–5 a run →
  0–3, all transport probes.
- **`check` notes fired: 4/4 → 0/3.** `N_WIDE_MERGE` (×2–8) and
  `N_SPARSE_FILTER` (×2–4) printed in every "before" run; here the only note in
  three runs is run-2's `N_MAINTAIN_DELTA`, a true disclosure (a maintain over
  a table whose rows the reader may not see). Every builder wrote the
  meter-bounded lane source (`[f.followedId] for f in follows[viewer] by
  byPair`, no `first N`), which ruling 23 (W13a) made the form `check --cost`
  prints `lanes ≤ meter` for instead of noting.
- **Narration: `N_WIDE_MERGE` as an unmet limit 4/4 → 0/3; bound vocabulary
  31–43 → 15–29 a run.** But the note's sentence took its place: two reports of
  three carry "can exceed the opening meter at larger fanout" as a limit not
  met, and all three carry the 32-word bound. A note retired into a card
  sentence is narrated less, not never.
- **Literals did not move**: 34–44 against 35–55.
- **Following did not move, and was not meant to** (ruling 38 deferred). The
  same merge-on-read shape in every run, 1,540 examined on a 500-lane first page
  against 115; the runner's ratio 2.64× / 1.73× / 2.53× at p50 (2.2–3.0×
  before); the builders' bare clients 2.87× / 9.87× / 8.63× (5.2–9.0× before).
  The keys-only measurement at 5 and 500 follows is still owed. The celebrity
  write path is flat (post acknowledgement 0.96× / 0.98× / 0.99× at p50).
- **The surface budget went the other way** (the table above): +320 README
  lines, +249 card lines, more lines read. The wave removed one walk from one
  card and documented everything else it did.
- **Seconds**: 7.8–10.7 minutes at load 52–70 against 9.6–10.5 (valid runs)
  at 11–76. The comparison this bar is for is the loops, the protocol chosen,
  the notes and the narration — and on 0.2.29 those read: no dead end, no
  defect, one protocol at the cheap cost, no note but a true one, and the
  limits narrated down by half while the surface they are read from grew.

## What the agents wrote

run-1: "Search pages 20 memberships and reads complete nested chat groups. Word
expansion still has the package's 32-word bound, and expensive queries can
exhaust the default meter. Following discovers all followed-author lanes on each
page; sufficiently wide follows can cut during opening without a continuation.
Trending merges 25 hour lanes over signed score/time columns." On its loops:
"Earlier transport exploration guessed an unsupported root client export and
encountered a server that exited with its shell."

run-2: "The returned outer shape owns continuation, so a meter-starved nested
shape can be retried through the native continuation … No acquisition horizon
or device holdings are involved." On unread: "Very large membership populations
can exhaust the read meter and return incomplete without a continuation; the
fixed 1,000-membership hub fits." On Trending: "Ranking cursors are live, not
snapshots, so concurrent score changes require restarting the first page."

run-3: "Every tested query page was complete, with no meter cuts." On its one
loop: "an early request preceded readiness, and the initial raw argument body
needed the documented/generated operation arguments inside the wire `args`
envelope." On limits: "Following rediscovers author lanes on every page and can
exceed the opening meter at larger fanout. Search retains the engine's word,
heap and output limits."
