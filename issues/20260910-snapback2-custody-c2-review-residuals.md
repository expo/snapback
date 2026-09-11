# snapback2: custody-c2 (LLP 1019 D6) review residuals

**Filed:** 2026-09-10 (orchestrator, RFC implementation program, lane `custody-c2`)
**From:** the lane's three fix rounds and the blind reviews `custody-c2-r{1,2,3}-{grok,codex}`
(program directory `~/projects/snapback-ri-20260910/reviews/`). Everything blocking was paid
before landing; these are the residuals both families and the implementer named.

1. **Acceptance 2 on a mounted Thread.** The proof observes the shared
   `conversationView` → `withHistory` → `threadItems` binding both screens import
   (`tests/chat-screens-owner.test.ts`) with an exhaustive zero-transport fetch; it never
   renders `<Thread>` or the "Downloaded history" note. Add a React `createRoot`/`act` mount
   (and Expo if the harness allows) asserting the note, the drained bubble, one predicted send,
   `itemsFrom === "history"`, no transport.
2. **Manifest-only-schema reset, end to end.** `resetCoverage` passes `this.schema`, which can
   be the manifest's tables (with `retain` but no `deliver.log`) before `restoreProgram`; the
   store then keeps only what the stored program's schema anchors. The direct clock-reset
   regression exists; the owner-level path (manifest assigned, program not yet restored, reset,
   cold reopen) does not.
3. **Carol offline after paginated joiner history:** `conversationView` must not mint delivery
   events for a joiner who paged 105 rows live and then went offline (the joiner-history test
   covers the pages, not the offline follow-up).
4. **LLP 1011 B5 wording** still compresses the history: custody-c1 added the six `deliver`
   words; D6 only removed `tombstones`.
5. **Four inherited reds outside the blocking package list** (fail at the lane's base too):
   `tests/client.test.ts` "query retries HTTP and network transport failures while mutation
   retries neither"; `tests/assets.test.ts` "mutation substitutes scalar, optional, list, and
   video sources from one manifest generation", "descriptor fence refuses an observed manifest
   generation change after uploads", and "local serialization failure discards automatic uploads
   before any mutation request" — verified failing at `origin/main`'s tip on the verification
   host on 2026-09-10, so they predate this lane. `scripts/test.sh` does not run them; decide
   whether they join the blocking list or are deleted.
6. **LLP 1012 is over the 1,500-line word** (`rules/NOT-DOING.md`; 1,861 lines, inherited): the
   enforced `caps` check is the source-file cap, so this is curation — split or fold the spec
   on its next revision, not in a lane.
7. **A successor that adds `retain delivered-history` and narrows a type in one install** skips
   adoption validation on the newly retained table (`retains(table)` reads the predecessor
   schema — right for "keep what the old program called custody"), so an unrepresentable image
   there could still reach cold preparation. Not the chat template's shape; rule it (newly
   retained tables join the walk, or are out of it) when a lane ships retain-adding changes.
8. **An actual clock-reset custody run.** The clock regression replaces `store.commit` with a
   recorder and proves argument construction; seed delivered custody and cached bytes, trigger a
   real `ClockCoverageReset`, reopen each carrier, and assert preserved custody, cleared
   coverage, and a successful drain.
9. **Interrupted adoption with byte custody on the three carriers.** Inject a persistence
   failure during adoption with an incompatible asset-bearing image and a fitting sibling:
   failure must preserve the predecessor schema, bodies, and bytes; success must remove only the
   incompatible body and its unshared byte lease while keeping both anchors (the reviewer's
   in-memory rollback probe passed; the physical carriers are unproved).

## Disposition — 2026-09-11

**Priority:** P2 overall (items 2, 7–9 highest custody risk). **State:** keep
open. The inherited retry red still fails at `15c134d056`:

```sh
cd snapback2
node --test --test-name-pattern="query retries HTTP and network transport failures while mutation retries neither" \
  packages/snapback2/tests/client.test.ts
```

It failed at `assertRefused` (`false !== true`), so item 5 is current evidence.
Real-browser signup/shared-session controls passed ordinary IndexedDB custody,
one-writer forwarding and takeover, but not manifest-only reset, paginated
Carol offline delivery, actual clock reset, or interrupted byte adoption. No
residual closes here; items 4/6 remain documentation curation.

