# Start: install, write the schema, check

Read this card once. It replaces the README, cheatsheet and introductory card
tour. Before the first schema write, do NOT open --help, guide --list, guide
tasks, --sections, language, or declaration files. The schema and syntax below
are sufficient for a first compiling workflow. Write it now; do not read language --full, security --full,
dist/contract.d.ts or all the other cards first. Open at most the two or three
sections named below when your feature needs them. `--repeat` shows a card again;
`--full` explicitly requests its entire reference.

## Install and choose a frontend

Install the backend package first, separately from the frontend toolchain:

```sh
npm i snapback4
npx snapback4 guide start
npx snapback4 init . --web --online --password   # Expo: replace --web with --expo
```

Init prints this recipe before starting the frontend install in the background.
Read/edit while it installs; `node scripts/install.mjs --status` reports progress,
and `node scripts/install.mjs --wait` waits once before a build. No need to poll
npm repeatedly. Existing snapback/*.q is kept; init then makes a generic Home.
For this workflow, write the schema below before init if you want that Home.
After replacing a starter schema, run `npx snapback4 init --adapt --apply`.

## A customer workflow with staff, private fields, evidence and approval

Save the entire block as snapback/schema.q, replacing the sample schema. All
snapback/*.q files share one namespace; remove sample tables you no longer use.

```quarry
use identity password

table roles:
  principal: principal
  role: enum('customer', 'staff')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'staff']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table requests:
  owner: principal
  title: text 1..120
  photo: image <=5000000
  openedAt: time
  dueAt: time
  status: enum('open', 'approved') default 'open'
  internalNote: text <=500 default '' read <- exists roles[viewer, role = 'staff']
  immutable owner, openedAt, dueAt
  read <- .owner = viewer or exists roles[viewer, role = 'staff']
  insert <- .owner = viewer and exists roles[viewer, role = 'customer']
  update <- exists roles[viewer, role = 'staff']
  online only

mutation provision(principal: principal, role: enum('customer', 'staff')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role } if absent

mutation openRequest(title: text 1..120, photo: image <=5000000):
  return insert requests { owner: viewer, title, photo, openedAt: now, dueAt: now + 30d }

mutation approve(request: requests, internalNote: text <=500):
  row = requests[request] ! else NOT_FOUND
  require now < row.dueAt else DEADLINE
  require row.status = 'open' else CLOSED
  update requests[request] { status: 'approved', internalNote }
  return null

query board(c: cursor ?):
  if exists roles[viewer, role = 'staff']:
    return requests last 50 by .id after c
  return requests where .owner = viewer last 50 by .id after c

-- Independent intent from the spec; extend these when requirements change.
invariant requests.read only .owner = viewer or exists roles[viewer, role = 'staff']
invariant requests.internalNote read only exists roles[viewer, role = 'staff']
```

```sh
npx snapback4 check   # compiles; emits snapback/generated/api.ts, never edit it
npx snapback4 test    # bounded security campaign; inspect any unproved coverage
npx snapback4 audit   # compare role/column coverage with the actual specification
```

A role is a roster row provisioned by an operator, never a signup parameter.
A rule's exists probe checks the keyed row independently of its read policy;
program lookups see only readable rows. Brackets pin a full unique key, then
optional filters. `read` never grants insert/update/delete. Each effect checks
its rule; a require cannot override it. Private columns are omitted when hidden.
Required evidence uses a required creating argument AND column. Guard deadlines
in every transition, before status; freeze or revalidate their stored anchors.
`now` is server milliseconds. Do not put a moving clock in a read rule.

Small syntax reference for adapting the block: `money USD` is integer cents on
the wire (1234 = USD 12.34); `int 0..` is nonnegative; `text 1..120` bounds length;
`T ?` is nullable. Add enum lifecycle states to status and a separate mutation
per transition; use `r = requests[id] ! else NOT_FOUND` before its requires.
`require now < r.dueAt else DEADLINE` checks at the action, independent of a sweep.
Derive fixed deadlines from server `now + 30d` or an immutable stored event,
never a caller's timestamp. Use 365d only for a fixed-duration year; actual UTC
calendar months/years: `guide time --section "Months and years"` AFTER first check.
A scheduled job may flag overdue rows, but its lateness cannot authorize a late
approval. Photo columns each need a separate upload of the same selected bytes.

## Route only when your feature needs it

- Roles, private fields, approvals: the complete schema above is the starting
  point. More column grants: `guide rules --section "Column read rules"`; independent security
  intent and unproved paths: `guide security --section Reference`.
- Uploads (including several photo columns): `guide uploads --section 'Copy the same image'`.
  The placing account uploads each column separately; an asset has one home.
- Deadlines and scheduled work: `guide time --section Values`, then
  `guide jobs --section Operations` only if you actually need a background job.
  Jobs may run late; transition guards enforce the deadline at the action.

Stop here until check compiles. Use `guide <card> --find <words>` for a specific
question. Repeated reads in this project print new paragraphs only. `--repeat`
forces the same selected content; `--full` forces the full card.

## Wire the screen, then verify once

Import `api` from ./snapback/generated/api.ts (adjust the relative path).
Its first screen indexes your operations and argument shapes. For exact shapes,
`guide api client`, `guide api auth`, `guide api proof`, `guide api generated`
replace declaration-file greps. No synced tables means createApp({url}) needs no
wasm device. Use AppProvider and hooks from snapback4/react: usePage(api.board,{})
provides items/loadMore/hasMore; useMutation(api.approve).run(args) yields a write.
Render refusals from failed writes; sentResult (snapback4/react) extracts a fresh
sent result. Headless createClient is from snapback4/client. observe returns
getSnapshot/subscribe/close, never a callback registration.

Starter map (file → purpose → custody):
- snapback/*.q → schema, rules, operations, intent → EDIT
- src/App.tsx or App.tsx → screen → EDIT
- src/client.ts → app/auth wiring → EDIT when needed
- scripts/staging.mjs → real users and operator provisioning → EDIT for your roles
- scripts/frontend-proof.mjs → browser assertions → EDIT for your business flow
- scripts/probe-serve.mjs → long-lived preview → EDIT if needed; do not wait on it
- scripts/probe-check.mjs → bounded preview/shutdown verification → RUN
- scripts/launch.mjs, scripts/install.mjs → ports and dependency progress → LEAVE
- snapback/generated/api.ts → checked types/handles → GENERATED; LEAVE
- versions/v1, versions/v2 → saved day-two evidence → keep until deliberately replaced

Scripts: backend = local dev; dev (web)/web (Expo) = screen; typecheck = TS;
frontend:proof = build + browser assertion; probe:check = bounded serve check;
probe:serve = stays up until SIGTERM; day2:proof = saved-release conservation.
Run `npm run probe:check` to verify; a foreground probe:serve is not a test.
For real-user provision, shared preview and production, open `guide production`
when you reach that step (`guide staging` for staging details); it owns the single complete serve recipe.
