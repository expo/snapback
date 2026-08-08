# Guide gap: browser auth custody never shows the IndexedDB adapter vs the volatile memory adapter

**Status:** Closed 2026-08-08
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, Auth, JS client, Contract, IndexedDB
**Date:** 2026-08-06
**Governing:** LLP 0059, LLP 0061

## Problem

The sessions/headless guide pages said browser sessions use durable
`AuthCoordinator` custody, but did not show the shipped
`createIndexedDbAuthCustodyStorage()` adapter or distinguish it from volatile
memory custody. The Zerobugs control found the consequence: a document-lifetime
memory record appeared healthy until a full navigation reconstructed the page
as anonymous.

## Resolution — 2026-08-08

The registered [`demos/browser-auth`](../../demos/browser-auth) carrier now
constructs `AuthCoordinator` with `createIndexedDbAuthCustodyStorage()` in its
actual browser module. Its real-Chrome acceptance signs in, records the settled
session custody fact, performs a full page reload, and requires the same
principal and protected app row while both the one-use bootstrap count and
`POST /auth/exchange` count remain unchanged. It then logs out, requires a
settled anonymous IndexedDB record with no bearer, and proves a signed-out
reload stays anonymous.

The exact executed construction is transcluded into:

- `guide/auth/sessions-and-principals.md`; and
- `guide/recipes/browser-auth.md`.

Both pages now state the distinguishing rule explicitly: memory custody is for
tests/document-lifetime flows and can survive an SPA route transition, but only
the IndexedDB adapter plus a real full-page reload witnesses durable browser
session custody. The capability index has a separate
`auth.browser-session-custody` row, and retrieval-eval case 27 routes the
original intent to the recipe.

The closure is local-only and bearer-v1 honest. It does not claim XSS-resistant
sender constraint, production challenge delivery, or hosted auth.
