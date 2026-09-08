# snapback2

Snapback 2's package contains the Quarry compiler, TypeScript effect and test helpers,
headless client, React web arm, and CLI shim. It requires Node 20 or newer for Node clients.

```sh
npm install snapback2 react
```

Start an Expo app with `npx snapback2 init my-app --template chat --client expo`.
Use `npx snapback2 guide init` for scaffolding and CLI setup, `npx snapback2 guide auth`
for authentication, and `npx snapback2 guide app` for the current backend's certified
facts.

```ts
import { api, createClient } from "snapback2/client";

const client = createClient({ url: process.env.SNAPBACK_URL!, as: "alice" });
const page = await client.query(api.messages.thread, { conversationId: "conversation-1", c: null });

const sub = client.subscribe(api.messages.thread, { conversationId: "conversation-1", c: null }, console.log);
await sub.until((delivery) => delivery.state === "complete" && delivery.live);
sub.close();

const observed = client.observe(api.messages.thread, { conversationId: "conversation-1", c: null });
const stop = observed.subscribe(() => console.log(observed.getSnapshot()));
stop();
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
  if (messages.status === "loading") return <>Loading…</>;
  return <button disabled={send.inFlight} onClick={() => send.run({ conversationId: "conversation-1", recipientId: "profile-bob", body: "Hi" })}>
    {messages.status}
  </button>;
}

export const App = () => <SnapbackProvider url="http://127.0.0.1:3210" as="alice">
  <Messages />
</SnapbackProvider>;
```

`useQuery` returns one immutable `Snapshot`: `data`, the certified `receipt`
(`outcome`, `source`, `seq`, `next`), `freshness`, `local` facts, and any `refusal`.
Its derived `status` is `loading`, `ready`, or `unavailable`; `ready` means
readable data, not completeness. `receipt.outcome` preserves `complete`,
`capped`, `partial`, or `denied`, independently of `freshness.live` and
`freshness.connection` (`connected`, `reconnecting`, or `offline`). Prediction
and retention are under `local`. `useQuery` subscribes by default; pass
`{ live: false }` for a one-shot query, which stays loading and retries while
its connection is reconnecting.

`client.observe` is the lazy headless form of the same query resource. Its
first listener opens the shared subscription and its last listener releases
it. Identical headless and React consumers read the same immutable `Snapshot`;
successor and account resets publish `loading` before new-authority data.
`QueryView` remains the reducer/event-facing form used by raw subscriptions.
Committed predictions, settlements, and coverage changes reevaluate mounted
views once from the atomic store revision; bookkeeping-only commits stay silent.

`useMutation` returns `{ run, inFlight, can, pending, last, detail }`.
`inFlight` marks an active call; `pending` lists this operation's durable queued
intents. `can.send`, `can.reason`, and `can.action` describe readiness and recovery;
`detail.status` retains the underlying queue/grant/fence facts. `last` is
`queued`, `committed`, `rejected`, or `admission-unknown`; queued means saved
on the device for FIFO replay after resume. `useOutbox()` exposes entries,
`dismiss`, `can`, and `detail`. The client's `outbox.drain()` and `settled()`
report `{ stopped, remaining }`. Transport failures preserve queued writes;
a thrown retryable refusal leaves `last` untouched and sets `detail.transport`.
Run `snapback2 guide offline` for recovery.

A second browser tab for the same account forwards ordinary mutation arguments
to the tab holding the IndexedDB partition lock. `queued` means that writer has
durably admitted the request. If its answer is lost after send, the follower
gets `{ state: "admission-unknown", recovery }`; keep the opaque token and call
`client.recoverMutation(ref, args, recovery)` with the same operation and
arguments. Never retry that outcome as a fresh mutation. Uploads and channel
publishes still refuse from a follower before sending bytes.

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
package's `react-native` condition. Metro web uses the preceding `browser`
condition, including when its configuration also asserts `react-native`.
`indexedDbRangeStore` comes from `snapback2/react` on web;
`browserTokenStore` comes from `snapback2/client`. For native, install
`react-native`, `expo-video`, and `expo-file-system` in that application.

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
