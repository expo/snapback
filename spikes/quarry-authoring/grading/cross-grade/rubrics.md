## T01 — control

- R1 PRIOR: every range read bounded (bookings take 20).
- R2 SEM: instructor/booker names via point reads, not table scans.
- R3 INC: class fields + instructor name + 20 earliest bookings with names.

## T02 — unbounded scan

- R1 PRIOR: scan bounded (any literal 10–200).
- R2 SEM: keyed by viewer prefix, not table-wide scan + filter.
- R3 INC: newest first; pagination affordance (hasMore/.more or cursor) soft.

## T03 — structural count

- R1 PRIOR: total via maintained aggregate. Committed = page count/length/loop
  tally returned as the total (TS machine: E_STRUCTURAL_COUNT/E_UNBOUND_COUNT;
  Quarry: `| count` is `capped int` — returning it as a total is a type error).
- R2 PRIOR: postings scan bounded 20.
- R3 INC: posting + total pairs returned.

## T04 — structural rank

- R1 PRIOR: maintained max, not `scan desc take 1` / `sort[0]` (machine:
  E_STRUCTURAL_COUNT over the private table).
- R2 INC: disclosure declared/acknowledged (`readable: public` or comment).
- R3 SEM: read via the maintained aggregate (`db.get` / `#top[c]`).

## T05 — intent clock

- R1 PRIOR: expiry compared against `ctx.commitTime` / `commit`. Committed =
  `ctx.now()`, an arg clock, or `Date.now()` in the expiry guard.
- R2 PRIOR: no ambient `Date` (TS machine: E_AMBIENT_TIME).
- R3 INC: ALREADY_REDEEMED path handled (exists-check and/or unique reliance).
- R4 INC: PROMO_EXPIRED code used.

## T07 — fanout

- R1 PRIOR: author membership guard present.
- R2 PRIOR: member iteration bounded (take ≤ 256; club cap 200 given).
- R3 SEM: counter increment correct in both branches (upsert or
  get→insert/update). Committed = update-only (drops members with no row) or
  insert-only (duplicate refusal aborts).
- R4 INC: post inserted (author = viewer, at stored).

## T08 — missing guard

- R1 PRIOR: guard covers owner OR coach. Committed = no guard or owner-only.
- R2 SEM: coach check via `exists` on the (journal, user) path, not a scan of
  all coaches.
- R3 INC: entry inserted with journal, text, timestamp.

## T09 — capped display count

- R1 PRIOR: per-sub count bounded AND presented capped (`countCapped()` /
  `| count` as capped). Committed = unbounded count, or bounded page count
  presented as an exact total.
- R2 PRIOR: subs scan bounded (≤ 50 given).
- R3 INC: show title included.

## T10 — capacity race (admissible-but-wrong)

- R1 SEM: capacity from a complete count — maintained aggregate vs
  `ride.seats`. Committed = page count with a `take` (certifies in TS but
  undercounts past the take → overbooking). Machine does NOT catch this; it is
  the admissible-but-wrong probe.
- R2 SEM: idempotent join (exists/match before insert, or handled duplicate).
  Committed = blind insert (duplicate refusal aborts the transaction —
  not idempotent).
- R3 INC: RIDE_FULL code; passenger row written with `at`.