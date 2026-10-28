# Start: install, choose a frontend, read one recipe


```sh
npm i snapback4
npx snapback4 guide workflow
```

Read workflow next, then stop reading and write snapback/schema.q. It includes
roles/private fields, upload/price, live stages, stored deadlines, approval and
acceptance. Rename the schema to your spec and run `npx snapback4 check` before
opening another card, API digest or starter file. No introductory card tour.

Only after that first backend check, initialize the frontend:

```sh
npx snapback4 init . --web --online --password   # Expo: replace --web with --expo
node scripts/install.mjs --wait                # join once before building
```

Init keeps your schema and emits a generic Home plus a matching account plan.
Build your screen and replace the marked proof assertions. Starting from a demo
instead means adapting it after the schema changes: `init --adapt --apply`
(preview: `init --adapt`). Do not repeatedly initialize or inspect infrastructure.
All .q files share one namespace. Node 24.x is required.
If a tool host reaps the background installer, run `node scripts/install.mjs`
in the foreground rather than repeatedly polling a missing worker.

## Syntax and time essentials

Types: `text 1..120`, `text <=500`, `int 0..`, `bool`, `time`, `money USD`,
`T ?` (nullable). Write `int 0..`, not literal brackets or `int >= 0`.
Money is integer cents; time is Unix milliseconds; durations: `30d`, `1h`.
An ordered comparison needs present operands: bind `t = row.deliveredAt ! else
NOT_DELIVERED` before `t + 30d` or `t < now`. Optional Booleans: `flag ?? false`.
Supply every required insert field without a default.

A job's where/by cursor columns must be immutable. Sweep by id when the deadline
can change; test mutable flags/deadlines inside the loop. Staging clocks keep
ticking: test before/after with a margin. Exact boundaries use fixtures or pinned
local calls, rather than assuming advance() freezes the server clock.

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
