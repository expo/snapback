# The operator seat

Use `run <op> [args-json] --as system --json`, `data <table> --as system --json`,
or `why <query> --as system` in `dev`. Skips viewer rules; constraints, indexes,
immutability, maintains and bounds apply. No persona is minted. Mutations trace
`kind: operator` and `by`; reads log op/`by` in `.snapback/log.jsonl`.
`by` defaults to OS username: invalid characters become `-`, capped at 80;
empty/`system` becomes `operator`. Explicit `by`: 1–80 ASCII letters, numbers,
dashes/underscores; `system` reserved. `E_ARGS_NAME` at `by`: use `operator-alice`.

Requires loopback/control secret. `E_OPERATOR_REQUIRED`: use `dev` or an `admin`
token once available in serve; `/api/*` refuses the seat. `/control/run` and
`/control/job` default `as` to `system`; `/control/execute` also serves personas
without that default. Rejected operator traces stay in logs and `trace latest`
until commit/restart. An explicit sequence selects its committed ledger row.

For a required column, declare `T?`, apply, run the fill job (`guide job`),
then declare `T` and apply. `E_SUCCESSOR_NARROWING` lists null columns,
counts and up to ten IDs in `narrowings`; absence counts as null.
The first conflict is the site; the job takes a typed replacement.
Refusals keep generation (`dev --status --json`).
Update `seed.ts`: checked before stored rows, even in populated stores.
Seed edits cannot fill existing rows.

`reset` clears data and reapplies seed; JSON adds `seed: { rows, personas }`,
printed as counts. `reset --empty` reports `seed: skipped`, clears rows, commits,
outbox, jobs and timers, keeps principals/sessions and survives restart empty.
Schedules wait for a row; ordinary reset re-arms with seed.

## Abandoned uploads

Pass browser `File` or Expo `{ uri, size?/fileSize? }` as assets. Before
persistence, refusal, sibling failure, failed admission/prediction discard uploads;
queues/ambiguous outcomes retain them. Progress: `client.upload(file,
{ kind: "image", onProgress })`.

`client.listUploads()` lists your receiving/unclaimed/released uploads: id, kind,
state, bytes, `createdAt`, nullable `releasedAt`, `reclaiming`.
Page: `{ after: page.next }` (100 rows).
`usage.objects` counts receiving (including cancellation) and never-claimed
ready uploads; releases use no slots. `usage.bytes` charges
the larger of uploaded and finalized size, including released originals.
Limits: 20 objects / 256 MiB per creator, 40 / 512 MiB per owner.
Totals show your usage.

`client.discardUpload(id)` abandons unclaimed ids; claimed ids refuse
`E_ASSET_IN_USE`, missing/foreign return `false`. Keep queued mutations' uploads.
Receiving bodies are fenced before freeing charge; running finalizers or failed
unlinks can retain it. Ready disposal frees charge before blob sweeping;
usage is not disk size. Cleanup expiry cannot replace a settled result.

Commit discards your validated staged asset arguments left unattached, including
idempotent returns and offline replay: slots and bytes leave together.
Rolled-back calls retain uploads.
Ordinary release retains bytes, derived widths and once-view history through
24 hours after creation or latest release; creators may reclaim ids.
`E_ASSET_TOO_LARGE` distinguishes object pressure, byte pressure and column bounds.
Discard abandoned ids or wait. Free slots need not mean byte headroom;
releases and replacements gain no capacity refusal.

`why <query> [args-json] --as <persona|system>` explains reads: denials name
a unique requirement or ambiguous source, preserving lookups. Admitted sites
show examined/visible rows, bound, complete/capped state and rule. Subscriptions
include table/index keys, absences and whole-table constraint inputs. Locations
use compiled callers or site IDs. `--json` keeps trace, bounds, digests, deliveries.

`check` indents multiline repairs; `--json` keeps fields. Messages omit codes.
Unbounded reads list matching indexes and key types. Unknown names suggest a
spelling within two edits or case differences, else declarations; fallback
repairs remain. `guide E_CODE` shows examples.
