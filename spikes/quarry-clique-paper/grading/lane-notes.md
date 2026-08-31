# Lane grading notes — Clique M1–M3 paper exercise

Grader: Claude Fable 5 (orchestrator), against `grading-key.md`. Cross-review
verdicts in `cross-review/`.

## codex gpt-5.6-sol lane

**M1 — clean.** Identity/assets stayed kinds (the brief's KDF language did
not bait an in-plane auth implementation); `id: viewer` profile keying;
commit-time `unique handle`; write rules per effect on the table. Strains
(correctly flagged in its notes): no charset/min-length/nonBlank predicates,
no URL type — both exist in LLP 0329.014.004's schema vocabulary
(`text({min, charset, nonBlank})`) and were elided from the one-pager.

**M2 — the big finding.** Invented a third Following-feed strategy: one
shared `followingFeedEvents` lane whose READ rule is viewer-dependent
(`r.actor = viewer or exists follows[viewer, r.actor]`). Elegant (unfollow
hides history instantly; self-posts free), and **refused by v1 policy**: a
completeness-sensitive timeline scanned under a non-uniform rule is the
uniform-read-logs / hidden-take defect family (0329.014.004 §2.1-A, §8
ruling-2 rows). The one-pager omits that policy family, so the lane cannot
be blamed — the finding is that the one-page grammar admits a program the
seventeen-dimension design refuses. Everything else clean: all five counts
maintained (`#` reads, auto-deref keys), reposts transactional with feed
events, replies never in feeds, 20/page cursors with separate `*Before`
queries. Named the composite `(time, id)` cursor gap — which is exactly what
the oracle's `pageKey` string-encoding exists to work around.

**M3 — near-production.** No semantic defect found by this grader.
- Recipient-set-at-send-time: receipt rows minted per current member at
  send, keyed by the membership *incarnation* id — rejoin mints a new id, so
  leavers stay dropped (`requiredNow: exists conversationMembers[.membership]`);
  aggregate derived client-side over a complete bounded (≤49) receipt set.
- Monotonic receipts: full transition matrix as an update rule + mutation
  guards; recipient-authored `markDelivered`/`markRead` batches (receipts are
  never read side-effects).
- DM pair unique sorted key + `match` idempotent reopen; groups as entities
  (identical membership coexists); 2–50 spelled as `firstMember + [users] <=48`;
  admin policy encoded in row rules INCLUDING first-admin bootstrap via
  `#conversationMemberCount = 0` and the 50-cap via a rule reading a
  maintained aggregate — an unmarked reinvention of v1's `cap()` constraint,
  which the one-pager omits.
- Removed members keep pre-removal history: correctly placed on the client
  custody boundary ("offline client cache"), matching v1's retention
  dimension rather than faking it in-plane.
- Typing = `channel` kind, TTL 5s, members-only. Chat list = bounded
  fan-out `conversationStates` (justified: group cap 50) + maintained unread
  per membership incarnation. `merge()` used correctly for the unread-receipt
  batch driver. Added a seed-idempotency table for acceptance item 7.
- Cost note: history queries nest receipts (≤50 × ≤50) — bounded but heavy;
  a maintained per-message aggregate was the cheaper alternative.

**Coverage: 26/27 oracle product ops** (missing only a `listProfiles`-style
user directory; `profileByHandle` is exact-match only). Ops: 20 queries +
22 mutations = 42 vs oracle's 42 (12 of the oracle's are fixture plumbing;
codex added 1 seed op of its own).

**Size:** final cumulative design 37,263 bytes / 1,426 lines vs oracle
product surface ≈ 79 KB (106.6 KB − ~27 KB fixture share) → **≈ 2.1×
smaller** at app scale (toy tasks measured 2.9×).

## grok-4.6 lane

**M1 — clean, convergent.** Same kind boundaries, same `id: viewer` keying,
same commit-time-unique reliance (explicitly: "do not check-then-insert"),
same two spec-elision strains. Divergence: avatar as a separate `setAvatar`
mutation so text saves cannot clobber it.

**M2 — the other side of the pincer.** Chose fan-out-on-write (`home` table
per follower) — and immediately hit the bound problem: `for f in
follows[followee = viewer] last 100` caps delivery at 100 followers, flagged
honestly in its notes as "unbounded celebrity fan-out and full-history
backfill are inexpressible." ALSO layered a viewer-dependent read rule on
`home` (stale rows after unfollow are hidden by rule re-check), and wrote in
its notes: "Assumes unreadable rows are skipped, not slotted, in `last 20`"
— naming the hidden-take ambiguity (v0.1 ruling 2, the corpus's
most-recurring defect family) as an explicit assumption, blind. Between the
two lanes: codex's rule-filtered lane hits the visibility-scan refusal,
grok's fan-out lane hits the fan-out bound — **the exact pincer that forced
`maintain.rows`, the broadcast projection, and engine fan-out in the v1
design (dimensions K/O, §2.2-E), reproduced independently by two blind
model families in one afternoon.** Neither could reach the paved answer
because the one-pager omits it.
Other divergences: likes are private to the liker with only the maintained
count publicly disclosed (`readable: public`) — a deliberate
minimal-disclosure design the oracle didn't attempt; `postAssets` slot table
instead of inline columns; optional-cursor handling by duplicating the whole
query body under `if cursor:` (codex: separate `*Before` queries — the same
gap worked around two ways).

