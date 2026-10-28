READING REPLAY SCOPE OVERRIDE: Work only in /tmp/dx16-replay/after-022. This is the day-two reading/discovery phase of the following exact harness task, with the copied day-one app and installed package. The milestone for this session is DAY2-PLAN.md with exact commands, source-shape choices and compact pseudocode for the release/frozen-client/production proof. Stop there: do not change backend/UI sources, deploy, provision users, run full proof scripts, install frontends or build the app. Inspect original app sources only as needed to choose the change route. Begin with the installed CLI's handover, npx snapback4 init --adapt --day2 (preview only), then follow its recommended documentation path. Use docs on demand to resolve the v1 save, change, preview, v2, rollback, forward, frozen v1 client, reruns and persistent production roster. You may run check and CLI help. Do not inspect other lanes, repository checkouts, transcripts or model session logs. Do not ask questions. State unresolved limits in the plan. This scope override replaces implementation/delivery instructions below; the original brief supplies the same change, constraints and APIs as the harness.

# Day two: take over "Custom Corset Fittings"

You are a senior product engineer taking over an app another engineer built
last week. Work fully autonomously; there is no human to ask.
Work only in the current directory (`/tmp/dx16-replay/after-022`). It holds a copy of that app: its
backend, frontend and scripts, plus the previous builder's notes renamed to
`PREVIOUS-DIARY.md`, `PREVIOUS-REPORT.md` and `PREVIOUS-friction.jsonl`
(read them; they are the hand-over). Do not read other builders' apps on this
machine (anything under `~/sb4-loop/` or `~/sb5-lanes/` outside your own
directory) and do not read any backend's source repository (anything under
`~/projects/`). You are a user of the published packages.

## The app

**Custom Corset Fittings.** A corsetry studio makes custom corsets for brides, and the assistant opens each fitting with a photo of the client's body measurement sheet and the fitting price. Cutters see each fitting's measurements, boning and seam notes, but not the client's phone number, deposit or the price on the same fitting, which only the assistant and the studio owner see. Clients see only their own fittings, the workroom board updates live as corsets move from measured to mock-up and boned, and a client may return for a free adjustment within 30 days of pickup. Only the studio owner can approve keeping a cancelled fitting's deposit, with the reason recorded.

## The version 2 change request

> Rename 'fitting price' to 'fitting charge' everywhere it appears, making the wording consistent when the studio discusses a fitting with a client. Every existing fitting keeps exactly its current amount under the new name, including any zero charge; nothing is recalculated or combined with the deposit. The assistant continues to enter the charge when opening a fitting. Once the fitting has been opened, only the studio owner may change that charge; the assistant and cutters cannot. Keep all other fitting details and arrangements unchanged.

This is the product change you ship today. Existing production data must
survive it: every record that exists before v2 must still exist after it, in
the shape the change request describes.

## The stack

- Backend: **Snapback 4** (the `snapback4` npm package).
- Where it runs: development is local, as a server you start on your ports.
  Production is a release directory, `./deploy` in this directory, served by
  the production server on your ports. Run `deploy`/`serve` only with paths
  inside this directory.
- Learn it from its own documentation, which ships with the package.
- Frontend: **React web (Vite + React + TypeScript)**, as the previous builder set it up. Use the backend's own React client bindings.

## Compatibility mode

The backend section defines the mode. When it supplies release rollback,
run the rollback/forward work below. When it asks for **v1 clients after the
change**, keep the changed backend live: every instruction below to roll
back becomes a check of the frozen v1 client against that backend, and every
forward is an idempotent migration to the changed backend. `prod:rollback`
is then optional; `prod:forward` and `prod:serve` remain required. Report
`v1ClientAfterChange` and whether your migration preserves v1 rows in
`day2-proof.json`; rollback fields are null in this mode. The harness freezes
and tests the inherited client before you start, then replays it after your
change. Save migration files, list their relative paths in `day2-proof.json` as
`migrationFiles` (including an app file if it holds an inline migration), and
describe their row-preservation assertions.
Do not reset the inherited database. This mode measures calls, returned row
shape and migration preservation; it makes no claim about release rollback.

