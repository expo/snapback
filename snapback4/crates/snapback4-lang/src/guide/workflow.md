# Workflow

Copy and rename this recipe.

## Roles/private fields: schema.q

Replace snapback/schema.q; remove unused .q files. Signup grants no role.

```quarry
use identity password

table roles:
  principal: principal
  role: enum('customer', 'intake', 'staff', 'director')
  staff: bool
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table requests:
  owner: principal
  title: text 1..120
  evidence: file <=5000000
  price: money USD read <- exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']
  openedAt: time
  dueAt: time
  deliveredAt: time ?
  status: enum('ordered', 'fitted', 'delivered', 'followup') default 'ordered'
  approvedBy: principal ? write <- exists roles[viewer, role = 'director']
  approvalReason: text <=500 default '' write <- exists roles[viewer, role = 'director']
  checked: bool default false
  overdue: bool default false
  immutable owner, title, evidence, price, openedAt, dueAt
  read <- .owner = viewer or exists roles[viewer, staff = true]
  insert <- exists roles[viewer, role = 'intake']
  update <- exists roles[viewer, staff = true]
  online only

mutation provision(principal: principal, role: enum('customer', 'intake', 'staff', 'director')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, staff: role != 'customer' }
fn nextYear(t: time):
  m = month(t)
  elapsed = t - monthStart(m)
  return min(monthStart(m + 12) + (elapsed / 1d) * 1d, monthStart(m + 13) - 1d) + elapsed % 1d
query myRole():
  return roles[viewer]
query board(c: cursor ?):
  if exists roles[viewer, staff = true]:
    return requests last 50 by .id after c
  return requests where .owner = viewer last 50 by .id after c
mutation openRequest(owner: principal, title: text 1..120, evidence: file <=5000000, price: money USD):
  return insert requests { owner, title, evidence, price, openedAt: now, dueAt: now + 30d }
mutation fit(request: requests):
  r = requests[request] ! else NOT_FOUND
  require r.status = 'ordered' else CLOSED
  update requests[request] { status: 'fitted' }
mutation deliver(request: requests):
  r = requests[request] ! else NOT_FOUND
  require now < r.dueAt else DEADLINE
  require r.status = 'fitted' else CLOSED
  update requests[request] { status: 'delivered', deliveredAt: now }
mutation checkUsage(request: requests):
  r = requests[request] ! else NOT_FOUND
  delivered = r.deliveredAt ! else NOT_DELIVERED
  require now < delivered + 30d else DEADLINE
  require r.status = 'delivered' else CLOSED
  update requests[request] { status: 'followup', checked: true }
mutation approve(request: requests, reason: text 1..500):
  require exists roles[viewer, role = 'director', staff = true] else NOT_DIRECTOR
  r = requests[request] ! else NOT_FOUND
  require now < r.dueAt else DEADLINE
  update requests[request] { approvedBy: viewer, approvalReason: reason }
job flagOverdue(periodStart: time, periodEnd: time):
  for r in requests where .dueAt < periodEnd by .dueAt:
    if not r.overdue and r.status = 'ordered':
      update requests[r.id] { overdue: true }
schedule overdueHourly every 1h: flagOverdue

invariant requests.read only .owner = viewer or exists roles[viewer, staff = true]
invariant requests.price read only exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']
```

Rules grant writes; require cannot. Hidden fields are omitted; price is cents.
If approval gates an action, require `r.approvedBy != null` there.

## Deadlines/jobs and nullable values

Deadlines use stored server events; guard before status despite sweep lateness.
30d is a duration. For exact UTC anniversary validity set dueAt: nextYear(now),
then guard against that immutable deadline. nextYear clamps leap day to February
28 at the same UTC time. Test such a deadline after 366d rather than 31d.

Nullable arithmetic: `at = r.deliveredAt ! else NOT_DELIVERED`, then `at + 30d`.
Nullable conditions: `(flag ?? false)`. Assert nullable times before comparing.
Inserts supply every required column without a default, including evidence/price.

