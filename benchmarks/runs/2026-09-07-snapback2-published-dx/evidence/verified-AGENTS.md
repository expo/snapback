<!-- snapback2:start -->
## Snapback 2

- `snapback2 check` compiles, certifies, and refreshes `.snapback/build/api.d.ts`.
- `snapback2 dev` starts or attaches to the one local owner and prints `SNAPBACK_URL`.
- `snapback2 test` proves derived checks and authored journeys with a receipt.
- `snapback2 why <query> --as <persona>` explains rows, rules, and bounds.
- `snapback2 trace latest` follows commit → invalidation → delivery.
- Backends are `snapback/*.q`; `snapback2 guide quarry` is the language reference.
- Effect modules, `seed.ts`, and `tests/*.test.ts` are TypeScript.

Gotchas: authentication is always on; use `--as <persona>` only in development.
Every scan names `take`; empty, capped, denied, and stale are distinct states.
Generated files stay under `.snapback/` and are never committed.
<!-- snapback2:end -->
