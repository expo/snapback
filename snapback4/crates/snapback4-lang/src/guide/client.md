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
- `E_QUERY_RETRY`: four rounds exhausted; retry the read.

## Reference
`Write`: pending custody, sent fresh result, sent replay without result, or failed with why. Clear only on sentResult; undefined is not success.
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
Membership: no horizon, the conversation's own group and messages' audience prove presence/absence unless a pending prediction blocks absence. `loading` means acquisition or later withdrawal. `existence(member) === "absent"` blocks only when fresh and non-revalidating; denied blocks; loading/partial never disable. Never add `with own keys` to admin-written memberships.
Keep drafts and receipts above rows; [write journal, password form and typed list props](CLIENT-AND-OPERATIONS.md). `waitSeconds:0` returns custody; keep the original id, never auto-resend.

## An online role form across releases
Create the app once outside render with createApp({url,writes:"online",sessionStore:localStorageSessionStore()}); mount this signed-in screen under AppProvider. RULES3 owns roster authorization; DAY3 owns compatibility generation.
```tsx
import { useEffect, useState } from "react";
import { isPresent, matchReadList, sentResult, useAppReady, useMutation, useQuery, useRelease } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function StaffWorkspace({team}: {team: string}) {
  const ready = useAppReady(), release = useRelease();
  const role = useQuery(api.myRole, {team});
  const [draft, setDraft] = useState(""), [selected, setSelected] = useState("");
  const [lastStaff, setLastStaff] = useState(false);
  const staff = isPresent(role) && role.data.role === "staff";
  const uncertain = "loading" in role || ("data" in role && role.existence === "partial");
  useEffect(() => { if (!uncertain) setLastStaff(staff); }, [uncertain, staff]);
  const shell = uncertain ? lastStaff : staff;
  const available = api.addStaffNote.available(release) && api.staffNotes.available(release);
  const add = useMutation(api.addStaffNote);
  async function submit() {
    const title = draft.trim();
    if (!ready || !staff || !available || !title || !selected) return;
    const write = await add.run({team, title, category:selected});
    if (sentResult(write) !== undefined) setDraft(current => current === draft ? "" : current);
  }
  return <section aria-label="Staff workspace"><p>{shell ? "Staff workspace" : "Staff access required"}</p>
    <label>Note<input value={draft} onChange={e => setDraft(e.target.value)} /></label>
    <label htmlFor="category">Category</label><select id="category" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose</option><option value="general">General</option></select>
    <button disabled={!ready || !staff || !available || add.inFlight} onClick={() => void submit()}>Save note</button>
    {staff && available ? <StaffRows team={team} /> : <p>Waiting for staff capabilities</p>}
    {add.last?.state === "failed" && <p role="alert">{add.last.why.message}</p>}
  </section>;
}
function StaffRows({team}: {team:string}) {
  const rows = useQuery(api.staffNotes, {team});
  return <>{matchReadList(rows, {denied: why => <p role="alert">{why.message}</p>, absent: () => <p>No notes</p>,
    present: notes => <ul>{notes.map(row => <li key={row.id}>{row.title} — {row.priority ?? "normal"}</li>)}</ul>,
    otherwise: () => <p>Updating notes…</p>})}</>;
}
```
Mount `<StaffWorkspace key={team} team={team}/>`: drafts/selections survive loading and generation changes, but resource/account/backend changes reset them. The sticky role labels the shell only; current role and availability gate reads/Save. Server rules still decide permission. A "Since release N" field stays optional: use `row.priority ?? "normal"` at React render and Exact required-property boundaries.

## A public guest page
The schema admits guests (`use identity`/`use identity guests`) and public reads. No device/password is needed; browser session custody is required.
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
Render editable sign-in controls only while signed-out, Restoring… otherwise. AppProvider resets on app/viewer changes; restoring → signed-out preserves the null-viewer form. `useAppReady()` waits for initial app.ready and current signed-in auth without an admission refusal; gate writers/proof input. Successful later sign-in recovers from initial failure. Readiness is neither connectivity nor permission; surface auth.why.
`useAuth()` members: `state`, `viewer`, `why`, `signup(email, password)`, `login(email, password)`, `guest()`, `logout()`, `logoutEverywhere()`. `signOut()` belongs to the client. Expo session store: secureStoreSessionStore(SecureStore); password form: [reference](CLIENT-AND-OPERATIONS.md#password-react-and-expo).
`matchRead` handlers: `loading(read)`, `denied(why,read)`, `absent(read)`, `partial(data,read)`, `present(data,read)`. `otherwise` covers omitted loading/absent/present; otherwiseAll also takes denied/partial. A complete empty list is absent; `absent` can be an authorised empty list. `matchReadList` handles lists; `isPresent(read)` excludes null, while `isReady(read)` still permits null; `existence(read)` and `read.existence` classify.
`loading`: keep shells; `denied`: show refusal; `present`: render; `absent`: proven empty; `partial`: uncertain. Offline absent is absence at the acquired watermark. Hidden/missing rows are indistinguishable. `readPresentation` notices never grant permission. Render page.items, follow hasMore/loadMore. Unknown counts never hide conversations.
`query(op,args)` settles ready/denied within 30 seconds. Unavailable offline reads give immediate `E_OFFLINE`. After four rounds, exhaustion refuses retryable `E_QUERY_RETRY`; permanently unavailable held reads refuse non-retryable `E_QUERY_HELD`. Retention, RowOf/ArgsOf/ResultOf and {skip}: [reference](CLIENT-AND-OPERATIONS.md). Share/paginate: eight active, eight queued observation attempts; direct queries and timed presence refreshes use separate paths.
Browser createApp: no sync → journal; sync → webDevice(); online writes: writes:"online". Native: nativeDevice; Expo Go online. Start: `npx snapback4 init --expo`, then `npm install` and `npx snapback4 check`. Adapter-first installs resolve React 19.2.3 / RN 0.86.3; init supplies app/scripts. Upgrade: `npx snapback4@latest upgrade` aligns Expo and installed Expo packages. Supported: Expo >=57.0.22 <58, core >=57.0.23 <58. Every milestone: npm run export:ios; proof in the background: witness status --wait. Rebuild npm run native:smoke. Acquisition/offline reopen/reconnect/write replay: guide witness.
useOnline: server reads/ephemeral/actions; durable writes: app.mutate. SDK owns delivery reporting; screen owns visible `seen` reporting. useSeen owns receipt retries (guide receipts). Read-only clients: guide read-only. Media: OFFLINE-UPLOADS.md. Never wait for networkidle; assert fresh sent before rendered output (guide testing).
Keyed counts: hidden key → null; authorized missing count group → 0; public count → number. Choose count ?? 0 explicitly.
