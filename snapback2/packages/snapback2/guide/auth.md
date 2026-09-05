# Auth and mutation reads

Auth is always on. In `snapback/schema.q`:

```q
use identity
```

One flow: `use identity password` or `use identity guests`.
`client.auth`: `signup`, `login`, `guest`, `logout`, `me`.
Relaunch: supply `tokenStore`, await `client.ready`. Browser persistence:
`browserTokenStore(storage, backendSpecificKey)`. Personas refuse bearer
transitions/tokens; production refuses personas. Logout/expiry fence one session.

`snapshot.auth`/`useAuth()` share: `hydrating`, `authenticated`
(`viewer`, `kind`, `authEpoch`), `anonymous` (no `refusal`), or `refused`
(`refusal`). Bearers restore without hooks; callers share one `me()`.
`restoringViewer` while hydrating is confirmed for this exact token: display
only. Reads wait for confirmation or use offline coverage, never display identity
as fresh authority. Unbound stores show no restoring viewer.

Transport cuts retain custody and retry on connected/reconnecting transitions
and after 1, 2, 4, … 30 seconds without queries. `retryAt` is Unix milliseconds;
explicit `me()` replaces its timer. Other coded
refusals retry once per reconnect; storage/protocol failures stay refused.
Only `E_AUTH`, `E_AUTH_REQUIRED`, or `E_AUTH_SESSION` make restoration anonymous
and clear custody. `offline()` pauses timers; `online()` resumes the shared flight.
Offline restart stays paused. Logout, replacement and close
cancel retries and ignore late replies. Closed `auth` is only its last view, without `retryAt`.

Failed signup/login/guest preserves unchanged custody/auth or resumes hydrating
with backoff. Metadata/resume errors reject `ready` without revoking confirmed
auth. Session/`me` carry `kind` and `authEpoch`; same-principal login fences old replies
and revalidates coverage,
preserving queued writes. Built-in stores bind principal to token; custom stores
need `loadPrincipalBinding()` and `savePrincipal(principal, token)` for cold reads.
No login rate limit. Wrong passwords/unknown emails yield
`E_AUTH_INVALID`, which proves no account absence.

Use `principal` from `viewer`, not a profile reference. Keep login email private:

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

Lookups (mutations and `exists` too) obey `read`. Missing/unreadable rows return
absence; `! else CODE` rejects both. Admin writes cannot elevate reads. Absence
cannot prove a row missing; do not duplicate rosters.

`snapback2 init --template chat` admits conversation members:

```q
  read <- exists memberships[.conversationId, viewer]
```

`read <- .principal = viewer` hides other seats even from admins. Admit self
plus scoped admin membership for admin rosters. Write rules separately enforce
admin authority, immutable scope/principal, and promotion:

```q
mutation memberPromote(conversationId: conversations, membershipId: memberships):
  require exists memberships[conversationId, viewer, 'admin'] else ADMIN_REQUIRED
  membership = memberships[membershipId] ! else MEMBERSHIP_REQUIRED
  require membership.conversationId = conversationId else MEMBERSHIP_SCOPE_REQUIRED
  require membership.role = 'member' else MEMBER_REQUIRED
  update memberships[membership] { role: 'admin' }
  return null
```

`groupCreate` inserts conversation and creator-admin seat atomically;
`after insert` requires that seat, with `created` allowing the creator's bootstrap.
`memberAdd`, `memberRemove`, and `memberLeave` complete the pattern. Membership
ids fence remove/re-add races. No last-admin invariant.

## Diagnose absence

`snapback2 why <query> '<args-json>' --as alice --json` explains denied reads
via owner-only `rowVerdicts`/`diagnostics`. Missing rows get no denial hint;
ordinary responses expose none. Mutations refuse `E_OP_KIND`.
