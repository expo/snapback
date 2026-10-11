# Client: answers stay on screen

**Start here:** `useQuery`/`usePage`, `matchRead`/`readPresentation`; composers/receipts above rows. `useFollowing` (`guide feeds`).

```tsx
import { matchRead, readPresentation, usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function Inbox() { const page = usePage(api.inboxCards, {}), status = readPresentation(page.read); return <>{matchRead(page.read, { loading: () => "Loading…", denied: why => why.message,
    absent: () => "No conversations", partial: () => "Partial results", present: rows => `${rows.length} conversations` })}
    {status.incomplete && "Results may be incomplete"}{page.items.map(row => <p key={row.id}>{row.title} ({row.memberCount})</p>)}<button disabled={!page.hasMore} onClick={page.loadMore}>More</button></>;
}
```

- `E_OFFLINE`: unavailable; reconnect.
- `E_QUERY_RETRY`: settlement exhausted; retry.

## Reference
```tsx
import { useState } from "react"; import { matchRead, useMutation, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function Composer({ conversationId }: { conversationId: string }) {
  const [draft, setDraft] = useState(""); const send = useMutation(api.send);
  const member = useQuery(api.myMembership, { conversationId });
  const blocked = matchRead(member, { denied: () => true, absent: read => read.fresh && !read.revalidating, partial: () => false, otherwise: () => false });
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
Membership: no horizon, the conversation's own group and messages' audience prove presence/absence unless a pending prediction blocks absence. `loading` means acquisition or later withdrawal. Never add `with own keys` to admin-written memberships.
`denied` always blocks. `existence(member) === "absent"` blocks only when fresh and non-revalidating. Stale absence queues; `loading`/`partial` never disable.

`waitSeconds: 0` returns at custody; `inFlight` covers admission, ungated by acquisition after session readiness. Identity I/O: 15s excluding prior admissions; `usePendingWrites()` says “not yet admitted”. Reload loses it. Resumes FIFO; `E_ADMISSION_STORE`/`E_ADMISSION_TIMEOUT` permit retry after repair without remounting.
Predictions: “Sending…”.
Persist `{id: mintId(), args}` per account/backend before `run(args, { id, waitSeconds: 0 })`. `usePendingWrite`: “Saving…” during submission, “Checking…” while `restoring`; afterward undefined means unknown. Never auto-resend. Dismiss after lookup. New attempts: new ids; replay omits historical results. Web/Expo starters journal this.

`usePendingItems({writes,rows,scope,rowKey,intentKey})`: mapped row/intent union through observed settlement. `usePendingState(op,{scope,current,read?,value})`: latest admitted intent. [Reference](CLIENT-AND-OPERATIONS.md); non-JS hosts: “The device reply”.

## Read boundaries
`query(op, args)` settles ready/denied within 30 seconds including queues/approval. Admitted dependent writes: observed/failed or in complete predicted device answers. Unrelated writes pass; unknown intersects. Custody awaits events; loading/races before/after waits: four rounds; exhaustion refuses retryable `E_QUERY_RETRY`; proven permanently unavailable held reads refuse non-retryable `E_QUERY_HELD`. Offline: permitted predictions/data or immediate `E_OFFLINE`, including blockers. Refusals win; partial/stale permitted.
`matchRead` (no type arguments) requires five states: `present(data, read)` excludes null; `partial(data, read)` keeps T; `denied(why, read)`; `absent(read)`/`loading(read)`. `otherwise(read)` covers omitted loading/absent/present; denied/partial stay explicit, or `...otherwiseAll(read => …)` takes all unnamed. `existence(read)` classifies; `isReady(read)` enables `read.existence`; `void client.close()` in cleanup.
Types/hooks: `RowOf`/`ResultOf`/`ArgsOf`/`UseQuery`/`UsePage`/`useSignedInViewer()`; `[add, remove].find(isFailed)?.last.why`; `Outcome` types status helpers ([lists/scalars](CLIENT-AND-OPERATIONS.md#lists-and-single-values-with-usequery)). [Personas](CLIENT-AND-OPERATIONS.md#personas-in-a-react-ui).

| Meaning | UI decision |
| --- | --- |
| `loading` | Withheld: keep composers/headers/routes mounted. |
| `denied` | Show refusal; disable durable action. |
| `present` | Render values; `incomplete` controls “Partial results”. |
| `absent` | Proven empty: resolve missing route/row. |
| `partial` | Uncertain empty, never absence or denial; `incomplete` controls “Partial results”. |

`null`/`[]` is empty; `false`/`0`/nested nulls are present. Empty is `absent` only with `complete`, `cut === null`, no `next`, and no admission or intersecting prediction. Unknown prediction footprints block every read; complete local execution narrows dependencies. `fresh` never demotes; offline `absent` is absence at the acquired watermark. Hidden/missing rows are indistinguishable.
Route on `present`/`absent`; follow `useAuth().state` (personas: `guide personas`). Reset drafts on account/backend change. Retention grants no authority.
Deletes, policy changes and unknown/older evidence start a nonrenewable one-second bound; inserts, non-policy updates and plain revalidation retain through failures. Local bounds exclude queueing; online bounds include it. Bounded failure/timeout withdraws. Scope loss withdraws dependent groups; older replicas await publication. `keep: true`: 30-second subscriber-free linger; `keep: false`: immediate withdrawal. Keys, deadlines, sign-out, credentials/store/schema/generation changes withdraw immediately.
Search: render `page.items`; `readPresentation(page.read)` supplies `pending` (loading), `incomplete` (partial/coverage/cut/continuation), `stale`, `revalidating`, `why?`, `since?`; never permission. Follow `hasMore`/`loadMore`. Unknown counts never hide conversations. [Expo screen](CLIENT-AND-OPERATIONS.md#a-stable-conversation-screen): backend/account/resource shell preserves drafts.

`app.online`/`useOnline()` (AppProvider): server query/observe, ephemeral mutate, act; no bearer/lifecycle; durable writes: app.mutate. `guide social`/`guide ephemeral`: snapshots/typing/quotes/bounded screens.

## Row queries
Share/paginate (`usePage` queries take `c: cursor ?` with `after c`); authorization remains dependent.
Eight active; eight queued observation attempts start/turn; direct queries and timed presence refreshes use separate paths. Local budgets pause while queued, never replenish. Online evidence overtakes ≤8 times; occupied slots can withdraw.

Server/composed scopes preserve unrelated rooms; unknown selectors withdraw table-wide.
Flashes: `inspect(client)` (`snapback4/inspection`): `queued`/`inFlight`, `revalidating`/`withdrawn`, `recentWithdrawals`. `change-timeout`: exhausted budget. `latency`: queue/attempt percentiles.
Overlay: `useInspection(import.meta.env.DEV)` (Expo: `useInspection(__DEV__)`). Disabled: null/no timer; enabled: 250-ms samples. No arguments/values.

## Expo and acquisition
Writing browser apps need `createApp`+`webDevice()`, online-only too: ~650 KB gzip wasm at sign-in, not first paint. `nativeDevice`; Expo Go online. Acquisition/Workers: `guide sync`.
Every milestone: `npm run export:ios`; proof in the background: `witness status --wait`. Rebuild: `npm run native:smoke`. Acquisition/offline reopen/reconnect/write replay: `guide witness`.

`readOnly: true` (`createClient`/online `createApp`, `guide read-only`): inactive `useSeen`, no SDK rotation. `refreshSession()`: `E_READ_ONLY_REFRESH`; `expiresAt`: `E_AUTH`.

## Receipts
`guide receipts`: `useSeen(api.receiptFamilies.chat, { scope, through, active })` owns retries. SDK owns delivery reporting; screen owns visible `seen` reporting. Supply visible confirmed positions; separate retained history/live decorations.

## One-view photos
Mount **above the list**; key: `JSON.stringify([backend, account, messageId, assetId])`. Open once; recycling/refetch preserves handles. Unmount/account change revokes late responses. Close on `absent`/denied/tombstone/changed-asset/deadline; deadlines run through loading.

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
`useAsset` revokes on unmount; once media cannot refetch (`E_ASSET_VIEWED`).
