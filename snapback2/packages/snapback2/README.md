# snapback2

Snapback 2's TypeScript package contains the authoring descriptors, headless client,
React web arm, and CLI shim. It requires Node 20 or newer for Node clients.

```sh
npm install snapback2 react
```

```ts
import { api, createClient } from "snapback2/client";

const client = createClient({ url: process.env.SNAPBACK_URL!, as: "alice" });
const page = await client.query(api.messages.thread, { conversationId: "conversation-1" });

const sub = client.subscribe(api.messages.thread, { conversationId: "conversation-1" }, console.log);
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
  const messages = useQuery(api.messages.thread, { conversationId: "conversation-1" });
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

Build and run the package tests against a real debug owner from this directory with:

```sh
node build.mjs
env -u SNAPBACK_URL node --test tests/
```

With `SNAPBACK_URL` unset, the harness builds the chat fixture with the bundled
compiler, starts `target/debug/snapback2 dev --foreground` on an ephemeral port,
and exports its URL to the suite. To use an already-running compatible owner, set
`SNAPBACK_URL=http://127.0.0.1:<port>` instead.
