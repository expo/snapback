# Personas

Seed a small, named cast for development and tests:

```ts
  personas: ["alice", "bob", "charlie"],
```

Use `snapback2 run <op> '{}' --as alice`, `snapback2 why <query> --as alice`,
or `createClient({ url, persona: "alice" })`. Persona ids are stable (`dev:alice`)
and remain distinct across clients. The loopback-only `--as`/header shortcut
does not mint a stored session. First use creates the persona; `snapback2
persona list` lists the cast. A `serve` owner refuses persona headers.

React and Expo use `<SnapbackProvider url={url} persona="alice">`. Choose
either a persona or bearer/token-store custody for each client.