## Your job: day two

1. **Upgrade.** Upgrade the backend package to exactly `snapback4@0.4.43`, with `--save-exact` (if the app is already on that version, confirm it and move on). Then get `npm run check`, `npm run acceptance` and
   `npm run frontend:proof` green again (if they were red before, make them
   green). Fix what the upgrade breaks; record each break in friction.jsonl.
2. **Production, version 1.** Deploy the current backend as a production release into `./deploy` with `npx snapback4 deploy`, run it with `npx snapback4 serve` (not the development server) on your ports, and point a production build of the frontend at it. Production uses the backend's real
   sign-in for every user: no development-only identity switch, persona,
   seeding or admin shortcut. Create at least two real users of every role
   through the real sign-up/sign-in path, and write business data through the
   app's own operations as those users.
3. **Version 2.** Implement the change request above in the backend and the
   frontend: the new or reshaped data, the migration of existing records, and
   the new or tightened access rule, enforced by the backend. Deploy v2 to the
   same production, over the data from step 2, and prove that every
   pre-existing record survived with the right migrated values, that the new
   feature works for the existing accounts, and that the new rule holds
   between two users.
4. **Roll back to v1, then forward to v2.** Roll production back to the v1 release with `npx snapback4 rollback`, then move it forward to v2 again. Data must be preserved
   through both moves, including what v2 wrote; records v1 cannot hold are
   part of the work on either backend, so decide how your rollback copes with
   them. Find out whether **v1 clients** keep working: the v1 frontend's calls
   (the v1 client code against the live backend) after v2 is deployed, and
   again after the rollback. Keep them working where the backend allows it;
   where it does not, record exactly what breaks. This is part of what we are
   comparing, so do not hide it.
5. **Automate it: `npm run day2:proof`**, steps 2–4 end to end against
   production, and the three **production stage scripts** the harness drives
   itself: `prod:serve`, `prod:rollback`, `prod:forward` (details below).
6. **`npm run probe:serve` now serves v2 from production** (details below).

Keep the v1 backend code you start from in a saved copy inside this directory
(for example `v1/`), because the rollback and `day2:proof` need it.

The harness may provide `.harness-env.json` (mode 0600) for server-side
configuration. Load it without printing it; never expose privileged values
to the frontend or include it in the frozen client. Public client configuration
needed for sign-in belongs in `apiNotes` or in the test user objects
(for example a public API key), so `client:calls` needs only its two inputs.
Record your chosen stack and libraries in `backend-choice.json` (no credentials).
For SQLite, include `databaseFiles`: the relative paths of the persistent app
databases, leaving out throwaway proof databases, so the harness can audit rows.
Provide `npm run harness:snapshot` for the harness's data audit: a self-contained,
read-only script that prints one JSON object `{"tables":{"<table>":[<row>, ...]}}`
containing every persistent app record (with stable IDs), without auth/session
bookkeeping or credentials. It may use private server configuration, never a
public admin endpoint. Start and stop anything it needs on your assigned ports.
The harness prefers its own store reader where available and otherwise uses
this script, keeps rows in memory only, and records hashes and field names.
This is an audit adapter; the five proof contracts below are unchanged.
Password sign-in or another app-owned sign-in must work without external OAuth
approval, email delivery or a human during proofs. Seed test accounts privately;
public seeding or role-setting shortcuts must not relax normal access rules.

## Ground rules for processes and ports

