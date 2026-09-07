# Clique / Snapback 2 — M7 final report

lane: grok-clique-snapback2
model: grok-4.6
effort: xhigh
backend: snapback2-0.0.4
phase: m7
start=1788745131

## Raw clock

| mark | epoch |
| --- | ---: |
| M7 start | 1788745131 |
| owner up (fresh starter) | 1788745609 |
| pre-snapshot | 1788745664 |
| fillVisibleCounts done | 1788745984 |
| visibleCount required | 1788745995 |
| suite + acceptance m7 | 1788746220 |
| snapshot compare | 1788746230 |
| choreography green | 1788746874 |
| iOS Hermes export | 1788746908 |
| report | 1788746917 |
| end (pids killed) | 1788747007 |

Wall (seconds): 1876 (~31 min). Under the four-hour cap.

## Status

**green**

| gate | result | evidence |
| --- | --- | --- |
| `npm run acceptance -- --milestone m7` | pass | `artifacts/m7-suite.txt`, coverage sha256:51f44bd0fb8c5be233678225cbcbfad8d5578f9027a8ef2a8683ca9fc2621814 |
| coverage manifest | suite-required m7-a01, a03, a04, a06, a07, a09 | `coverage.json` |
| choreography `m7` | green | `receipts/m7.jsonl` assertions 2/2, `green: true` |
| pre-M7 snapshot | 8 personas | `m7/pre-snapshot/` |
| snapshot compare (m7-a08 local) | PASS | `scripts/m7-compare.mjs` vs `m7/post-snapshot/` |
| previously green suites | m1 pass, m2 pass | `artifacts/m1-m7-regression.txt`, `artifacts/m2-m7-regression.txt` |
| other prior suites (not previously green) | m3–m6, m8 still pass; prior choreography failures not repaired | `artifacts/*-m7-regression.txt` |

## Pre-M7 count structure

Yes. The inherited schema already had `maintain messageCounts = count messages by conversationId` and `api.messages.summary.messageCount`. That maintain counts all message rows, including tombstoned. M7 added `conversations.visibleCount`, backfilled visible-only (exclude tombstoned and expired), and maintains it forward on send/sendMedia/sendPoll/delete/purge. Polls are message inserts, so they count.

## Snapshot comparison

Pre-existing messages, media, receipts, and reactions for all eight starter personas matched `m7/pre-snapshot/` after the successor, fill job, and narrowing. New polls and suite traffic are additive.

## Correction loops

1. Snapshot passed `c` into non-pageable `reactionsFor`/`receiptsFor` — **agent-error** (`E_INPUT` unknown args: `c`).
2. `optionKeys[0]` in Quarry — **agent-error** / platform gap (`E_QUARRY_UNKNOWN` unknown table optionKeys).
3. `#pollTallies` in thread/pollFor page shapes — **snapback2-defect** / bound (`E_STRUCTURAL_COUNT`).
4. Changing pollTallies grouping after apply — **agent-error** (`E_SUCCESSOR_DESTRUCTIVE` drop `pollTallies.byMessageOptionKey`).
5. `mineKey` only when `pollFor.state === "complete"` while the votes scan reports `capped` — **agent-error** (choreography a02 attempt 2 / a05 selection).
6. Offline pending not set on click — **agent-error** (choreography a05 `offline pending vote`).

## Servers (kill only these PIDs)

| role | pid | port |
| --- | ---: | ---: |
| owner wrapper | 55737 |  |
| product owner | 55747 | 49400 |
| Expo npm | 31185 |  |
| Expo metro | 31211 | 49401 |
| metro workers | 32376–32386 |  |

## Native artifacts

- iOS Hermes: `artifacts/m7/ios-hermes/_expo/static/js/ios/entry-153d803d36d04a056345a4f51e658737.hbc` (not faked).
- Simulator Clique `.app`: not produced (same class as prior M6/M8: separately recorded, does not block web green).

## Candid gap list

1. Quarry has no list indexing; poll create is four named option fields.
2. Nested `#maintain` in a page shape is `E_STRUCTURAL_COUNT`; tallies are aggregated client-side from `pollFor.votes`.
3. `first N` on a cap-N group reports `capped`, which is easy to mis-handle as “no row.”
4. Reshaping a maintain grouping is a destructive index drop; needs `--apply-migration` or a revert.
5. `snapback2 guide successor/migrations` is not a published page (`E_GUIDE_UNKNOWN`); operator.md + job.md + the diagnostic rewrite are the docs.
6. RN-web `accessibilityState.selected` does not become `aria-pressed`; explicit `aria-pressed` / `data-selected` / `accessibilityPressed` are required.
7. Offline pending is not automatic on the option node; the app must set `aria-busy`/`data-pending` on the click.
8. Prior M3–M6/M8 choreography failures were left unrepaired under M7’s budget.

end=1788747007
