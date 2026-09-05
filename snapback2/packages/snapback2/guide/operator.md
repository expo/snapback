# The operator seat

In a local `dev` owner, use `run <op> [args-json] --as system --json`,
`data <table> --as system --json`, or `why <query> --as system --json`.
The store owner sees every row and skips viewer rules; constraints, unique
indexes, immutable columns, maintains, and certified bounds still apply.
Mutations record `kind: operator` and `by` in `trace`; successful reads record their op
and `by` in `.snapback/log.jsonl`. The local control caller's `by` defaults
to the owner's OS username with disallowed characters replaced by `-` and
truncated to 80 characters (`operator` if empty or `system`). An explicit `by`
is strictly validated. Attribution is ledger text and never creates a persona.
`E_ARGS_NAME` (args, site `by`, page `operator`) requires 1–80 ASCII letters,
numbers, dashes, or underscores; rewrite `by` to a name such as `operator-alice`.
`system` is reserved and cannot be the attribution name.
The control secret and loopback transport are required. `E_OPERATOR_REQUIRED`
(`operator/seat`) means run it locally against `dev`, or with an `admin` token
once `serve`-mode tokens exist; `/api/*` never accepts the seat.
`POST /control/run` and `POST /control/job` default `as` to `system` (they are
the seat); `POST /control/execute` does not, because it also serves explicit personas.
A rejected operator mutation retains its attempted trace in the owner log and
in `trace latest` until the next commit (or owner restart); an explicit sequence
still selects its committed ledger row.

For a new required column, declare `T?`, apply, fill it through a declared
job (`guide job`), then declare `T` and apply again. `E_SUCCESSOR_NARROWING`
(`successor/migrations`) reports every null column in `narrowings`, each with
its null count and up to ten IDs; absent fields count as null. The primary site
names the first conflict in table/column order. Its pasted fill job accepts the
typed replacement value as an argument. A refused
application keeps the previous generation and appears in `dev --status --json`.
