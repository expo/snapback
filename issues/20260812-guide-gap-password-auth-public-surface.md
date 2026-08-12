# guide-gap: first-class password auth has no intent-indexed public recipe

**Opened:** 2026-08-12 · **Severity:** P2 · **Systems:** Guide, auth, client,
CLI, catalog v4

## Problem

The acceptance work for first-class email+password auth had to discover the
public client and CLI shapes from package declarations and source. There is no
`guide/auth/passwords.md` page and no `auth.passwords` capability row in
`guide/capabilities.md`, even though the surface now includes signup, signin,
change/set/reset, recovery consume/rotate, stdin-only CLI carriers, catalog-v4
identifier modes, and lockout behavior.

The missing guide surface also makes an important current contradiction hard
to see: fresh sessions activation selects `username-v1`, while the binding
email+password charter requires `email-v1`, and no public authoring/startup
selector was found.

## Acceptance

- Add an intent-indexed password-auth page covering the exact public package
  and CLI methods, password carriers, coordinator adoption, recovery custody,
  change consequences, non-oracular failures, and admin observability.
- Add the governed capability row with honest status/evidence.
- State how an app selects the immutable catalog-v4 identifier mode, or name
  the public activation gap until that selector exists.
- Link the runnable witnesses under `demos/rbac/tests/acceptance/` and the real
  browser custody witness.

## Evidence

Diary 0076 records the acceptance exercise. The definition-of-done witness
currently fails with `SNAPBACK_ACCEPTANCE_EMAIL_IDENTIFIER_MODE_REQUIRED`.
