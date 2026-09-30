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

Membership with no horizon, synced in the conversation's own group with the messages' audience, proves `present`/`absent` after acquisition unless a pending prediction blocks absence. `loading` means acquisition or later withdrawal. Never add `with own keys` to admin-written memberships.
Queueing needs no membership answer: only `denied`, or fresh, non-revalidating `absent`, disables Send. Stale offline absence still queues; the server authorizes or refuses at sync. `loading`/`partial` never disable.

`waitSeconds: 0` returns at custody; `inFlight` covers the call, not settlement. After session readiness, acquisition never gates admission. Identity I/O gets 15 seconds excluding prior admissions; `usePendingWrites()` says “not yet admitted”. Reload loses this call. Identification resumes admission in order; `E_ADMISSION_STORE`/`E_ADMISSION_TIMEOUT` permit retry after repair without remounting.
Clear on submit; restore refused text into empty drafts; otherwise offer Edit/Dismiss. Show “Sending…” on predicted rows (`pending: true`).
Save `{ id: mintId(), args }` in account/backend-scoped storage before `run(args, { id, waitSeconds: 0 })`. `usePendingWrite` shows “Saving…” during submission, “Checking…” while `restoring`; afterward, undefined means unknown. Never automatically resend. Keep saved text; Dismiss only after lookup settles. New attempts get new ids; replay confirms execution without historical results. Web/Expo starters include this journal.

## Honest read boundaries

`query(op, args)` waits for publishable device/server data and app authority: ready or denied, never loading. Retired/expired answers reread: four rounds, 30 seconds including queues/authority (while runnable); exhaustion refuses retryable `E_QUERY_RETRY`. Admitted writes precede ready data. `online only` waits online unless `held`; offline: permitted device data or immediate `E_OFFLINE`. Closed/signed-out/replaced/restored stores retain their refusals. Ready may be partial/stale.
`existence(read)` classifies; `isReady(read)` enables `read.existence` narrowing.

| Meaning | UI decision |
| --- | --- |
| `loading` | Unavailable: keep composers, headers and routes mounted. |
| `denied` | Refusal: show its message; disable the durable action. |
| `present` | Nonempty top-level value: render it, even with incomplete coverage. |
| `absent` | Proven empty answer: resolve the missing route/row. |
| `partial` | Empty, uncertain answer: show “Partial results”; never infer absence or denial. |

Only top-level `null`/`[]` is empty; scalars/nested nulls are present. Empty is `absent` only with `complete`, `cut === null`, no `next`, and no admission or intersecting prediction. Unknown prediction footprints block every read; complete local execution narrows dependencies. Precedence: present, absent, partial. `fresh` never demotes; offline `absent` is absence at the acquired watermark. Hidden/missing rows are indistinguishable.
Route on `present`/`absent`, never `loading`/`partial`. Follow `useAuth().state`; reset drafts on account/backend change. Retention grants no authority.
Same-key plain refetch, reconnect, slow reads, transport failure and retry exhaustion retain `revalidating` answers without timeout. Completed replacements recompute existence. Local commits, online receipts, `/changes` and `/sync` bound retention to one non-renewable second; failure/timeout withdraws. Whole server answers can precede sync; older replicas cannot clear pending notifications. `keep: true` adds 30-second subscriber-free linger; `keep: false` withdraws immediately. Keys, deadlines, sign-out, credentials/store/schema resets withdraw; generation changes withdraw before adoption, even without changed tables.
Search with `usePage`: render `page.items`, classify `page.read`; loading items prove nothing. Show “Partial results” for `existence(page.read) === "partial"`; follow `hasMore`/`loadMore`. Unknown unread counts never hide conversations.

## Queries in rows

Wire-equivalent names/arguments share observations per retention policy; object key order is irrelevant. Prefer paging: 1,000 row hooks require 1,000 evaluations per write. Disjoint writes do zero; authorization inputs are dependencies.
At most eight queued observation attempts start per turn, eight remain active; direct queries and timed presence refreshes use separate paths. `keep: false` withdraws before queueing. Queue wait precedes a new episode; retries never renew existing deadlines. Expiry/resets stay immediate. Unrelated writes preserve fallback memory; clock refresh preserves unexpired newer answers.

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

## Expo and acquisition

Every milestone: `npm run export:ios` for Hermes; on a Mac with Xcode, `npm run native:smoke` (about 3 minutes warm). It installs Release and proves local-store acquisition, offline reopen and reconnect. Pending write replay needs an application scenario (`guide witness`).

## Receipts

`guide receipts`: schema, mutations, `useReceipts`. SDK owns delivery reporting; the screen owns visible `seen` reporting. Mount above transient rows. “Read” follows foreground newest-message `seen`. Send-time members are recipients; removal claims no reading.

## One-view photos

Mount **above the list**, keyed by `JSON.stringify([backend, account, messageId, assetId])`. Explicit Open fetches once; recycling/refetch cannot consume or lose the handle. Unmount/account change revokes even late responses. Close on ready `absent`, denied, tombstoned, changed asset or deadline; keep deadlines ticking through loading.

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

`useAsset` revokes on unmount. Never refetch once media (`E_ASSET_VIEWED`).
Start with `snapback4 new my-social --template social`; see `guide social` and `guide ephemeral`.