Use only TCP ports 21220–21229 for anything you start (backend servers,
Vite, Metro/Expo, test servers); they are also in `$PORT_LO` / `$PORT_HI` (the
same range the previous builder had), so read them in scripts instead of
hard-coding them. A Chromium is at `$CHROME`: the previous builder's scripts
may point at a browser or paths that are gone now, so make inherited scripts
read these variables. Keep the child handle and PID of every server you launch
and stop it yourself (in a `finally` block in scripts). Never discover another
process by its name, directory or port and kill it — other builders share this
machine: no `pkill`/`killall` by name or pattern, no `kill $(pgrep …)`,
`fuser -k` or `lsof … | xargs kill`; stop only the PIDs you recorded. On this
machine `ps`, `pgrep`, `pkill`, `killall`, `pidof`, `kill`, `fuser` and `lsof`
show and signal only your own processes. Leave no servers running when you
finish. Keep logs inside your
directory; for scratch files use `$TMPDIR` (a short directory reserved for
you), not other paths under `/tmp`; scratch scripts that import your project's
packages go in `./.scratch/` so Node can resolve them.

Never create, delete or edit anything outside this directory and `$TMPDIR`: not
the parent directory, not other builders' directories. If something outside
blocks you, record it in friction.jsonl and work around it inside your own
directory.

Environment notes (this sandbox, not the backend): do not rely on
`python`/`python3` (some sandboxes lack it), so script with `node`, and write
long generated text (reports, components) to a file rather than through a
nested template literal; `/bin/sh` is dash (no `PIPESTATUS`, process
substitution `<(…)` or `/dev/tcp`: use `bash -c` for those, or `node`'s `net`
module for port probes); use `tail -n 40`, not `tail -40`, with several files;
there is no TTY, so a command that would stop to ask for confirmation must be
given its own non-interactive flag; your shell tool may refuse `rm -f` and
trailing-`&` backgrounding: delete
scratch files with `node -e "require('fs').rmSync(…)"` and start long-lived
servers with `setsid -f` from a script that records the PID; npm is configured
to use a local package mirror of the public registry, and the first
`npm install` can sit silent for several minutes while it fills: wait for it,
and never switch to another registry; Chromium needs `--no-sandbox` (without
it, it hangs silently; Playwright: `executablePath: process.env.CHROME`) —
never download browsers; about 60 builders share this host, so a port can be
taken by someone else between your checks: bind first and confirm the server
answering is yours before driving it; each tool call starts in this directory
(`cd` does not persist between calls); this directory is not a git repository;
`rg` exits 1 when nothing matches.

## The proof (what "done" means)

All of these are `npm` scripts in this directory's `package.json`. The harness
runs each one itself after you finish, exactly as written, with no arguments
(put any arguments inside the npm script). If one of the first four, or
`probe:serve`, fails when the harness runs it, you get its output back once to
fix it (`probe:serve` is checked as the harness will use it: its JSON line, at
least two users for every role, still up 30 seconds later, then stopped).

**Time.** Production proofs use the real clock on every arm, and the harness runs the production scripts at
times of its choosing: right after you stop and again up to several hours
later, at any time of day. They must pass whenever they are run and must never
wait for a real-clock window; development acceptance still exercises time
rules without waiting, as before. The harness records when each run started.

1. **`npm run check`** — typechecks the whole project and runs the backend's
   own schema/function validation, and exits 0.
2. **`npm run acceptance`** — as before, against a live **development**
   backend, with at least two users of each role through the real sign-in
   path: every backend operation and every authorization and privacy rule,
   **now including v2's** new feature and new rule. Time-based rules are
   exercised without waiting in real time. It must pass twice in a row.
3. **`npm run frontend:proof`** — Build the app with Vite, serve it on your ports, and drive it with Playwright. A real browser (`$CHROME`)
   drives the real UI against a live backend: sign in, make at least one
   write that uses the v2 feature, see it appear. The harness deletes `dist`
   (and any other build output) before each run and runs it twice in a row, so
   it must build what it serves, be self-contained and pass both times.
