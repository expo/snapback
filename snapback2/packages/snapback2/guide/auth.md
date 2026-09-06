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

`snapshot.auth`/`useAuth()`: `hydrating`, `authenticated`
(`viewer`, `kind`, `authEpoch`), `anonymous` (no `refusal`), `refused`
(`refusal`). Restoration needs no hooks; callers share `me()`.
Hydrating `restoringViewer` is confirmed for this token but display-only. Reads
await confirmation or use held coverage. Unbound stores omit it.

Transport cuts retain custody; retry on connected/reconnecting and after
1, 2, 4, … 30 seconds without queries. `retryAt` is Unix milliseconds;
explicit `me()` replaces its timer. Other codes
retry once per reconnect; storage/protocol failures stay refused.
Only `E_AUTH`, `E_AUTH_REQUIRED`, or `E_AUTH_SESSION` make restoration anonymous
and clear custody. `offline()` pauses timers; `online()` resumes the shared flight.
Offline restart stays paused. Logout/replacement/close cancel retries and ignore late replies.
Closed `auth` is only its last view, without `retryAt`.

Failed sessions retain custody or resume restoration. Confirmation recovers sync.
Metadata errors set `lastRefusal`; initial errors reject
`ready`, but installed sessions succeed. `online()` retries sync. Held reads wait
for account transitions. Same-principal login revalidates coverage and keeps queued
writes. Built-in stores bind principal to token; custom stores
need `loadPrincipalBinding()` and `savePrincipal(principal, token)` for cold reads.
No login rate limit. Wrong passwords/unknown emails both yield `E_AUTH_INVALID`.

Signup authenticates before profile creation; missing profiles need onboarding.
Show `rejected` results; enter after profile creation commits.
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
need self plus scoped admin read access. Write rules enforce admin authority,
immutable scope/principal, and promotion:

```q
mutation memberPromote(conversationId: conversations, membershipId: memberships):
  require exists memberships[conversationId, viewer, 'admin'] else ADMIN_REQUIRED
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

`snapback2 why <query> '<args-json>' --as alice --json` explains denied reads
via owner-only `rowVerdicts`/`diagnostics`. Missing rows get no denial hint;
ordinary responses expose none. Mutations refuse `E_OP_KIND`.