## Uploads, live board and approval

Hooks from snapback4/react: usePage(api.board,{}) gives live items/read/loading/
why/hasMore/loadMore. useMutation(api.approve).run({request,reason}) returns sent
(committed) or failed (why). Keep auth/AppProvider; hooks go at component top level.

As the placing account, upload bytes with `{file:{type:'application/pdf'}}` for
valid PDF bytes; require result.ok, then pass `{evidence:{id:result.asset.id}}`.
Images: client.upload(imageBytes). Upload separately per column. Observe returns
getSnapshot/subscribe/close; close on cleanup. Signatures: guide api client.

## Acceptance: scripts/acceptance.mjs

seedUsers in scripts/staging.mjs is
`{roles:{customer:2,intake:2,staff:2,director:2},provision:{name:'provision'}}`.
Write scripts/acceptance.mjs and wire it into package.json, then `npm run verify`.
Optional matrix: `check --proof-scaffold`. Example assertions:

```js
import assert from 'node:assert/strict';
import { createClient } from 'snapback4/client';
import { api } from '../snapback/generated/api.ts';
import { waitForServer } from 'snapback4/proof';
import { startStaging } from './staging.mjs';
const host = await startStaging();
const clients = [];
try {
  const as = (role, n = 0) => {
    const c = createClient({url:host.url, session:host.sessions[role][n]});
    clients.push(c); return c;
  };
  const intake = as('intake'), staff = as('staff'), director = as('director');
  const customer = as('customer'), other = as('customer', 1);
  const guest = createClient({url:host.url}); clients.push(guest);
  const sent = w => { assert.equal(w.state,'sent',JSON.stringify(w)); return w.result; };
  const denied = w => assert.equal(w.state,'failed');
  const upload = await intake.upload(new TextEncoder().encode('proof report'),
    {file:{type:'text/plain'}});
  assert.ok(upload.ok);
  const row = sent(await intake.mutate(api.openRequest, {
    owner:host.sessions.customer[0].principal, title:'Proof request',
    evidence:{id:upload.asset.id}, price:1234
  }));
  const request = row.id;
  assert.ok((await intake.query(api.myRole,{})).data);
  const board = await staff.query(api.board,{});
  assert.ok(!('denied' in board)); assert.equal(board.complete,true);
  assert.ok(board.data.some(r => r.id === request && !('price' in r)));
  assert.equal((await customer.query(api.board,{})).data.length,1);
  assert.equal((await other.query(api.board,{})).data?.length ?? 0,0);
  denied(await staff.mutate(api.approve,{request,reason:'not authorized'}));
  denied(await guest.mutate(api.fit,{request}));
  sent(await director.mutate(api.approve,{request,reason:'Order received'}));
  const approved = (await director.query(api.board,{})).data[0];
  assert.equal(approved.approvedBy,host.sessions.director[0].principal);
  assert.equal(approved.approvalReason,'Order received');
  denied(await staff.mutate(api.checkUsage,{request}));
  const observed = staff.observe(api.board,{});
  try {
    sent(await staff.mutate(api.fit,{request}));
    await waitForServer(() => observed.getSnapshot(), r =>
      r.data?.some(x => x.id === request && x.status === 'fitted'));
  } finally { observed.close(); }
  sent(await staff.mutate(api.deliver,{request}));
  sent(await staff.mutate(api.checkUsage,{request}));
  await host.advance('31d');
  const late = await director.mutate(api.approve,{request,reason:'Too late'});
  denied(late); assert.equal(late.why.code,'DEADLINE');
  console.log('acceptance passed');
} finally { for (const c of clients) await c.close(); await host.stop(); }
```

Add boundaries/job catch-up; use valid args in refusal tests. Run twice.
Edit frontend proof assertions; keep build/cleanup. Run `npm run verify`.
Keep credentials private.
Args/hooks: `guide api generated`.
