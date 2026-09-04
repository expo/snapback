# Offline

Offline storage is explicit: pass a durable carrier through the client's
`offline.store` option (React web exports the IndexedDB carrier; journeys and
Node tests export the file carrier from `snapback2/test`). `E_OFFLINE_CARRIER`
means that carrier could not open; Snapback never substitutes memory. The store
is partitioned by principal: a terminal session expiry seals it until that
principal authenticates again; sign-out or another principal wipes it; one
writer per principal (`E_OFFLINE_LOCK`). `offline.fenceDays` (1..30) bounds
trust, not reading: past it the client stops predicting and replaying until a
resume succeeds and labels views `stale`; held answers stay readable.
`useQuery(op, args, { drain: true })` follows `next` to `null`, keeps the
watermark, and watches the tail; `useOutbox()` lists queued intents.
Asset bytes a component fetched (`<AssetImage>`, `<AssetVideo>`, `useAssetUrl`,
`assetBlob`) are cached per partition under the owning row's lease, keyed
`(assetId, width)`, and leave in the swap that evicts the row; `offline.maxAssetBytes`
(default 256 MiB) is the LRU ceiling. `offline.viewOnce(table, row)` names rows that
render once: a viewed row answers `null` offline, its bytes are never cached, and a
second fetch refuses `E_ASSET_VIEWED`.

A client holds certified answers, never a replica. Ask for the envelope with
`receipt: true` on `POST /api/query` or `receipt=1` on `/api/subscribe`:
`{ protocol: 1, generation, schemaHash, planHash, authority, state, data, next,
seq, rows, receipt, validator }`. `rows` is the pool (each row once); `data` and
the receipt reference rows as `{ "$row": { table, id } }`. Echo `validator` to
get `{ state: "unchanged", seq, validator }`. `GET /api/program?generation=`
serves the IR, certificates, and schema; `/api/manifest` carries
`tables[<name>].retain` per generation.

## Resume

`POST /api/resume { protocol: 1, generation, schemaHash, authEpoch, log: { op,
args, watermark, validator }, mounted: [{ op, args, validator }] }` is one owner
action: the log tail after `watermark` (`{ unchanged: true }` when the tail is
empty and the validator matches, else the envelope plus a new `watermark`),
then each mounted query, stopping at 1 MiB with `more`. Mounted is capped at 32
(`E_OFFLINE_RESUME`, 413). A changed program or schema answers `E_OFFLINE_RESET`
(409) with the current `{ generation, schemaHash }`: drop held coverage, keep
the outbox, fetch `/api/program`, cold-drain. A stale `authEpoch` refuses
`E_AUTH_SESSION`. Subscriptions are never reopened.

## Grants and replay

Login, guest, and resume return `grant: { id, from, count: 8192, mintedAt,
expiresAt }`: engine ids bound to the principal, minted with server time, good
for 30 days. `POST /api/mutation { op, args, replay: { grant, offset, count,
intent: "<grant>:<offset>", trace } }` injects ids `from + offset …` as the
program's `new` envelope. Refusals: `E_OFFLINE_INTENT_EXPIRED` (grant unknown,
another principal's, or past 30 days), `E_OFFLINE_ID_BLOCK` (slice outside the
grant or overlapping a settled intent), `E_OFFLINE_INTENT_REUSE` (same intent,
different bytes). The same bytes twice return the stored response without
executing, so a 503 after a commit is never a double send.

## Conflict

`trace: { points: [{ table, index, key, digest }], verdicts: [{ ruleHash,
inputsDigest, result }] }` is what the client read when it queued the write:
each point read's row digest (SHA-256 of the canonical wire row) or `null` for
an absence, and each rule verdict. At commit the server executes against
current rows, then compares inside the same transaction; a moved point or
verdict rolls the write back and answers `{ state: "rejected", reason:
"conflict", site, intent }`. Ranges re-execute fresh and are never validated,
so a fan-out uses the members at commit. It is `mutation edit(`'s `require
msg.body = baseBody else CONFLICT`, made universal.
