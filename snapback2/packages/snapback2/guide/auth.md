# Auth and mutation reads

Authentication is always enabled. In `snapback/schema.q`:

```q
use identity
```

This enables password and guest flows; select just one with `use identity
password` or `use identity guests`. Clients use `client.auth.signup`, `login`,
`guest`, `logout`, and `me`. For relaunches, pass `tokenStore` and await
`client.ready`; browser persistence is explicit through
`browserTokenStore(storage, backendSpecificKey)`. Dev personas (`--as alice`)
cannot be combined with tokens or bearer-session transitions. Production
refuses personas. Logout and expiry fence that session, including live queries
and channels, without signing out other sessions for the same principal.

Keep authority separate from product profiles. Use nominal `principal` for
creator, membership, and author fields, and derive the acting value from
`viewer`. A profile reference is for product data; it is not a principal.
Never copy login email from the protected identity store into a public row.
For example, the chat template's `snapback/schema.q` contains:

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

## A write permission does not grant a read

Every program lookup obeys the caller's table `read` rule, including lookups
inside mutations. An unreadable point lookup returns absence just like a
missing row; `! else CODE` rejects both with the same code. Program `exists`
also checks readable rows. An admin update/delete rule does not elevate these
reads. Do not treat absence as proof that no row exists, or add a duplicate
roster to work around a read policy.

For group administration, start with `snapback2 init --template chat`. Its
membership roster is readable to current members of that same conversation:

```q
  read <- exists memberships[.conversationId, viewer]
```

An owner-only rule (`read <- .principal = viewer`) would hide another person's
seat from an admin. Choose the roster's read audience intentionally; if only
admins should see other seats, admit self reads plus the current scoped admin
membership. Never make private roster rows public merely to unblock a write.
Table write rules independently enforce admin authority, immutable scope and
principal, and the member-to-admin transition. The template's promotion is:

```q
mutation memberPromote(conversationId: conversations, membershipId: memberships):
  require exists memberships[conversationId, viewer, 'admin'] else ADMIN_REQUIRED
  membership = memberships[membershipId] ! else MEMBERSHIP_REQUIRED
  require membership.conversationId = conversationId else MEMBERSHIP_SCOPE_REQUIRED
  require membership.role = 'member' else MEMBER_REQUIRED
  update memberships[membership] { role: 'admin' }
  return null
```

`groupCreate` atomically inserts the conversation and creator-admin seat. The
conversation's `after insert` constraint requires that seat; `created` admits
only the creator's bootstrap in that transaction. `memberAdd`, `memberRemove`,
and `memberLeave` complete the pattern. Intrinsic membership ids prevent a
remove/re-add from retargeting an old request. There is no last-admin invariant.

## Diagnose an unexpected absence

Use a query containing the same lookup, then run
`snapback2 why <query> '<args-json>' --as alice --json`. `why` refuses mutations
with `E_OP_KIND` before execution. Its local, owner-protected
`rowVerdicts` and `diagnostics` explain denied read sites and point here.
Compare the intended viewer's result with a member/admin persona. A genuinely
missing row has no denied-row diagnostic. These details are development
inspection; ordinary query/mutation responses do not gain a hidden-row hint.
