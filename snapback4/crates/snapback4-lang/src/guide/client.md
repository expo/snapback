# Client: answers stay on screen

Render current reads: same-key observations keep their answer during revalidation.
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
After session readiness, no acquisition gate is needed. Identity I/O has 15 seconds, excluding prior admissions; `usePendingWrites()` says “not yet admitted”. Reload loses this call. Identification resumes ordinary admission in call order. `E_ADMISSION_STORE` or `E_ADMISSION_TIMEOUT` permits a new attempt after repair, without remounting.
Clear the field at submit; on refusal, restore it only if still empty, otherwise offer the saved text with Edit (append to a non-empty draft). Text typed meanwhile survives. Predicted rows carry `pending: true`: show “Sending…”.
For earlier sends and reload, save `{ id: mintId(), args }` in account-and-backend-scoped storage **before** `run(args, { id, waitSeconds: 0 })`.
Observe each saved id with `usePendingWrite(op, savedId)`; `failed` shows its refusal and saved text to edit. Show “Saving…” during submission and “Checking…” while `restoring` is true; only then is an `undefined` receipt unknown, never failed or automatically resent. Unknown and failed rows show the saved text; only settled lookups offer Dismiss.
A deliberate new attempt gets a new id; never mint one to recover a lost acknowledgement. A replay confirms execution without a historical result.
The reference saved-intent journal is in the starters: `snapback4 init --expo` / `--web`; it is not another outbox or resend loop.

## Honest read boundaries

A profile `useQuery` can gate a route: once ready, plain refetch, reconnect, a slow read, transport failure and retry exhaustion keep its answer marked `revalidating`, with no timeout. `usePage` likewise keeps history through peer sync, sends, settlements, edits and deletes; each completed read replaces the answer directly.
Local commits, acknowledged online mutations, durable and ephemeral `/changes`, and `/sync` publications keep the answer for at most one non-renewable second after the replacement attempt starts, then withdraw on failure or timeout. Immediate replica replacements never show `loading`. A notification remains pending until sync applies it. A whole server answer at its reported cut can replace the display sooner; older replica reads remain ineligible. Membership removal replaces rows with the denial or empty answer. `fresh: false` and `since` describe offline freshness; `revalidating` says a replacement is still needed.
Offline ephemeral answers keep their original row expiry. The default and `keep: true` share this policy; `true` also lingers for 30 seconds after the last subscriber. `keep: false` withdraws immediately. Key changes, deadlines, sign-out, credential, store and schema resets still withdraw. A reported program-generation change withdraws immediately, even with no changed tables; the old replica stays unavailable until adoption completes. Reset user-owned state on account/backend change. No identity latch or `keep: true` workaround is needed for refetch.
`usePage` returns `items: []` while page one is loading: show loading, not empty. Keep effects out of rows.
For search, use one ordinary query per scope through `usePage`, as the social
starter does. The replica client combines current server hits with retained
device hits online and searches acquired holdings offline. Render `page.items`;
the SDK accumulates generated source-row pages by identity. Show “Partial
results” only for a ready `page.read.complete === false`, not for stale rows
or a non-null continuation. Follow `page.hasMore` and `page.loadMore`.
While this device holds a predictable pending write to a table a query reads, that query asks no server; a write with an unknown predicted footprint blocks every query. Writes to unrelated tables do not hold it.
A withheld answer (a total/extremum over input past the horizon, a point read past it, or another speculative answer) stays `loading`; a local partial answer (`complete: false`, e.g. an order unlike the window's) stays partial. See `guide reads`, `snapback4 why <query>`.
Keep the main list locally complete and server-needing decorations separate. Unknown unread counts never hide the conversation. Unknown membership may queue a durable write for server authorization; only denial or current non-membership disables Send (`guide social`).

## Queries in rows

Per-row `useQuery` is supported. Equal query names and wire-equivalent arguments
share one live observation within the same retention policy. Object key order
does not create another observation; changing `keep` does.

For a large list, return fields in one paged query: in the 1,000-row point/page fixture, a list does one evaluation per relevant write; 1,000 distinct row observations do 1,000.
The pre-port Linux/Chromium wasm sample mounted the same 1,000 fields in 23 ms as one
list query versus 593 ms as per-row hooks (single run, not a timing guarantee).
Both do zero evaluations for a known unrelated table write. The client starts
at most eight queued observation attempts per event-loop turn, with at most eight
active; direct queries and timed presence refreshes use separate paths.
`keep: false` withdraws before a re-read is queued; retaining watches keep the answer marked `revalidating`.
Queue wait precedes a new change-evidence episode: its one-second bound starts when the attempt starts. Later queueing and retries never renew an existing deadline. Expiry and scope resets remain immediate.
Known unrelated writes also preserve remembered server answers for offline fallback.
A clock refresh preserves a newer answer whose own deadline is still in the future.
Dependencies include authorization inputs: a write can re-evaluate every row on the table even when only one id changed.

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

`inboxCards` is your application's query and fields. Keep server-needing
decorations separate when including them would withhold the main list.

## Expo and cold acquisition

For iOS/Android, `snapback4 new my-social --template social` uses `createApp` with `nativeDevice` from `snapback4-expo` in native builds, `webDevice()` on web, and the online tier in Expo Go; use `guide witness` for native proof.
Use `guide reads` for live propagation measurements; `guide sync` for Worker/default device choices, acquisition progress, measured timings and planning estimates, and the five-profile cold-acquisition recipe with offline reopening checks.

## Acknowledgements and receipts

Use `snapback4 guide receipts` for the schema, `delivered`/`seen` mutations and `useReceipts` hook; keep that recipe's server-owned progress and lifecycle together.
The SDK owns delivery reporting from acquired rows and accepted query manifests, even with no conversation mounted. The screen owns visible `seen` reporting; mount `useReceipts` for that screen, not background delivery observations.
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
