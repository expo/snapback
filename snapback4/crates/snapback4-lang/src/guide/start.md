# Start: install, choose a frontend, read one recipe

```sh
npm i snapback4
npx snapback4 init . --web --online --password   # Expo: replace --web with --expo
npx snapback4 guide workflow
```

Read workflow next: one copyable schema, roles/private fields, upload at creation,
price, live board/stages, stored-event deadlines, privileged approval and real-user
acceptance. After start + workflow, this shape needs no other card. Rename it to
your spec; then write/check and wire the screen. Do not tour language, staging,
production, --full, README, SERVER.md or CLIENT-AND-OPERATIONS.md to build it.

Init keeps existing snapback/*.q; writing the schema before init gives a generic
Home rather than a demo. After replacing a starter schema:
`npx snapback4 check && npx snapback4 init --adapt --apply`.
The first command emits types; the second adapts untouched starter files, keeping
your edits. `init --adapt` previews. All .q files share one namespace.

Frontend install runs in the background. Edit while it installs; join once with
`node scripts/install.mjs --wait` before building. Node 24.x is required.

## Starter map: edit regions, keep infrastructure

- snapback/*.q: EDIT schema, operations, rules and independent spec intent.
- src/App.tsx (Expo App.tsx): EDIT screen; keep auth/provider/witness wiring.
- src/client.ts: EDIT connection/auth only when needed; keep runtime wiring.
- scripts/staging.mjs: EDIT only seedUsers for your roles/custom provision args.
- scripts/frontend-proof.mjs: EDIT marked business assertions for your screen.
- scripts/probe-serve.mjs: EDIT readiness/business setup if needed.
- scripts/install.mjs, scripts/launch.mjs, scripts/probe-check.mjs: RUN; leave infrastructure.
- snapback/generated/api.ts: GENERATED; `guide api generated` lists args/hooks.
- package.json: EDIT business script commands; keep pinned toolchain/config.
- versions/v1 and v2: saved day-two evidence; keep until deliberately replaced.

Run npm run check, acceptance and frontend:proof; verify with `npm run probe:check`.
probe:serve stays up until SIGTERM. An intentional harness lifetime uses --hold.

## Signatures only when needed

`guide api react` covers hooks/results, `guide api client` covers observe/reads/
writes/uploads, `guide api auth` covers sign-in/session, `guide api proof` covers
hosts/accounts/clocks/browser helpers. These replace declaration searches;
`guide api generated` shows your operation index without reopening api.ts.
Do not read them all preemptively. `guide <card> --find <words>` answers a specific
question. `--repeat` forces a previous read; ordinary repeats show new blocks.
