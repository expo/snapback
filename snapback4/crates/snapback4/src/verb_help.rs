//! `snapback4 <verb> --help`: one verb's flags, output and exit codes. The
//! all synopses and flag lists come from cli_flags; pages add recipes and output details.

const INIT: &str = "Starts a project in dir (default: here) without overwriting anything: an
existing package.json has the starter's dependencies and scripts merged in
(a caret range of the starter's own version is pinned to it; scripts compare
as commands, so option order does not matter), and an existing file or a
conflicting value refuses before any file is written.

  (no flag)        snapback/schema.q: the local-first todo schema, and .gitignore
  --online         plus an online client, package.json and README
  --web            a Vite + React todos app (vite.config.mts, src/App.tsx)
  --web --online   Vite + React without a device: server reads and journaled
                   writes; the new schema has no sync (your schema is kept)
  --expo           an Expo todos app
  --template chat  with --web or --expo: the full reference chat app
  --port N         the backend port: the client's URL, the README's
                   `snapback4 dev --port N`, and with --web the page on N+1
                   (dev and preview), so one flag moves all of them
                   (default 4400; the page 5173)
  --port-range A-B  set interactive defaults; PORT_LO/PORT_HI override at run time
  --web-port N     the Vite page's port instead of N+1 (--web only)
  --skip-existing  keep every existing file and write only the missing ones

A project's own snapback/*.q is never overwritten and never a conflict, nor is
snapback/generated/ (check's output), and the todo starter's fixtures are
written only beside the starter's own schema; beside a schema without the
todo operations, the screen behind the sign-in is a neutral Home.
Beside a schema that declares `use personas` and no `use identity`, the
screen picks a persona instead of signing in as a guest.

Init first, schema second: once you replace the starter's schema, `check`
names the starter files that no longer fit it, and --adapt fits them:

  --adapt          preview only; writes nothing. Ends with the exact --apply command.\n                   Plan to remove the todo starter's fixtures and cases when the
                   schema has no todos table and its operations (fixtures/
                   itself stays); rewrite the starter screen and client for
                   the schema's sign-in (guest, password, or a persona picker
                   for `use personas` without `use identity`), keeping the
                   backend port, and replace the Todos screen with a Home
                   screen that compiles against any schema. Only files whose
                   bytes still match what init wrote are touched. The plan
                   lists every rewrite/removal; only --apply changes files.
  --dry-run        with --adapt: preview only, changing no files
  --apply          with --adapt: apply the plan, keeping edited files intact

Next: npm install (when a package.json was written), snapback4 check, then
snapback4 dev. Exit 0 when written, 1 on a conflict, 2 on bad flags.
snapback4 guide start walks the first schema.";

const CHECK: &str = "Compiles snapback/*.q, checks that the dev store's rows adopt it (read-only,
.snapback4/store.sqlite or --store), writes snapback/generated/api.ts and
builds native jobs.

Output:
  check: ok — …          it compiled and adopts: dev, test and deploy accept it
  check: N problems      each with its site, code, rewrite and guide card; exit 1
  notes                  advisory, never blocking, listed after the ok line and
                         ranked: \"review\" notes can cost correctness or
                         completeness (a page that never completes, a write no
                         caller can pass); \"performance\" notes cost speed or
                         offline coverage; \"by design\" notes describe what a
                         declaration implies and need no action for online use.
                         Repeats of one code are shortened; one site's repeats
                         are counted (×N).

  --verbose    every note in full, with its card excerpt, rewrites and execution facts
  --json       one JSON object (ok, notes, problems, plans) on stdout
  --cost       each operation's read and write plan and the scale summary
  --residency  what a device holds; with --fixture and --as, measured on that data
  --fix        apply mechanical source repairs (for example // comments to --)
  --store p    judge adoption against another store file
  --release N  with --store, preview immutable release N (or latest) without activation

snapback4 why <CODE> explains any problem or note; snapback4 why <op> one
operation's cost. Exit 0 ok (notes or not), 1 problems, 2 cannot run.";

const DEV: &str = "Serves snapback/*.q on http://127.0.0.1:4400 and re-adopts the schema on every
save (a save with problems keeps the previous generation serving).

Readiness and ownership:
  stdout's first line is the URL, printed once the server accepts requests;
  everything else goes to stderr, so read stdout alone for it. A script that
  reads both streams through one handler matches the tagged stderr line
  SNAPBACK4_READY verb=dev generation=N url=http://… pid=N [wrapperPid=N]
  instead. The stderr banner names the server's pid, and GET /dev/status (no
  credential) answers {pid, wrapperPid, project, temporary, generation,
  personas, …}: a script that spawned dev can check the pid is the one it
  started. Through the npm wrapper (node_modules/.bin/snapback4, npx), pid is
  the binary's and wrapperPid the wrapper's; a signal to either stops the
  server, and so does a SIGKILL to the wrapper (the binary exits when the
  wrapper that launched it is gone). A taken port refuses the start at once (E_ADDRINUSE, naming
  the holder); --port 0 picks a free port; --port A-B binds the first free
  port of that inclusive range (E_ADDRINUSE only when every one is taken),
  for a host that assigns each builder a range. Read the URL from stdout.