4. **`npm run day2:proof`** — your own script, against **production**:
   - it starts from whatever production holds when it is run (the first time,
     what you left there; every later time, v2 with all earlier data, including
     data other people wrote through the app) and never deletes, resets or
     recreates production data or the production deployment;
   - it puts v1 live, signs in real users (creating them if they do not exist
     yet) and writes v1 data through the app's operations;
   - it deploys v2 and asserts that every record that existed before the
     deploy (not only the ones this run wrote) survived with the right
     migrated values, that the v2 feature works and that the v2 rule holds;
   - it runs the v1 client against v2 and records the result;
   - it rolls back to v1, asserts the data (including what v2 wrote) is
     preserved, and runs the v1 client again;
   - it moves forward to v2 again and asserts the data once more;
   - it stops everything it started, leaves **v2 live** in production, and
     exits 0 only if every assertion held. How v1 clients fared is recorded,
     not asserted: write what really happened.
   - It must be **re-runnable**: the harness runs it twice in a row. Use fresh
     unique names for what each run writes. Production keeps growing (every
     run, the v1-client replays and the reviewer all add records), so whatever
     it checks, it checks over all of production's records, not a first page.
   - It writes `day2-proof.json` in this directory, overwriting any old one:
     ```json
     {"ok": true,
      "recordsBeforeV2": 0, "recordsCheckedAfterV2": 0,
      "dataPreservedAfterV2": true, "migratedValuesCorrect": true,
      "v2FeatureWorks": true, "v2RuleEnforced": true,
      "rollback": "ok|failed", "dataPreservedAfterRollback": true,
      "rollforward": "ok|failed", "dataPreservedAfterRollforward": true,
      "v1ClientAfterV2": "works|degraded|broken", "v1ClientAfterRollback": "works|degraded|broken",
      "migrationFiles": ["<relative migration file>"],
      "v1ClientAfterChange": "works|degraded|broken|null", "migrationPreservesV1Rows": true,
      "v1ClientNotes": "<what the v1 client tried and what happened>",
      "notes": "<anything a reader needs to interpret the above>"}
     ```
     The counts are records of the kinds the change request touches;
     `degraded` means some v1 calls work and some fail.
5. **The production stage scripts.** After its `day2:proof` runs, the harness
   drives production itself, in this order, with v2 live at the start:
   `prod:rollback`, `prod:forward`, `prod:rollback`, `prod:forward`. Before
   and after every move it reads **all** production data itself through the
   backend's own data tools and checks that no record is lost, and with v1 live
   and with v2 live it replays the v1 client (below) against production.
   - **`npm run prod:rollback`** puts the saved v1 backend live in production
     over whatever production holds (including records v2 wrote), without
     deleting, resetting or recreating data or the deployment, and exits 0
     when v1 is live. **`npm run prod:forward`** does the same for v2. Both
     must work repeatedly and from either state, stop everything they start,
     and leave no server running.
   - **`npm run prod:serve`** serves production **as it stands** (whatever
     release is live; it must not deploy or change anything) on your ports for
     the v1 client to call, and prints **one line** of JSON
     `{"backendUrl": "...", "users": {"<role>": [<user>, <user>], ...}}`
     (every other log line to stderr or a file): the URL the v1 client's
     `BACKEND_URL` should be, and at least two real production users of every
     role, each with their sign-in details (`"email"`, `"password"` or what the
     sign-in form takes), created through the real sign-up path if they do not
     exist yet. It stays up until it is killed (SIGTERM to its process group).
   - **The v1 client** is the previous builder's `client:calls` script: the
     harness kept its own copy of the day-one app and replays that copy,
     unmodified, with `BACKEND_URL` and `CALLS_USERS` (the `users` above), once
     with v1 live, once after the v2 deploy and once after the rollback, and
     scores which of its calls still work. The harness's own measurements, not
     `day2-proof.json`, are what we compare.
   - **The v2 client.** Your own `npm run client:calls` in this directory
     started as the same code; make it v2's: it signs in the users it is given
     (`BACKEND_URL`, `CALLS_USERS` as above) and makes the calls v2's UI makes,
     including the v2 feature, printing the same one line per call and carrying
     on after a failed call. With v2 live, the harness runs it against
     production (twice, after the first `prod:forward`), and after the second
     `prod:rollback` it replays the v1 client once more and checks which of
     the records written while v2 was live the v1 client gets back.

   For an expected guard refusal, print `"ok": false`, `"expected": "<CODE>"`
   and an `"error"` beginning with that refusal code. The harness counts it as ok
   only when the refusal code matches `expected`; an unexpected success or a
   different code fails. Exit 0 when every call succeeds or matches its expected
   refusal. For older clients, an error beginning with a refusal code followed
   immediately by `expected` (optionally after `:` or `(`) also counts as ok;
   the summary lists these compatibility matches.

