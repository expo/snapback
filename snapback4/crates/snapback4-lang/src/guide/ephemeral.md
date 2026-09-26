# Ephemeral tables: typing and presence in a room

Ephemeral tables hold short-lived rows in one server process, under ordinary table rules. Use them for typing and viewing indicators that disappear without durable writes.

```quarry
table rooms:
  name: text <=80
  read <- exists members[.id, viewer]
  sync to members[.id]

table members:
  roomId: rooms
  principal: principal
  unique roomId, principal
  by byPrincipal: principal, roomId
  read <- exists members[.roomId, viewer]
  sync to members[.roomId] last 100 by .id

table typing:
  roomId: rooms
  principal: principal
  unique roomId, principal
  cap 50 by roomId
  read <- exists members[.roomId, viewer]
  insert <- .principal = viewer and exists members[.roomId, viewer]
  update <- .principal = viewer and exists members[.roomId, viewer]
  delete <- .principal = viewer
  ephemeral 4s

mutation setTyping(roomId: rooms):
  upsert typing[roomId, viewer] {}

mutation stopTyping(roomId: rooms):
  delete typing[roomId, viewer]

query typingIn(roomId: rooms):
  return typing where .roomId = roomId and .principal != viewer by .principal { principal }

query typingInMyRooms(c: cursor ?):
  return members where .principal = viewer first 100 by .roomId after c { roomId, typing: typing[roomId = .roomId] where .principal != viewer { principal } }

table viewing:
  roomId: rooms
  principal: principal
  unique roomId, principal
  cap 50 by roomId
  read <- exists members[.roomId, viewer]
  insert <- .principal = viewer and exists members[.roomId, viewer]
  update <- .principal = viewer and exists members[.roomId, viewer]
  delete <- .principal = viewer
  ephemeral 30s

mutation markViewing(roomId: rooms):
  upsert viewing[roomId, viewer] {}

mutation stopViewing(roomId: rooms):
  delete viewing[roomId, viewer]

query viewingIn(roomId: rooms):
  return viewing where .roomId = roomId by .principal { principal }
```

Keep the ordinary chats-list query device-held. Observe `typingInMyRooms`
separately and render its room hints beside that list: never join an
ephemeral table into a query that must work offline.
A query reading ephemeral rows runs on the server; `N_EPHEMERAL_SERVER`
explains this and suggests splitting it from device-held data.

## Calling from React

```tsx
const typing = useQuery(api.typingIn, { roomId });
const setTyping = useMutation(api.setTyping);
const stopTyping = useMutation(api.stopTyping);
<Composer onChangeText={text => text ? setTyping.run({ roomId }) : stopTyping.run({ roomId })}
          onSend={() => stopTyping.run({ roomId })} />;
<TypingIndicator visible={"data" in typing && (typing.data?.length ?? 0) > 0} />;
```

`useQuery` watches normally and re-reads at the row's expiry. The client sends
calls in order. `setTyping` is marked `renews`: waiting equal calls coalesce,
and an equal last successful call can be reused for one quarter of the life
when nothing intervenes. Deletes and inserts are never coalesced. A row
expires between `0.75 × life` and `life` after the last call, plus delivery;
for a 5 s bound use `ephemeral 4s` or less.

A bare ephemeral write returns `null`. Use explicit `return` when you need
a result; that operation never coalesces. `renews` requires exactly one final
upsert or update, with argument/viewer/literal/`now` keys and patch values,
preceded only by guards or their local values. Counters and toggles do not renew.

For "who has this room open", keep a viewing heartbeat while mounted:

```tsx
const markViewing = useMutation(api.markViewing);
const stopViewing = useMutation(api.stopViewing);
useEffect(() => {
  void markViewing.run({ roomId });
  const heartbeat = setInterval(() => { void markViewing.run({ roomId }); }, 10_000);
  return () => { clearInterval(heartbeat); void stopViewing.run({ roomId }); };
}, [roomId, markViewing.run, stopViewing.run]);
```

Import `useQuery` and `useMutation` from `snapback4/react`, and `useEffect`
from React. The generated `api` supplies the operation handles. Calls resolve
to `Signal<R>` (`sent` or `failed`); offline calls fail with `E_OFFLINE` and
are dropped, never held, retried or added to an outbox. A server refusal does
not mark the link offline. A suspended or disconnected viewer disappears
within its 30 s life without cleanup succeeding.

## Life and the renewal law

Life is required, from 1 s through 60 s. Every insert, update and upsert
stamps a hidden deadline at the server's current time plus the life; even an
empty update renews it. Every deadline-stamping write must pass the insert
rule on its new image as well as its ordinary write rule. This renewal law
means a removed member cannot keep a row alive past one life, even if an
update rule checks only ownership. Keep membership in both rules as shown.

Rows are absent at their deadline, before rules run. Deadlines are hidden
from returned rows; query answers carry `nextExpiry`. `connected[p]` remains
server-wide; it does not report who is viewing a room. Memory is cleared on
restart, adoption, generation change or store replacement. One server
process serves these rows; there is no multi-server presence.

## Refused declarations and uses

E_QUARRY_EPHEMERAL refuses a declaration or operation that gives ephemeral rows durable custody. Use life from 1 s to 60 s, remove sync and durable clauses, and split mixed writes into separate client calls. Every row below names the clause and fix.

| Clause or use | Fix |
| --- | --- |
| Missing life, below 1 s or above 60 s | Use `ephemeral 4s` |
| `sync`, `sync public`, a horizon, `online only` | Delete the line; devices read these rows from the server |
| `expire at .col` | Delete it; the declaration sets every deadline |
| `sequence by`, `through`, `words(..)`, `image`, `video`, `once` | Keep that data in a durable table |
| Source of a maintain, Following view or feed | Count or rank durable rows |
| Any rule or `after insert` probing an ephemeral table | Probe durable rows instead |
| A reference column or `sync to` targeting an ephemeral table | Keep that target durable |
| A durable mutation, job, action or schedule reading or writing memory | Call a separate ephemeral mutation from the client |
| One mutation writing both durable and ephemeral rows, or emitting an effect | Split it; call the ephemeral mutation after the durable one |
| A `held` query reading memory | Split that read into its own server query |

Unique keys, table caps and normal work meters apply. Admission charges each
row's declared maximum column and index size, never the private payload's
actual length. `E_EPHEMERAL_FULL` is retryable at 1,000 rows or 4 MiB per
principal, or the global 100,000 rows / 512 MiB backstop. Expired rows reclaim
capacity. The session rate is 20 writes/s, burst 40; at most 256 calls wait
in the client lane. `E_RATE_LIMIT` is retryable and keeps its `auth` family.
All ephemeral mutation refusals return HTTP 200 `failed`; none bumps durable
`seq` or records replay. Repeating a correlation id executes again.

In tests, `snapback4 clock advance 4s` or `POST /dev/clock/advance` with
`{ "duration": "4s" }` expires typing. `snapback4 test` uses one in-process
hub. `run` starts a new process, so use `dev` to observe across calls.
