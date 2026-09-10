# Snapback 2: M7 poll-shape `E_STRUCTURAL_COUNT` reproduced — the refusing spelling is gone; no policy change

**Opened:** 2026-09-10 (LLP 1020 A7, lane `cost`)
**Area:** certificate policy / maintained reads
**Related:** LLP 1020 A7; LLP 1011 B2; `20260907-snapback2-quarry-gaps-from-the-m7-migration-legs.md` item 2

## Finding

- The grok M7 leg's refusal (`~/clique-full-20260905/lanes/grok-snapback2/m7/run-log.md`,
  1788745840) was `#pollTallies[...]` inside the `thread` page shape:
  `E_STRUCTURAL_COUNT capped-only site messages.thread.2`. On that package the parser
  turned `#table[keys]` into an `aggregate` read (`quarry/parser.ts` at `66f960d48d`), a
  structural count sink. LLP 1011 B2 (2026-09-08) deleted `#`; a maintained point read now
  lowers to `Get`, which `certificate_policy.rs` never marks structural.
- Reproduced on today's code (`snapback2/crates/snapback2/tests/check_cost.rs::
  m7_poll_tally_reproduction_records_capped_only_refusal`, and by hand on the chat template
  with grok's `pollOptions`/`pollVotes`/`pollTallies` declarations): `page { *, tally:
  tallies[.id] }` over a capped-only scan is admitted; grok's nested
  `options: pollOptions[.id] first 4 … { *, tally: pollTallies[.messageId, .optionKey] }`
  admits or refuses `E_BOUND` on output/closure width (the m7-retry log's "nested poll
  projection failed `E_BOUND`"), never `E_STRUCTURAL_COUNT`. The refusal reappears only when
  a structural sink depends on the capped-only page — `count(page)` yields "returned result
  depends on capped-only site todos.list.0; its read rule is not uniform over the scanned
  prefix" — and pinning the scan to a uniform prefix (`polls[viewer] … by byOwner`) admits.
- A membership-probe read rule keyed by the scanned prefix
  (`exists memberships[.conversationId, viewer]` over `messages[conversationId]`) is uniform
  today (`certificate_policy/visibility.rs`), so grok's `thread` scan is not capped-only here.

## Ruling owed (A7)

None of the refusing mechanics remain: a keyed maintained read keyed by the page's own row
is already admitted, so no exemption is needed and lane `cost` changed no policy. Any future
exception must keep absence authority: an unreadable maintained row carries neither payload
nor absence in its receipt; receipt-only replay stays `partial` even when the server returned
typed zero (LLP 1011 B2; LLP 1001 capped-only sites). A group cap is not a visibility proof.

Close on the author's confirmation that no ruling is owed.