6. **`npm run probe:serve`** — as before, but against **production v2**: it
   makes sure v2 is live (without resetting data), starts the frontend built
   for production on your ports, signs in at least two real users of every
   role (creating them if needed), prints **one line** of JSON
   `{"backendUrl": "...", "frontendUrl": "...", "sessions": {"<role>": [<credential for user 1>, <credential for user 2>], ...}, "apiNotes": "..."}`
   (every other log line to stderr or a file), and stays up until it is
   killed. Credentials are what an ordinary signed-in client presents, plus
   each user's sign-in details (`"email"`, `"password"` or what the sign-in
   form takes) so the reviewer can sign in again if a session expires; never
   print admin, deploy or service keys. After
   you finish, an independent reviewer gets only this output, the spec plus
   the change request, and a read-only copy of your source, and tries to break
   the access rules — including the v2 rule — against production.

## The diary (required — this is the main output we care about)

We are comparing backends for what happens after day one: upgrades,
production, migrations and rollbacks. Your honest experience report matters
more than polish. Keep these files current **as you go** (you may be stopped
at any time; anything not written down is lost). They are new files for this
run; leave the `PREVIOUS-*` files as they are.

- `DIARY.md` — a running narrative, each entry stamped with the output of
  `date -u +%FT%TZ` (this machine's local clock is not UTC): what you tried,
  what felt good or easy, what felt bad or hard, where the backend was
  ergonomic or surprising on day two (taking over someone's code, upgrading,
  production deploys, real auth in production, migrating live data, rolling
  back, old clients), what you had to work around, and where its docs and
  diagnostics helped or misled you. Compare against familiar alternatives
  where relevant. Note frontend-framework (React web (Vite + React + TypeScript)) observations in their
  own section.
- `friction.jsonl` — one JSON object per line, appended **every time** you hit
  friction. Fields:
  `{"t": <unix seconds>, "area": "schema-data|functions-api|auth|authorization-rules|realtime|uploads|scheduling-time|cli|dev-server|hosting-deploy|migration|rollback|upgrade|codegen-types|client|frontend|docs|diagnostics|install|testing|other", "kind": "backend-defect|docs-gap|confusing-diagnostic|missing-feature|ergonomics|agent-error|environment", "severity": 1-3, "minutes_lost": <int>, "summary": "<one line>", "detail": "<what happened, exact error text if any, what you expected>", "workaround": "<what you did>", "suggested_fix": "<what the backend should change>"}`
- `REPORT.md` — written at the end: what you changed for v2 and how existing
  data was migrated, which proof steps pass (with the exact commands), what
  happened to v1 clients after the v2 deploy and after the rollback, the top 5
  friction points ranked, what you'd tell the backend or library maintainers to fix
  first, a section **"Compared with day one"** that compares today's
  experience with the previous builder's (from `PREVIOUS-DIARY.md` and
  `PREVIOUS-REPORT.md`), and an overall rating of today's experience on its
  own line, exactly `Rating: N/10`.
- None of these files may hold a secret: never paste a key you generated (a
  JWT signing or other private key, a deploy, admin or API key) or a password
  into DIARY.md, friction.jsonl or REPORT.md. Say what you generated and where
  it lives instead.

Time: aim to be green within about 90 minutes of work. You will be stopped at
3 hours wall clock regardless. When the proofs and stage scripts work and
REPORT.md is written, stop; do not polish after green.


Reminder: stop at the reading/discovery plan, no implementation or end-to-end score.
