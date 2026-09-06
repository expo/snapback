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

Increasing only a text maximum (`text <=80` to `text <=2000`) installs in place
and preserves existing values and row IDs. This also works inside unchanged
optional/list wrappers when every list bound stays the same. Text minimums,
formats, unique indexes and caps still apply. Widen a mutation's argument too
if it should accept longer input; an unchanged `text <=80` argument still
refuses 81 characters. Certification must fit the new declared maxima.
Narrower text or other retypes still need an explicit migration; required
retypes on populated tables refuse rather than install missing values.
Use add/fill/drop to convert those values. Old destructive plans for a now-safe
widening are rejected; check the current `dev --status --json` before applying.

## Recovering abandoned media uploads

Clients accept a browser `File` or Expo picker `{ uri, size?/fileSize? }` directly
in asset arguments: `client.mutation(api.messages.sendPhoto, { conversationId, photo: file })`.
Uploads from that call are discarded after a definitive refusal, sibling failure,
or failed outbox admission/prediction before persistence. Queued intents and
ambiguous network or storage outcomes retain their uploads for replay.

For two-phase progress UIs, use `client.upload(file, { kind: "image", onProgress })`.
To recover abandoned uploads (including after an owner restart), authenticate as
the same account and inspect `await client.listUploads()`: `uploads` gives id,
kind, state, bytes and creation time; `usage` and `limits` give byte/object counts.
Pass `{ after: page.next }` for the next page when `next` is non-null. Explicitly
release an abandoned id with `await client.discardUpload(id)`; the writer refuses
`E_ASSET_IN_USE` if any row claims it. Missing/foreign ids return `false`.
Only discard uploads whose pending mutation or queued intent you have abandoned.
Disposal closes a receiving body's staging file and fences late body writes before
freeing quota. A finalizer already running keeps its charge until its files close;
`usage` shows that pending charge. Ready uploads release quota immediately and
the existing sweep removes their blobs. Cleanup session expiry does not replace
an already settled mutation result.
Otherwise unclaimed uploads expire after 24 hours. `E_ASSET_TOO_LARGE` names the
current usage and recovery call when the staging ceiling, rather than the column
bound, was reached. Other accounts must recover their own staging allowance.
