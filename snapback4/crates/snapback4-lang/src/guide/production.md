# Production: a persona demo becomes an account app

The minimal production bar is identity plus one trusted seat writer per root table that accounts cannot bootstrap. Use real principals and persisted sessions; signup grants no role.

```quarry
use identity password
table labels:
  slug: text 1..40
  unique slug
  cap 100
  immutable slug
  public 'labels are visible to signed-in accounts'
  insert <- viewer = 'service:ops'
  online only
mutation provisionLabel(slug: text 1..40):
  require viewer = 'service:ops' else NOT_OPERATOR
  return insert labels {slug}
```
Profiles and teams below are optional application policy. Prove writes, outsiders and durable restart. Mint `token --service ops --release ./deployment` while serve runs, then call `/m/provisionLabel` with its bearer. No production seed door is needed. Add a root's service read branch when its writer probes existing rows. Every mutation still passes table rules (`guide deploy`).

A persona demo becomes a password-account app with self-written profiles,
a private staff directory and trusted membership enrollment. This policy is
explicit because directory privacy and enrollment authority are application decisions.

```tsx
import { useState } from "react";
import { createApp } from "snapback4/app";
import { webDevice } from "snapback4/web";
import { localStorageSessionStore } from "snapback4/auth";
import { AppProvider, useAuth, useMutation, sentResult } from "snapback4/react";
import { api } from "../snapback/generated/api";
const app=createApp({url:"http://127.0.0.1:4400",device:webDevice(),sessionStore:localStorageSessionStore()});
export function ProductionApp(){return <AppProvider app={app}><Gate /></AppProvider>;}
function Gate() {
  const auth=useAuth();
  if(auth.state==="restoring")return <p>Restoring…</p>;
  if(auth.state==="signed-out")return <PasswordForm />;
  return <AccountScreen />;
}
function PasswordForm(){
  const auth=useAuth(),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[why,setWhy]=useState("");
  async function submit(signup:boolean){const result=await(signup?auth.signup(email,password):auth.login(email,password));if(!result.ok)setWhy(result.why.message);}
  return <form onSubmit={e=>{e.preventDefault();void submit(false);}}>
    <input aria-label="Email" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/>
    <input aria-label="Password" type="password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)}/>
    <button>Sign in</button><button type="button" onClick={()=>void submit(true)}>Sign up</button>
    {why&&<p role="alert">{why}</p>}</form>;
}
function AccountScreen(){
  const auth=useAuth(),save=useMutation(api.register),[name,setName]=useState("");
  async function submit(){const displayName=name.trim();if(!displayName||displayName.length>80)return;const write=await save.run({displayName});if(sentResult(write)!==undefined)setName(current=>current.trim()===displayName?"":current);}
  return <><p>Account {auth.viewer}</p><input aria-label="Display name" value={name} onChange={e=>setName(e.target.value)}/>
    <button disabled={save.inFlight} onClick={()=>void submit()}>Save profile</button>
    {save.last?.state==="failed"&&<p role="alert">{save.last.why.message}</p>}
    <button onClick={()=>void auth.logout()}>Sign out</button></>;
}
```

## Password UI and auth transitions

Replace `?as=alice`, `usePersonaApp` and fixed `dev:` owners with `createApp`
using a persisted session store (`guide client`, password React/Expo). Change
`use identity` to `use identity password` and retain `use personas` only for
development tests. Production principals come from signup/login, not names.
`init --adapt` previews starter files; keep business schemas and apply this
policy explicitly. This card supplies the full transition without guessing
an app's directory and enrollment policy.

`AppProvider` remounts children on every auth-state transition. A draft inside
PasswordForm is intentionally reset by signup/login/logout; store a mode choice
or unsent work above the provider if it must survive. `useSignedInViewer()` is
for a signed-in AccountScreen; `restoring` is not a signed-in viewer. The browser setup above persists sessions; on Expo replace webDevice with
nativeDevice and use SecureStore (`guide client`). Never keep credentials in an account directory.

## Profiles, private pickers, roles and linked memberships

This whole schema compiles. Each account writes its own display profile.
An operator enrolls staff and members. A staff directory exposes display names
and principals only to staff, not every account; a picker for a team narrows to
that team's members. Do not offer an unrestricted principal picker. Profiles
and membership creation are linked in `register`/`enroll`; enrollment first
requires a real profile, so opaque ids are not silently invented.

