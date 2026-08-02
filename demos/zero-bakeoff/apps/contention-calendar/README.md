# Contention Calendar (A3)

Paired provider-native implementations of LLP 0138's final-capacity booking
race. The business invariant is structural in each authority: a Snapback
compound unique index and a PostgreSQL unique constraint. Client predictions
are intentionally allowed to disagree until authority answers.

```sh
cd demos/zero-bakeoff/apps/contention-calendar
npm run generate:snapback
npm run accept:snapback
npm run accept:zero
npm run typecheck
```

The Zero runner uses the already-qualified shared PostgreSQL 17 server when
`ZERO_BAKEOFF_PG_URL` is set, creating and dropping a distinct database. It
owns its API server, Zero port, replica file, clients, and cleanup. A runtime
failure becomes a machine-readable GAP and non-zero exit.

Stable UI identifiers are `cc-calendar`, `cc-slot-<key>`, `cc-book-<key>`,
`cc-status`, `cc-error`, and `cc-alternative`.
