# 0.4.3 integration

Branch `sb4-intent/integration-043`, from main `7706ab656`. The supervisor
integrated this round by hand. Codex could not authenticate (HTTP 401) on any
host for its first half, so Grok reviewed every delta blind; Astra rejoined once
codex recovered, and wrote lane V round 16.

## What it carries

| Lane | Rounds | What |
|---|---|---|
| U | 11–13 | Remembered answers keep their own expiry, and expiry-retry watches keep their wakeups. Closes `issues/closed/20260925-snapback4-expiry-retry-watch-edges.md`. |
| V | 12–16 | Outcome-qualified acknowledgements, receipt custody through web upgrades, and lookup reading a verified shared correction, while settlement reads only the device's own history and lookup rechecks custody after adoption. Closes `issues/20260925-snapback4-legacy-acknowledgement-outcome.md`. |
| receipts card | 0–18 | `guide receipts`: sent, delivered and read in one query. A delivered prefix, a `runs` table for fetched runs above gaps, a `progress` catch-up page, and a hook that reports every run it holds and every view, owing each until the server shows it covered. A report the client could not keep goes again with the next answer. An engine test and a React-harness test of the card's own hook. |
| live presence | 0–14 | LLP 3000.018: a query that may read `connected[p]` asks for a 5-second refresh, and the clients re-read it in the background, publishing only a reply nothing overtook. Remembered answers are ordered by the store cut each reply names, the highest cut named is kept, and composed reads take their place in the same order. Rounds 1–4 followed presence through held polls and were withdrawn (§6). |
| scale certificate | 0–6 | A third class, `backlog`, for work background cleanup removes, granted only to the scan the compiler generates for a timeline read; the paved Following feed reads `constant once background cleanup catches up`. Presence variants come only from an argument's presence, answer for every compatible site, and condition what follows a branch that returns. Closes `issues/closed/20260926-snapback4-backlog-scale-class.md`. |

## Merges and resolutions

- **U rounds 11–13** (`442cf0d21`). One conflict, in `JOURNAL.md`; both entries
  were kept. `local-query.ts` auto-merged and keeps the fence fix
  (`speculative === true`).
- **V rounds 12–13** (`699b83279`). Ten files conflicted, because V's round-11
  head predates lanes Y, Z and T. Each resolution kept both sides:
  - `sync_wire.rs`: main's `now` (lane Y) beside V's `sent`, in the
    alphabetical order the byte-exact encoding test requires.
  - The six test literals and the expected JSON carry both fields.
  - `local.ts` imports main's type list plus V's `successSequence`.
  - The LLP 3000.013 revision line and `JOURNAL.md` keep both.
  - The wasm budget takes main's entry, then raises it (below).
- **Fake devices** (`a7a2078e2`). V round 12 refuses a device that does not
  advertise `receipt_outcomes` (`E_DEVICE_VERSION`). Four client test files
  from U and the 0.4.2 integration used fakes that predate it. They now
  advertise the capability, as V's own fakes do; 217 of 217 pass.
- **V round 14** (`d011af2b4`), then **round 15** (`81116bf6d`). Each
  conflicted only in the LLP 3000.013 revision line.
- **The receipts card** (`f9f8d174d`), then its census (`063ae0136`). The
  readauth authoring census walks every card, and the card's five mutations
  are new entries.
- **Live presence** (`7ba594e4c`), its clock fix (`f25467d2a`), and follow
  grants (LLP 3000.018 §3.5): a poll follows only presence its viewer's own
  queries read.
- **The ordinal receipts card** (`c523c7ccc`), after the first card's NOT READY
  review. Its `JOURNAL.md` conflict kept both entries.
- **V round 16** (`a15738530`). Four files conflicted:
  - `web.ts`: main's recovery order (orphans, then the journal) kept, with V's
    lookup-only history read;
  - `local.ts`: V's `lookupWrite` import added to main's type list;
  - the LLP 3000.013 revision line and `JOURNAL.md` kept both.
