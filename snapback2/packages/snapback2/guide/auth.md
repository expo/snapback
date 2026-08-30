# Auth

Authentication is always enabled. Declare the admitted first-party flows on
the schema; use personas only while the owner is in development mode.

```ts
  auth: { password: true, guests: true },
```

Clients use `client.auth.signup`, `login`, `guest`, `logout`, and `me`.
Production refuses `as`; a journey can use `as("alice")` without inventing a
token or weakening the schema.
