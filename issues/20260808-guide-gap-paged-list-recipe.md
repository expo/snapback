# guide-gap: no pagination-UI recipe despite it being a recurring demo journey

**Opened:** 2026-08-08 · **Severity:** P3 (documentation)

Keyset pagination exists only as a backend fragment
(guide/backend/queries.md:202-210) and a generated pattern
(`backend.standard-patterns`, capabilities.md:34). Nothing teaches the
client journey — a load-more/paged list over live queries whose delivery is
whole-result replacement, cursor threading through `useSnapbackQuery`, and
the interaction with retained stores — which feed-shaped demos (warble,
messaging-snapback, chirp) each solved by hand.

LLP 0196 T4's queued recipe order (real-auth sign-in, offline
supervisor-origin, verify-config) does not include it, so it is not owned
anywhere today.

Ask: a `recipes/paged-list.md` (or a section on clients/react.md) with a
CI-verified demo source; propose it for the LLP 0196 T4 queue since recipes
graduate into template code there.

Found by the 2026-08-08 comprehensive docs review (recipes slice).

## Status (2026-08-08 docs-review execution)

Not addressed — a CI-verified recipe needs a demo source to transclude,
which is real demo work, and LLP 0196 T4's queue (real-auth sign-in,
offline supervisor-origin, verify-config) still does not include
pagination. This remains the strongest unowned recipe candidate; propose
it for the T4 queue when the current queue drains.
