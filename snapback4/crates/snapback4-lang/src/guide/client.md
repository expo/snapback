# Client: preserve intent through read gaps

Keep drafts, routes and viewer ownership above transient lists; render protected rows only from current reads.
Submit once at custody, then let the user continue.

```tsx
import { useState } from "react";
import { useMutation } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function Composer({ conversationId }: { conversationId: string }) {
  const [draft, setDraft] = useState({ text: "", revision: 0 });
  const send = useMutation(api.send);
  async function submit() {
    const submitted = draft;
    const write = await send.run({ conversationId, body: submitted.text }, { waitSeconds: 0 });
    if (write.state !== "failed") setDraft(current => current.revision === submitted.revision ? { text: "", revision: current.revision + 1 } : current);
  }
  return <><input value={draft.text} onChange={e => setDraft(d => ({ text: e.target.value, revision: d.revision + 1 }))} />
    <button disabled={send.inFlight} onClick={() => void submit()}>Send</button>
    {send.last?.state === "failed" && <p role="alert">{send.last.why.message}</p>}</>;
}
```

`waitSeconds: 0` returns at custody; `inFlight` covers the call, while `pending` lasts until settlement and must not disable the next send.
A refusal before custody keeps the draft; text typed meanwhile survives. Predicted rows carry `pending: true`: show “Sending…”.
For earlier sends and reload, save `{ id: mintId(), args }` in account-and-backend-scoped storage **before** `run(args, { id, waitSeconds: 0 })`.
Observe each saved id with `usePendingWrite(op, savedId)`; `failed` shows its refusal and saved text to edit. An `undefined` receipt is unknown, never failed or automatically resent.
A deliberate new attempt gets a new id; never mint one to recover a lost acknowledgement. A replay confirms execution without a historical result.
The reference saved-intent journal is in the starters: `snapback4 init --expo` / `--web`; it is not another outbox or resend loop.

## Honest read boundaries

The signed-in tree follows `useAuth().state`, not a profile query. Decide the first route once per account/backend; subsequent `loading` never unmounts that tree, a route or draft.
Keep headers and composers mounted through `loading`; rows follow the current read, never a saved previous answer. Reset user-owned state on account/backend change.
`usePage` returns `items: []` while page one is loading: show loading, not empty. Keep effects out of rows.
A query the device cannot complete goes `loading` while your predictable writes to its tables are pending; see `guide reads` and `snapback4 why <query>`.
Keep the main list locally complete and server-needing decorations separate. An unavailable unread aggregate is unknown, not zero, and must not hide the conversation.

## Acknowledgements and receipts

Keep server-owned monotonic progress per member. “Read” means the conversation is open and the app foregrounded, not that a row rendered.
Keep admitted progress and an in-flight guard in refs **above the list**, keyed by backend, account, room and delivery/read kind. Coalesce only a contiguous observed prefix; do not cross unloaded gaps.
After `const write = await ack.run(args, { waitSeconds: 0 })`, remember the submitted progress only if `write.state !== "failed"`; a pre-custody refusal leaves it retryable.
A later failed receipt clears that suppression; on reload reconcile against server progress and saved ids, never blindly resend an unknown receipt.
Start **one** delivery observation after `useAcquired()` is true, not a live `usePage` for every conversation row.

The recipient set is membership at send time, excluding the sender; later joins never enter it. Leaving/removal drops a recipient from the requirement (rejoining does not restore it).
The aggregate is the minimum remaining progress: 0 sent, 1 delivered, 2 read (2 if none remain). Member progress only moves forward.
This schema uses the shared `sequence by room` counter (`guide writes`); receipt shaping is a separate decoration query.

