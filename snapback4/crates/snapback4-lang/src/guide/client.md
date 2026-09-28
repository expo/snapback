# Client: reads stay visible through revalidation

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
`useQuery` and `usePage` retain their last answer through plain revalidation by default,
with `revalidating: true` and no timer. Render their current result directly;
no application cache or “had data” latch is needed. An EnsureProfile loading gate
cannot unmount its children during plain revalidation after data has appeared.
Keep routes owned by identity so actual invalidation can also preserve navigation.
A changed dependency (including rule probes), denial, deadline or account/backend
change withdraws immediately and fences old replica reads until sync applies it.
A direct public-profile lookup by an immutable unique key stays visible through
non-deleting public updates and unrelated mutations. Other dependency changes
remain conservative. `{ keep: false }` opts out of retention.
Reset user-owned state on account/backend change.
`usePage` returns `items: []` while page one is loading: show loading, not empty. Keep effects out of rows.
For search, use one ordinary query per scope through `usePage`, as the social
starter does. The replica client combines current server hits with retained
device hits online and searches acquired holdings offline. Render `page.items`;
the SDK accumulates generated source-row pages by identity. Show “Partial
results” only for a ready `page.read.complete === false`, not for stale rows
or a non-null continuation. Follow `page.hasMore` and `page.loadMore`.
While this device holds a predictable pending write to a table a query reads, that query asks no server; a write with an unknown predicted footprint blocks every query. Writes to unrelated tables do not hold it.
A withheld answer (a total/extremum over input past the horizon, a point read past it, or another speculative answer) stays `loading`; a local partial answer (`complete: false`, e.g. an order unlike the window's) stays partial. See `guide reads`, `snapback4 why <query>`.
Keep the main list locally complete and server-needing decorations separate. An unavailable unread aggregate is unknown, not zero, and must not hide the conversation.

## Acknowledgements and receipts

Use `snapback4 guide receipts` for the schema, `delivered`/`seen` mutations and `useReceipts` hook; keep that recipe's server-owned progress and lifecycle together.
The SDK owns delivery reporting from acquired rows and accepted query manifests, even with no conversation mounted. The screen owns visible `seen` reporting; mount `useReceipts` for that screen, not background delivery observations.
“Read” follows `seen` of the newest message on screen while the conversation is open and the app foregrounded; keep the hook above transient rows and follow its visibility input.
The recipient set is membership at send time: later joins never enter it, and leaving/removal drops a recipient from the requirement, without recording that they read.

## One-view photos

Mount this viewer **above the list**, keyed by `JSON.stringify([backend, account, messageId, assetId])`; the point query returns the message's photo, tombstone and deadline.
Only Open selects the asset for `useAsset`; a render never selects it by itself. List refetch/recycling cannot consume or lose the handle; unmount/account change revokes it, including a late response.
The point read closes/revokes on gone (`data: null`), denied, tombstoned, changed asset or deadline, on invalidation as well. Keep the known deadline ticking; plain revalidation returns data with `revalidating: true`.

```tsx
import { useRef, useState } from "react";
import { useAsset, useNow, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function OneView({ messageId, assetId }: { messageId: string; assetId: string }) {
  const row = useQuery(api.messagePhoto, { id: messageId });
  const [started, setStarted] = useState(false);
  const opened = useRef(false), deadline = useRef<number | null>(null);
  if ("data" in row && row.data) deadline.current = row.data.expiresAt;
  const now = useNow(deadline.current);
  const closed = (opened.current && "loading" in row) || "denied" in row || ("data" in row && (!row.data || row.data.tombstone || row.data.photo?.id !== assetId)) || (deadline.current !== null && now >= deadline.current);
  const invalid = useRef(false); invalid.current ||= closed;
  const asset = useAsset(started && !invalid.current ? assetId : null);
  function open() {
    if (opened.current || invalid.current || !("data" in row) || row.revalidating) return;
    opened.current = true; setStarted(true);
  }
  return invalid.current ? null : <>{asset.status === "ready" ? <img src={asset.url} alt="One-view photo" /> : <button disabled={started || !("data" in row) || row.revalidating} onClick={open}>Open photo</button>}{asset.status === "denied" && asset.why.message}</>;
}
```

`useAsset` revokes on invalidation, expiry, identity change and unmount: use this ownership for one-view photos. Never refetch one (`E_ASSET_VIEWED` on the second fetch); this is a transient handle, not a media cache.
Integrated messaging app and all three lifetimes: `snapback4 new my-social --template social`, then `snapback4 guide social`. Typing schema: `guide ephemeral`.
