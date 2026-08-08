<!-- @ref LLP 0198#ii3-phases —
     the day-2 evolution brief: prices the greenfield caveat (edit-loop
     and migration cost) that every standing run zeroes by building
     from empty. -->

# Brief: messaging — day-2 evolution (scripted change requests)

**Status:** authored 2026-08-08 under LLP 0198 P3; no run yet; not
calibrated. Requires frozen starting artifacts (below) before its first
run can be scheduled.

## Why this brief exists

Every run in the standing corpus builds from empty, so the corpus
zeroes the dimension where Snapback's known open frictions live: the
doc-comment/artifact-identity rollover (LLP 0186 W4's remaining item),
deployment pinning versus the edit loop (diary 0059's "a
documentation-only @ref comment changed the generated function bundle
identity"), and diary 0057's pre-production ask ("a story for evolving
a sessions app without dropping its database"). Convex's edit-loop
story is plausibly its second advantage after model familiarity. This
brief is the symmetric counterpart to the trust-boundary brief: that
one prices Snapback's hidden strength, this one prices its hidden
weakness — the portfolio is honest in both directions or it is not
honest (LLP 0198 §I.6, §II.3 P3).

## Starting artifacts (paired configuration inputs)

- Each lane starts from a **frozen post-messaging-run artifact** for
  its platform: a completed messaging-brief app that **passed the same
  messaging acceptance bar** (acceptance-equivalent starts — never one
  lane's polished app against another's rough one).
- The artifact's content hash is part of the configuration cell
  (LLP 0197 rule 1); re-freezing a new artifact is a **new
  configuration**, so repeats measure evolution cost on a fixed start,
  not the luck of one prior implementation.
- The building agent is **cold-context**: it did not author the
  artifact and has no memory of it. Seeded data is live (non-empty
  tables with the standard seed) so migrations act on real rows.

## The three scripted change requests (measured serially, one window)

1. **Field + live-data migration.** Add `editedAt` (nullable timestamp)
   to messages; existing rows must remain readable and the running app
   must keep working across the change — prove history renders before
   and after, and that a message edited post-change carries `editedAt`.
   The database is not dropped; a lane that must drop it records that
   fact as the outcome of this change request (it is a result, not a
   DNF).
2. **Cross-cutting feature.** Add "pinned messages": schema (a pin
   marker or table), a mutation with authority (only conversation
   members pin), and client UI listing pins per conversation — live
   across two clients.
3. **Pure refactor.** Rename an internal function/module touched by the
   message-send path and add a doc comment to a backend function,
   changing no behavior; prove the app still passes its acceptance
   checks and record every restart/reload/rollover step the platform
   forced along the way.

Per change request, the record captures wall/tokens/loops separately
(the `tokens.phases` and loop sub-attribution splits of LLP 0198
P0.0 apply), plus a count of forced environment resets (database drops,
store rollovers, full restarts).

## Lane-prompt block

```text
you are handed an existing, working WhatsApp-shaped messaging app built
on this backend (it passed its acceptance checks; seeded conversations
and messages are live). Apply three changes IN ORDER, keeping the app
working and the existing data intact throughout: (1) add a nullable
editedAt timestamp to messages, migrating live data — prove existing
history still renders and an edited message carries editedAt; do not
drop the database (if the platform forces a drop, record it and
continue); (2) add pinned messages: only conversation members may pin,
pins are listed per conversation, live across two clients; (3) a pure
refactor: rename an internal function on the message-send path and add
a doc comment to a backend function, then prove behavior is unchanged
by re-running the acceptance checks. Record every restart, reload,
migration step, or reset the platform forces on you.
```

## Notes for lane fairness

- The three changes are fixed verbatim; no lane may substitute an
  easier variant. A change that cannot be completed records a DNF for
  that change under LLP 0197 rule 4b's identical budgets and stopping
  rules.
- Forced resets are outcomes, not failures — the point of the brief is
  to count them honestly on both sides.
- Aid labeling per LLP 0197 rule 4a applies unchanged.
