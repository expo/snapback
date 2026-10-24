# Client: answers stay on screen

**Start here:** `useQueryData`/`useQueryResult` ([short screens](CLIENT-AND-OPERATIONS.md#short-screens)); metadata: `useQuery`/`usePage`; `useFollowing` (`guide feeds`); lists: `ReadState`.

```tsx
import { matchRead, readPresentation, usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function Inbox() { const page = usePage(api.inboxCards, {}), status = readPresentation(page.read); return <>{matchRead(page.read, { loading: () => "Loading…", denied: why => why.message,
    absent: () => "No conversations", partial: () => "Partial results", present: rows => `${rows.length} conversations` })}
    {status.incomplete && "Results may be incomplete"}{page.items.map(row => <p key={row.id}>{row.title} ({row.memberCount})</p>)}<button disabled={!page.hasMore} onClick={page.loadMore}>More</button></>;
}
```

- `E_OFFLINE`: unavailable; reconnect.
- `E_QUERY_RETRY`: exhausted; retry.

## Reference

Proofs/exports use `exhaustPages` from `snapback4/proof`; screens use `usePage`.
- Treat the cursor as opaque: pass each reply's `next` back unchanged.
- Projection changes row fields only, never page order, completeness or cursor meaning.
- Every accepted page says `complete:true`, `cut:null` and nonpartial existence. The helper refuses denied, loading, malformed, repeated, capped, incomplete, partial or over-limit pages rather than returning a partial snapshot.
`Write`: pending custody, fresh sent result, replay without result, or failed. Clear on sentResult; undefined is not success.
```tsx
import { useState } from "react"; import { matchRead, sentResult, useAppReady, useMutation, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function Composer({conversationId}:{conversationId:string}) {
  const [draft,setDraft]=useState(""),[submitted,setSubmitted]=useState("");
  const ready=useAppReady(),send=useMutation(api.send),member=useQuery(api.myMembership,{conversationId});
  const blocked=matchRead(member,{denied:()=>true,absent:read=>read.fresh&&!read.revalidating,partial:()=>false,otherwise:()=>false});
  async function submit(){const text=draft.trim();if(!ready||blocked||!text||text.length>2000)return;setSubmitted(text);const write=await send.run({conversationId,body:text});if(sentResult(write)!==undefined)setDraft(current=>current.trim()===text?"":current);}
  return <><input value={draft} onChange={e=>setDraft(e.target.value)}/>
    <button disabled={!ready||send.inFlight||blocked} onClick={()=>void submit()}>Send</button>
    {send.last?.state==="failed"&&submitted&&<p role="alert">Not sent: {submitted} <button onClick={()=>setDraft(current=>current?current+" "+submitted:submitted)}>Edit</button> <button onClick={()=>setSubmitted("")}>Dismiss</button></p>}</>;
}
```
Membership has no horizon: the conversation's own group and messages' audience prove existence unless a pending prediction blocks absence. `loading` means acquisition or later withdrawal. Fresh, non-revalidating `existence(member) === "absent"` blocks; denied blocks. Never add `with own keys` to admin-written memberships. `waitSeconds:0` returns custody; retain its id, never auto-resend. Drafts/receipts: [reference](CLIENT-AND-OPERATIONS.md).

## An online role form across releases
Own createApp({url,writes:"online",sessionStore:localStorageSessionStore()}) outside render under AppProvider.
```tsx
import { useEffect, useState } from "react"; import { isPresent, matchReadList, sentResult, useAppReady, useMutation, useQuery, useRelease } from "snapback4/react"; import { api } from "../snapback/generated/api";
export function StaffWorkspace({team}: {team: string}) {
  const [draft, setDraft] = useState(""), [selected, setSelected] = useState("");
  const ready = useAppReady(), release = useRelease(), role = useQuery(api.myRole, {team});
  const [lastStaff, setLastStaff] = useState(false);
  const staff = api.myRole.available(release) && isPresent(role) && role.complete && role.fresh && !role.revalidating && role.data.role === "staff", uncertain = "loading" in role || ("data" in role && (role.existence === "partial" || !role.complete || !role.fresh || role.revalidating === true));
  useEffect(() => { if (!uncertain) setLastStaff(staff); }, [uncertain, staff]);
  const shell = uncertain ? lastStaff : staff;
  const available = api.addStaffNote.available(release) && api.staffNotes.available(release), add = useMutation(api.addStaffNote);
  async function submit() {const title = draft.trim(); if (!ready || !staff || !available || !title || !selected) return;
    const write = await add.run({team, title, category:selected}); if (sentResult(write) !== undefined) setDraft(current => current === draft ? "" : current);}
  return <section aria-label="Staff workspace"><p>{shell ? "Staff workspace" : "Staff access required"}</p>
    <label>Note<input value={draft} onChange={e => setDraft(e.target.value)} /></label>
    <label htmlFor="category">Category</label><select id="category" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose</option><option value="general">General</option></select>
    <button disabled={!ready || !staff || !available || add.inFlight} onClick={() => void submit()}>Save note</button>
    {staff && available ? <StaffRows team={team} /> : <p>{"denied" in role || "denied" in release || ("generation" in release && !available) || (!uncertain && !staff) ? "Staff workspace not available" : "Waiting for staff capabilities"}</p>}
    {add.last?.state === "failed" && <p role="alert">{add.last.why.message}</p>}
  </section>;
}
function StaffRows({team}: {team:string}) {
  const rows = useQuery(api.staffNotes, {team}); return <>{matchReadList(rows, {denied: why => <p role="alert">{why.message}</p>, absent: () => <p>No notes</p>,
    present: notes => <ul>{notes.map(row => <li key={row.id}>{row.title} — {row.priority ?? "normal"}</li>)}</ul>,
    otherwise: () => <p>Updating notes…</p>})}</>;
}
```
Mount `<StaffWorkspace key={team} team={team}/>` to preserve drafts. Gate reads/Save on settled role/operation availability; rules decide authority. Use fallbacks such as `row.priority ?? "normal"`.

## A public guest page

Guests (`use identity`/`use identity guests`): public reads require browser session custody.
```tsx
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { AppProvider, matchReadList, useAuth, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
const guestApp = createApp({url:"http://127.0.0.1:4400", readOnly:true, sessionStore:localStorageSessionStore()});
export function GuestPage() { return <AppProvider app={guestApp}><GuestGate /></AppProvider>; }
function GuestGate() {
  const auth = useAuth();
  if (auth.state === "restoring") return <p>Restoring…</p>;
  if (auth.state === "signed-out") return <><button onClick={() => void auth.guest()}>Continue as a guest</button><p role="alert">{auth.why?.message}</p></>;
  return <PublicNotes />;
}
function PublicNotes() {
  const notes = useQuery(api.publicNotes, {});
  return <>{matchReadList(notes, {denied: why => <p role="alert">{why.message}</p>, absent: () => <p>No public notes</p>,
    present: rows => <ul>{rows.map(row => <li key={row.id}>{row.title}</li>)}</ul>, otherwise: () => <p>Loading…</p>})}</>;
}
```

## React hooks and auth decisions

Never gate sign-in with `useAppReady()`: it needs a signed-in client; sign-out/replacement resets it. Keep drafts above gates; readiness is not authority. Invalid online/device/readOnly combinations set `useAuth().why` and fail app.ready; recreate corrected. Storage failures throw `E_ADMISSION`.
`useAuth()`: `state`/`viewer`/`why`, `signup`/`login`/`guest`/`logout`/`logoutEverywhere`; client `signOut()`; Expo secureStoreSessionStore(SecureStore). Password/custody: [reference](CLIENT-AND-OPERATIONS.md#password-react-and-expo). E_SESSION names invalid fields. Online tokens return no session and refresh explicitly; automatic refresh/devices need complete Sessions.

| Helper | Input/result | Handlers/arguments |
| --- | --- | --- |
| `matchRead(read, handlers)` | Read or page; handler result | `loading(read)`, `denied(why,read)`, `absent(read)`, `partial(data,read)`, `present(data,read)`. Bare `why: Refusal`; data first, metadata second. All five required, even partial on single rows; `otherwise(read)` replaces omitted loading/absent/present only. |
| `matchReadList(read, handlers)` | List read or page | Requires `denied(why,read)` and `otherwise(read)`; omitted partial uses otherwise. |
| `otherwiseAll(fallback, overrides?)` | Spread into matchRead handlers | `fallback(read)` includes denied/partial; named handlers win in any order. |
| `usePage(op, args)` | Query with `c: cursor ?`; omit c from args | `{read, items, hasMore, loadMore}`; match page.read/page, render items, call loadMore(). No handlers. |

`'data' in read` exposes data/existence/metadata. Complete empty lists are absent. `isPresent` excludes null; `isReady` permits it; `existence(read)` and `read.existence` classify. `absent` can be an authorised empty list. PDFs need `doc: file <=10000000 ?`; persist uploaded ids through mutations (`guide assets`).
```ts
import type { Read, Client } from "snapback4/contract";
export function listLabel(read: Read<readonly {id:string}[]>): string {
  if ('denied' in read) return "not available"; if ('data' in read) return read.existence === "absent" ? "No rows" : `${read.data.length} rows`; return "Loading…"; }
export async function uploadPdf(client: Client, picked: File) { return client.upload(picked, {file: {type: "application/pdf", name: picked.name}}); }
```
`loading`: keep shells; `denied`: show refusal; `present`: render; `absent`: proven empty; `partial`: uncertain. Offline absent is absence at the acquired watermark. Hidden/missing rows are indistinguishable. `readPresentation` notices never grant permission. Unknown counts never hide conversations. `predicts`: eligible/device/held facts may render `pending:true` before `useMutation().run()` settles; others queue without rows. Never/online follows settlement/delivery. run() waits for sent/failed; `{waitSeconds:0}` returns custody. Proofs await fresh sent; predictions aren't settlement.
`query(op,args)` settles ready/denied within 30 seconds. Unavailable offline reads give immediate `E_OFFLINE`. After four rounds, exhaustion refuses retryable `E_QUERY_RETRY`; permanently unavailable held reads refuse non-retryable `E_QUERY_HELD`. Retention, RowOf/ArgsOf/ResultOf and {skip}: [reference](CLIENT-AND-OPERATIONS.md). Share/paginate: eight active, eight queued observation attempts; direct queries and timed presence refreshes use separate paths.
Browser: no sync → journal; sync → webDevice(); online writes: writes:"online". Native: nativeDevice. Every milestone: npm run export:ios; check proof in the background with witness status --wait. Rebuild: npm run native:smoke. Reopen/reconnect/write replay: guide witness. useOnline: server reads/ephemeral/actions; app.mutate: durable writes. SDK owns delivery reporting; screen owns visible `seen` reporting; useSeen retries (guide receipts). Proofs: await fresh sent/rendering; avoid networkidle (guide testing).
Keyed counts: hidden key → null; authorized missing count group → 0; public → number. Choose count ?? 0.
