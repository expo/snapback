# The operator seat

In `dev`, use `run <op> [args-json] --as system --json`,
`data <table> --as system --json`, or `why <query> --as system`.
The owner skips viewer rules; constraints, unique indexes,
immutability, maintains and bounds still apply.
Mutations trace `kind: operator` and `by`; reads log op and `by` in
`.snapback/log.jsonl`. No persona is minted. `by` defaults to the OS
username, invalid characters replaced by `-`, capped at 80 characters
(`operator` if empty or `system`). Explicit `by` needs 1–80 ASCII letters,
numbers, dashes or underscores; `system` is reserved. `E_ARGS_NAME` names site
`by`; use `operator-alice`.

The control secret and loopback are required. `E_OPERATOR_REQUIRED` means use
local `dev`, or an `admin` token once serve-mode tokens exist; `/api/*` refuses
the seat. `/control/run` and `/control/job` default `as` to `system`;
`/control/execute` also serves personas and has no such default.
Rejected operator mutations retain their attempted trace in the log and
`trace latest` until the next commit or restart. An explicit sequence selects
its committed ledger row.

For a required column, declare `T?`, apply, run the fill job (`guide job`),
then declare `T` and apply. `E_SUCCESSOR_NARROWING` lists every null column in
`narrowings`, null counts and up to ten IDs; absence counts as null. The first
conflict is the site; the job takes a typed replacement.
Refusals keep the old generation (`dev --status --json`).
Update `seed.ts` too: seeds are checked before stored rows, even in populated
stores. Changing seeds cannot fill existing rows.

## Recovering abandoned media uploads

Pass browser `File` or Expo `{ uri, size?/fileSize? }` directly as an asset
argument. Definitive refusal, sibling failure, or failed outbox admission or
prediction discards uploads before persistence. Queues and ambiguous
outcomes retain uploads for replay. For progress,
use `client.upload(file, { kind: "image", onProgress })`.

As the same account, `await client.listUploads()` lists receiving,
never-claimed ready and released ready uploads with id, kind, state, charged
original bytes, `createdAt`, nullable `releasedAt` and `reclaiming`.
Page with `{ after: page.next }` (100 rows). `usage.objects` counts receiving
(including cancellation custody) and never-claimed ready uploads across pages.
Released rows use no slots; `usage.bytes` includes their charge, the larger of
uploaded and finalized size. Limits: 20 objects / 256 MiB per creator,
40 / 512 MiB per owner. Public totals show only your usage.

`await client.discardUpload(id)` abandons an unclaimed id; claimed ids refuse
`E_ASSET_IN_USE`, missing/foreign ids return `false`. Keep uploads needed by
pending or queued mutations. Receiving bodies are fenced before freeing their
charge; running finalizers or failed staging unlinks can retain it. Ready
disposal removes the charge before blob sweeping finishes; usage is not disk
size. Cleanup expiry cannot replace a settled result.

Cleanup starts 24 hours after creation or latest release.
Releases retain the full grace, derived widths and once-view history; creators
may reclaim available ids. `E_ASSET_TOO_LARGE` distinguishes object pressure,
byte pressure (including released originals), and column bounds. Discard abandoned ids or wait. Free slots need not mean byte headroom;
releases and replacements gain no capacity refusal.

`why <query> [args-json] --as <persona|system>` explains an authoritative read:
denials show the failed requirement and its lookups; admitted reads show each
site's rows examined/visible, bound and complete/capped state, read rule, then
subscription table/index prefixes. Compiled `file:line` locations show helper
callers; unavailable locations use site IDs. `--json` keeps trace, bounds, digests and deliveries. Only queries run.

`check` wraps full messages and rewrites; `--json` keeps JSON lines. Unbounded
reads list matching range indexes and declared key types. Unknown names suggest
a spelling within two edits or case differences, else declarations.
`guide E_CODE` shows Quarry or CLI/harness repairs.