```quarry
use identity password

table staff:
  principal: principal
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:ops'
  insert <- viewer = 'service:ops' or exists staff[viewer]
  sync
table profiles:
  principal: principal
  displayName: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists staff[viewer] or viewer = 'service:ops'
  insert <- .principal = viewer
  update <- .principal = viewer
  online only
table catalogues:
  slug: text 1..80
  label: text 1..80
  unique slug
  cap 100
  immutable slug
  public 'catalogue labels are visible to signed-in accounts'
  insert <- viewer = 'service:ops'
  update <- viewer = 'service:ops'
  online only
table teams:
  name: text 1..80
  read <- exists members[.id, viewer] or exists staff[viewer] or viewer = 'service:ops'
  insert <- exists staff[viewer] or viewer = 'service:ops'
  online only
table members:
  team: teams
  principal: principal
  unique team, principal
  immutable team, principal
  read <- exists members[.team, viewer] or exists staff[viewer] or viewer = 'service:ops'
  insert <- exists staff[viewer] or viewer = 'service:ops'
  online only
mutation register(displayName: text 1..80):
  return upsert profiles[principal = viewer] { displayName }
mutation grantStaff(principal: principal):
  require viewer = 'service:ops' else NOT_OPERATOR
  p = profiles[principal = principal] ! else NO_PROFILE
  return insert staff { principal: p.principal }
mutation provisionCatalogue(slug: text 1..80, label: text 1..80):
  require viewer = 'service:ops' else NOT_OPERATOR
  return upsert catalogues[slug = slug] { label }
mutation createTeam(name: text 1..80):
  require exists staff[viewer] or viewer = 'service:ops' else NOT_STAFF
  return insert teams { name }
mutation enroll(team: teams, principal: principal):
  require exists staff[viewer] or viewer = 'service:ops' else NOT_STAFF
  t = teams[team] ! else NOT_FOUND
  p = profiles[principal = principal] ! else NO_PROFILE
  return insert members { team: t.id, principal: p.principal }
query directory(c: cursor ?):
  require exists staff[viewer] else NOT_STAFF
  return profiles first 20 by .id after c { principal, displayName }
query teammates(team: teams, c: cursor ?):
  require exists members[team, viewer] or exists staff[viewer] else NOT_MEMBER
  return members where .team = team first 20 by .id after c { principal }
query catalogue(c: cursor ?):
  return catalogues first 20 by .id after c
query myProfile():
  return profiles[principal = viewer]
```

A staff picker uses the authorized directory; a failed read produces a refusal,
not an unrestricted fallback list. Mount this inside the signed-in screen:

```tsx
import { readPresentation, usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function StaffPicker({onPick}:{onPick:(principal:string)=>void}) {
  const page=usePage(api.directory,{}),status=readPresentation(page.read);
  return <>{status.why&&<p role="alert">{status.why.message}</p>}
    {status.incomplete&&<p>More accounts may exist</p>}
    <select aria-label="Account" defaultValue="" onChange={e=>onPick(e.target.value)}>
      <option value="" disabled>Choose an account</option>
      {page.items.map(p=><option key={p.principal} value={p.principal}>{p.displayName}</option>)}
    </select><button disabled={!page.hasMore} onClick={page.loadMore}>More</button></>;
}
```

The teammate query above lists only principals; resolve names through a separately
authorized profile read. This policy does not make all teammates' profiles
readable. Either let staff choose by the directory, or materialise a minimal
team directory with the team's read rule. Keep emails and private profile fields
in a separate self-readable table. For a group-synced app, staff's independent
cross-group grant cannot form a second group audience: enroll staff in each
team roster or stay online. `guide rule-recipes` covers copied audiences and
one-group limits. Wait for scope acquisition before treating an offline
membership or page as complete.

## Invitation UI by shared principal

Replace a persona-name picker with two signed-in controls: each account shares its own opaque principal, and authorized staff paste it into `enroll`. Sharing an id grants no authority; the server checks staff, team and profile. This recipe directly enrolls the invited account, without an acceptance step. For accept/revoke invitations into hidden groups, see `guide rule-recipes`.

