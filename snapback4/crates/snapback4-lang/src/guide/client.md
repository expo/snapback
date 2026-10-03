# Client: answers stay on screen

**Start here:** Use reactive `useQuery`/`usePage` and classify `existence`; keep composers and receipts above transient rows. Page an inbox query.

```tsx
import { usePage } from "snapback4/react";
import { existence } from "snapback4/contract";
import { api } from "../snapback/generated/api";
export function Inbox() { const page = usePage(api.inboxCards, {});
  return <>{existence(page.read)}{page.items.map(row => <p key={row.id}>{row.title} ({row.memberCount})</p>)}<button disabled={!page.hasMore} onClick={page.loadMore}>More</button></>;
}
```

- `E_OFFLINE`: server data is unavailable; show unavailable and reconnect.
- `E_QUERY_RETRY`: one-shot settlement exhausted its budget; retry, using reactive hooks for screens.

## Reference
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
Only `denied` or fresh, non-revalidating `absent` disables Send; stale offline absence queues for sync authorization. `loading`/`partial` never disable.

`waitSeconds: 0` returns at custody; `inFlight` covers admission, ungated by acquisition after session readiness. Identity I/O: 15 seconds excluding prior admissions; `usePendingWrites()` says “not yet admitted”. Reload loses it. Resumes in order; `E_ADMISSION_STORE`/`E_ADMISSION_TIMEOUT` permit retry after repair without remounting.
Restore refused text into empty drafts; otherwise Edit/Dismiss. Predicted rows (`pending: true`): “Sending…”.
Persist `{id: mintId(), args}` per account/backend before `run(args, { id, waitSeconds: 0 })`. `usePendingWrite` shows “Saving…” during submission, “Checking…” while `restoring`; then undefined is unknown. Never auto-resend. Dismiss after lookup settles. New attempts: new ids; replay omits historical results. Web/Expo starters journal this.

## Honest read boundaries
`query(op, args)` settles ready/denied after device/server evaluation and authority: four rounds/30 seconds including queues/approval while runnable, exhaustion refuses retryable `E_QUERY_RETRY`; proven permanently unavailable held reads refuse non-retryable `E_QUERY_HELD`. Admitted writes precede ready data. `online only` waits online unless `held`; offline uses permitted device data or immediate `E_OFFLINE`. Terminal refusals win; ready may be partial/stale.
`existence(read)` classifies; `isReady(read)` enables `read.existence` narrowing.

| Meaning | UI decision |
| --- | --- |
| `loading` | Withheld: keep composers/headers/routes mounted. |
| `denied` | Show refusal; disable durable action. |
| `present` | Render nonempty values, even incomplete. |
| `absent` | Proven empty: resolve missing route/row. |
| `partial` | Uncertain empty: “Partial results”, never absence/denial. |

Only top-level `null`/`[]` is empty; `false`/`0`/nested nulls are present. Empty is `absent` only with `complete`, `cut === null`, no `next`, and no admission or intersecting prediction. Unknown prediction footprints block every read; complete local execution narrows dependencies. `fresh` never demotes; offline `absent` is absence at the acquired watermark. Hidden/missing rows are indistinguishable.
Route on `present`/`absent`. Follow `useAuth().state`; reset drafts on account/backend change. Retention grants no authority.
Answers stay `revalidating` until replaced unless evidence may revoke rows: deletes, policy-input changes and unknown/older evidence start a nonrenewable one-second bound. Inserts, non-policy updates and plain revalidation retain through slow/failed retries. Local bounds exclude queueing; online bounds include it. Bounded failure/timeout withdraws. Applied scope loss immediately withdraws dependent groups; older replicas wait for publication. `keep: true` adds 30-second subscriber-free linger; `keep: false` withdraws immediately. Keys, deadlines, sign-out, credentials/store/schema resets and generation changes withdraw immediately.
Search: point-decorated hits; `usePage` per scope; render `page.items`, classify `page.read`. Show “Partial results” only for `existence(page.read) === "partial"`; follow `hasMore`/`loadMore`. Loading proves nothing. Unknown counts never hide conversations.

## Queries in rows
Wire-equivalent names/arguments share observations per retention policy. Paging avoids 1,000 row hooks requiring 1,000 evaluations/write. Disjoint writes do zero; authorization inputs are dependencies.
At most eight queued observation attempts start/turn, eight active; direct queries and timed presence refreshes use separate paths. Local budgets pause in the queue; retries never replenish them. Expiry/resets stay immediate. Online evidence can overtake ordinary work at most eight times; occupied slots can still cause sibling withdrawal.

Server/composed scopes preserve unrelated rooms; unknown selectors withdraw table-wide. [Read boundaries](CLIENT-AND-OPERATIONS.md).
Empty flashes: `inspect(client)` from `snapback4/inspection` collects. Compare `queued`/`inFlight`, `revalidating`/`withdrawn`, and `recentWithdrawals` causes. `change-timeout`: exhausted budget. `latency`: queue/attempt p50/p95/max over 256 attempts; last 64 withdrawals. Includes linger; excludes direct/presence.
Overlay: `useInspection(import.meta.env.DEV)` from `snapback4/react` (Expo: `useInspection(__DEV__)`). Disabled: null/no timer; enabled: 250-ms samples. No arguments/values.

## Expo and acquisition
Social: native `nativeDevice`, web `webDevice()`, Expo Go online. `guide sync` covers acquisition/Workers.
Every milestone: `npm run export:ios` for Hermes; Mac/Xcode: `npm run native:smoke` (about 3 minutes warm). Proves Release/local-store acquisition and offline reopen/reconnect. Write replay needs an app scenario (`guide witness`).

## Receipts
`guide receipts`: `useSeen(api.receiptFamilies.chat, { scope, through, active })` owns retries. SDK owns delivery reporting; screen owns visible `seen` reporting. Supply visible confirmed positions. Keep retained history and live decorations independent.

## One-view photos
Mount **above the list**, keyed by `JSON.stringify([backend, account, messageId, assetId])`. Open fetches once; recycling/refetch preserves its handle. Unmount/account change revokes even late responses. Close on ready `absent`, denied, tombstoned, changed asset or deadline; keep deadlines ticking through loading.

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
`useAsset` revokes on unmount; once media cannot refetch (`E_ASSET_VIEWED`); handles are transient. Start with `snapback4 new my-social --template social`; see `guide social` and `guide ephemeral`.
