# Snapback 4: data-modeling forms SQL builders expect (candidates after 0.4.1)

Date: 2026-09-24. Source: hands-on checks of an issue tracker and a booking
marketplace against the 0.4.1 candidate, plus calibration #19's
diary. Items already taken into 0.4.1 (spread, default text bound, shape
field replacement, optional-filter variants, empty-search browse, keyed
`exists`) are not repeated here.

## 1. Overlap and exclusion constraints

A booking app writes:

```quarry
mutation book(listing: listings, start: time, end: time):
  require not exists(bookings where .listing = listing and .status != 'cancelled' and .start < end and .end > start) else TAKEN
```

Today it is refused with `E_STRUCTURAL_FANOUT` ("the mutation page's read
rule is not uniformly decided by its prefix") and a rewrite about pinning
`.guest, .host`. The real issue is that the viewer cannot read other guests'
bookings, so a mutation cannot check them. The pattern that works today is a
public per-night table with `unique listing, day`. The guide does not teach
it.

Candidate: a declared constraint, like Postgres `EXCLUDE`:
`no overlap .start, .end by listing where .status != 'cancelled'`. The engine
enforces it on every write, across all rows, and discloses only the clash, as
`unique` does. Over rows that already satisfy the invariant, the check is one
seek: the last row with `start < new.end` overlaps if and only if its
`end > new.start`.

At minimum, the diagnostic should say that a mutation sees only rows its
viewer may read, and point to the per-night unique pattern.

## 2. Referential actions

References are typed ids with no existence check and no delete cascade, and
cleanup is the application's (types card). SQL builders expect
`on delete cascade | restrict | set null`.

Candidate: declared actions on a reference column.
- Capped children (`cap N by parent`) are handled in the deleting
  transaction.
- Uncapped children are handled by an engine-owned sweep: the parent is
  tombstoned at once, and the children are removed in self-chunking
  transactions, as LLP 3000.013 §5.2 does for jobs.

## 3. Rules through references (now LLP 3000.014)

Child tables copy the parent's audience key: `comments.org` beside
`comments.issue`. The copy is kept honest only with an insert probe
(`exists issues[id = .issue, org = .org]`). The maintained-count disclosure
note still fires even when that probe and `immutable` establish the
invariant.

Candidate: `read <- readable issues[.issue]`. The engine copies the parent's
immutable audience columns into the child at insert, proves them, and derives
sync and aggregate readability from that copy.

## 4. Per-field unavailability on devices

A shape field computed from a streaming aggregate over a table synced with a
horizon (the inbox's `unread`) makes the whole device answer unavailable. The
0.4.1 fix keeps the last answer and asks the server. Offline and
never-answered, the inbox still shows nothing, although everything except
the count is held.

Candidate: that field is null, and the page is `complete: false`. This needs
a nullable generated type for aggregate fields over horizon-limited sources.

## 5. Smaller

- Computed scalar columns (`fullName = .first + ' ' + .last`).
- A float or decimal type (money is integer minor units today).
- `N_NO_CURSOR` on a deliberately fixed-size report page is noise. Consider
  suppressing it for `first N` pages with no `after`, when N fits the ceiling.