Store:
  (default)        .snapback4/store.sqlite, kept across runs; one host at a
                   time (a second dev, or a CLI writer, refuses E_STORE_BUSY
                   naming the owner's address and pid)
  --fresh          a new private temporary store that dies with this process;
  --memory         the same flag. run, data, sql and test still read the
                   on-disk store; reach a fresh dev over HTTP or run --port N

Identity: x-snapback-persona: alice acts as dev:alice for a persona declared
in `use personas`; an undeclared name is refused E_AUTH. POST /seed writes
rows as the system (guide wire); POST /dev/reset (snapback4 reset) empties the
store between tests and can reseed it in the same transaction (guide testing).
Development only: deploy + serve refuse all three.

Scripted lifecycle (an acceptance script): spawn the installed binary
(node_modules/.bin/snapback4, or node_modules/snapback4-<platform>/snapback4)
with dev --port 0 --memory, read the URL from stdout's first line, run the
requests, then send SIGTERM and wait for the exit; dev exits 128+15 after
flushing its refusal log, and the port is closed. Through npx the wrapper also
stops the server when its parent dies. snapback4 guide testing has the script.

  --no-watch          never re-adopt; restart to serve edits
  --replay            suppress new effects and hold schedules
  --hold-effects      keep effects queued, unclaimed
  --hold-schedules    admit no scheduled runs
  --clock-offset +25h start the dev clock ahead; --resume-clock continues the store's time
  --trace-empty       record unknown empty reads in snapback4 why recent
  --verbose           print each refusal's full record (phase, generation, store, instance, request)
  long-wait flags     see snapback4 --help

Stop with Ctrl-C or SIGTERM. Refusals print as one short `dev refusal: <op> <CODE> at <site> (<clause>)`
line per cause; snapback4 why recent lists the full records.";

const RUN: &str = "--release uses served source, the server clock and the existing FIFO. Set SNAPBACK4_SERVICE_TOKEN (or --token-env NAME) to a full service token; every full service seat may trigger system jobs. It needs a running serve and no local app directory.

Runs one query, mutation or job and prints its answer and meters.

Where it runs:
  beside a dev that owns .snapback4/store.sqlite, the call is forwarded over
  that dev's HTTP as the persona (its clock, its store);
  otherwise it runs in this process on .snapback4/store.sqlite, and says so on
  stderr;
  --port N forwards to the dev on 127.0.0.1:N, whichever store it serves: use
  it for a dev --fresh/--memory, whose temporary store no local run can open.

  --as alice      a persona declared in `use personas` (default alice), acting
                  as dev:alice; or a principal id such as user:… for a local run
                  (a bare undeclared name is that id, not dev:<name>: run warns,
                  and dev refuses it as a persona, 401)
  --now <t>       pin the clock for a local run (milliseconds, or +2h from now)
  --json          one JSON object on stdout

A job runs whole as the system (--as is ignored). Exit 0 sent/complete, 1
refused (the refusing clause and its site are printed), 2 cannot run.";

const TEST: &str = "Runs fixture cases in order, then sweeps every query as each persona and prints
its meters. The sweep uses that persona's case arguments when available, otherwise
derives arguments from the resulting store (including the cases' writes).
Cases default to sent for mutations and check's verdict for queries: complete,
or either complete/capped when check notes N_NEVER_COMPLETE. With a fixture it
first loads the rows into a private in-memory store and afterwards runs
dir/test.cases.jsonl, your own operations with expectations (a query's default
expectation is its check verdict; a failing refusal names the layer that refused).

  --fixture dir   dir/<table>.jsonl, one JSON row per line, loaded as one batch
                  (parents first) exactly as POST /seed writes rows: defaults,
                  sequences, unique (your codes) and caps, maintained views.
                  Defaults to ./fixtures when present; otherwise reads the dev
                  store .snapback4/store.sqlite (E_STORE_BUSY while a dev owns it).
  --as alice      one persona (default: every persona in `use personas`); an
                  undeclared one is refused, as dev refuses it (--residency
                  measures any principal)
  --residency     what each persona's device would acquire; --verbose also runs the queries

Columns (one row per query and persona; the ceilings row is each read's limit):
  examined   rows the read looked at, from scans and lookups (not rows returned)
  entries    index entries walked to find them
  probes     rule lookups: read rules and exists checks
  steps      interpreter steps
  heap B     peak working memory, bytes
  output B   bytes of the encoded answer

States:
  complete                      the answer is the whole answer
  capped                        the answer is partial (complete: false): the
                                read reached a ceiling, or the page can never
                                prove completeness on the server (N_NEVER_COMPLETE);
                                not a refusal
  refused CODE as expected (test.cases.jsonl:N)   that persona's own case
                                expects CODE for this query: not a failure
  refused CODE on derived arguments   the query's own require refused the
                                arguments test derived from the data (shortest text/list
                                values, not representative boundary values; a row of
                                each referenced table, preferring one whose
                                answer is not empty for the persona; the
                                persona); not a failure: give it real
                                arguments in test.cases.jsonl
  (from test.cases.jsonl:N)     the query ran on that persona's own case's
                                arguments instead of derived ones
  refused CODE by its own require   an argument-free query's require refused
                                the persona; not a failure: pin the refusal
                                as an expect case in test.cases.jsonl
  denied CODE                   a refusal: a failure
  not run                       an argument test cannot derive

The last line counts each state and the cases and ends in pass, incomplete (some probes not run), or FAIL. Exit 1 when a query is denied,
a case fails or the fixture does not load (a bad row, an unknown table file);
0 otherwise. snapback4 guide testing: fixture rows, test.cases.jsonl and an
acceptance script over HTTP.";

/// The help for `snapback4 <verb> --help`; `None` prints the full help.
pub fn page(verb: &str) -> Option<String> {
    let page = match verb {
        "init" => INIT,
        "new" => "Choose a full reference template. For a small starter or schema-only setup, use snapback4 init. The Flags section lists the shared scaffold validator; each template checks its own combinations.",
        "version" => "Print the binary version.",
        "upgrade" => "Upgrade core and every installed snapback4-expo adapter together with npm, bun or pnpm, keeping exact pins. Default: latest; --to selects an explicit target and permits a downgrade. Rebuild native apps after adapter changes; guide deploy has the upgrade checklist. Executing upgrade requires the matching installed client helper; help itself is built into this binary.",
        "check" => CHECK,
        "dev" => DEV,
        "run" => RUN,
        "test" => TEST,
        "deploy" => "Packages immutable source and activates it on the durable store. A running serve adopts the release before this command completes. --check previews exact deploy adoption without activating; --restore-dormant explicitly restores retired names. --allow-destructive never prunes; use prune <dir> --allow-destructive. Exit 1 on refusal.",
        "rollback" => "Without --to, selects the previously active release from committed activation history. --to selects a successful immutable release, including roll-forward with latest. --check previews exact adoption without activating. Removed storage and incompatible rows become dormant per row and restore on compatible forward. --allow-destructive never prunes. Exit 1 on refusal.",
        "serve" => "Attaches the active release; a running serve adopts deploy and rollback atomically without restart. Bearer sessions only. The first stdout line is its URL. Non-loopback cleartext requires --i-understand-cleartext. Exit 1 on refusal.",
        "data" => "Inspect stored rows as an administrator, bypassing read rules. --json prints one array, including [] for an empty table. Default output is one JSON row per line.",
        "sql" => "Read-only administrative inspection, never rule-filtered. --json-objects returns {columns, header, limit, more, rows, ruleFiltered}; rows are objects and boolean columns retain boolean values. Use sql '\\dt' to list tables, or sql '\\d messages' for one schema.",
        "reset" => "Empty a running development store through POST /dev/reset. --seed reseeds in the same transaction; --clock reset returns to wall time. Production releases refuse this door.",
        "clock" => "Advance a running development backend's clock, sweep expiry and run due jobs. --port targets a specific dev. Production releases refuse clock control.",
        "token" => "Mint a bearer session for a service seat. Default: token and newline on stdout, usage on stderr. --quiet suppresses successful stderr; --json prints {token, principal, expiresAt, store} with no successful stderr. --quiet and --json are mutually exclusive. A token belongs only to its owning store.",
        "witness" => "Browser executable: set SNAPBACK4_CHROMIUM (or CHROME) to Chromium. Build the static export first and register the app with registerWebWitness(app, api) from snapback4/witness-web. web exercises a visible form; acquire proves native acquisition and retained restart; ios exercises an installed application; status inspects background proof.",
        "" => return None,
        verb if crate::cli_flags::VERBS.contains(&verb) => "See the flags below and snapback4 guide for recipes.",
        _ => return None,
    };
    let prose = if page.starts_with("snapback4 ") { page.split_once("\n\n").map(|(_, prose)| prose).unwrap_or("") } else { page };
    Some(format!("{}\n\n{prose}\n\n{}\n\nsnapback4 --help lists every verb.", crate::cli_flags::synopsis(verb), crate::cli_flags::help(verb)))
}