- **The wasm budget** (`e966922a9`), committed with its ledger entry.
- **The receipts card, rounds 4–11** (`60d77b512`), clean.
- **Live presence, rounds 4–6** (`25172b56d`). Only `JOURNAL.md` conflicted, and
  both entries were kept. The server's poll returns to its pre-presence form.
- **The final lane rounds**: the receipts card, rounds 12–20 (`3410446db`); live
  presence, rounds 7–14 (`6ab9544cb`); the scale certificate, rounds 0–7
  (`60053dc02`). Each conflicted only in `JOURNAL.md`.
- **The renumbering** (`84d0e6820`). `main` had taken LLP 3000.017 for ephemeral
  tables, so live presence became LLP 3000.018 in every file of this branch,
  before `main` was merged. Two stray `.probe.mjs` measurement scripts went.
- **Live presence round 15** (`5fe936c7d`), renumbered the same way.
- **Main at `6768a0385`** (`31a877ec0`), which had just landed ephemeral tables
  (LLP 3000.017, implemented) in the same client and server code as live
  presence. Thirteen files conflicted, and every resolution keeps both
  features:
  - `client.ts` and `local.ts`: `post` and `sendPost` take the ephemeral
    request and the presence refresh's quiet flag; query results carry both
    `refresh` and `ephemeral`. A presence refresh publishes only an answer
    current for the ephemeral state too.
  - `local-query.ts`: results carry the store cut, the refresh and the
    ephemeral request. A refetch for a stale ephemeral request, and
    `runLocal`'s ephemeral retry, take a new place in the remembered answers'
    order, as every refetch does.
  - `engine/mod.rs` records the query transaction's cut before main's
    ephemeral layering; `serve.rs`'s reply carries `ephemeral` and `refresh`.
  - The guide's keyword list, the client guide, the guide fact homes and the
    readauth census carry both new cards; `NOT-DOING.md`'s presence line states
    both; LLP 3000.013's revision line and `JOURNAL.md` keep both sides.
- **The scale certificate, round 8** (`fd4516b02`).

## Wasm

Merged with main's ephemeral-tables baseline (579,833 B), the device measures
2,021,689 B raw and 581,094 B gzip, and the ratchet moves to 582,094 B
(measured + 1,000). Before that merge, the ratchet had moved from 522,000 B to
525,000 B. Merging V rounds 12–13 measured
1,857,919 B raw and 524,013 B gzip (Rust 1.97.0, wasm-bindgen 0.2.127, no
wasm-opt): the device keeps each acknowledgement's outcome qualification and
advertises `receipt_outcomes`. Live presence adds a `presence` field to the
engine's query outcome, measured at 524,732 B gzip. The ledger in
`metrics/wasm-budget.json` records the reason.

## Suite runs

