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

## Recovering abandoned media uploads

Clients accept a browser `File` or Expo picker `{ uri, size?/fileSize? }` directly
in asset arguments: `client.mutation(api.messages.sendPhoto, { conversationId, photo: file })`.
Uploads from that call are discarded after a definitive refusal, sibling failure,
or failed outbox admission/prediction before persistence. Queued intents and
ambiguous network or storage outcomes retain their uploads for replay.

For two-phase progress UIs, use `client.upload(file, { kind: "image", onProgress })`.
To recover uploads after a restart, authenticate as the same account and inspect
`await client.listUploads()`. The creator-only `uploads` page includes receiving,
never-claimed ready, and released ready rows; each has id, kind, state, charged
original bytes, `createdAt`, nullable `releasedAt`, and `reclaiming`. Use
`{ after: page.next }` when `next` is non-null (100 rows per page).
`usage.objects` counts pending uploads across all pages: receiving, including
cancellation custody, and never-claimed ready rows. Released ready rows use no
pending slots. `usage.bytes` still includes their original-byte charge, the larger
of uploaded and finalized size. Limits remain 20 pending objects / 256 MiB per
creator, 40 / 512 MiB per owner; public totals describe only your own usage.

`await client.discardUpload(id)` explicitly abandons an unclaimed id's future use;
claimed ids refuse `E_ASSET_IN_USE`, missing/foreign ids return `false`.
Keep uploads needed by a pending mutation or queued intent. A receiving body is
fenced before its slot/charge is freed; a running finalizer or failed staging
unlink can retain both. Ready disposal removes its admission charge before the
fork-aware blob sweep completes. These figures do not measure physical disk use.
Cleanup session expiry does not replace an already settled mutation result.

Unclaimed uploads become eligible for cleanup after 24 hours from creation, or
from their latest release if later. Releases retain the full grace, derived
widths and once-view history; their creator may claim the same available id again.
`E_ASSET_TOO_LARGE` distinguishes pending-object pressure, byte admission pressure
(including released originals), and authored size bounds. Inspect your listing,
discard only abandoned ids, or wait for eligible cleanup. Free pending slots do
not guarantee byte headroom. Releases and replacements gain no capacity refusal.
