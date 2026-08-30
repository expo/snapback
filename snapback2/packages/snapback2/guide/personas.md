# Personas

Seed a small, named cast for development and tests:

```ts
  personas: ["alice", "bob"],
```

Use `snapback2 run <op> '{}' --as alice`, `snapback2 why <query> --as alice`,
or `createClient({ url, as: "alice" })`. Persona ids are stable (`dev:alice`)
and remain distinct across clients. A `serve` owner refuses persona headers.
