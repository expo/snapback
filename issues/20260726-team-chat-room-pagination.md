# Team Chat needs membership-scoped opaque room-history pagination

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 2
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Team Chat needs membership-scoped opaque room-history pagination” shows the issue reaches a security, correctness, release, or core product boundary; the defect is blocking or unsafe on a live path now, while the repair crosses several runtime, host, protocol, or policy seams, with a direct reproduction or current implementation proof.
**Severity:** P1
**Systems:** Team Chat, Standard patterns, Authorization, Pagination
**Date:** 2026-07-26
**Governing:** LLP 0056, LLP 0065, LLP 0063 Step 6
**Proposed authority:** LLP 0100 (Draft)

The `team-chat/local-pressure-v0` checkpoint proves opaque keyset pagination
for each principal's recipient-owned inbox. It does not prove the required
product path: paging one protected room's history.

`defineOwnedKeysetPages` intentionally supports a single owner field and an
index shaped `[owner, cursor]`. A team room instead needs an index shaped
`[room, cursor]` plus a declaration-bound membership predicate. Raw page keys
or application-minted cursors would weaken the current authority-bound cursor
contract and are not acceptable workarounds.

## Proposed decision

LLP 0100 proposes `defineMembershipKeysetPages` with stable
`membership-keyset-pages.v1` / `membership.v1` identities. The closed profile
requires an exact `[resource, cursor]` unique index, executes the
declaration-bound membership predicate on every page, and reuses the opaque
MAC cursor envelope with bindings over the app, function pair, room argument,
authority/authorization epoch, plan/index/order schema, activation/target
identity, and instance keyring.

The proposal remains Draft. This issue stays open until the RFC is independently
reviewed, ratified, implemented, and exercised by the Team Chat product
receipts.

**Progress 2026-07-30:** the v0.2 revision landed (Major 1 decided by the
author as its option (a); this ticket's two Minors applied — the page-key
idiom is now a stated guide obligation and compound boundaries are LLP 0100
open question 4; the probe-shaped first-page negative joined acceptance).
Remaining gate: ratification under the stated LLP 0056 boundary, then
implementation and the product receipts.

**Progress 2026-07-27:** first independent cross-family review round done —
`llp/reviews/0100-membership-addressed-operations-and-pages.fable.md`
(Claude family; the draft is Codex-authored). The pages surface (§4–§6) drew
no Major; Minors touching this ticket: the per-resource unique `pageKey`
idiom must land in the guide with the helper (LLP 0061), and acceptance
should add the byte-identical nonexistent-room vs unjoined-room first-page
negative. Gate: author revision + ratification, then implementation.

## Acceptance

- a member traverses a pinned multi-page room fixture without overlap;
- a non-member sees no room or cursor existence;
- malformed, cross-room, cross-user, cross-target, expired, and
  post-membership-change cursors fail with one safe coded outcome;
- membership removal invalidates an already-minted continuation before
  candidate evaluation;
- concurrent untouched rows are neither duplicated nor skipped under the
  admitted consistency contract;
- the query is index-served with a preregistered work/page bound; and
- the Team Chat pressure app uses the surface through headless and complete UI
  receipts.
