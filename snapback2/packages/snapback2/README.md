# snapback2

Snapback 2's TypeScript package contains the authoring descriptors, headless client,
React web arm, and CLI shim. It requires Node 20 or newer for Node clients.

```sh
npm install snapback2 react
```

```ts
import { api, createClient } from "snapback2/client";

const client = createClient({ url: process.env.SNAPBACK_URL!, as: "alice" });
const page = await client.query(api.messages.thread, { conversationId: "general" });

const sub = client.subscribe(api.messages.thread, { conversationId: "general" }, console.log);
await sub.until((delivery) => delivery.state === "live");
sub.close();
```

The generated `.snapback/build/api.d.ts` is the only source of `api` members, so
operation and channel arguments flow through the headless client and React hooks
without committed generated code. Typos and extra arguments are compile errors.

```tsx
import { SnapbackProvider, useMutation, useQuery } from "snapback2/react";
import { api } from "snapback2/client";

function Messages() {
  const messages = useQuery(api.messages.thread, { conversationId: "general" });
  const send = useMutation(api.messages.send);
  if (messages.state === "hydrating") return <>Loading…</>;
  return <button disabled={send.pending} onClick={() => send.run({ conversationId: "general", recipientId: "bob", body: "Hi" })}>
    {messages.state}
  </button>;
}

export const App = () => <SnapbackProvider url="http://127.0.0.1:3210" as="alice">
  <Messages />
</SnapbackProvider>;
```

Reads surface exactly eight states: `hydrating`, `live`, `stale`, `partial`,
`denied`, `refused`, `capped`, and `complete`. Transport status is a separate
`connection: "connected" | "reconnecting" | "offline"` field; it never becomes a
query state. `useQuery` subscribes by default; pass `{ live: false }` for a one-shot
query, which remains `hydrating` and retries while its connection is reconnecting.

`useMutation` returns `{ run, pending, last }`. `pending` covers the in-flight
interval, and `last` is the most recent `committed` or `rejected` value. `queued`
is reserved for the deferred offline outbox and is not a v1 mutation state.
