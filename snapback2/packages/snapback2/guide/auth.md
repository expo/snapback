# Auth

Authentication is always enabled. Declare the admitted first-party flows on
the schema; use personas only while the owner is in development mode.

```ts
  auth: { password: true, guests: true },
```

Clients use `client.auth.signup`, `login`, `guest`, `logout`, and `me`.
Production refuses `as`; a journey can use `as("alice")` without inventing a
token or weakening the schema.

Keep the authority subject separate from the product profile row. The profile
has its own row id; its immutable, unique `principal` column is what aligns it
with `ctx.viewer`:

```ts
export const profiles = table({
  columns: { principal: t.principal(), handle: t.text(32), name: t.text(80), email: t.text(200) },
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
  constraints: [{ unique: "byPrincipal" }, { immutable: ["principal"] }],
});
```

Use a profile ref when an operation targets product profile data. Use
`Principal` for creator, membership, author, and other authority axes, and
derive the acting value from `ctx.viewer`.
