# Diary 0076: password-auth acceptance

**Date:** 2026-08-12
**Systems:** Snapback auth, packaged client, CLI, catalog v4, physical backup,
logical transfer, browser custody, acceptance testing

## What I built

I added skeptic-facing acceptance witnesses for first-class password signup,
signin, change, recovery, lockout, client custody, CLI secret carriage,
catalog-v4 transfer, and browser reload. The witnesses reuse the RBAC demo's
protected live query, `server-process.mjs`, the browser-auth Vite gateway, the
controlled Chrome launcher, and real `AuthCoordinator` storage adapters. They
do not mint sessions, inspect the credential database, or substitute a hashing
gateway.

## What felt good

- The packaged `authPassword*` methods compose cleanly with ordinary protected
  queries and mutations. The public return value omits the bearer while the
  coordinator durably owns it.
- Password change behavior is easy to state from the outside: the acting
  custody gets a new bearer, another session for that user expires, a different
  user's session survives, the old password refuses, and the new password
  succeeds.
- Recovery custody has a crisp public contract. Signup returned eight codes,
  ordinary signin did not redisclose them, consume minted a normal session and
  a disjoint replacement set, and reuse refused.
- Running existing and missing identifiers in parallel made non-oracular timing
  concrete. Their debug-build Argon2 medians were comparable and their static
  response headers and bodies were identical. The standard HTTP `Date` value
  naturally varies by completion second, so the witness compares its presence
  while byte-comparing every stable header.

## What felt bad or surprising

- A fresh public sessions activation reports catalog-v4 `username-v1`; the
  charter requires email-v1, and neither schema authoring nor server startup
  exposes a public selector. The definition-of-done witness therefore fails at
  its first precondition instead of pretending an email-shaped username proves
  email canonicalization.
- A real signin/change race exposed a security contradiction: a signin using
  the predecessor password succeeded and its newly minted session remained
  authenticated after the concurrent change. The two-phase stale-predecessor
  fence is not holding end to end.
- The shipped password CLI did not offer the auth-client protocol header. Its
  first real signup was refused with
  `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`, before stdin secrecy could be
  accepted as an end-to-end CLI proof.
- Physical `snapback auth backup` failed deterministically after a graceful
  server stop with `SQLite online backup did not complete`. Logical
  `snapback auth export` independently panicked on the async-worker blocking
  guard, so neither transfer half can currently be certified by the CLI.
- Storage has a password-attempt admin projection type, but the server routes
  only the AdminWrite unlock. The public uniformity and unlock halves pass;
  lock existence, count/threshold, and expiry cannot be observed through the
  commissioned authenticated read projection.
- Chrome 151 was installed and the frozen browser dependencies installed from
  cache, but both the new password witness and the existing browser-auth
  witness saw Chrome abort with `SIGABRT` before CDP startup. I left this as an
  environment gap rather than replacing real-browser evidence with jsdom.

## Comparison

Compared with React plus Supabase Auth or Clerk, the successful Snapback client
path is pleasantly unified: one coordinator owns issuance, refresh, logout,
and protected data authority. Compared with Convex plus an external auth
provider, there is less application-side credential plumbing. The current
cost is that several operational projections are not yet connected end to end:
the identifier-mode choice, CLI protocol negotiation, transfer CLI safety, and
admin lock inspection all sit between a strong storage core and a product
surface a skeptical app can actually exercise.

## Boundary

Passing component rows are not a first-class email+password launch claim. The
email-v1 activation precondition, stale-predecessor race, CLI signup, physical
backup, logical export, authenticated lock-state projection, and real-browser
run remain explicit blockers.

## 2026-08-12 repair pass

The product repairs turned several vague end-to-end failures into precise
cross-layer lessons:

- The signin transaction's exact credential-generation fence was already
  correct. The broken interleaving was earlier: password change snapshotted the
  user's sessions before its KDF while signin could mint a new predecessor-
  password session outside that snapshot. Sharing the canonical-identifier
  admission stripe and replanning after admission made the two legal outcomes
  explicit: signin commits first and the fresh change plan revokes it, or the
  change commits first and signin sees only the successor password.
- Password CLI verbs shared a good stdin carrier but missed the protocol offer
  required by their own public routes. Adding the auth-client protocol header
  at the common HTTP helper repaired all six public password/recovery verbs;
  the seventh, admin unlock, correctly remains on the AdminWrite protocol.
- `defineAuth` was already the right authoring seam. Allowing
  `identifier: 'email'` there and carrying `email-v1` into the generated schema
  kept the choice declarative and made catalog immutability a deployment check,
  not a runtime surprise.
- macOS SQLite cannot pager-write the `/dev/fd/N` alias of a retained writable
  descriptor once a real multi-page backup starts. A private in-memory online
  backup followed by serialization through that descriptor preserved inode
  pinning without relying on a pathname alias. Declared restore also needed to
  distinguish real elapsed time from the artificial clock jump forced by a
  restored future session deadline; otherwise that jump silently aged the
  physically preserved password-attempt window out.
- Logical transfer had two independent seams hidden behind its async-worker
  panic: the CLI needed the sanctioned blocking lane, and an ordinarily
  activated empty target legitimately contained matching scope-base schema
  facts. Exact subset matching admits that fresh state without turning import
  into a merge.
- The lockout ledger already had a correctly bounded storage projection, but
  no route. A body-carried AdminRead projection now reports the active profile
  thresholds and optional ledger record without putting the identifier in an
  URL or leaking any of those facts through the public password response.

The client acceptance also exposed two projection papercuts adjacent to the
four server defects: a server-authoritative snapshot did not advance freshness
unless a retention adapter was present, and the public authority view omitted
the derived `isAuthenticated` convenience bit even though the durable custody
record was correct. Fixing those at their projection boundaries was markedly
cleaner than teaching the demo about internal custody shapes.
