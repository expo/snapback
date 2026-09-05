# Auth and mutation reads

Auth is always on. In `snapback/schema.q`:

```q
use identity
```

Single flow: `use identity password` or `use identity guests`.
`client.auth` provides `signup`, `login`, `guest`, `logout`, and `me`.
Relaunch: pass `tokenStore`, await `client.ready`. Browser persistence is
explicit: `browserTokenStore(storage, backendSpecificKey)`.
Dev personas refuse tokens and bearer transitions; production refuses personas.
Logout/expiry fence that session's queries/channels, leaving other sessions intact.

`snapshot.auth` and all `useAuth()` hooks share `hydrating`, `authenticated`
(with `viewer`), `anonymous`, or `refused` (with `refusal`). Stored-token
restoration starts without hooks, with one `me()` in flight. `restoringViewer`
while hydrating is confirmed for that exact token: display only, never fresh
query authorization. Transport failures retain custody and retry on connection
transitions to connected/reconnecting and after 1, 2, 4, … 30 seconds without
queries. `retryAt` is the scheduled Unix time in milliseconds. Other coded
refusals retry once per reconnect; storage/protocol failures stay refused.
Only `E_AUTH`, `E_AUTH_REQUIRED`, or `E_AUTH_SESSION` make restoration anonymous
and clear custody. Logout, authority changes, and close cancel retries and
ignore late replies.

Logins are not rate limited. Wrong passwords and unknown emails both yield
`E_AUTH_INVALID`, which cannot establish account absence.
Session/`me` responses carry `authEpoch`: same-principal re-login fences old
replies and revalidates coverage, preserving queued writes. Built-in stores
bind principal to token. Custom stores need `loadPrincipalBinding()` and
`savePrincipal(principal, token)` for cold offline reads; unbound hints wait
for owner confirmation.

Use nominal `principal`, deriving the actor from `viewer`; a profile reference
is not a principal. Never copy protected login email into public profiles:

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

All lookups, including mutation lookups and `exists`, obey `read`.
Unreadable and missing rows both return absence; `! else CODE` rejects both.
Admin write permission cannot elevate a read. Absence cannot prove a row
missing; don't duplicate rosters to bypass policy.

The `snapback2 init --template chat` roster admits current conversation members:

```q
  read <- exists memberships[.conversationId, viewer]
```

`read <- .principal = viewer` hides other seats even from admins. For admin-only
rosters, admit self plus scoped admin membership, never public reads. Write
rules independently enforce admin authority, immutable scope/principal, and
promotion:

```q
mutation memberPromote(conversationId: conversations, membershipId: memberships):
  require exists memberships[conversationId, viewer, 'admin'] else ADMIN_REQUIRED
  membership = memberships[membershipId] ! else MEMBERSHIP_REQUIRED
  require membership.conversationId = conversationId else MEMBERSHIP_SCOPE_REQUIRED
  require membership.role = 'member' else MEMBER_REQUIRED
  update memberships[membership] { role: 'admin' }
  return null
```

`groupCreate` atomically inserts conversation and creator-admin seat; the
conversation's `after insert` requires that seat, with `created` allowing only
the creator's bootstrap. `memberAdd`, `memberRemove`, and `memberLeave` complete
the pattern. Intrinsic membership ids fence remove/re-add races. There is no
last-admin invariant.

## Diagnose an unexpected absence

`snapback2 why <query> '<args-json>' --as alice --json` explains denied reads
via owner-only `rowVerdicts`/`diagnostics`; missing rows get no denial hint.
Mutations refuse `E_OP_KIND`. Ordinary responses expose no hidden-row hint.
