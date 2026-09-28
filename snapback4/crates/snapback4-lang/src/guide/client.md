# Client: preserve intent through read gaps

Keep drafts, routes and viewer ownership above transient lists; render protected rows only from current reads.
Submit once at custody, then let the user continue.

```tsx
import { useState } from "react";
import { useMutation } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function Composer({ conversationId }: { conversationId: string }) {
  const [draft, setDraft] = useState("");
  const send = useMutation(api.send);
  const [submitted, setSubmitted] = useState("");
  async function submit() {
    const text = draft; setSubmitted(text); setDraft("");
    const write = await send.run({ conversationId, body: text }, { waitSeconds: 0 });
    if (write.state === "failed") setDraft(current => current || text);
  }
  return <><input value={draft} onChange={e => setDraft(e.target.value)} />
    <button disabled={send.inFlight} onClick={() => void submit()}>Send</button>
    {send.last?.state === "failed" && submitted && <p role="alert">Not sent: {submitted} <button onClick={() => setDraft(current => current ? current + " " + submitted : submitted)}>Edit</button> <button onClick={() => setSubmitted("")}>Dismiss</button></p>}</>;
}
```

`waitSeconds: 0` returns at custody; `inFlight` covers the call, while `pending` lasts until settlement and must not disable the next send.
Clear the field at submit; on refusal, restore it only if still empty, otherwise offer the saved text with Edit (append to a non-empty draft). Text typed meanwhile survives. Predicted rows carry `pending: true`: show “Sending…”.
For earlier sends and reload, save `{ id: mintId(), args }` in account-and-backend-scoped storage **before** `run(args, { id, waitSeconds: 0 })`.
Observe each saved id with `usePendingWrite(op, savedId)`; `failed` shows its refusal and saved text to edit. Show “Saving…” during submission and “Checking…” while `restoring` is true; only then is an `undefined` receipt unknown, never failed or automatically resent. Unknown and failed rows show the saved text; only settled lookups offer Dismiss.
A deliberate new attempt gets a new id; never mint one to recover a lost acknowledgement. A replay confirms execution without a historical result.
The reference saved-intent journal is in the starters: `snapback4 init --expo` / `--web`; it is not another outbox or resend loop.

## Honest read boundaries

The signed-in tree follows `useAuth().state`, not a profile query. Decide the first route once per account/backend; subsequent `loading` never unmounts that tree, a route or draft.
Keep headers and composers mounted through `loading`; rows follow the current read, never a saved previous answer. Reset user-owned state on account/backend change.
`usePage` returns `items: []` while page one is loading: show loading, not empty. Keep effects out of rows.
While this device holds a predictable pending write to a table a query reads, that query asks no server; a write with an unknown predicted footprint blocks every query. Writes to unrelated tables do not hold it.
A withheld answer (a total/extremum over input past the horizon, a point read past it, or another speculative answer) stays `loading`; a local partial answer (`complete: false`, e.g. an order unlike the window's) stays partial. See `guide reads`, `snapback4 why <query>`.
Keep the main list locally complete and server-needing decorations separate. An unavailable unread aggregate is unknown, not zero, and must not hide the conversation.

## Acknowledgements and receipts

Use `snapback4 guide receipts` for the schema, `delivered`/`seen` mutations and `useReceipts` hook; keep that recipe's server-owned progress and lifecycle together.
Start its background (`visible: false`) delivery hooks only after `useAcquired()` is true. Deferring them took calibration 21's cold acquisition from 69.9 s to 5.6 s at 100 conversations.
“Read” follows `seen` of the newest message on screen while the conversation is open and the app foregrounded; keep the hook above transient rows and follow its visibility input.
The recipient set is membership at send time: later joins never enter it, and leaving/removal drops a recipient from the requirement, without recording that they read.

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
Integrated messaging app and all three lifetimes: `snapback4 new my-social --template social`, then `snapback4 guide social`. Typing schema: `guide ephemeral`.
