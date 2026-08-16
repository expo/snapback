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

## Resolution

Resolved 2026-08-15, verified against origin/main. `guide/auth/passwords.md`
landed via b92bcd412 with the `auth.passwords` capability row (honest
partial/local status). The previously missing public identifier-mode selector
now exists and is documented: `identifier: 'email'` on the password mechanism
in `defineAuth` selects email-v1 before activation, with
`SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE` refusing reinterpretation.
The minimum-length surface is app-declarable (`minimumLength`, 8–128, default
12) via 0d091e3af/fa34dbd8a. Witnesses are bound through the page's
frontmatter authorities (packages/snapback-client/password-auth.test.mjs,
demos/rbac snippet sources) and `examples: [demos/browser-auth]` rather than
inline prose links; that satisfies the runnable-witness intent.