```tsx
import { useState } from "react";
import { useAuth, useMutation } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function SharePrincipal() {
  const auth = useAuth();
  if (auth.state !== "signed-in") return null;
  return <label>Share your account id<input readOnly value={auth.viewer} onFocus={e => e.currentTarget.select()} /></label>;
}
export function InviteAccount({team}: {team: string}) {
  const invite = useMutation(api.enroll), [principal, setPrincipal] = useState("");
  async function submit() {
    const sent = principal.trim(); if (!sent) return;
    const result = await invite.run({team, principal: sent});
    if (result.state === "sent") setPrincipal(current => current.trim() === sent ? "" : current);
  }
  return <form onSubmit={e => {e.preventDefault(); void submit();}}>
    <input aria-label="Invited account id" required value={principal} onChange={e => setPrincipal(e.target.value)} />
    <button disabled={invite.inFlight}>Invite account</button>
    {invite.last?.state === "failed" && <p role="alert">{invite.last.why.message}</p>}
  </form>;
}
```
Mount InviteAccount only behind a role read, such as `myStaff(): return staff[principal = viewer]` (add that query to the schema above). `absent` on a list can be an authorised empty result; it does not prove staff membership. Handle NOT_STAFF/NO_PROFILE even when the button was enabled. Sign up and register before sharing a principal. Seeded persona names never become production ids.

## New-app bootstrap for catalogues and first seats

Write the schema above first, then run `init --web` (or `--expo`); identity
is read from the schema. Apps with no sync use `init --web --online`.
Declare `use identity`, `use identity password`, or `use identity guests` once
for the whole project; repeating it is refused rather than replacing the active
methods.
An existing persona app runs `init --adapt --web` after adding password identity.
Signup is not staff enrollment. The first
account signs up and calls `register`, then the local operator:

```sh
npx snapback4 check
npx snapback4 deploy ./deployment
npx snapback4 serve ./deployment --port 4400
npx snapback4 token --service ops --release ./deployment
# Keep the token private; send it as Authorization: Bearer <token>.
# POST /m/grantStaff {"args":{"principal":"user:REAL_SIGNUP_ID"}}
# POST /m/provisionCatalogue {"args":{"slug":"standard","label":"Standard"}}
# POST /m/createTeam {"args":{"name":"Production"}}
# POST /m/enroll {"args":{"team":"RETURNED_TEAM_ID","principal":"user:REAL_SIGNUP_ID"}}
```

Never seed a deployed store. The compiled `provisionCatalogue` path writes catalogue labels through the seat;
call it after deploy. Add application-specific catalogue fields deliberately. Every write, including seat writes,
passes each table's own insert/update rule. A seat's `exists` and lookups obey
read rules; give it an explicit read branch on what it must probe. The synced
staff roster permits a whole service insert branch, without adding a service
device audience (`guide deploy`, first admin).

## Real-account and rollback acceptance

Remove guest-only smoke helpers (`client.guest()` and `/auth/guest`); password
identity deliberately refuses them. Adapt proofs to signup/login; keep persona
fixtures only in development tests. On a fresh durable deployment:

1. Signup two accounts through `/auth/signup`; keep each returned principal and
   token separately. Register each profile. Restart serve and login again;
   persisted sessions and profiles survive.
2. Before enrollment, the account's `directory` refuses NOT_STAFF. The seat
   grants only the intended staff account, creates a team and enrolls both.
3. Staff sees both names; an ordinary member cannot enumerate the directory;
   an outsider cannot read teammates. A forged enrollment fails. Confirm
   account writes and sign-out, then revocation (`guide services`).
4. Save v1 source, deploy v2 with an optional profile field, run account writes,
   and `rollback ./deployment --to 1 --check`. Roll back and assert v1
   myProfile still returns displayName with the same bearer. A v2-only
   operation must answer E_OP; incompatible row writes must refuse. Forward
   with `rollback --to latest` and assert v2 values restore.

The tested schema above covers enrollment, directory privacy and linked rows.
Run this HTTP acceptance against your actual app's fields as well; storage
rollback does not restore safeguards absent from old business logic. Detailed
proof process helpers are `guide testing`; release narration is `guide changes`.
