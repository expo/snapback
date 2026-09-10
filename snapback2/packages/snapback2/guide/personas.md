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

The chat seed uses the fixture handles `alice_dev` and `bob_dev`, so `alice`
and `bob` are free for a real signup; this reserves no namespace, and `charlie`
keeps no profile. Real account signup is separate from profile creation:
choosing an occupied handle rejects the profile mutation even if signup
succeeded. Show that refusal and retry profile onboarding with another handle.
Editing a seed alone does not rewrite existing rows; `reset` reapplies it and
reports row and persona counts.
