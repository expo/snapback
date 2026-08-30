# Auth

Authentication is always enabled. Declare the admitted first-party flows on
the schema; use personas only while the owner is in development mode.

```ts
  auth: { password: true, guests: true },
```

Clients use `client.auth.signup`, `login`, `guest`, `logout`, and `me`.
Production refuses `as`; a journey can use `as("alice")` without inventing a
token or weakening the schema. For relaunches, pass `tokenStore` and await
`client.ready`. Snapback never selects browser persistence:
`browserTokenStore(storage, backendSpecificKey)` is explicit and XSS-sensitive.
The dev-only `as` cannot be combined with `token` or `tokenStore`; they are
exclusive authority sources, and persona clients cannot run bearer-session
transitions.

Keep the authority subject separate from the product profile row. The profile
has its own row id; its immutable, unique `principal` column is what aligns it
with `ctx.viewer`:

```ts
export const profiles = table({
  columns: {
    principal: t.principal(),
    displayName: t.text(50),
    handle: t.text(20),
    avatarUrl: t.optional(t.text(2048)),
    bio: t.text(200),
    location: t.text(50),
    link: t.optional(t.text(2048)),
  },
  indexes: {
    byPrincipal: { columns: ["principal"], unique: true },
    byHandle: { columns: ["handle"], unique: true },
  },
  rules: {
    read: rule.public("profiles are public"),
    insert: rule.viewerIs("principal"),
    update: rule.viewerIs("principal"),
    delete: rule.deny(),
  },
  constraints: [
    { unique: "byPrincipal" },
    { unique: "byHandle" },
    { immutable: ["principal"] },
    { text: { field: "displayName", min: 1 } },
    { text: { field: "handle", min: 3, format: "handle" } },
    { text: { field: "avatarUrl", format: "url" } },
    { text: { field: "link", format: "url" } },
  ],
});
```

Use a profile ref when an operation targets product profile data. Use
`Principal` for creator, membership, author, and other authority axes, and
derive the acting value from `ctx.viewer`. Keep login email in Snapback's
protected identity store; do not copy it into a public profile row.

Every successful login, signup, guest flow, or `persona create` call returns a
fresh finite session. Logout and expiry fence that exact session, including its
live queries and channels, without signing out a second session for the same
Principal. Snapback stores only a domain-separated digest of the bearer token.

Model follows as ordinary rows with nominal `follower` and `followed`
Principals. A Following query may consult that row; a Global post rule must
not. Removing a follow then changes product selection without revoking a
globally readable post. Add a closed role only when a scoped relationship
really grants different authority.

For a group, make the scope row and creator-admin seat atomic with the
conversation's `finalExistsOnInsert` constraint. Membership insertion then has
two lanes: current admin, or the creator's own admin seat when `rule.created`
proves that conversation was inserted earlier in this transaction. It never
admits a matching older conversation. Bind promotion to the old scope and the
one allowed transition:

```ts
    update: rule.and(
      rule.exists(memberships, "byConversationPrincipalRole", [
        rule.oldField("conversationId"),
        rule.viewer,
        rule.literal("admin"),
      ]),
      rule.eq(rule.oldField("conversationId"), rule.nextField("conversationId")),
      rule.eq(rule.oldField("principal"), rule.nextField("principal")),
      rule.eq(rule.oldField("role"), rule.literal("member")),
      rule.eq(rule.nextField("role"), rule.literal("admin")),
    ),
```

The template's `groups.groupCreate`, `memberAdd`, `memberPromote`,
`memberRemove`, and `memberLeave` are canonical. Creation admits 2–50 people;
self-reseating is refused; admins add/promote/remove; anyone leaves. There is no
last-admin invariant: the remaining group may become adminless. Operations
name intrinsic membership row ids, so remove/re-add cannot retarget an old
operation.
