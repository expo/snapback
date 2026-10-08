# Snapback 4: positional `t[x]` refused once a table gains a second unique key

Status: Closed (already fixed on main; not reproduced on current source)
Date: 2026-10-08
Scope: Snapback 4 compiler (`snapback4-lang` binder); app-farm round 1 cluster S-POSKEY

## Evidence

App-farm round 1 (`~/appfarm/synthesis/round-01.md` §2.1, cluster 5): 18 builds
(GPT 8, Muse 10), 31 diaries mention `E_QUARRY_AMBIGUOUS` /
`E_QUARRY_POSITIONAL_SCAN`. freezer-cubes-0928 lost ~4 min on
`delete reservations[reservation]` with `unique bin`, guessed
`.id = reservation.id` (E_QUARRY_UNKNOWN) before finding `[bin = bin]`;
parade-grid-0584 and calibration-case-0580 hit the same shape.

## Repro

```quarry
table bins:
  label: text <=40
  public 'bins'
  insert <- allow
  sync last 100 by .id
table reservations:
  bin: bins
  buyer: principal
  unique bin
  public 'availability'
  insert <- .buyer = viewer
  delete <- .buyer = viewer
  sync last 100 by .id
mutation release(reservation: reservations):
  delete reservations[reservation]
```

- 0.4.14 (the farm's package): `E_QUARRY_POSITIONAL_SCAN: reservations positional
  key has 2 declared unique keys of arity 1; choose a compatible unique index
  explicitly` — no rewrite. Reproduced with `reservation: reservations` and `: id`.
- main at cd2fa88d8b: `check: ok`. Commit 7eba286ddd (2026-10-06, "Resolve
  Snapback 4 positional keys by argument type") prefers identity for ids and
  same-table references. A genuinely ambiguous key (two `unique` text columns,
  `users[h]` with `h: text`) now says `choose a named form: users[handle = h] or
  users[email = h]` with `check --fix` applying it — the synthesis's suggested fix.

## Resolution

Fixed before this triage; ships with the next publication after 0.4.14. No
further work. Re-check in app-farm round 2.