## Disposition — 2026-09-11 client/custody qualification

**State:** keep open, narrowed. Commits `f9ee16ff0` and `dc8bbf74c` resolve
items 1, 3–5, 7, and 9 and the correctness half of items 2 and 8:

- the shipped React `<Thread>` is mounted over a supplied cold client and pins
  the Downloaded-history note, drained and predicted bubbles,
  `partial-history` witness, and zero transport;
- Carol pages all 106 historical rows through both shipped reads, restarts
  offline, repeats every page and the empty delivery log without transport;
- `client.test.ts` and `assets.test.ts` join the blocking package command. Their
  90/90 run is green; malformed HTTP 400 is pinned as one non-retryable
  `E_WIRE_SHAPE`, local serialization as non-retryable `E_CLIENT`, and the
  descriptor fence now compares both manifest and program generation;
- LLP 1011 B5 records the actual D3 +6/D6 -1 history;
- all three carriers prove a retain-adding/type-narrowing successor validates
  the newly retained rows; and an injected file pre-rename, SQLite transaction,
  or IndexedDB transaction failure preserves predecessor bodies and bytes,
  while retry drops only the incompatible body and its unshared bytes and
  retains both delivery anchors;
- reset now selects the adopted program's full schema ahead of the manifest
  projection (while an explicit swap schema still wins). A manifest-only
  deterministic store/cold-reopen control preserves its delivery anchor and
  body. A naturally raised `ClockCoverageReset` on each carrier preserves that
  custody and its bytes, clears the obsolete answer, reopens cold, and admits
  the next checked clock page.

The four focused files pass **194/194** together at their 60-second per-test
limit. Exact remaining work is (a) item 6's LLP 1012 split/fold, which remains
curation rather than a correctness repair; (b) if the original wording is held
literally, a real-owner scheduling witness for manifest-before-program reset
instead of the deterministic runtime/store boundary; and (c) an explicit
client drain after the real clock reset rather than the checked post-reset
clock page. These last two integration controls do not identify an unfixed
source defect. Do not close this ticket until those acceptance-wording choices
and LLP curation are discharged.

## Disposition — 2026-09-11 literal integration controls

**State:** keep open for documentation curation only. Commit `90ca5ab03`
discharges both remaining correctness controls against a real owner and the
Node file carrier:

- the client first drains the shipped chat log and retains the real generated
  delivery anchor and `message-1` body;
- a legacy unclocked answer is installed while that custody remains, and its
  held program is cleared to reproduce the cold manifest-before-program state;
- the first real `/api/program` response is held after `/api/manifest`; at that
  boundary the runtime has no restored program and carries exactly the
  manifest schema projection;
- releasing the response makes the first ordinary program commit raise
  `ClockCoverageReset`; the observed retry is one `resetCoverage` swap carrying
  the adopted program's full schema, including `messages.deliver.log`;
- the reset removes the obsolete answer while retaining the exact body and
  anchor, after which a public `drain: true` subscription reaches `caughtUp`
  and the live tail; a transport-free cold restart still reads the drained
  message.

The combined focused control passes 6/6: this real-owner case, the prior
manifest-only runtime case, and the actual clock-identity custody/byte case on
the Node file, IndexedDB and SQLite carriers. No production change was needed.

Item 6 is not safe to fold opportunistically into this correctness lane. LLP
1012 is currently 1,877 lines. Reaching the 1,500-line rule requires moving or
deleting at least 378 lines, while its two largest sections (`#6-reads-offline`
and `#7-writes-offline`) interleave current normative rules with historical
implementation records and account for 898 lines. There are 220 live
non-review references to LLP 1012 in this checkout, including direct references
to those section anchors and their `indexed-held-search`,
`bytes--frozen-allocation`, and `coverage-reset-amendment` subsections. A blind
split would either move the meaning behind those anchors or duplicate binding
text.

The safe remaining work is a documentation-only curation pass: separate the
dated implementation history from the current contract, retain concise
normative text under every existing referenced heading, place the extracted
record in a conventionally numbered companion or tombstone, and run both
`ref-check` and an LLP-maintain audit over every changed reference. Until that
curation is reviewed and lands, this ticket stays open at P3 documentation
priority; there is no remaining custody/runtime defect attributed to it.