| Run | Tree | Result |
|---|---|---|
| 1 | U and V (rounds 12–13) merged | Stopped at the wasm budget: 2,013 B over 522,000 |
| 2 | Budget raised | 1 failed stage: 33 client tests refused `E_DEVICE_VERSION` from fakes |
| 3 | V round 14 and the fakes fix | 0 failures in 549 s |
| 4 | V round 15 | 0 failures in 547 s |
| 5 | Receipts card | 1 failed stage: `readauth::authoring_census` (the card's mutations) |
| 6 | Census updated | 0 failures in 573 s |
| 7 | Live presence | 1 failed stage: `clock_advance_expires_presence_grace_and_a_new_poll_reconnects`. The clock advance woke every held poll, ending open ones. Fixed so an advance wakes held polls only when one follows presence |
| 8 | Presence clock fix and the ordinal receipts card | 0 failures in 555 s |
| 9 | Follow grants | 0 failures in 581 s |
| 10 | Receipts card rounds 2–3, presence rounds 2–3 | 0 failures in 641 s |
| 11 | V round 16 | 0 failures in 563 s |
| 12 | Receipts card rounds 4–11, presence rounds 4–6, the committed budget | 1 failed stage: two `snapback4-sim` w15a meter pins, moved 67 bytes per guard read by the presence memo's heap charge. Repinned in presence round 7 |
| 13 | The lanes' final rounds (receipts 20, presence 15, scale 7) merged with main at `6768a0385`, which carries ephemeral tables | 0 failures in 1,131 s |

## Reviews

Reviews ran blind on eb1000, one worktree per review. Until codex recovered,
every review was by Grok.

| Delta | Verdict | Disposition |
|---|---|---|
| U r13 | Grok READY; Astra READY WITH CHANGES | Astra's one Medium, row expiry, stays in `issues/20260925-snapback4-remembered-answer-row-expiry.md` |
| V r13 | Grok READY; Astra READY WITH CHANGES | Astra's Medium was fixed in round 14 |
| V r14 | Grok READY WITH CHANGES | Its Medium, the overlay reaching settlement, was fixed in round 15 |
| V r15 | Grok READY; Astra READY WITH CHANGES | Astra's two Mediums and one Low were fixed in round 16 |
| V r16 | Grok READY; Astra READY | Astra's Low test gap (qualified adoption in the race cases) stays open |
| Receipts card r0–r9 | Nine NOT READY or READY WITH CHANGES verdicts | Each round's findings are dispositioned in the next round's commit; the reviews are in `reviews/rc-*` |
| Receipts card r10–r20 | Astra NOT READY at rounds 14–18; Grok READY WITH CHANGES at 18; Astra READY WITH CHANGES at 19 | Every finding fixed by round 20. The limit both families accepted, a report dropped at the 64-run cap and then forgotten by a reload, is stated in the card |
| Live presence r0–r4 (follow design) | NOT READY from both families at every round | Withdrawn; LLP 3000.018 §6 |
| Live presence r5 | Astra NOT READY; Grok findings | Fixed in round 6 |
| Live presence r6–r15 | Astra NOT READY at rounds 6–12, READY WITH CHANGES at 13; Grok READY at 11, NOT READY at 14 | The store-cut order took rounds 9–15: a refusal's own cut, the highest cut named, composed reads in the order, and (Grok, round 14) no composed cleanup before its reply |
| Scale certificate r0–r8 | Both families NOT READY at rounds 0–4, READY WITH CHANGES at 5–7 | Round 8 closed Astra's last Lows (copies known before the walk; literal comparisons that hold). Grok's round-7 Lows, six shapes the certificate over-charges and none a false constant, are `issues/20260926-snapback4-scale-certificate-precision.md` |

## Probes

These are supervisor probes on eb1000, not suite tests. Each ran the package
tiers against a real development server. Bob's client was the tier under test,
and the timings start when Alice's mutation returned `sent`.

| Probe | online | native | web |
|---|---|---|---|
| A peer's watermark reaching `membersOf`, 10 rounds | 10–11 ms | 0–10 ms | 10–11 ms |
| A typing row appearing, and expiring | 10 ms; 4.5 s | 11 ms; 4.5 s | 11 ms; 4.5 s |
| A just-added member: inbox, then history, then the next message | 10, 21, ≤11 ms | 0, 10, ≤10 ms | 9, 20, ≤19 ms |
| Following delivery, post to follower's page, 10 posts (p50 / max) | 15 / 16 ms | 19 / 21 ms | 13 / 14 ms |
| A live `connected[p]` turning true after the principal connects, before 0.4.3 | never (60 s) | — | never (60 s) |
| The same with 0.4.3 (the live test) | 5.0 s | 5.0 s | 5.0 s |

The Grok builder's M3 trouble was not platform latency. Following delivery,
which the 0.4.1 comparative left to measure behind grader finding d-02, takes
tens of milliseconds end to end. The one platform defect found was presence,
fixed by LLP 3000.018's refresh.

## Tickets

- **Closed:** `20260925-snapback4-legacy-acknowledgement-outcome.md`, fixed by
  V rounds 12–15.
- **Opened:**
  - `20260926-snapback4-stored-manufactured-sent.md`: round 13's upgrade-only
    Low, a design decision.
  - `20260926-snapback4-live-presence.md`, closed here by LLP 3000.018.
- **Opened at landing:** `20260926-snapback4-scale-certificate-precision.md`,
  Grok's round-7 Lows on the scale certificate: six shapes it over-charges,
  none a false constant.
- **Still open:** `20260925-snapback4-remembered-answer-row-expiry.md`.
