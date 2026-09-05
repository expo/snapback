# snapback2

Snapback 2's package contains the Quarry compiler, TypeScript lowering descriptors,
headless client, React web arm, and CLI shim. It requires Node 20 or newer for Node clients.

```sh
npm install snapback2 react
```

```ts
import { api, createClient } from "snapback2/client";

const client = createClient({ url: process.env.SNAPBACK_URL!, as: "alice" });
const page = await client.query(api.messages.thread, { conversationId: "conversation-1", c: null });

const sub = client.subscribe(api.messages.thread, { conversationId: "conversation-1", c: null }, console.log);
await sub.until((delivery) => delivery.state === "complete" && delivery.live);
sub.close();
```

The generated `.snapback/build/api.d.ts` is the only source of `api` members, so
operation and channel arguments flow through the headless client and React hooks
without committed generated code. Typos and extra arguments are compile errors.

```tsx
import { SnapbackProvider, useMutation, useQuery } from "snapback2/react";
import { api } from "snapback2/client";

function Messages() {
  const messages = useQuery(api.messages.thread, { conversationId: "conversation-1", c: null });
  const send = useMutation(api.messages.send);
  if (messages.state === "hydrating") return <>Loading…</>;
  return <button disabled={send.pending} onClick={() => send.run({ conversationId: "conversation-1", recipientId: "profile-bob", body: "Hi" })}>
    {messages.state}
  </button>;
}

export const App = () => <SnapbackProvider url="http://127.0.0.1:3210" as="alice">
  <Messages />
</SnapbackProvider>;
```

Reads surface exactly seven states: `hydrating`, `complete`, `capped`, `partial`,
`denied`, `refused`, and `stale`. A subscription frame retains its server receipt
state and sets the orthogonal `live: true`; stream loss changes the view to
`stale` with `live: false` only after a receipt has been delivered. An initial
connection failure remains `hydrating`. Transport status is separately exposed as
`connection: "connected" | "reconnecting" | "offline"`. `useQuery` subscribes by
default; pass `{ live: false }` for a one-shot query, which remains `hydrating` and
retries while its connection is reconnecting.

`useMutation` returns `{ run, pending, last, transport }`. `pending` covers the
in-flight interval, and `last` is only the most recent server `committed` or
`rejected` receipt. A retryable HTTP or network failure rejects `run`, leaves
`last` untouched, and appears separately as `transport` until the next successful
run. `queued` is reserved for the deferred offline outbox and is not a v1 mutation
state.

## Assets

Generated image and video arguments accept either their closed record or a
browser `File`. The client reads the operation's current manifest descriptors,
preflights every file against its byte bound, uploads them, and substitutes the
returned records before invoking the mutation. An Expo source may instead be
`{ uri, size?, fileSize?, type?, mimeType? }`, matching Expo ImagePicker's
`uri`/`fileSize`/`mimeType` fields. The optional `expo-file-system` peer opens
`file://` and `content://` URIs as a native Blob-compatible `File`; when neither size
field is supplied, its `File.size` provides the required upload length. The
web bundle does not include that peer, and URI bytes never pass through a
custom owner `fetch` supplied to `createClient`. Native File uploads use the
documented direct File body through `expo/fetch`; progress reports whole-body
start and successful completion (0, then total) because that transport does
not expose streaming request progress.

Native URI uploads require the optional peers `expo >=54` and
`expo-file-system >=19`. Version 19.0.0
[made the modern API the package-root default](https://github.com/expo/expo/blob/main/packages/expo-file-system/CHANGELOG.md#1900---2025-08-13),
and Expo SDK 54 pairs it with `~19.0.24` and documents both the package-root
`File` import and direct `expo/fetch` upload body in the
[SDK 54 FileSystem API](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/).

```ts
const sent = await client.mutation(api.messages.sendPhoto, {
  conversationId: "conversation-1",
  photo: file,
});

const record = await client.upload(file, {
  kind: "image",
  onProgress: ({ loaded, total }) => console.log(loaded, total),
});
```

`client.upload` is the explicit two-step form. Pass `kind` to get the nominal
`ImageAsset`/`VideoAsset` back for a later mutation; the server still decides by
sniffing the bytes and the client refuses `E_ASSET_TYPE` if the two disagree.
Without `kind` the result is the union. Upload and transport failures
reject; a mutation refusal still resolves as a `MutationRejected` receipt.

React renders closed records and keeps authority out of image URLs:

```tsx
import { AssetImage, AssetVideo, useAssetUrl } from "snapback2/react";

<AssetImage asset={message.photo} alt="attachment" />
<AssetVideo asset={message.clip} />

const download = useAssetUrl(message.clip, { download: true });
```

`AssetImage` measures its rendered box and header-fetches an appropriate image
rung before creating a blob URL. `AssetVideo` mints one short-lived session
carrier for its stream URL. React Native resolves the same import through the
package's `react-native` condition; install `react-native`, `expo-video`, and
`expo-file-system` in that application.

Build and run the package tests against a real debug owner from this directory with:

```sh
node build.mjs
env -u SNAPBACK_URL node --test tests/
```

With `SNAPBACK_URL` unset, the harness builds the chat fixture with the bundled
compiler, starts `target/debug/snapback2 dev --foreground` on an ephemeral port,
and exports its URL to the suite. To use an already-running compatible owner, set
`SNAPBACK_URL=http://127.0.0.1:<port>` instead.

### Native view-once video

`AssetVideo` from `snapback2/expo` or `snapback2/react-native` shows Play for
view-once clips. A tap (or explicit `autoPlay`) fetches and durably admits the
view before giving MP4 bytes to the native memory player. No temporary file
is created. Completion, unmount, backgrounding, or loss of custody stops
playback; an admitted clip cannot be reopened. Decoder failure after
admission does not restore the allowance.

Rebuild the Expo app/development client after installing this version so
Expo autolinks Snapback's memory player: `npx expo run:ios` or
`npx expo run:android` (existing iOS projects also need `npx pod-install`).
Expo Go lacks the module and refuses before fetching or consuming a clip.
Ordinary videos continue to use `expo-video`.
