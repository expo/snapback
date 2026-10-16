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
`Write<R>`: pending `{id}`; fresh sent `{id,seq,result:R}`; replayed sent `{id,seq,replayed:true}` without result; failed `{id,why}`. Only failed has `why`. `sentResult(write)` extracts a fresh result; undefined means pending/failed/replayed, not success.
```tsx
import { useState } from "react"; import { matchRead, sentResult, useMutation, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function Composer({conversationId}:{conversationId:string}) {
  const [draft,setDraft]=useState(""),[submitted,setSubmitted]=useState("");
  const send=useMutation(api.send),member=useQuery(api.myMembership,{conversationId});
  const blocked=matchRead(member,{denied:()=>true,absent:read=>read.fresh&&!read.revalidating,partial:()=>false,otherwise:()=>false});
  async function submit(){const text=draft.trim();if(blocked||!text||text.length>2000)return;setSubmitted(text);const write=await send.run({conversationId,body:text});if(sentResult(write)!==undefined)setDraft(current=>current.trim()===text?"":current);}
  return <><input value={draft} onChange={e=>setDraft(e.target.value)}/>
    <button disabled={send.inFlight||blocked} onClick={()=>void submit()}>Send</button>
    {send.last?.state==="failed"&&submitted&&<p role="alert">Not sent: {submitted} <button onClick={()=>setDraft(current=>current?current+" "+submitted:submitted)}>Edit</button> <button onClick={()=>setSubmitted("")}>Dismiss</button></p>}</>;
}
```
Validate; clear drafts only on fresh sent. Pending/replayed keep them. Notices grant no permission. Keep composers above reactive rows; [full screen](CLIENT-AND-OPERATIONS.md#a-stable-conversation-screen).
Membership: no horizon, the conversation's own group and messages' audience prove presence/absence unless a pending prediction blocks absence. `loading` means acquisition or later withdrawal. Never add `with own keys` to admin-written memberships.
`denied` always blocks. `existence(member) === "absent"` blocks only when fresh and non-revalidating. Stale absence queues; `loading`/`partial` never disable.

`waitSeconds: 0` returns at custody; `inFlight` covers admission, ungated by acquisition after session readiness. `usePendingWrites()` lists admitted intents; keep drafts before custody. Predictions: “Sending…”. Persist `{id: mintId(), args}` per account/backend before `run(args, { id, waitSeconds: 0 })`. `usePendingWrite`: “Saving…” during submission, “Checking…” while `restoring`; afterward undefined means unknown. Never auto-resend. Dismiss after lookup. New attempts: new ids; replay omits historical results. Web/Expo starters journal this.

Pending composition: usePendingItems/usePendingState; [reference](CLIENT-AND-OPERATIONS.md).

## Read boundaries
`query(op,args)` settles ready/denied within 30 seconds. Dependent writes settle or have complete device predictions; unrelated writes pass. Unavailable offline reads give immediate `E_OFFLINE`. After four rounds, exhaustion refuses retryable `E_QUERY_RETRY`; permanently unavailable held reads refuse non-retryable `E_QUERY_HELD`. `useRelease()` exposes served capabilities; availability is not authority (`guide deploy`).

## Password React and Expo

Beside the persona form (`guide personas`), use this for `use identity password`:
```tsx
import { useState } from "react";
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { AppProvider, useAuth } from "snapback4/react";
const app = createApp({ url: "http://127.0.0.1:4400", sessionStore: localStorageSessionStore() });
export function PasswordApp() { return <AppProvider app={app}><Password /></AppProvider>; }
function Password() {
  const auth = useAuth(), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [why, setWhy] = useState("");
  if (auth.state === "restoring") return <>Restoring…</>;
  if (auth.state === "signed-in") return <>Signed in as {auth.viewer}</>;
  const submit = async (signup: boolean) => { const r = await (signup ? auth.signup(email, password) : auth.login(email, password)); if (!r.ok) setWhy(r.why.message); };
  return <><input aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} /><input aria-label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
    <button onClick={() => void submit(false)}>Sign in</button><button onClick={() => void submit(true)}>Sign up</button>{why}</>;
}
```
Render editable sign-in controls only while `auth.state === "signed-out"`;
show Restoring… otherwise. AppProvider resets account-owned state when the app
or viewer changes. Restoring → signed-out has the same null viewer and preserves
state; entering/leaving an account resets drafts. `useAppReady()` becomes true
after this app's initial `app.ready` resolves ok and auth is signed-in. Gate
writers and proof input on it; readiness is neither connectivity nor permission.

Sign-in: {ok:true, session} or {ok:false, why}. useAuth exposes no session. Expo: secureStoreSessionStore(SecureStore); web: localStorageSessionStore. guide production.

`useAuth()` members: `state`, `viewer`, `why`, `signup(email, password)`, `login(email, password)`, `guest()`, `logout()`, `logoutEverywhere()`.
`signOut()` belongs to the client, not useAuth. Install `expo-secure-store` with `npx expo install expo-secure-store`, then:
```ts
import * as SecureStore from "expo-secure-store"; import { nativeDevice, secureStoreSessionStore } from "snapback4-expo"; import { createApp } from "snapback4/app";
const app = createApp({url: "http://127.0.0.1:4400", device: nativeDevice, sessionStore: secureStoreSessionStore(SecureStore)});
```
Storage failures propagate. Rebuild.

## React hooks
`matchRead(read, …)` (no type arguments; or a page) requires five states: `present(data, read)` excludes null; `partial(data, read)` keeps T; `denied(why, read)`; `absent(read)`/`loading(read)`. `otherwise(read)` covers omitted loading/absent/present; denied/partial stay explicit, or `...otherwiseAll(read => …)` anywhere takes all unnamed (named handlers win). A complete empty list is `absent`; `otherwiseAll` also takes `denied`.
`isPresent(read)` narrows to disclosed non-null data. `isReady(read)` includes
absent and partial, so its data can still be null. `existence(read)` classifies; `isReady(read)` enables `read.existence`; `void client.close()` in cleanup. Types/hooks: `RowOf`/`ResultOf`/`ArgsOf`/`UseQuery`/`UsePage`/`useSignedInViewer()`/`usePersonaApp`; `{ skip: !id }` waits for arguments; `[add, remove].find(isFailed)?.last.why`; helpers take `Outcome | undefined` or `Read<unknown>` ([form](CLIENT-AND-OPERATIONS.md#status-components-and-a-form)).

`loading`: keep shells mounted; `denied`: show refusal; `present`: render; `absent`: proven empty; `partial`: uncertain, never absence.

`null`/`[]` is empty; false/0/nested nulls are present. Empty is `absent` only with `complete`, `cut === null`, no `next`, and no admission or intersecting prediction. `fresh` never demotes; offline `absent` is absence at the acquired watermark. Hidden/missing rows are indistinguishable. Route on `present`/`absent`; follow `useAuth().state` (personas: `guide personas`). Reset drafts on account/backend change. Deletes, policy changes and unknown/older evidence start a nonrenewable one-second withdrawal bound; inserts, non-policy updates and revalidation retain through failures. Key/account/store/schema changes withdraw immediately. `keep: true` adds a 30-second subscriber-free linger; `keep: false` withdraws immediately. [Retention details](CLIENT-AND-OPERATIONS.md). Search: render `page.items`; `readPresentation(page.read)` supplies `pending` (loading), `incomplete` (partial/coverage/cut/continuation), `stale`, `revalidating`, `why?`, `since?`; never permission. Follow `hasMore`/`loadMore`. Unknown counts never hide conversations. [Expo screen](CLIENT-AND-OPERATIONS.md#a-stable-conversation-screen): backend/account/resource shell preserves drafts.

`app.online`/`useOnline()` (AppProvider): server query/observe, ephemeral mutate, act; no bearer/lifecycle; durable writes: app.mutate. `guide social`/`guide ephemeral`: snapshots/typing/quotes/bounded screens.

## Read props and outcomes

List props: `Read<T[]>` (`T extends { id: string }`); operation props: `UseQuery<typeof api.op>`. run() waits for sent/failed, including reconnect; keep App alive. waitSeconds: 0 returns custody. Pending is not success; null is a legitimate result.

List fallback: matchReadList(page.read, {denied: why => why.message, present: rows => rows.length, otherwise: () => "…"}) covers partial. matchRead keeps explicit denied/partial; otherwiseAll supplies unnamed handlers.

Keyed counts: hidden key → null; authorized missing count group → 0; public count → number. Choose `count ?? 0` explicitly. `useQuery` is live; after sent, `client.query(...)` reads once.

## Shared list and write props
```tsx
import { matchReadList, readPresentation, type PageHook, type WriteHook } from "snapback4/react";
export function SharedList<T extends {id: string}>({page, remove, label}: {page: PageHook<T[]>; remove: WriteHook<{id: string}, unknown>; label: (row: T) => string}) { const status = readPresentation(page.read); return <>{matchReadList(page.read, {denied: why => <p role="alert">{why.message}</p>,
    otherwise: () => <p>{status.incomplete ? "Incomplete results" : "Waiting or empty"}</p>,
    present: () => <ul>{page.items.map(row => <li key={row.id}>{label(row)}<button disabled={remove.inFlight} onClick={() => void remove.run({id: row.id})}>Remove</button></li>)}</ul>})}
    {status.incomplete && <p>More rows may exist</p>}{remove.last?.state === "failed" && <p role="alert">{remove.last.why.message}</p>}
    <button disabled={!page.hasMore} onClick={page.loadMore}>More</button></>; }
```
Pass usePage(api.list) and useMutation(api.remove). Match page.read, render page.items. `absent` can be an authorised empty list; query myMembership for roles. createClient takes generated handles (api.op), never names.

## Row queries
Share/paginate (`usePage` queries take `c: cursor ?` with `after c`); authorization remains dependent. Eight active; eight queued observation attempts; direct queries and timed presence refreshes use separate paths. `inspect(client)` and `useInspection(import.meta.env.DEV)` report pressure ([reference](CLIENT-AND-OPERATIONS.md#inspect-subscription-pressure)).

## Expo and acquisition
Browser: `createApp`; no sync → journal (personas too). Synced: `webDevice()`/writes: "online". Opening refusal preserves replay. Native: `nativeDevice`; Expo Go online; `guide sync`. Every milestone: `npm run export:ios`; proof in the background: `witness status --wait`. Rebuild: `npm run native:smoke`. Acquisition/offline reopen/reconnect/write replay: `guide witness`.

`readOnly: true` (`createClient`/online `createApp`, `guide read-only`): inactive `useSeen`, no SDK rotation. `refreshSession()`: `E_READ_ONLY_REFRESH`; `expiresAt`: `E_AUTH`.

## Receipts
`guide receipts`: `useSeen(api.receiptFamilies.chat, { scope, through, active })` owns retries. SDK owns delivery reporting; screen owns visible `seen` reporting. Supply visible confirmed positions; separate retained history/live decorations.

Once-media handles revoke on unmount ([recipe](CLIENT-AND-OPERATIONS.md)); offline media: [OFFLINE-UPLOADS.md](OFFLINE-UPLOADS.md).

## Browser proof
Never wait for `networkidle`: live queries hold a long poll. Use `domcontentloaded`, labelled controls, and this write's fresh `sent` receipt before rows; existing text proves nothing. Visible-form witness and RN-web notes: `guide testing`.


## An online role form across releases

Use `createApp({url, writes:"online", sessionStore:localStorageSessionStore()})`
for this online browser screen, inside AppProvider after sign-in. Query roles
from a readable roster, never infer them from an empty protected list. RULES3
owns roster authorization; DAY3 owns compatibility generation.

```tsx
import { useEffect, useState } from "react";
import { isPresent, matchReadList, sentResult, useAppReady, useMutation, useQuery, useRelease } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function StaffWorkspace({team}: {team: string}) {
  const ready = useAppReady(), release = useRelease();
  const role = useQuery(api.myRole, {team});
  // Own drafts and selection above every read, role and release gate.
  const [draft, setDraft] = useState(""), [selected, setSelected] = useState("");
  const [lastStaff, setLastStaff] = useState(false);
  const staff = isPresent(role) && role.data.role === "staff";
  const uncertain = "loading" in role || ("data" in role && role.existence === "partial");
  useEffect(() => { if (!uncertain) setLastStaff(staff); }, [uncertain, staff]);
  // Sticky shell only: held role never authorizes reads or writes.
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
Mount `<StaffWorkspace key={team} team={team}/>` so resource changes reset its
state too. Loading/generation changes retain input ownership and selections;
denied/absent roles close the gate, and unavailable operations never open.
Inputs stay mounted but Save is disabled without current role and capabilities.
The sticky role labels the shell only; protected rows withdraw during loading.
Server rules and mutation requires always decide permission.

A compatibility field marked "Since release N" can be undefined with an older
server, even after narrowing to present. At React's render boundary use
`row.priority ?? "normal"`; at an Exact property boundary pass the same normalized
value to a required text prop. Keep the optional generated type honest. Feature
gates use `operation.available(release)`, never field presence as permission.

## A public guest page

For a read-only visitor, the schema admits guests (`use identity` or
`use identity guests`) and its public query has a public read rule. No password
or device is needed; the browser still needs session custody.

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
