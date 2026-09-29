# Client: answers stay on screen

Render current reads: same-key observations keep their answer during revalidation.
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

This recipe requires membership with no horizon, synced within the conversation's own group with the messages' audience, after that group's first acquisition. Membership is then `present` or `absent` offline; `loading` means acquisition, not denial. Disable send on `absent`/`denied`, never `loading`/`partial`. Do not add `with own keys` to admin-written memberships.

`waitSeconds: 0` returns at custody; `inFlight` covers that call, not settlement. Clear at submit; restore refused text into an empty draft, otherwise offer Edit/Dismiss. Predicted rows carry `pending: true` (“Sending…”).
For recovery, save `{ id: mintId(), args }` in account/backend-scoped storage before submission. `usePendingWrite` shows “Saving…” during submission, “Checking…” while `restoring`; only afterward is an undefined receipt unknown. Never automatically resend it. Offer failed text to edit; Dismiss after lookup settles. New attempts get new ids; replay confirms execution without historical results. Web/Expo starters include this journal.

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

Route on `present`/`absent`, never `loading`/`partial`. The signed-in tree follows `useAuth().state`; keep drafts above transient rows, resetting on account/backend change. Retention grants no authority.

Same-key reads retain answers marked `revalidating` through plain refetch, reconnect, slow reads, transport failure and retry exhaustion, without timeout. Completed answers replace directly and recompute presence. Local commits, online receipts, `/changes` and `/sync` bound retention to one non-renewable second; failure/timeout withdraws. An older replica cannot clear a pending notification. `keep: true` adds 30-second subscriber-free linger; `keep: false` withdraws immediately. Key changes, deadlines, sign-out, credential/store/schema resets still withdraw; generation changes withdraw before adoption even without changed tables. No route latch is needed for refetch.

Search uses one query per scope through `usePage`: render `page.items`, classify `page.read` (`items: []` also occurs during loading). Show “Partial results” only for `presence(page.read) === "partial"`; follow `hasMore`/`loadMore`. Nonempty pages remain present with cuts/continuations. An unavailable unread aggregate is unknown, not zero; never hide its conversation.

## Measure cold acquisition

`webDevice({ worker: true })` moves atomic publication off the page thread; `webDevice()` remains default. Render the first screen while `useAcquisition()` reports progress; `acquired` means the declared partition is durably published for offline use.
On eb1000 (EPYC 9454, Chromium 151), five cold runs measured medians **2.25 s Worker / 2.19 s default** for 100 memberships, 500 Following edges and 500 messages (3.65 MB); 1,000 memberships/90,500 messages took **25.66 s Worker** (39.76 MB). M1 Max estimates **5–8 s / 60–90 s** are unqualified, not promises. Group count alone is insufficient.
Measure five fresh browser profiles on your largest account: clock immediately before `createApp` through `onAcquired(true)` after authentication. Record median, host/network/browser, sync bytes/requests and `client.residency()`; time first screen separately, then verify offline reopening. Warm restoration is not cold acquisition. Full recipe: `guide sync`.

## Acknowledgements and receipts

`snapback4 guide receipts` keeps schema, mutations and `useReceipts` together. The SDK owns delivery reporting from acquired rows/accepted manifests without mounted conversations; the screen owns visible `seen` reporting. Mount the hook above transient rows, following visibility. “Read” follows `seen` of the newest message while open and foregrounded. Recipients are members at send time; later joins are excluded, removals drop requirements without claiming they read.

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
