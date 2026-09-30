# Client: answers stay on screen

```tsx
import { useState } from "react"; import { useMutation, useQuery } from "snapback4/react";
import { existence, isReady } from "snapback4/contract";
import { api } from "../snapback/generated/api";
export function Composer({ conversationId }: { conversationId: string }) {
  const [draft, setDraft] = useState(""); const send = useMutation(api.send);
  const member = useQuery(api.myMembership, { conversationId });
  const blocked = existence(member) === "denied" || (existence(member) === "absent" && isReady(member) && member.fresh && !member.revalidating);
  const [submitted, setSubmitted] = useState("");
  async function submit() {
    if (blocked) return;
    const text = draft; setSubmitted(text); setDraft(""); const write = await send.run({ conversationId, body: text }, { waitSeconds: 0 });
    if (write.state === "failed") setDraft(current => current || text);
  }
  return <><input value={draft} onChange={e => setDraft(e.target.value)} />
    <button disabled={send.inFlight || blocked} onClick={() => void submit()}>Send</button>
    {send.last?.state === "failed" && submitted && <p role="alert">Not sent: {submitted} <button onClick={() => setDraft(current => current ? current + " " + submitted : submitted)}>Edit</button> <button onClick={() => setSubmitted("")}>Dismiss</button></p>}</>;
}
```

Membership with no horizon in the conversation's own group and messages' audience proves presence/absence unless a pending prediction blocks absence. `loading` means acquisition or later withdrawal. Never add `with own keys` to admin-written memberships.
Only `denied`, or fresh, non-revalidating `absent`, disables Send. Stale offline absence queues; sync authorizes/refuses. `loading`/`partial` never disable.

`waitSeconds: 0` returns at custody; `inFlight` covers admission. Acquisition never gates it after session readiness. Identity I/O gets 15 seconds excluding prior admissions; `usePendingWrites()` says “not yet admitted”. Reload loses it. Identification resumes in order; `E_ADMISSION_STORE`/`E_ADMISSION_TIMEOUT` permit retry after repair without remounting.
Restore refused text into an empty draft; otherwise offer Edit/Dismiss. Show “Sending…” on predicted rows (`pending: true`).
Save `{ id: mintId(), args }` in account/backend-scoped storage before `run(args, { id, waitSeconds: 0 })`. `usePendingWrite` shows “Saving…” during submission, “Checking…” while `restoring`; afterward, undefined means unknown. Never automatically resend. Dismiss after lookup settles. New attempts need new ids; replay omits historical results. Web/Expo starters include this journal.

## Honest read boundaries

`query(op, args)` settles ready/denied after device/server evaluation and authority: four rounds/30 seconds including queues/approval while runnable, then retryable `E_QUERY_RETRY`. Permanently unavailable held reads refuse non-retryable `E_QUERY_HELD`. Admitted writes precede ready data. `online only` waits online unless `held`; offline uses permitted device data or `E_OFFLINE`. Terminal refusals win; ready may be partial/stale.
`existence(read)` classifies; `isReady(read)` enables `read.existence` narrowing.

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
Search with `usePage` per scope: render `page.items`, classify `page.read`. Show “Partial results” only for `existence(page.read) === "partial"`; follow `hasMore`/`loadMore`. Loading items prove nothing. Unknown unread counts never hide conversations.

## Queries in rows

Wire-equivalent names/arguments share observations per retention policy. Prefer paging: 1,000 row hooks require 1,000 evaluations/write. Disjoint writes do zero; authorization inputs are dependencies.
Eight observation starts/turn, eight active; direct queries and timed presence refreshes are separate. Local budgets pause in the queue; retries never replenish them. Expiry/resets stay immediate. Online evidence can overtake ordinary work at most eight times; occupied slots can still cause sibling withdrawal.

```tsx
import { useQuery, usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";
function MemberCount({ conversationId }: { conversationId: string }) { const members = useQuery(api.members, { conversationId });
  return <span>{"data" in members ? members.data.length : "…"}</span>;
}
function ConversationList() { const page = usePage(api.inboxCards, {});
  return <>{page.items.map(row => <span key={row.id}>{row.title} ({row.memberCount})</span>)}
    {page.hasMore && <button onClick={page.loadMore}>More</button>}</>;
}
```

Server/composed scopes preserve unrelated rooms; unknown selectors withdraw table-wide. [Read boundaries](CLIENT-AND-OPERATIONS.md).

Screen flashes empty: `inspect(client)` from `snapback4/inspection` enables collection. Compare `queued`/`inFlight`, `revalidating`/`withdrawn`, and `recentWithdrawals` causes. `change-timeout`: exhausted budget. `latency`: queue/attempt p50/p95/max over 256 attempts; last 64 withdrawals. Includes linger; excludes direct/presence.
Overlay: `useInspection(import.meta.env.DEV)` from `snapback4/react` (Expo: `useInspection(__DEV__)`). Disabled: null/no timer; enabled: 250-ms samples. No arguments/values.

## Expo and acquisition

Social: `nativeDevice` on native, `webDevice()` on web, online in Expo Go. `guide sync` covers acquisition/Workers.

Every milestone: `npm run export:ios` for Hermes; Mac/Xcode: `npm run native:smoke` (about 3 minutes warm). Proves Release/local-store acquisition, offline reopen/reconnect. Write replay needs an app scenario (`guide witness`).

## Receipts

`guide receipts`: schema, mutations, `useReceipts`. SDK owns delivery reporting; the screen owns visible `seen` reporting. Mount above transient rows. “Read” follows foreground newest-message `seen`. Send-time members are recipients; removal claims no reading.

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
