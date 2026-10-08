# Snapback 4: the device answers an online-only read with `data: []` / `0` and only an `unknown` flag

Status: Open
Date: 2026-10-08
Scope: Snapback 4 device (`snapback4-device` query reply) and its host contract; the Exact2 client half is owned elsewhere
Reproduced: yes, on main cd2fa88d8b, through `snapback4 device`

## Evidence

App-farm round 1: memory-quilt-0800 (online-only aggregate read 0 on device,
"counts stuck at 0", ~2 + ~4 min), seed-lineage-swap-0927 (`mySwaps`
`speculative:true, data:[]`, 6 min, "silent speculative [] for server-held
rows"), charger-share-meter-0953 (`{data:0, speculative:true, unknown:true}`
while `POST /q/total` said 3500), weed-front-0518 ("device-local speculative
zeros ... cost 15+ min because every layer reported success"). 12 diaries
mention speculative answers. All four removed `online only` (making data
synced or public) to get correct numbers.

## Repro

```quarry
use personas alice
table swaps:
  note: text <=80
  owner: principal
  read <- .owner = viewer
  insert <- .owner = viewer
  cap 100 by owner
  online only
table lots:
  title: text <=80
  kind: text <=10
  public 'lots'
  insert <- allow
  sync last 100 by .id
view lotCount: count lots by .kind
  read <- allow
  online only
query mySwaps():
  return swaps where .owner = viewer
query total(k: text <=10):
  return lotCount[k]
```

With `snapback4 dev` serving and one swap and one lot written,
`curl /schema > backend.json`, then on a fresh device store:

```
$ printf '%s\n' '{"op":"query","name":"mySwaps","viewer":"dev:alice","args":{},"now":1789352669447}' \
    '{"op":"query","name":"total","viewer":"dev:alice","args":{"k":"a"},"now":1789352669447}' \
  | snapback4 device dev-device.sqlite backend.json
{"ok":{"complete":false,"data":[],...,"speculative":true,"tables":["swaps"],"unknown":true,"watermark":0}}
{"ok":{"complete":false,"data":0,...,"speculative":true,"tables":["lotCount"],"unknown":true,"watermark":0}}
```

The server answers `[ {note..} ]` and `1`.

## Whose responsibility

The Snapback 4 client (`snapback4/client`) treats `unknown: true` as
server-only knowledge: it runs the query on the server or refuses `E_OFFLINE`,
and "never answers an empty device page as server data" (`guide residency`).
The farm's apps used the Exact2 client, which renders `data` from the device
reply. So the wrong answer on screen is the **Exact2 client's** responsibility
(another agent owns it; not ticketed here).

The Snapback side still has two gaps that made this easy to get wrong:

1. The device reply carries a placeholder `data` (`[]`, `0`) next to
   `unknown: true`, which reads as an answer to any host that does not know
   the flag. For a read whose sites are server-only (`online only` table or
   view, `check --residency` says "server"), there is no device answer at all.
2. The device query protocol (`unknown`, `speculative`, `complete`,
   `retained`, `watermark`) is not documented as a host contract anywhere in
   the published docs; third-party hosts reverse-engineer it.

## Suggested fix (lead session; device/contract)

- When `unknown` is true because a read site is server-only, omit `data` (or
  send `loading: true` as the server does for an unavailable read) and add an
  explicit marker such as `server: true` naming the site, so a naive host
  cannot render a placeholder.
- Document the device `query` reply for embedding hosts (the Exact2 seam):
  what `unknown`, `speculative` and `complete` oblige a host to do.
- Cross-reference: Exact2 client must fall back to `POST /q/<op>` or show
  unavailable when `unknown` is true.
