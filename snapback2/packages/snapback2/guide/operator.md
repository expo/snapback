# The operator seat

In a local `dev` owner, use `run <op> [args-json] --as system --json`,
`data <table> --as system --json`, or `why <query> --as system --json`.
The store owner sees every row and skips viewer rules; constraints, unique
indexes, immutable columns, maintains, and certified bounds still apply.
Mutations record `kind: operator` and `by` in `trace`; successful reads record their op
and `by` in `.snapback/log.jsonl`. The local control caller's `by` defaults
to the owner's OS username. Attribution is ledger text and never creates a persona.
`E_ARGS_NAME` (args, site `by`, page `operator`) requires 1–80 ASCII letters,
numbers, dashes, or underscores; rewrite `by` to a name such as `operator-alice`.
`system` is reserved and cannot be the attribution name.
The control secret and loopback transport are required. `E_OPERATOR_REQUIRED`
(`operator/seat`) means run it locally against `dev`, or with an `admin` token
once `serve`-mode tokens exist; `/api/*` never accepts the seat.
A rejected operator mutation retains its attempted trace in the owner log and
in `trace latest` until the next commit (or owner restart); an explicit sequence
still selects its committed ledger row.

For a new required column, declare `T?`, apply, fill it through a declared
operator mutation, then declare `T` and apply again. `E_SUCCESSOR_NARROWING`
(`successor/migrations`) reports the null count and up to ten IDs; absent
fields count as null. Its pasted fill-job skeleton becomes runnable when the
job grammar lands; use an operator mutation for the fill today. A refused
application keeps the previous generation and appears in `dev --status --json`.
