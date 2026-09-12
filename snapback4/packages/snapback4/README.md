# snapback4

The client for Snapback 4 (LLP 3000): the card, the online-tier client, and
React hooks. Everything a screen can read is in `contract.ts`.

```ts
import { createClient } from "snapback4/client";
import { SnapbackProvider, useQuery, usePage, useMutation, useLink } from "snapback4/react";
import { api } from "./snapback/generated/api";   // written by `snapback4 check`

const client = createClient({ url: "http://127.0.0.1:4400", persona: "alice" });

function Thread({ conversationId }) {
  const { items, hasMore, loadMore } = usePage(api.thread, { conversationId });
  const send = useMutation(api.send);
  // items[].pending marks this device's unconfirmed sends; send.last is pending | sent | failed
}
```

`snapback4/contract` is the card; `snapback4/client` talks to a server
started with `snapback4 dev`; `snapback4/react` is the hooks; `snapback4/mock`
is a labelled in-memory client for tests. The local-first tier (a replica
on IndexedDB) arrives in week three.
