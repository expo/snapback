# snapback4

The client for Snapback 4, one of two parallel candidates for the successor
to Snapback 2 (see LLP 3000 in the repository). Version 0.0.x is week one:
this package carries the **contract** every screen is written against, a
**labelled mock client** so an application can be written before the
mechanism exists, and the **React hooks** over the contract. Nothing here
talks to a server yet; the replica, the outbox and the interpreter arrive in
weeks two and three.

```ts
import { isReady, type Read, type Write } from "snapback4/contract";
import { createMockClient, page } from "snapback4/mock";
import { SnapbackProvider, useQuery, useMutation } from "snapback4/react";
```

The contract fits on an index card. A read is `{ data, complete, fresh,
since?, next? } | { loading } | { denied }`; a row this device changed and
the server has not confirmed carries `pending: true`; a write is `pending |
sent | failed(why)`; the app's link is `online | offline | signed-out`.
Everything else is the runtime's business.
