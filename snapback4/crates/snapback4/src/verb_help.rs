//! `snapback4 <verb> --help`: one verb's flags, output and exit codes. The
//! verbs agents script against have a page; any other verb prints its lines
//! from the full help.

const INIT: &str = "snapback4 init [dir] [--online|--expo|--web] [--template chat] [--port N] [--web-port N] [--skip-existing]

Starts a project in dir (default: here) without overwriting anything: an
existing package.json has the starter's dependencies and scripts merged in
(a caret range of the starter's own version is pinned to it; scripts compare
as commands, so option order does not matter), and an existing file or a
conflicting value refuses before any file is written.

  (no flag)        snapback/schema.q: the local-first todo schema, and .gitignore
  --online         plus an online client, package.json and README
  --web            a Vite + React todos app (vite.config.mts, src/App.tsx)
  --expo           an Expo todos app
  --template chat  with --web or --expo: the full reference chat app
  --port N         the backend port the client calls (default 4400)
  --web-port N     the Vite page's port for dev and preview (--web only;
                   default 5173, or the port after --port)
  --skip-existing  keep every existing file and write only the missing ones

A project's own snapback/*.q is never overwritten, and the todo starter's
fixtures are written only beside the starter's own schema. Beside a schema
that declares `use personas` and no `use identity`, the screen picks a
persona instead of signing in as a guest.

Next: npm install (when a package.json was written), snapback4 check, then
snapback4 dev. Exit 0 when written, 1 on a conflict, 2 on bad flags.
snapback4 guide start walks the first schema.";

const CHECK: &str = "snapback4 check [--verbose] [--json] [--cost] [--residency [--fixture dir --as p]] [--fix] [--store path]

Compiles snapback/*.q, checks that the dev store's rows adopt it (read-only,
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

snapback4 why <CODE> explains any problem or note; snapback4 why <op> one
operation's cost. Exit 0 ok (notes or not), 1 problems, 2 cannot run.";

const DEV: &str = "snapback4 dev [--port N] [--bind IP] [--fresh|--memory] [--no-watch] [--replay] [--hold-effects] [--hold-schedules] [--clock-offset +25h|--resume-clock] [--trace-empty] [--verbose]

Serves snapback/*.q on http://127.0.0.1:4400 and re-adopts the schema on every
save (a save with problems keeps the previous generation serving).

Readiness and ownership:
  stdout's first line is the URL, printed once the server accepts requests;
  everything else goes to stderr. The stderr banner names the server's pid,
  and GET /dev/status (no credential) answers {pid, project, temporary,
  generation, personas, …}: a script that spawned dev can check the pid is the
  one it started. A taken port refuses the start at once (E_ADDRINUSE, naming
  the holder); --port 0 picks a free port.

Store:
  (default)        .snapback4/store.sqlite, kept across runs; one host at a
                   time (a second dev, or a CLI writer, refuses E_STORE_BUSY
                   naming the owner's address and pid)
  --fresh          a new private temporary store that dies with this process;
  --memory         the same flag. run, data, sql and test still read the
                   on-disk store; reach a fresh dev over HTTP or run --port N

Identity: x-snapback-persona: alice acts as dev:alice for a persona declared
in `use personas`; an undeclared name is refused E_AUTH. POST /seed writes
rows as the system (guide wire). Development only: deploy + serve refuse both.

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
  long-wait flags     see snapback4 --help

Stop with Ctrl-C or SIGTERM. Refusals print as `dev refusal: …` lines with
their source site; snapback4 why recent lists them.";

const RUN: &str = "snapback4 run <operation> [json-args] [--as <persona|principal-id>] [--port N] [--now <ms|+duration>] [--json]

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
  --now <t>       pin the clock for a local run (milliseconds, or +2h from now)
  --json          one JSON object on stdout

A job runs whole as the system (--as is ignored). Exit 0 sent/complete, 1
refused (the refusing clause and its site are printed), 2 cannot run.";

const TEST: &str = "snapback4 test [--fixture dir] [--as persona] [--json] [--residency [--verbose]]

Runs every query as each persona and prints its meters; with a fixture it
first loads the rows into a private in-memory store and afterwards runs
dir/test.cases.jsonl, your own operations with expectations.

  --fixture dir   dir/<table>.jsonl, one JSON row per line, loaded as one batch
                  (parents first) with the table's defaults and sequences
                  applied as on insert. Without it, test reads the dev store
                  .snapback4/store.sqlite (E_STORE_BUSY while a dev owns it).
  --as alice      one persona (default: every persona in `use personas`)
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
  refused CODE on derived arguments   the query's own require refused the
                                argument test derived from the data (the first
                                row, the persona); not a failure: give it real
                                arguments in test.cases.jsonl
  denied CODE                   a refusal: a failure
  not run                       an argument test cannot derive

The last line counts each state and the cases. Exit 1 when a query is denied,
a case fails or the fixture does not load (a bad row, an unknown table file);
0 otherwise. snapback4 guide testing: fixture rows, test.cases.jsonl and an
acceptance script over HTTP.";

/// The help for `snapback4 <verb> --help`; `None` prints the full help.
pub fn page(verb: &str, full: &str) -> Option<String> {
    let page = match verb {
        "init" => INIT,
        "check" => CHECK,
        "dev" => DEV,
        "run" => RUN,
        "test" => TEST,
        "" => return None,
        verb => {
            // Its own lines from the full help, and the indented lines under them.
            let mut lines = Vec::new();
            let mut inside = false;
            for line in full.lines().skip(1) {
                let trimmed = line.trim_start();
                let depth = line.len() - trimmed.len();
                if depth == 2 { inside = trimmed.split_whitespace().next() == Some(verb); }
                if inside && !trimmed.is_empty() { lines.push(line.to_owned()); }
            }
            if lines.is_empty() { return None; }
            return Some(format!("{}\n\nsnapback4 --help lists every verb.", lines.join("\n")));
        }
    };
    Some(format!("{page}\n\nsnapback4 --help lists every verb."))
}
