# The operator seat

In `dev`, use `run <op> [args-json] --as system --json`,
`data <table> --as system --json`, or `why <query> --as system`.
Viewer rules are skipped; constraints, indexes,
immutability, maintains and bounds apply.
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

See `guide successor` for additive changes, checked narrowing, fill jobs and
reviewed destructive plans.

`reset` clears application data and reapplies the seed; its JSON adds
`seed: { rows, personas }` and the human line prints those counts.
`reset --empty` prints `seed: skipped`: it clears rows, commits, outbox, jobs
and timers, keeps principals and sessions, re-arms no schedule until a row
exists, and stays empty across restart.

## Parallel fresh instances

The project directory is the owner and store isolation boundary. For parallel
proofs or scale replays, create a separate project directory for each instance
and select it with `--project`; do not reuse `reset --empty` as isolation.

```sh
snapback2 init .replays/a --template chat --client none
snapback2 init .replays/b --template chat --client none
snapback2 test --project .replays/a
snapback2 test --project .replays/b
```

For parallel development owners, run `snapback2 dev --project .replays/a` and
the corresponding command for `b`. With no `--port`, each owner chooses a free
port and writes its own `.snapback/dev-url`. Stop each owner with the same
`--project` argument. When cloning an existing app into replay directories,
copy authored source only: never copy `.snapback/`, owner metadata, or stores.

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
uploaded and finalized size, until physical cleanup settles; failed and
reclaiming originals remain byte-charged too. Limits: 20 objects / 256 MiB per creator,
40 / 512 MiB per owner. Public totals show only your usage.

`await client.discardUpload(id)` abandons an unclaimed id; claimed ids refuse
`E_ASSET_IN_USE`, missing/foreign ids return `false`. Keep uploads needed by
pending or queued mutations. Receiving bodies are fenced before freeing their
charge; running finalizers or failed staging unlinks can retain it. Ready
disposal frees its object slot immediately but keeps the byte charge until blob
sweeping finishes; usage is not total disk size. Cleanup expiry cannot replace
a settled result.

A committed mutation discards the validated staged asset arguments it left
unattached, including an idempotent early return and offline replay: the
object slot and the byte charge leave in the same transaction. A rejected
call keeps its uploads staged; a released row keeps its grace.

Cleanup starts 24 hours after creation or latest release.
Releases retain derived widths and once-view history; creators may reclaim ids. `E_ASSET_TOO_LARGE` distinguishes object pressure,
byte pressure (including released originals), and column bounds. Discard abandoned ids or wait. Free slots need not mean byte headroom;
releases and replacements gain no capacity refusal.

`why <query> [args-json] --as <persona|system>` shows source, rule, read state,
subscriptions and certified bounds beside **measured** examined/probes/steps,
derived scratch and writes. Heap peak, closure, index and output bytes are
**unavailable**: no trace measures them. `--json` keeps the columns and trace. Denials keep
executed lookups and name the requirement, or say its source is ambiguous.

`check` wraps full repairs with indented continuations; `--json` keeps fields.
Refusal messages omit their codes. Unbounded reads list matching indexes and
declared key types. Unknown names suggest a spelling within two edits or case
differences, else declarations; fallback repairs remain. `guide E_CODE` shows examples.