```quarry
table rooms:
  creator: principal
  read <- .creator = viewer or exists members[.id, viewer]
  insert <- .creator = viewer
table members:
  room: rooms
  principal: principal
  joined: sequence by room
  delivered: int default 0
  readThrough: int default 0
  unique room, principal
  immutable room, principal
  read <- exists rooms[id = .room, creator = viewer] or exists members[.room, viewer]
  insert <- created rooms[.room] or (exists members[.room, viewer] and exists rooms[id = .room, creator = viewer])
  update <- .principal = viewer
  delete <- .principal = viewer or exists rooms[id = .room, creator = viewer]
table messages:
  room: rooms
  sender: principal
  ordinal: sequence by room
  body: text <=2000
  immutable room, sender
  read <- exists members[.room, viewer]
  insert <- .sender = viewer and exists members[.room, viewer]
  sync to members[.room] last 100 by .ordinal
fn receipt(m: messages):
  state = 2
  for member in members where .room = m.room:
    if member.principal != m.sender and member.joined <= m.ordinal:
      state = min(state, 2 if member.readThrough >= m.ordinal else 1 if member.delivered >= m.ordinal else 0)
  return state
mutation acknowledge(id: messages, kind: enum('delivered', 'read')):
  m = messages[id]
  if m != null:
    member = members[m.room, viewer]
    if member != null:
      update members[member] { delivered: max(member.delivered, m.ordinal), readThrough: max(member.readThrough, m.ordinal) if kind = 'read' else member.readThrough }
query messageReceipt(id: messages):
  return messages[id] { id, receipt: receipt(.) }
```

Only acknowledge a known contiguous prefix; the maximum rendered row is not evidence of it. Keep the main thread query free of `receipt(.)` if that decoration needs the server.

## One-view photos

Mount this viewer **above the list**, keyed by `JSON.stringify([backend, account, messageId, assetId])`; the point query returns the message's photo, tombstone and deadline.
Open fetches once, never from a render/effect. List refetch/recycling cannot consume or lose the handle; unmount/account change revokes it, including a late response.
The point read closes/revokes on gone (`data: null`), denied, tombstoned, changed asset or deadline, never on `loading`. Keep the known deadline ticking through loading.

```tsx
import { useEffect, useRef, useState } from "react";
import { useClient, useNow, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function OneView({ messageId, assetId }: { messageId: string; assetId: string }) {
  const client = useClient(), row = useQuery(api.messagePhoto, { id: messageId });
  const handle = useRef<{ revoke(): void } | null>(null), alive = useRef(false), deadline = useRef<number | null>(null);
  const [started, setStarted] = useState(false), [url, setUrl] = useState<string | null>(null), [problem, setProblem] = useState("");
  const opened = useRef(false);
  if ("data" in row && row.data) deadline.current = row.data.expiresAt;
  const now = useNow(deadline.current);
  const closed = "denied" in row || ("data" in row && (!row.data || row.data.tombstone || row.data.photo?.id !== assetId)) || (deadline.current !== null && now >= deadline.current);
  const invalid = useRef(false); invalid.current ||= closed;
  useEffect(() => { alive.current = true; return () => { alive.current = false; handle.current?.revoke(); }; }, []);
  useEffect(() => { if (closed) { handle.current?.revoke(); handle.current = null; setUrl(null); } }, [closed]);
  async function open() {
    if (opened.current || invalid.current || !("data" in row)) return;
    opened.current = true; setStarted(true);
    const result = await client.asset(assetId);
    if ("denied" in result) { if (alive.current) setProblem(result.denied.message); return; }
    if (!alive.current || invalid.current) { result.revoke(); return; }
    handle.current = result; setUrl(result.url);
  }
  return invalid.current ? null : <>{url ? <img src={url} alt="One-view photo" /> : <button disabled={started || "loading" in row} onClick={() => void open()}>Open photo</button>}{problem}</>;
}
```

`useAsset` revokes on unmount: use this ownership for one-view photos. Never refetch one (`E_ASSET_VIEWED` on the second fetch); this is a transient handle, not a media cache.
Typing: see `snapback4 guide ephemeral`.
