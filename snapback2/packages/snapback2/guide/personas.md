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

For an explicit development-only preview, React and Expo may use
`<SnapbackProvider url={url} persona="alice">`. The shipped app flow uses
real account sessions (`guide auth`). Choose
either a persona or bearer/token-store custody for each client.

The chat seed occupies profile handles `alice` and `bob`. Real account signup
is separate from profile creation: choosing an occupied handle rejects the
profile mutation even if signup succeeded. Show that refusal and retry profile
onboarding with another handle. For a clean app, namespace seed handles (for
example `demo-alice`) before first `dev`, or reset disposable development data
after editing the seed. Editing a seed alone does not rewrite existing rows.
