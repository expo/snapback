# Client: preserve intent through read gaps

Keep drafts, routes and viewer ownership above transient lists; render protected rows only from current reads.
Submit once at custody, then let the user continue.

```tsx
import { useState } from "react";
import { useMutation, useQuery } from "snapback4/react";
import { presence } from "snapback4/contract";
import { api } from "../snapback/generated/api";
export function Composer({ conversationId }: { conversationId: string }) {
  const [draft, setDraft] = useState("");
  const send = useMutation(api.send);
  const member = presence(useQuery(api.myMembership, { conversationId }));
  const blocked = member === "absent" || member === "denied";
  const [submitted, setSubmitted] = useState("");
  async function submit() {
    if (blocked) return;
    const text = draft; setSubmitted(text); setDraft("");
    const write = await send.run({ conversationId, body: text }, { waitSeconds: 0 });
    if (write.state === "failed") setDraft(current => current || text);
  }
  return <><input value={draft} onChange={e => setDraft(e.target.value)} />
    <button disabled={send.inFlight || blocked} onClick={() => void submit()}>Send</button>
    {send.last?.state === "failed" && submitted && <p role="alert">Not sent: {submitted} <button onClick={() => setDraft(current => current ? current + " " + submitted : submitted)}>Edit</button> <button onClick={() => setSubmitted("")}>Dismiss</button></p>}</>;
}
```

For this recipe, membership has no horizon, syncs within the conversation's own group with the messages' audience, and that group's first acquisition has finished. The viewer's membership is then `present` or `absent`, never `partial` just because the device is offline. `loading` here is first acquisition, not denial or absence. Disable send on membership `absent` or `denied`, never `loading`/`partial`. Do not add `with own keys` to admin-written memberships.

`waitSeconds: 0` returns at custody; `inFlight` covers that call. Pending settlement must not disable the next send. Clear at submit; restore refused text only into an empty draft, otherwise offer Edit and Dismiss. Predicted rows carry `pending: true`: show “Sending…”.
For recovery, save `{ id: mintId(), args }` in account-and-backend-scoped storage before submitting with that id. Observe it with `usePendingWrite`: show “Saving…” during submission and “Checking…” while `restoring`. Only then is an undefined receipt unknown; never automatically resend it. Offer saved text to edit on failure and Dismiss only after lookup settles. A new attempt gets a new id; a replay confirms execution without historical results. The web/Expo starters include the saved-intent journal.

## Honest read boundaries

Use `presence(read)` for status; after `isReady(read)`, branch on `read.presence` to narrow point data.

| Meaning | UI decision |
| --- | --- |
| `loading` | No answer yet or withheld: keep composers, headers and routes mounted. |
| `denied` | Refusal: show its message; disable the durable action. |
| `present` | Nonempty top-level value: render it, even with incomplete coverage. |
| `absent` | Proven empty answer: resolve the missing route/row. |
| `partial` | Empty, uncertain answer: show “Partial results”; never infer absence or denial. |

Only top-level `null` or `[]` is empty: `false`, `0`, and nested nulls are present. Empty means `absent` only when `complete`, `cut === null`, no `next`, and no intersecting pending prediction. An unknown prediction footprint blocks every read; complete local execution narrows dependencies. Precedence: present, absent, partial. `fresh` never demotes; offline `absent` is absence at the acquired watermark. Hidden and missing rows are indistinguishable.

Route and mount on `present`/`absent`, never `loading`/`partial`. The signed-in tree follows `useAuth().state`; keep drafts above transient rows and reset them on account/backend change. A required membership row's `absent` disables send; its `loading`/`partial` does not. Retention grants no authority; one-view playback keeps the safeguards below.

For search use one ordinary query per scope through `usePage`. Render `page.items`; classify `page.read`, because `items: []` also occurs while page one loads. Show “Partial results” only for `presence(page.read) === "partial"`. Follow `hasMore`/`loadMore`; a nonempty page is `present` even with a continuation or cut. Keep server-needing decorations separate: an unavailable unread aggregate is unknown, not zero, and must not hide the conversation.

## Acknowledgements and receipts

Use `snapback4 guide receipts` for the schema, `delivered`/`seen` mutations and `useReceipts` hook; keep that recipe's server-owned progress and lifecycle together.
The SDK owns delivery reporting from acquired rows and accepted query manifests, even with no conversation mounted. The screen owns visible `seen` reporting; mount `useReceipts` for that screen, not background delivery observations.
“Read” follows `seen` of the newest message on screen while the conversation is open and the app foregrounded; keep the hook above transient rows and follow its visibility input.
The recipient set is membership at send time: later joins never enter it, and leaving/removal drops a recipient from the requirement, without recording that they read.

## One-view photos

Mount this viewer **above the list**, keyed by `JSON.stringify([backend, account, messageId, assetId])`; the point query returns the message's photo, tombstone and deadline.
Open fetches once, never from a render/effect. List refetch/recycling cannot consume or lose the handle; unmount/account change revokes it, including a late response.
The point read closes/revokes on a ready `absent`, denied, tombstoned, changed asset or deadline, never on `loading`. Keep the known deadline ticking through loading.

```tsx
import { useEffect, useRef, useState } from "react";
import { useClient, useNow, useQuery } from "snapback4/react";
import { isReady, presence } from "snapback4/contract";
import { api } from "../snapback/generated/api";
export function OneView({ messageId, assetId }: { messageId: string; assetId: string }) {
  const client = useClient(), row = useQuery(api.messagePhoto, { id: messageId });
  const handle = useRef<{ revoke(): void } | null>(null), alive = useRef(false), deadline = useRef<number | null>(null);
  const [started, setStarted] = useState(false), [url, setUrl] = useState<string | null>(null), [problem, setProblem] = useState("");
  const opened = useRef(false);
  if (isReady(row) && row.presence === "present") deadline.current = row.data.expiresAt;
  const now = useNow(deadline.current);
  const closed = presence(row) === "denied" || presence(row) === "absent" || (isReady(row) && row.presence === "present" && (row.data.tombstone || row.data.photo?.id !== assetId)) || (deadline.current !== null && now >= deadline.current);
  const invalid = useRef(false); invalid.current ||= closed;
  useEffect(() => { alive.current = true; return () => { alive.current = false; handle.current?.revoke(); }; }, []);
  useEffect(() => { if (closed) { handle.current?.revoke(); handle.current = null; setUrl(null); } }, [closed]);
  async function open() {
    if (opened.current || invalid.current || (!isReady(row) || row.presence !== "present" || row.revalidating)) return;
    opened.current = true; setStarted(true);
    const result = await client.asset(assetId);
    if ("denied" in result) { if (alive.current) setProblem(result.denied.message); return; }
    if (!alive.current || invalid.current) { result.revoke(); return; }
    handle.current = result; setUrl(result.url);
  }
  return invalid.current ? null : <>{url ? <img src={url} alt="One-view photo" /> : <button disabled={started || !isReady(row) || row.presence !== "present" || row.revalidating} onClick={() => void open()}>Open photo</button>}{problem}</>;
}
```

`useAsset` revokes on unmount: use this ownership for one-view photos. Never refetch one (`E_ASSET_VIEWED` on the second fetch); this is a transient handle, not a media cache.
Integrated messaging app and all three lifetimes: `snapback4 new my-social --template social`, then `snapback4 guide social`. Typing schema: `guide ephemeral`.
