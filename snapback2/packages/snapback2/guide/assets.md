# Assets: `assets/client`

`image <=N` is a byte-bounded closed record `{ id, width, height }`; `video <=N`
adds integer-millisecond `duration`. Both admit `?` and bounded lists, but no
indexes or `maintain.by`. `once` is image-column-only, never on arguments.
Authenticated readers get one original 200. Ordinary private bytes are
`private, no-cache` with an ETag and reauthorize before 304; a `once` response
is `private, no-store`. Anonymous gets 404 on public rows too. HEAD is free; width, Range and
conditionals cannot bypass 410 `E_ASSET_VIEWED`. Add `once`: prior views unrecorded; removal is destructive.

A mutation can require `clip.duration <= 60000 else TOO_LONG`.

## Uploads and custody

Pass a browser `File` or Expo `{ uri, fileSize, mimeType }` as a generated
image/video mutation argument. `client.upload(file, { kind: "image" })`
returns a record for the explicit two-step form; see `guide operator` for
cleanup. Raw uploads accept `Content-Length` or bounded chunked bodies;
over-bound bytes refuse `E_ASSET_TOO_LARGE`. Each asset belongs to one row cell. Reusing its id
in another cell refuses `E_ASSET_IN_USE`; upload a fresh copy for that cell.

Images are decoded, oriented and re-encoded; compare normalized pixels for PNG
fidelity. Videos are validated and location metadata stripped without re-encoding.

## Open once

Fetching consumes a once image. Mount after Open, capturing its record:
`onClick={() => setOpenedAsset(message.photo)}`, then render
`{openedAsset && <AssetImage asset={openedAsset} alt="attachment" />}`.
Keep it until the view closes, even if the live join becomes null.
`AssetImage` owns a stable viewing token, fetches bytes and durably admits
that instance's allowance before displaying them. Unmounting ends the view;
another mount cannot borrow its token or reopen the image.

A later `message: null` means the joined row is unreadable. Show an
opened/removed placeholder while preserving the mounted view; do not
dereference the join or offer another Open.

Imperative: keep one `const viewing = {}` per mounted lifetime. Fetch
`const url = await client.assetUrl(asset);`
then `if (url) await client.assetBlob(url, { viewing });` (native: `assetBytes`).
The lease/allowance check precedes resolution; new viewing objects cannot borrow it.
URL-list overloads preserve positions;
consumed slots are `undefined`.
`E_ASSET_TYPE`: missing viewing instance; `E_ASSET_VIEWED`: consumed;
`E_OFFLINE_CARRIER`: allowance/row custody changed. A new token is no bypass.

Unconsumed descriptors survive unrelated online updates, but are null offline,
warm or cold. Consumption, revocation and account changes never revive them.

`once` is image-only. Ordinary `AssetVideo` supports video. Video/download URLs
may carry `?s=` credentials: ten-minute expiry, 1,024-owner cap, current row checks,
`no-store`/`no-referrer`. URLs are transferable; redact proxy query logs too.
