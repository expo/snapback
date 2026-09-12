# Building with the first Snapback 3 slice

An application has a `snapback/` directory containing a Quarry schema, named
queries and mutations, and an optional development `seed.ts`. The compiler
infers the API from those operations. The server certifies them and owns the
authoritative SQLite database. The SDK owns live reads, browser storage, and
durable mutation recovery.

Start with the working [Commonroom example](examples/chat/README.md). Its
[schema](examples/chat/snapback/schema.q) and
[message operations](examples/chat/snapback/messages.q) show the actual forms
accepted by this implementation. A read rule controls row visibility; mutation
requirements and write rules enforce the operation's authority. A development
persona exercises those same rules under a local fictional account.

## Authorization rules and write preconditions

Rules use supported predicates such as `allow`, `deny`, `exists`, `=` and `!=`
over `viewer` and row fields, combined with `and`, `or`, and `not`.
Numeric ordering comparisons (`<`, `<=`, `>`, `>=`) are refused in rules.
An operation can use a mutation `require` for a write precondition. That does
not replace read authorization: every read still needs a rule that expresses
the intended visibility using supported predicates. Compiler repair advice
preserves this distinction and does not promise an equivalent automatic rewrite.

## Generate the application API

Run `snapback3 check <application-directory>`, or the repository CLI as shown in
the README. This writes `.snapback3/build/api.d.ts`. Include it in the app's
TypeScript configuration. Development mode refreshes it after an accepted backend
change. Generated declarations extend the `api` imported from `snapback3/client`;
there is no separately maintained list of operation names or argument types.

The CLI accepts `check`, `dev`, `serve`, and `run`. `check --json` prints structured
certification results. During development, a query can be inspected with:

```sh
snapback3 run messages.page '{"conversationId":"studio"}' --as alice --project examples/chat
```

`dev` owns the foreground process and prints its URL. Use Ctrl-C to stop it.
Accepted backend edits preserve the database; a rejected edit leaves the previous
generation serving and reports the compiler's diagnosis. A second owner cannot
open the same database. Each application stores its private state in `.snapback3/`.

## Read independently useful values

Create one client and put it in the React provider:

```tsx
import { createClient } from 'snapback3/client';
import { SnapbackProvider } from 'snapback3/react';

const client = createClient({ url: window.location.origin });
await client.ready;
// Local development only. The headless auth API also has signup/login/logout.
await client.auth.persona('alice');

<SnapbackProvider client={client}><App /></SnapbackProvider>;
```

A query returns a resource snapshot, including its value and what is known about
that value. Reading messages and an unread count separately lets each remain
useful independently:

```tsx
import { api } from 'snapback3/client';
import { useQuery } from 'snapback3/react';

const messages = useQuery(api.messages.page, { conversationId, c: null });
const summary = useQuery(api.conversations.unread, { conversationId });
const unread = summary.complete ? summary.data?.unread : undefined;
```

`complete` describes that query result, including its requested page, at `seq`.
It does not mean the whole table is downloaded. `fresh` describes current server
confirmation. Cached offline data can be complete and stale. A missing count is
unknown; render that state instead of turning it into zero. Resources from
different sequences do not establish a common snapshot.

Use the opaque `next` cursor as the next query's `c` argument. The example uses
40-message pages and 50-conversation pages. It displays the selected page and
explicitly provides earlier/latest navigation. Resources share authorized facts
and local evaluation evidence, but a query that lacks sufficient evidence stays
unavailable offline. This slice does not automatically download every room.

Live resource frames replace each subscribed result directly. Ordinary commits
do not deliberately blank all views. A denial or row removal takes effect even
when saving the replacement to browser storage fails. New positive facts become
available only after durable admission. The client also fences old sequences and
out-of-order manifest replies.

Headless applications use `client.watch(op, args)` and its `subscribe`,
`getSnapshot`, and `refresh` methods, or await `client.query(op, args)` for one
result. React renders that same store; it has no separate cache.

## Save an operation once

```tsx
import { api } from 'snapback3/client';
import { useMutation, useOperation } from 'snapback3/react';

const send = useMutation(api.messages.send);
async function submit(body: string) {
  const operation = send({ conversationId, body });
  await operation.durable; // Saved locally; it is now safe to clear this submitted draft.
  return await operation.settled; // The server outcome is saved locally.
}
```

Call the mutation in an event handler. `useOperation(operation)` subscribes to
its lifecycle; `useClientState().pending` lists work for the active account.
The phases distinguish saving locally, queued, sending, and observing an accepted
write in relevant live queries. A server commit and its appearance in a query are
different events. A rejected or conflicting receipt needs an application decision.

The SDK persists immutable arguments and identity before sending. After a lost
response or browser reopen, it checks that identity and retries it when needed.
The server records data and its terminal receipt in one transaction. The same
receipt remains recoverable after a schema or program change; uncommitted work
whose identity has changed is parked for review.

Do not call `mutate` again merely because a reply is late: that requests a new
operation. Let the original recover. `client.operation(id)` finds saved work;
`client.dismissOperation(id)` acknowledges terminal or parked work after the app
has preserved any user input it needs. A changed account seals retained operation
handles, hides its data, and leaves its saved work recoverable under that account.

Draft retention is application policy. Commonroom persists drafts and edit bases
per account and conversation, clears only the submitted draft after durable
admission, and preserves words from rejected operations. Its conditional edit
compares the original body so a later edit does not silently overwrite another
change.

## Offline and storage behavior

Browser clients use IndexedDB by default. Each admitted batch updates normalized
rows and resource evidence incrementally, alongside the operation journal.
`client.setOnline(false)` selects deliberate offline use; `setOnline(true)` resumes
recovery. The example exposes this through its room details panel. Browser network
events also drive connection state.

The example separately installs an application shell after its first successful
online visit. Its service worker caches only the built interface assets, so the
page itself can reopen offline. It never caches authentication or query responses.
An updated shell waits until older tabs close, without reloading an active draft.

Account changes propagate to other tabs sharing the same client database. An
adapter for tests or another host must implement the atomic `ClientStorage`
contract. `createMemoryStorage()` is for tests or explicitly ephemeral sessions;
it does not make process-restart durability promises.

The [README](README.md) lists the supported runtime and its current omissions.