**M3 — a third coherent design point, no blocking defect found.**
- Membership: soft-delete tombstones (`active`, `leftAt`) vs codex's
  row-delete + incarnation ids vs the oracle's two-table split — three
  designs for one problem, all sound.
- **Server-side pre-removal history**: leave snapshots `#lastSeq[conv]`
  into `historyThru`; the messages read rule is
  `members[..].active or r.seq <= members[..].historyThru`. A *stronger*
  reading of acceptance 6 than codex's client-custody answer (survives a
  relaunch with a cold cache) — the language made a genuine product fork
  visible as one rule line versus one boundary bullet.
- **Watermark receipts** (`lastDeliveredAt`/`lastReadAt` per member,
  monotonic guards, read-implies-delivered) vs codex's per-message receipt
  rows — the oracle contains BOTH mechanisms; each lane found one.
  Recipient set at send time = `active and joinedAt <= message.at`, author
  excluded; leavers drop out via the active roster. Nit (grader-found): the
  `at: time` watermark argument is forgeable *forward* — a client can pass
  a future time and future messages are born "delivered"; the per-message
  model is immune. Self-attested receipts anyway; MINOR.
- Sequencing: `seq = (#lastSeq[c] ?? 0) + 1` — sound only under
  trace-validated OCC (two concurrent sends conflict on the traced
  maintained read and retry); no `unique conv, seq` declared as a backstop.
- Send fan-out bounded `last 50` over active roster, justified by the
  member cap; unread is a stored counter (explicitly not a maintain —
  watermark-window semantics); preview denormalized onto member rows
  (chat list = one range read).
- Seed idempotency via client-minted message ids (`ensureMessage(id)`
  match-or-insert) and a `groupSeeds` key table (global key namespace
  collision flagged in its own notes).
- New spec gap found: **no spelling to unset an optional column** — re-add
  leaves stale `leftAt`/`historyThru` and the design "trusts `active`",
  flagged in its notes.
- Same strains as codex: rules as giant disjunction matrices (per-field
  grant vocabulary missing), hidden-take assumption restated.

**Coverage: 26/27** (same missing user directory). Ops: 10 queries + 18
mutations = 28 — a leaner factoring than codex's 42 (one `createPost` with a
kind enum vs six variants; one `send` with optional quote).

**Size:** final cumulative design 37,137 bytes / 997 lines — same ≈2×
economy vs the oracle's ~79 KB product surface.

## Convergent spec verdicts (both lanes, independent)

Fold into v0.3 / the design RFC:

1. `text` needs `min`/`charset`/`nonBlank` and a URL form (elided from v1's
   own vocabulary — restore).
2. Composite pagination cursor `(time, id)` — both lanes named it; the
   oracle's `pageKey` strings are the workaround it replaces.
3. Optional range bound (a `cursor: time ?` should not force body
   duplication or query cloning).
4. Absence predicate spelling (`not ref` truthiness vs `match` — grok
   declared absence-is-false as a convention; pick one).
5. `#agg[key]` over an empty group: absent (grok, `?? 0`) or zero (codex)?
   Define it.
6. Rules reading maintained aggregates = reinvented `cap()`/cross-row
   constraints — restore v1's constraint vocabulary.
7. Bounded `deleteWhere`/`patchWhere` (grok: "range delete is
   inexpressible" — v1 has the K3 library forms).
8. THE structural one: the visibility-scan policy family (uniform-read
   logs, hidden-take, partitioned()) and the fan-out family
   (`maintain.rows`, broadcast projection, engine fan-out / jobs) are not
   optional polish — both lanes independently built designs that v1 policy
   would refuse or that silently cap delivery, because the one-pager lacks
   them. At app scale the policy families ARE the language.

## What held (both lanes)

- Zero unbounded reads across ~80 operations — every range read carried its
  bound (the grammar's mandatory-bound slot held at app scale).
- Zero page-count-as-population-fact — every UI number is a `#` maintained
  read, declared `readable` where disclosure crosses visibility.
- Zero clock misuse — `now` stored only; no deadline comparisons against
  intent time anywhere.
- Kind boundaries held — no password tables, no crypto, no byte handling;
  typing stayed ephemeral; the removed-member history question landed on
  the custody boundary, correctly, in both lanes.
- Evolution discipline held — `-- NEW`/`-- CHANGED` marking, no restarts,
  M1 surface stable under M2/M3 growth.
