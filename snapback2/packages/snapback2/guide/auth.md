# Auth and mutation reads

Auth is always on. In `snapback/schema.q`:

```q
use identity
```

`use identity password` or `use identity guests`.
`client.auth`: `signup`, `login`, `guest`, `logout`, `me`.
Restore: set `tokenStore`; await `client.ready`. Browser:
`browserTokenStore(storage, backendSpecificKey)`. Personas refuse bearer
transitions/tokens; production refuses personas. Logout/expiry fence one session.

`useAuth()`/`snapshot.auth`: `hydrating`, `authenticated` (`viewer`, `kind`,
`authEpoch`), `anonymous`, `refused` (`refusal`). Shared `me()` needs no hooks.
`restoringViewer`: token-bound, display-only; otherwise omitted.
Reads need confirmation or held coverage.
Chat once-photos: anonymous → null, else `viewer ?? restoringViewer`.
Null/unknown cannot open. Logout/account changes clear openings synchronously;
returning needs a click. Same-account confirmation keeps openings.

Transport cuts keep custody. Retry when connected/reconnecting, then at
1, 2, 4, … 30 s without queries; `retryAt` is Unix ms. `me()` replaces the timer.
Others retry per reconnect; storage/protocol failures stay refused.
Only `E_AUTH`, `E_AUTH_REQUIRED`, `E_AUTH_SESSION` clear custody to anonymous.
`offline()` pauses retries, including cold restart; `online()` resumes.
Logout/replacement/close cancel retries and ignore late replies.
Closed: last view without `retryAt`.

Confirmation recovers sync. Replay grants: `guide offline`.
Metadata errors set `lastRefusal`; initial errors reject
`ready`, but installed sessions succeed. `online()` retries sync. Held reads wait
for account transitions. Same-principal login revalidates coverage and keeps queued
writes. Built-in stores bind principal to token; custom stores
need `loadPrincipalBinding()` and `savePrincipal(principal, token)` for cold reads.
No login rate limit. Wrong passwords/unknown emails both yield `E_AUTH_INVALID`.

Signup authenticates before profiles exist; onboard missing profiles.
Show `rejected`; enter after profile creation commits.
Duplicate handles leave auth installed; retry profile creation with a new
handle, without repeating signup.

Use `viewer` as `principal`; keep login email private:

```q
table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  avatarUrl: text <=2048 format url ?
  bio: text <=200
  location: text <=50
  link: text <=2048 format url ?
  unique byPrincipal: principal
  unique byHandle: handle
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
```

## Writes do not grant reads

All lookups, including mutations/`exists`, obey `read`. Missing/unreadable rows
return absence; `! else CODE` rejects both. Admin writes cannot elevate reads.
Absence cannot prove a row missing; do not duplicate rosters.

The chat template admits members:

```q
  read <- exists memberships[.conversationId, viewer]
```

`read <- .principal = viewer` hides other seats from admins too. Admin rosters
need self plus scoped admin read access. Shared `isAdmin` keeps each caller's
refusal code. Import it with `fn isAdmin from access`:

```q
mutation memberPromote(conversationId: conversations, membershipId: memberships):
  require isAdmin(conversationId, viewer) else ADMIN_REQUIRED
  membership = memberships[membershipId] ! else MEMBERSHIP_REQUIRED
  require membership.conversationId = conversationId else MEMBERSHIP_SCOPE_REQUIRED
  require membership.role = 'member' else MEMBER_REQUIRED
  update memberships[membership] { role: 'admin' }
  return null
```

`groupCreate` atomically inserts conversation and creator-admin seat;
`after insert` requires it, with `created` allowing bootstrap.
`memberAdd`/`memberRemove`/`memberLeave` manage seats. Membership ids fence
remove/re-add races. No last-admin invariant.

## Diagnose absence

`snapback2 why <query> '<args-json>' --as alice` shows requirements and lookups.
`--json`: authoritative trace and owner-only `rowVerdicts`/`diagnostics`.
Ordinary responses expose no hidden-row hints. Mutations refuse `E_OP_KIND`.
