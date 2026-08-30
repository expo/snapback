# Personas

Seed a small, named cast for development and tests:

```ts
  personas: ["alice", "bob", "charlie"],
```

Use `snapback2 run <op> '{}' --as alice`, `snapback2 why <query> --as alice`,
or `createClient({ url, as: "alice" })`. Persona ids are stable (`dev:alice`)
and remain distinct across clients. The loopback-only `--as`/header shortcut
does not mint a stored session. `snapback2 persona create alice` instead
issues a fresh, finite ordinary session for the same principal each time, so
logout and expiry use the production session path. A `serve` owner refuses
persona headers.
