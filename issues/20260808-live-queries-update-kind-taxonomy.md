# live-queries.md conflates wire frames with onUpdate meta kinds and omits the terminal delete kind

**Opened:** 2026-08-08 · **Severity:** P2 (documentation correctness)

guide/realtime/live-queries.md:119-131 presents one update-kind list that
mixes two vocabularies:

- `authorization_invalidation` frames never reach `onUpdate` — the client
  consumes them internally (packages/snapback-client/index.mjs:10513-10530)
  and delivers boundary events as `authorization_${event.kind}` for
  `snapshot|quarantine|delete`, plus `authorization_error`/
  `authorization_denied` (index.mjs:9626-9635, 9645-9690);
- the page names only `authorization_snapshot` and
  `authorization_quarantine`, omitting `authorization_delete` — the
  terminal denial that guide/auth/protecting-data.md:127 itself describes;
- "handle all four kinds" never says which four.

This is the kind of ambiguity that produces silently dead client branches.

Also on the same page: a dangling lead-in at :131-132 — "A subscription
asserts on delta kinds like this:" is followed by two unrelated paragraphs
and a snippet (:151-159) that only constructs a subscription; the promised
assertion snippet was evidently moved or deleted (candidate restore source:
demos/_kit/tests/live-delta-e2e.mjs).

Ask: separate "wire frame kinds" from "what your onUpdate receives",
enumerate the auth-boundary kinds completely, and fix or delete the
dangling lead-in.

Found by the 2026-08-08 comprehensive docs review (realtime slice).
