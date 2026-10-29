# Workflow

Adapt this recipe.

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

Require cannot grant writes. Hidden fields are omitted; money is cents.
Require `r.approvedBy != null` when approval gates an action.

## Deadlines/jobs and nullable values

Guard deadlines despite sweep lateness; test nextYear after 366d (leap day clamps).
Bind `at = r.deliveredAt ! else NOT_DELIVERED` before `at + 30d`. Private fields
stay nullable after role guards; keep guards. `flag ?? false` needs spec intent.
Ordered existence:
`exists requests where .owner = viewer and .dueAt < now`.

## Uploads, live board and approval

SDK handler (src/on-write.ts); keep auth/AppProvider:

```ts
import { refusalOf, type Write } from 'snapback4/contract';
// Inside the component; setProblem is its state setter.
async function onWrite<R>(run: () => PromiseLike<Write<R>>) {
  setProblem('');
  try { const w = await run(); setProblem(refusalOf(w)?.message ?? ''); return w; }
  catch { setProblem('Check write status before retry.'); }
}
// void onWrite(() => approve.run({request, reason}));
```

Only sent is committed; pending is queued.
Upload per column as the placing account: client.upload(pdf,{file:{type:'application/pdf'}}).
Require ok; pass {evidence:{id:upload.asset.id}}. Close observers on cleanup.

## Acceptance: scripts/acceptance.mjs

seedUsers in scripts/staging.mjs is
`{roles:{customer:2,intake:2,staff:2,director:2},provision:{name:'provision'}}`.
