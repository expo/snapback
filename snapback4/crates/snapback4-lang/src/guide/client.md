# Client: answers stay on screen

Submit at custody.

```tsx
import { useState } from "react";
import { useMutation, useQuery } from "snapback4/react";
import { existence, isReady } from "snapback4/contract";
import { api } from "../snapback/generated/api";
export function Composer({ conversationId }: { conversationId: string }) {
  const [draft, setDraft] = useState("");
  const send = useMutation(api.send);
  const member = useQuery(api.myMembership, { conversationId });
  const blocked = existence(member) === "denied" || (existence(member) === "absent" && isReady(member) && member.fresh && !member.revalidating);
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

Membership with no horizon, synced within the conversation's own group with the messages' audience, proves presence/absence after acquisition unless a pending prediction blocks absence. `loading` means acquisition or later withdrawal. Never add `with own keys` to admin-written memberships.
Only `denied`, or fresh, non-revalidating `absent`, disables Send. Stale offline absence queues; sync authorizes/refuses. `loading`/`partial` never disable.

`waitSeconds: 0` returns at custody; `inFlight` covers the call, not settlement. Acquisition never gates admission after session readiness. Identity I/O gets 15 seconds excluding prior admissions; `usePendingWrites()` says “not yet admitted”. Reload loses it. Identification resumes in order; `E_ADMISSION_STORE`/`E_ADMISSION_TIMEOUT` permit retry after repair without remounting.
Restore refused text into an empty draft; otherwise offer Edit/Dismiss. Show “Sending…” on predicted rows (`pending: true`).
Save `{ id: mintId(), args }` in account/backend-scoped storage before `run(args, { id, waitSeconds: 0 })`. `usePendingWrite` shows “Saving…” during submission, “Checking…” while `restoring`; afterward, undefined means unknown. Never automatically resend. Dismiss after lookup settles. New attempts need new ids; replay omits historical results. Web/Expo starters include this journal.

## Honest read boundaries

Use `existence(read)`; `isReady(read)` then `read.existence` narrows point data.

| Meaning | UI decision |
| --- | --- |
| `loading` | Withheld/unavailable: keep composers, headers and routes mounted. |
| `denied` | Refusal: show its message; disable the durable action. |
| `present` | Render nonempty values, including incomplete coverage. |
| `absent` | Proven empty answer: resolve the missing route/row. |
| `partial` | Uncertain empty: show “Partial results”, never absence/denial. |

Only top-level `null`/`[]` is empty; `false`, `0`, nested nulls are present. Empty is `absent` only with `complete`, `cut === null`, no `next`, and no admission or intersecting prediction. Unknown prediction footprints block every read; complete local execution narrows dependencies. `fresh` never demotes; offline `absent` is absence at the acquired watermark. Hidden/missing rows are indistinguishable.
Route on `present`/`absent`. Follow `useAuth().state`; reset drafts on account/backend change. Retention grants no authority.
Same-key plain refetch, reconnect and failed retries retain `revalidating` answers without timeout. Replacements recompute existence. Local changes get one second at attempt execution, excluding capacity wait; online change evidence includes queue wait because it may revoke access. Failure/timeout withdraws. Applied scope loss withdraws dependent groups immediately, including staged removals; older replicas wait for publication. `keep: true` adds 30-second subscriber-free linger; `keep: false` withdraws immediately. Keys, deadlines, sign-out, credentials/store/schema resets and generation changes withdraw immediately.
Search with `usePage` per scope: render `page.items`, classify `page.read`. Show “Partial results” only for `existence(page.read) === "partial"`; follow `hasMore`/`loadMore`. Nonempty pages remain present. Unknown unread counts never hide conversations.

## Queries in rows

Wire-equivalent names/arguments share observations per retention policy; object key order is irrelevant. Prefer paged lists: 1,000 distinct row hooks do 1,000 evaluations per relevant write versus one. Known disjoint writes do zero; authorization inputs are dependencies.
At most eight queued observation attempts start per turn, eight remain active; direct queries and timed presence refreshes use separate paths. Local budgets pause in the queue; retries never replenish them. Expiry/resets stay immediate. Online evidence rereads precede ordinary queued work; occupied slots can still cause sibling withdrawal.

```tsx
import { useQuery, usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";
function MemberCount({ conversationId }: { conversationId: string }) {
  const members = useQuery(api.members, { conversationId });
  return <span>{"data" in members ? members.data.length : "…"}</span>;
}
function ConversationList() {
  const page = usePage(api.inboxCards, {});
  return <>{page.items.map(row => <span key={row.id}>{row.title} ({row.memberCount})</span>)}
    {page.hasMore && <button onClick={page.loadMore}>More</button>}</>;
}
```

Server/composed scope metadata preserves unrelated rooms. Unknown selectors use table-wide withdrawal; see [read boundaries](CLIENT-AND-OPERATIONS.md).

If a screen flashes empty, call `inspect(client)` from `snapback4/inspection` to enable collection: compare `queued`/`inFlight`, `revalidating`/`withdrawn`, and `recentWithdrawals` causes. `change-timeout` means exhausted budget; online evidence includes capacity wait. `latency` reports queue/attempt p50/p95/max for 256 completed attempts; withdrawals keep 64. Counts include linger; direct/presence reads are excluded.
Development overlay: `useInspection(import.meta.env.DEV)` from `snapback4/react` (Expo: `useInspection(__DEV__)`). Disabled returns null and starts no timer; enabled samples every 250 ms. No arguments/values.

## Expo and acquisition

Social uses `nativeDevice` on native, `webDevice()` on web, online in Expo Go. See `guide witness` for native proof, `guide reads` for timings, `guide sync` for Worker choices/acquisition.

Every milestone: `npm run export:ios` for Hermes; on a Mac with Xcode, `npm run native:smoke` (about 3 minutes warm). It installs Release and proves local-store acquisition, offline reopen and reconnect. Pending write replay needs an application scenario (`guide witness`).


## Receipts

`guide receipts` covers `useReceipts`. SDK owns delivery reporting; the screen owns visible `seen` reporting. Mount above transient rows. “Read” follows newest-message `seen` while foregrounded. Send-time members are recipients; removal claims no reading.

## One-view photos

Mount **above the list**, keyed by `JSON.stringify([backend, account, messageId, assetId])`. Explicit Open fetches once; recycling/refetch preserves its handle. Unmount/account change revokes even late responses. Close on ready `absent`, denied, tombstoned, changed asset or deadline; keep deadlines ticking through loading.

```tsx
import { useEffect, useRef, useState } from "react";
import { useClient, useNow, useQuery } from "snapback4/react";
import { isReady, existence } from "snapback4/contract";
import { api } from "../snapback/generated/api";
export function OneView({ messageId, assetId }: { messageId: string; assetId: string }) {
  const client = useClient(), row = useQuery(api.messagePhoto, { id: messageId });
  const handle = useRef<{ revoke(): void } | null>(null), alive = useRef(false), deadline = useRef<number | null>(null);
  const [started, setStarted] = useState(false), [url, setUrl] = useState<string | null>(null), [problem, setProblem] = useState("");
  const opened = useRef(false);
  if (isReady(row) && row.existence === "present") deadline.current = row.data.expiresAt;
  const now = useNow(deadline.current);
  const closed = existence(row) === "denied" || existence(row) === "absent" || (isReady(row) && row.existence === "present" && (row.data.tombstone || row.data.photo?.id !== assetId)) || (deadline.current !== null && now >= deadline.current);
  const invalid = useRef(false); invalid.current ||= closed;
  useEffect(() => { alive.current = true; return () => { alive.current = false; handle.current?.revoke(); }; }, []);
  useEffect(() => { if (closed) { handle.current?.revoke(); handle.current = null; setUrl(null); } }, [closed]);
  async function open() {
    if (opened.current || invalid.current || (!isReady(row) || row.existence !== "present" || row.revalidating)) return;
    opened.current = true; setStarted(true);
    const result = await client.asset(assetId);
    if ("denied" in result) { if (alive.current) setProblem(result.denied.message); return; }
    if (!alive.current || invalid.current) { result.revoke(); return; }
    handle.current = result; setUrl(result.url);
  }
  return invalid.current ? null : <>{url ? <img src={url} alt="One-view photo" /> : <button disabled={started || !isReady(row) || row.existence !== "present" || row.revalidating} onClick={() => void open()}>Open photo</button>}{problem}</>;
}
```

`useAsset` revokes on unmount. Once media cannot refetch (`E_ASSET_VIEWED`); handles are transient.
Start with `snapback4 new my-social --template social`; see `guide social` and `guide ephemeral`.
