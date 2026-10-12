# Durable upload-and-place

Use a local device for captures that must survive offline, reload or app
restart. `createApp({ url, device: webDevice() })` on the web and
`createApp({ url, device: nativeDevice })` in an Expo development/production
build expose this capability through `app.client`. Open the backend once
online before capturing offline. The online-only tier's `upload` remains an
immediate connected operation.

```tsx
import { AppProvider, useUpload } from 'snapback4/react';

function Receipt({ document }: { document: File }) {
  const upload = useUpload(api.attach, 'doc');
  return <button disabled={!upload.available}
    onClick={() => upload.uploadAndPlace({}, document, { file: {} })}>
    {upload.state?.state ?? 'Attach'}
  </button>;
}
```

The mutation has a top-level image, video or file argument (here `doc`).
Pass the other arguments; the SDK fills that asset argument from the
server's authenticated upload facts. `file: {}` uses a File's name/type;
for native bytes specify `file: { name: 'recording.wav', type: 'audio/wav' }`.
WAV, MP3 (`audio/mpeg`) and FLAC (`audio/flac`) are sniffed files with the
ordinary file allow-list and bounds. There is no transcoding or duration
extraction for audio.

`uploadAndPlace` resolves after the selected bytes and placing mutation
commit together to the device outbox. Keep its returned `id` to reconnect
an application card with `useUpload(op, argument, id)` or
`client.uploadIntent(id)`. The device owns delivery, not the hook. Unmounting
or reloading loses no admitted capture. `uploads()` lists unresolved media
intents in submission order; `onUploads` signals that callers should reread.
The public `hasUploads(client)` type guard narrows this optional capability.

States are `queued`, `uploading`, `blocked` with a typed `why`, `placing`,
`cancelling`, then ordinary write `sent` or `failed`. `placing` means the
upload succeeded; it does not mean the row mutation succeeded. Retryable
network/admission failures retry automatically. For a permanent blocked
failure, fix the cause and call `retryUpload(id)`, or `discardUpload(id)`.
Discard is durable cancellation pending server acknowledgement. It refuses
`E_UPLOAD_DISPATCHED` once placement dispatch has begun; recover that same
write outcome instead. A failed admission owns no bytes and can be retried.

A stable supplied id must use the same selection, metadata and placing
arguments. Changed input, including reuse of an ordinary mutation id,
refuses `E_WRITE_ID_REUSE`. Once the terminal receipt leaves the bounded
256-entry history, use a new id for a new selection. Never change ids to
retry an unknown outcome. The asset store deduplicates retries, including a
lost accepted upload response; duplicate network transmissions can occur,
but only one asset is committed per owner and intent id.

The selected bytes are copied into the device outbox, independent of the
original Blob, mutable buffer or picker URI. Web custody uses an atomic
IndexedDB commit under its exclusive Web Lock, without a binary payload in
localStorage. Expo's module uses the same dispatcher and FULL SQLite
transaction as the SQLite device. A memory device needs its host to retain
committed changes for reopen. File names are normalized to one safe segment of at most 255 UTF-8 bytes;
media types to a lowercase MIME essence of at most 128 bytes. Other placing
args fit 64 KiB and complete metadata fits 96 KiB, so declaration and refusal
finalization always fit the HTTP envelope.
Admission allows 64 MiB per capture and
128 MiB of unresolved bytes per device; browser/app storage quota failures
are typed refusals. Hex encoding doubles stored byte payloads. Select or
compress an appropriately sized capture before admission.

The placing mutation waits for its upload and holds later FIFO writes.
Uploaded intents stay pinned on the server until placement has a durable
outcome or cancellation is acknowledged, so an offline interval after upload
cannot lose the bytes to the ordinary unclaimed sweep. Pinned unplaced bytes
are bounded at 128 MiB per viewer. After clearing device storage, inspect
`await client.serverUploads()` (50 entries and `next` per page), then cancel
abandoned captures with `await client.cancelServerUpload(id)`. These owner-only
operations require a connection and preserve another device's active captures
until explicitly cancelled. A cancellation cannot override a committed row.

## Expo save

```ts
import { saveAsset } from 'snapback4-expo';
const saved = await saveAsset(app.client, assetId);
if (!saved.ok) showMessage(saved.why.message);
```

`saveAsset` downloads through `client.asset`, using its session and retained
offline bytes, then presents the iOS save/share sheet with the file's name.
The private temporary copy and handle are disposed after the sheet completes.
An acknowledged selection returns `{ ok: true, name }`; cancellation returns
`E_CANCELLED`. The native module must be present; Expo Go returns a typed
refusal. `useUpload` and `uploadAndPlace` are also re-exported from
`snapback4-expo` and use the same local client.

## Exact adapter contract

Use `hasUploads(app.client)` and invoke the public methods above on the same
client that owns the adapter's ordinary mutations. Await capture admission
before reporting that it was saved. Preserve and display the typed states,
and use the same id on retries. The adapter needs no upload queue, callback
serialization or transport of its own. Its DeviceCore wrapper must forward
all symbol capabilities and committed-reply callbacks. The underlying
`admit_upload`, `upload_state`, `upload_ready` JSON calls are platform host
implementation details; they are not permission to send placement through an
online client around the device's dependency barrier.

Exact implements its adapter side in its workstream. DX owns starter and
main guide integration; HAND owns general wire/protocol text.
