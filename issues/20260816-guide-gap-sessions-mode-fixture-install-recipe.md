# guide-gap: sessions-mode fixture install recipe (accounts + profiles + typed assets)

**Opened:** 2026-08-16
**Source:** Coterie Snapback M1 backend lane (Diary 0086, LLP 0266 D9)

## Gap

There is no documented paved composition for deterministically and
idempotently installing password-backed fixture accounts, application
profile rows, and typed avatar media in a sessions-mode app:

- The versioned-seed page correctly documents that principal IDs cannot be
  seeded.
- `guide/backend/assets.md` does not teach a seed-fixture path for assets
  (`seed-assets.json` / an ensure-style fixture helper is not on the page).
- The closest existing demo (Party Wall) uses a dev-mode sibling for its
  operator fixture lane, which is unavailable in sessions mode.

## What the lane built instead (candidate recipe)

An ordinary-session installer (`demos/coterie/snapback/seed-m1.mjs`):
signup on first install; server-authorized profile creation; ordinary asset
upload + typed attach; on `SNAPBACK_AUTH_PASSWORD_EXISTS`, password sign-in
plus an owner-scoped profile check and fixture-source-digest verification
before reporting `matched`. A matched repeat performs no sign-in-side
upload or application write.

## Ask

Absorb this as a guide recipe page (sessions-mode fixture install:
accounts + profiles + typed media as one composition) or an explicit GAP
row in `guide/capabilities.md` per LLP 0061 §5.
