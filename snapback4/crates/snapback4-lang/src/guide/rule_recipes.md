# Rule recipes: audiences, disclosure and blind writers

These compiled recipes express roles, copied audiences, consent, publication, link enrollment and anonymity. Each makes the intended disclosure and write authority explicit, including the trade-offs of materialising a grant.

```quarry
use personas alice, bob, carol
table ownRuleRecords:
  owner: principal
  unique owner
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation ownRuleRecord():
  return insert ownRuleRecords { owner: viewer }
query ownRuleRecordBy(owner: principal):
  return ownRuleRecords[owner = owner]
```

## Composite role grants

```quarry
use personas alice, bob, carol

table roles:
  principal: principal
  role: enum('coordinator', 'commander')
  unique principal, role
  read <- .principal = viewer or exists roles[principal = viewer, role = 'commander']
  insert <- exists roles[principal = viewer, role = 'commander'] or viewer = 'service:ops'
  delete <- exists roles[principal = viewer, role = 'commander']
  online only

table incidents:
  owner: principal
  title: text 1..120
  immutable owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'commander']
  insert <- .owner = viewer
  update <- exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'commander']
  online only

query canCoordinate():
  return exists roles[principal = viewer, role = 'coordinator'] or exists roles[viewer, 'commander']

query canCommand():
  return exists roles[viewer, 'commander']

mutation grant(who: principal, role: enum('coordinator', 'commander')):
  require exists roles[viewer, 'commander'] or viewer = 'service:ops' else NOT_COMMANDER
  return insert roles { principal: who, role }
```


When one principal may hold several independent roles, make the pair unique. Every point probe then supplies both columns. A bare `exists roles[viewer]` is deliberately refused: under `unique principal, role` it names every role row for that principal, not one row. Prefer the named spelling in policy; the full positional spelling, such as `roles[viewer, 'commander']`, has the same meaning. Spell an “any staff role” grant as the `or` of the exact roles that grant it.

Seed the first commander or grant it through `service:ops`. A commander may also have a coordinator row; the pair constraint prevents only a duplicate of the same role. Test both grants separately:

```jsonl
{"as":"alice","op":"canCoordinate","args":{},"data":true,"label":"alice has the coordinator row"}
{"as":"alice","op":"canCommand","args":{},"data":true,"label":"alice also has the commander row"}
{"as":"bob","op":"canCoordinate","args":{},"data":true}
{"as":"bob","op":"canCommand","args":{},"data":false}
```

## Timed disclosure and timed writes
`not before .opensAt` is a server-enforced lower read lifetime. It withholds the row from reads, rule probes and sync until the server reaches the boundary; it does not authorize a write. Keep a write deadline as an explicit mutation `require`. Here submissions close independently, then their secrets become public for the half-open interval `[opensAt, expiresAt)`.

```quarry
use personas alice, bob

table events:
  host: principal
  submitUntil: time
  revealAt: time
  archiveAt: time
  immutable host, submitUntil, revealAt, archiveAt
  public 'event times are public'
  insert <- .host = viewer
  sync public last 500 by .id

table submissions:
  event: events
  author: principal
  opensAt: time
  expiresAt: time
  secret: text 1..2000
  by byOpening: opensAt
  by byExpiry: expiresAt
  immutable event, author, opensAt, expiresAt
  not before .opensAt
  expire at .expiresAt
  public 'submissions are public only during their read lifetime'
  insert <- .author = viewer and .opensAt = .event.revealAt and .expiresAt = .event.archiveAt
  sync public last 500 by .id

mutation submit(event: events, secret: text 1..2000):
  e = events[event] ! else NOT_FOUND
  require now < e.submitUntil else SUBMISSIONS_CLOSED
  return insert submissions { event, author: viewer, opensAt: e.revealAt, expiresAt: e.archiveAt, secret }

query revealed(c: cursor ?):
  return submissions last 50 by .id after c
```

A null opening on an optional `time ?` column means immediately readable; `expire at` remains the independent upper boundary. Natural server requests and sync publish due rows without an application job. A device timer may ask for a refresh, but device wall clocks and server-time estimates never unlock the secret, and no hidden opening is exposed as `nextExpiry`.

## A writer who cannot read the parent

A reference value does not itself read or validate its target. When a writer may create a child but must not read its parent, put the parent checks in the child's insert rule and insert without a program lookup. Rule probes see the target row for authorization even when a program lookup would return null. Here a recommender can write a letter for an application, while the student cannot write their own letter and cannot read any letter. A missing application and the student's own application both refuse `E_RULE`; neither is exposed by a preliminary `applications[id] !` lookup.

```quarry
use personas alice, bob, carol

table counselors:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only

table applications:
  student: principal
  college: text 1..80
  immutable student
  read <- .student = viewer or exists counselors[viewer]
  insert <- .student = viewer
  online only

table letters:
  application: applications
  author: principal
  body: text 1..2000
  immutable application, author
  read <- .author = viewer or exists counselors[viewer]
  insert <- .author = viewer and exists applications[.application] and not exists applications[.application, student = viewer]
  online only

mutation addLetter(application: applications, body: text 1..2000):
  return insert letters { application, author: viewer, body }

query lettersFor(application: applications, c: cursor ?):
  return letters where .application = application first 20 by .id after c
```

This form is for a blind writer. If the operation needs parent contents, that is a read and the parent must admit the caller. If existing children should follow a parent's changing audience, keep the child online and probe each live parent condition explicitly. If they should retain the audience chosen at creation, copy those audience columns onto the child, make the copies immutable, and check every copy against the parent in this same insert rule.

## Copied audiences

Unlike an RLS subquery, a synced rule describes an invertible delivery audience. Copy the parent's audience onto each child and verify the copies on insert. Immutable copies retain the audience chosen at creation; a parent transfer does not transfer these children. Use online live-parent probes when that is required.

```quarry
table folders:
  owner: principal
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  cap 100 by owner
  sync to .owner
table files:
  folder: folders
  owner: principal
  title: text 1..80
  immutable folder, owner
  read <- .owner = viewer
  insert <- .owner = viewer and exists folders[.folder, owner = .owner]
  cap 500 by owner
  sync to .owner
mutation addFolder():
  return insert folders { owner: viewer }
mutation addFile(folder: folders, title: text 1..80):
  f = folders[folder] ! else NOT_FOUND
  return insert files { folder, owner: f.owner, title }
query file(file: files):
  return files[file]
```

## Materialised access

A rule cannot scan "all participants consented". Store one grant after a mutation checks uniquely addressed consent rows, and delete it when consent is withdrawn. This two-person recipe makes those exact probes readable to the organizer; it deliberately reveals consent to that organizer. For an arbitrary population use an authorized maintained count and compare it with the expected population (`guide recipes`, booking); never scan partly readable consent rows.

```quarry
table agreements:
  owner: principal
  first: principal
  second: principal
  immutable owner, first, second
  read <- .owner = viewer or .first = viewer or .second = viewer
  insert <- .owner = viewer
  online only
table consents:
  agreement: agreements
  principal: principal
  unique agreement, principal
  immutable agreement, principal
  read <- .principal = viewer or exists agreements[.agreement, owner = viewer]
  insert <- .principal = viewer and (exists agreements[.agreement, first = viewer] or exists agreements[.agreement, second = viewer])
  delete <- .principal = viewer
  online only
table access:
  agreement: agreements
  principal: principal
  unique agreement, principal
  read <- .principal = viewer or exists agreements[.agreement, first = viewer] or exists agreements[.agreement, second = viewer]
  insert <- exists agreements[.agreement, owner = viewer]
  delete <- exists agreements[.agreement, first = viewer] or exists agreements[.agreement, second = viewer]
  online only
mutation consent(agreement: agreements):
  return insert consents { agreement, principal: viewer }
mutation open(agreement: agreements):
  a = agreements[agreement] ! else NOT_FOUND
  require a.owner = viewer else NOT_OWNER
  require exists consents[agreement, a.first] and exists consents[agreement, a.second] else CONSENT_NEEDED
  return insert access { agreement, principal: a.owner }
mutation withdraw(agreement: agreements):
  delete consents[agreement, viewer]
  a = agreements[agreement] ! else NOT_FOUND
  g = access[agreement, a.owner]
  if g != null:
    delete access[g.id]
query granted(agreement: agreements):
  return exists access[agreement, viewer]
```

Participants can read and delete the grant, so withdrawal atomically removes it. Every consent or participant change must maintain this grant in the same transaction; avoid separate grant repair jobs that leave a disclosure window.

## Copy on reveal: an event opens the payload

Keep the secret in a private table. An authorized event mutation copies it into an independently readable table in the same commit. Returning a shape that omits a secret is not a column read rule. The private lookup already requires the owner; an outsider gets NOT_FOUND. Reveal is durable; undoing the event flag does not retract an already copied payload. To retract it, delete the copy.

```quarry
table drafts:
  owner: principal
  body: text 1..200
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
table revealed:
  draft: drafts
  body: text 1..200
  unique draft
  public 'the author explicitly published this copy'
  insert <- exists drafts[.draft, owner = viewer]
  online only
mutation draft(body: text 1..200):
  return insert drafts { owner: viewer, body }
mutation reveal(draft: drafts):
  d = drafts[draft] ! else NOT_FOUND
  return insert revealed { draft, body: d.body }
query publication(publication: revealed):
  return revealed[publication]
```

For time instead of an event, use `not before .opensAt` and `expire at .endsAt` (the timed-disclosure recipe above); clocks stay out of read rules.

## Share links: token enrollment, then principal reads

The supported link grants an authenticated visitor a principal row. Possession of a high-entropy token authorizes enrollment; the resulting read rule uses the principal. Token rows are program-readable, but expose no listing operation or token row result. Generate secrets outside Quarry and provision them with a service seat. Hashing, leakage prevention and delivery of the link belong to the app. Revoking the token prevents new enrollment; revoke grant rows separately to remove existing readers. A query argument alone is not a capability grant.

```quarry
table documents:
  owner: principal
  body: text 1..200
  immutable owner
  read <- .owner = viewer or exists readers[.id, viewer] or viewer = 'service:ops'
  insert <- .owner = viewer
  online only
table tokens:
  secret: text 32..100
  document: documents
  unique secret
  immutable secret, document
  read <- allow
  insert <- viewer = 'service:ops'
  delete <- viewer = 'service:ops'
  online only
table readers:
  document: documents
  principal: principal
  unique document, principal
  immutable document, principal
  read <- .principal = viewer or viewer = 'service:ops'
  insert <- .principal = viewer
  delete <- viewer = 'service:ops'
  online only
mutation provisionLink(document: documents, secret: text 32..100):
  require viewer = 'service:ops' else NOT_OPERATOR
  d = documents[document] ! else NOT_FOUND
  return insert tokens { document: d.id, secret }
mutation revokeLink(secret: text 32..100):
  require viewer = 'service:ops' else NOT_OPERATOR
  t = tokens[secret = secret] ! else BAD_LINK
  delete tokens[t.id]
mutation revokeReader(document: documents, principal: principal):
  require viewer = 'service:ops' else NOT_OPERATOR
  delete readers[document, principal]
mutation claim(secret: text 32..100):
  t = tokens[secret = secret] ! else BAD_LINK
  return insert readers { document: t.document, principal: viewer }
query document(document: documents):
  return documents[document]
```

Do not publish a generic mutation accepting a document id and inserting a reader: that would bypass token enrollment. Mutations are the app's API; `insert <- .principal = viewer` alone does not prove token possession.

## Split-table anonymity

Private author attribution belongs in its own table; the published payload has no author field. Public replies and private audit rows are linked by id, so operators may still correlate them. This is application anonymity from other readers, not a claim about network logs or the store administrator.

```quarry
table responses:
  body: text 1..200
  public 'anonymous response bodies'
  insert <- allow
  online only
table attribution:
  response: responses
  principal: principal
  unique response
  immutable response, principal
  read <- .principal = viewer
  insert <- .principal = viewer and created responses[.response]
  online only
mutation respond(body: text 1..200):
  r = insert responses { body }
  insert attribution { response: r.id, principal: viewer }
  return r
query author(response: responses):
  return attribution[response = response]
query response(response: responses):
  return responses[response]
```

## Versioned media: mutable publication pointer

Keep the band's member roster, immutable version audience and media references separate. A publication pointer chooses the released version. Here subscribers may read only the current version; moving the pointer immediately removes the old version's read grant. Keep it online: a mutable publication condition is not an invertible sync audience. The owner retains draft access. Downloads also need the version row's read authority (`guide assets`).

```quarry
table bands:
  owner: principal
  immutable owner
  read <- .owner = viewer or exists fans[.id, viewer]
  insert <- .owner = viewer
  online only
table fans:
  band: bands
  principal: principal
  unique band, principal
  read <- .principal = viewer or exists bands[.band, owner = viewer]
  insert <- exists bands[.band, owner = viewer]
  online only
table versions:
  band: bands
  owner: principal
  title: text 1..80
  cover: image <=5000000 ?
  immutable band, owner
  read <- .owner = viewer or (exists fans[.band, viewer] and exists publications[version = .id])
  insert <- .owner = viewer and exists bands[.band, owner = viewer]
  online only
table publications:
  band: bands
  version: versions
  unique band
  unique version
  read <- exists bands[.band, owner = viewer] or exists fans[.band, viewer]
  insert <- exists bands[.band, owner = viewer] and exists versions[.version, band = .band]
  update <- exists bands[.band, owner = viewer] and exists versions[.version, band = .band]
  online only
mutation publish(band: bands, version: versions):
  return upsert publications[band = band] { version }
query version(version: versions):
  return versions[version]
```

## Mine, shared with my groups, and public

A public branch plus private audiences stays online. One live read rule admits owners, public entries and team members. Three complete cursor pages serve Mine/Public/Team tabs; keep their cursors separate and deduplicate ids if combining them in the UI. An owner may make an entry public deliberately. A synced variant splits public entries into a public table and keeps owner-or-one-team rows separately (`guide sharing`); a union may contain at most one group audience.

```quarry
use identity

table teams:
  owner: principal
  immutable owner
  read <- .owner = viewer or exists members[.id, viewer]
  insert <- .owner = viewer
  online only
table members:
  team: teams
  principal: principal
  unique team, principal
  immutable team, principal
  read <- .principal = viewer
  insert <- exists teams[.team, owner = viewer]
  online only
table library:
  owner: principal
  team: teams
  shared: bool default false
  title: text 1..80
  immutable owner, team
  read <- .owner = viewer or .shared = true or exists members[.team, viewer]
  insert <- .owner = viewer and exists teams[.team, owner = viewer]
  update <- .owner = viewer
  online only
query mine(c: cursor ?):
  return library where .owner = viewer first 20 by .id after c
query publicLibrary(c: cursor ?):
  return library where .shared = true first 20 by .id after c
query teamLibrary(team: teams, c: cursor ?):
  require exists members[team, viewer] else NOT_MEMBER
  return library where .team = team first 20 by .id after c
query entry(entry: library):
  return library[entry]
```

Public visitors still need transport authentication: declare `use identity`, call `auth.guest()` from `snapback4/react`'s `useAuth()` (or `client.guest()`), then query. Public describes row authority, not an unauthenticated HTTP door. A guest can see shared rows, not team rows; password accounts enroll in the team roster. Use `use identity password` when the app should have no visitors.

## Day-scoped and time-window visibility

Store the assigned day as a key in a roster; select it in the API instead of
putting a clock in a rule. A publication's lower and upper lifetime bounds are
server enforced. Here staff assign readers, and only the assigned day reader
can read the publication while it is live. Changing the roster revokes access
on the next read; the day never changes on an existing publication.

```quarry
table dayReaders:
  principal: principal
  dayNumber: int
  unique principal, dayNumber
  immutable principal, dayNumber
  read <- .principal = viewer or viewer = 'service:ops'
  insert <- viewer = 'service:ops'
  delete <- viewer = 'service:ops'
  online only
table dayPublications:
  dayNumber: int
  opensAt: time
  endsAt: time
  body: text 1..200
  by byOpening: opensAt
  by byExpiry: endsAt
  immutable dayNumber, opensAt, endsAt, body
  not before .opensAt
  expire at .endsAt
  read <- exists dayReaders[viewer, .dayNumber]
  insert <- viewer = 'service:ops'
  online only
mutation assignDay(who: principal, dayNumber: int):
  require viewer = 'service:ops' else NOT_OPERATOR
  return insert dayReaders { principal: who, dayNumber }
mutation publishDay(dayNumber: int, opensAt: time, endsAt: time, body: text 1..200):
  require viewer = 'service:ops' else NOT_OPERATOR
  require opensAt < endsAt else BAD_WINDOW
  return insert dayPublications { dayNumber, opensAt, endsAt, body }
query dayPublication(publication: dayPublications):
  return dayPublications[publication]
```

For a slot-relative audience (the previous speaker), store an immutable slot
identity and a validated successor principal, then authorize that principal
explicitly. A lookup of a hidden prior slot cannot repair its successor. Give
that maintenance operation readable authority, or update by key under an
explicit transition rule; do not silently skip a nullable hidden lookup.

## Column-level privacy: public identity, private sheet

A returned shape does not protect a stored field. Split the row so that every
field in the public identity is public and the private sheet has its own read
rule. Column-level read rules remain an open language decision; this recipe applies ordinary row rules.

```quarry
table identities:
  principal: principal
  name: text 1..80
  unique principal
  immutable principal
  public 'display name and account principal are public'
  insert <- .principal = viewer
  online only
table privateSheets:
  identity: identities
  owner: principal
  notes: text 1..200
  unique identity
  immutable identity, owner
  read <- .owner = viewer
  insert <- .owner = viewer and exists identities[.identity, principal = .owner]
  online only
mutation createIdentity(name: text 1..80, notes: text 1..200):
  i = insert identities { principal: viewer, name }
  insert privateSheets { identity: i.id, owner: viewer, notes }
  return i
query identity(identity: identities):
  return identities[identity]
query privateSheet(identity: identities):
  return privateSheets[identity = identity]
```

## Status dashboard over private rows

Declare the wider count disclosure on the view, not on private source rows.
Role queries read the caller's own roster row; use them for access UI even
when a private list is empty. An authorized missing count group is zero; a
hidden keyed count is null. A roster holder can see the status count but not
another user's body. Counts disclose activity; grant them deliberately.

```quarry
table dashboardStaff:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table privateTickets:
  owner: principal
  status: enum('open', 'closed')
  body: text 1..200
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
view statusCounts: count privateTickets by .status
  read <- exists dashboardStaff[viewer]
query dashboardRole():
  return exists dashboardStaff[viewer]
query statusCount(status: enum('open', 'closed')):
  return { count: statusCounts[status] }
query privateTicket(ticket: privateTickets):
  return privateTickets[ticket]
mutation ticket(body: text 1..200):
  return insert privateTickets { owner: viewer, status: 'open', body }
```

## Audience follows a mutable parent

Copy-at-insert plus immutable copies keeps the creation-time audience, so a
transfer leaves existing children with the old owner. `read through` captures
a parent's immutable audience inputs and lifetime; it refuses mutable inputs
and does not follow owner transfers. A fixed stricter audience (for example
the child's author) intentionally never follows the parent. To follow a mutable
parent live, stay online and test its current owner in every read. This recipe
transfers existing children with the parent; the original author loses access.

```quarry
table movableFolders:
  owner: principal
  read <- .owner = viewer
  insert <- .owner = viewer
  update (old, next) <- old.owner = viewer
  online only
table liveFiles:
  folder: movableFolders
  body: text 1..200
  immutable folder
  read <- exists movableFolders[.folder, owner = viewer]
  insert <- exists movableFolders[.folder, owner = viewer]
  online only
mutation newMovableFolder():
  return insert movableFolders { owner: viewer }
mutation liveFile(folder: movableFolders, body: text 1..200):
  f = movableFolders[folder] ! else NOT_FOUND
  return insert liveFiles { folder: f.id, body }
mutation transferFolder(folder: movableFolders, who: principal):
  f = movableFolders[folder] ! else NOT_FOUND
  update movableFolders[f.id] { owner: who }
  return null
query liveFileById(file: liveFiles):
  return liveFiles[file]
```

## Minimum-group publication

A rule cannot count a population. Maintain a count, check its readable group,
and publish a copy atomically. Approvals here are irrevocable, so publication
is monotone. For retractable consent, withdraw the publication in the same
transaction as every withdrawal, as in Materialised access; a later cleanup
job leaves a disclosure window.

```quarry
table petitions:
  owner: principal
  body: text 1..200
  immutable owner, body
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
table approvals:
  petition: petitions
  principal: principal
  unique petition, principal
  immutable petition, principal
  read <- .principal = viewer or exists petitions[.petition, owner = viewer]
  insert <- .principal = viewer and exists petitions[.petition]
  online only
view approvalCount: count approvals by .petition
  read <- exists petitions[.petition, owner = viewer]
table petitionPublications:
  petition: petitions
  body: text 1..200
  unique petition
  immutable petition, body
  public 'the owner published after ten irrevocable approvals'
  insert <- exists petitions[.petition, owner = viewer]
  online only
mutation petition(body: text 1..200):
  return insert petitions { owner: viewer, body }
mutation approve(petition: petitions):
  return insert approvals { petition, principal: viewer }
mutation publishPetition(petition: petitions):
  p = petitions[petition] ! else NOT_FOUND
  require (approvalCount[petition] ?? 0) >= 10 else TOO_FEW
  return insert petitionPublications { petition, body: p.body }
query petitionPublication(petition: petitions):
  return petitionPublications[petition = petition]
```

Only publish the trusted threshold mutation. The table rule proves the owner,
not the threshold; adding a generic publication writer would bypass it.

## Secret ballots, closed publication, maintained result

Keep voter choices private, and disclose only the maintained result after
closing. The public poll metadata makes the closed-phase probe explicit.
Neither insert nor delete can change votes after closure. There is no reopen
operation. A readable empty result is zero; while open the count key is hidden
and reads null. This is choice privacy from other voters, not administrator
anonymity. Small totals may reveal an individual choice.

```quarry
table polls:
  owner: principal
  closed: bool default false
  immutable owner
  public 'poll identity and whether voting is closed are public'
  insert <- .owner = viewer and .closed = false
  update (old, next) <- old.owner = viewer and old.closed = false and next.closed = true
  online only
table ballots:
  poll: polls
  voter: principal
  choice: enum('yes', 'no')
  unique poll, voter
  immutable poll, voter, choice
  read <- .voter = viewer
  insert <- .voter = viewer and exists polls[.poll, closed = false]
  delete <- .voter = viewer and exists polls[.poll, closed = false]
  online only
view ballotResults: count ballots by .poll, .choice
  read <- exists polls[.poll, closed = true]
mutation poll():
  return insert polls { owner: viewer }
mutation vote(poll: polls, choice: enum('yes', 'no')):
  return insert ballots { poll, voter: viewer, choice }
mutation closePoll(poll: polls):
  p = polls[poll] ! else NOT_FOUND
  require p.owner = viewer else NOT_OWNER
  update polls[p.id] { closed: true }
  return null
query ballotResult(poll: polls, choice: enum('yes', 'no')):
  return { count: ballotResults[poll, choice] }
query ownBallot(poll: polls):
  return ballots[poll, viewer]
```

## Ephemeral presence under an enrolment parent

An ephemeral row cannot use `read through`. Copy the durable scope, verify it
against the unique enrolment key on every write, and probe the durable
roster for current read authority. Removing a viewer's enrolment hides presence
from that viewer on the next read; a departed writer's row lasts at most 4s.
Renewals require membership, including after leave/rejoin. Never replace presence with a durable table to repair this refusal.

```quarry
table spaces:
  title: text 1..80
  public 'space metadata is public; participation is private'
  online only
table enrolments:
  space: spaces
  principal: principal
  unique space, principal
  immutable space, principal
  read <- .principal = viewer
  insert <- viewer = 'service:ops'
  delete <- .principal = viewer or viewer = 'service:ops'
  online only
table presenceRows:
  space: spaces
  principal: principal
  unique space, principal
  immutable space, principal
  read <- exists enrolments[.space, viewer]
  insert <- .principal = viewer and exists enrolments[.space, viewer]
  update <- .principal = viewer and exists enrolments[.space, viewer]
  ephemeral 4s
mutation pulse(space: spaces):
  upsert presenceRows[space, viewer] {}
mutation leaveSpace(space: spaces):
  delete enrolments[space, viewer]
  return null
query presence(space: spaces, who: principal):
  return presenceRows[space, who]
```

## Blind comparison with a system job

A mutation cannot scan or compare secrets its caller cannot read. A system job
can read them, but must publish only the explicitly permitted derived fact.
Here the operator schedules the comparison, and ordinary callers get only
which of two known submissions is higher, not either score. Jobs run as the
system; no client mutation delegates arbitrary secret comparisons.

```quarry
table secretScores:
  owner: principal
  score: int
  immutable owner, score
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
table comparisons:
  left: secretScores
  right: secretScores
  leftHigher: bool
  public 'operator-authorized comparison discloses only the ordering'
  online only
mutation secretScore(score: int):
  return insert secretScores { owner: viewer, score }
job compare(left: secretScores, right: secretScores):
  for a in secretScores where .id = left:
    b = secretScores[right] ! else NOT_FOUND
    insert comparisons { left: a.id, right, leftHigher: a.score > b.score }
query comparison(comparison: comparisons):
  return comparisons[comparison]
query secretScoreById(score: secretScores):
  return secretScores[score]
```

## Enrolment into hidden things: invite, self-join or public metadata

Choose one entry contract. **Invite:** the inviter reads the private parent and
creates an addressed invitation; the recipient reads that invitation, then
inserts their own membership without looking up the hidden parent. The table
insert rule probes the parent and invitation even when program reads cannot.
**Self-join:** deliberately make the root metadata public and require its open
flag in the membership insert rule. **Public metadata:** keep a separate public
catalogue with no private payload, and let its entry operation create private
membership. Knowing an id is not consent and does not make a hidden parent
readable. `! else NOT_FOUND` before joining will stop the invitee too early.

```quarry
table hiddenClubs:
  owner: principal
  title: text 1..80
  immutable owner
  read <- .owner = viewer or exists clubMembers[.id, viewer]
  insert <- .owner = viewer
  online only
table clubInvites:
  club: hiddenClubs
  principal: principal
  unique club, principal
  immutable club, principal
  read <- .principal = viewer or exists hiddenClubs[.club, owner = viewer]
  insert <- exists hiddenClubs[.club, owner = viewer]
  delete <- .principal = viewer
  online only
table clubMembers:
  club: hiddenClubs
  principal: principal
  unique club, principal
  immutable club, principal
  read <- .principal = viewer
  insert <- .principal = viewer and exists hiddenClubs[.club] and exists clubInvites[.club, viewer]
  online only
mutation club(title: text 1..80):
  return insert hiddenClubs { owner: viewer, title }
mutation inviteClub(club: hiddenClubs, who: principal):
  c = hiddenClubs[club] ! else NOT_FOUND
  return insert clubInvites { club: c.id, principal: who }
mutation acceptClub(club: hiddenClubs):
  i = clubInvites[club, viewer] ! else NOT_FOUND
  m = insert clubMembers { club: i.club, principal: viewer }
  delete clubInvites[i.id]
  return m
query hiddenClub(club: hiddenClubs):
  return hiddenClubs[club]
```

For the self-join variant, replace the private root read rule with explicit
public metadata and the membership insert rule with `.principal = viewer and
exists root[.root, open = true]`; there is no invite. Do not apply that variant
to a synced closed roster: its grant law also requires existing membership or
a newly created parent (`guide sharing`). SURF owns transport authentication
and production UI recipes; KIT owns proof-kit details in `guide testing`.

## Revocable media links with expiry

Redemption copies the link's upper lifetime to a principal grant. A live grant
permits the media row and its download; an expired grant is absent even before
physical sweep. Tokens are unguessable secrets generated outside Quarry. Keep
them out of exported query results and listings. Revoking a token prevents new
redemptions; revoke existing readers separately to remove their media access.
Revocation cannot retract downloaded bytes. The asset itself is placed on the
private row through the ordinary upload API (`guide assets`).

```quarry
table mediaDocuments:
  owner: principal
  title: text 1..80
  image: image <=5000000 ?
  immutable owner
  read <- .owner = viewer or exists mediaReaders[.id, viewer] or viewer = 'service:ops'
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
table mediaLinks:
  secret: text 32..100
  document: mediaDocuments
  expiresAt: time
  unique secret
  by byExpiry: expiresAt
  immutable secret, document, expiresAt
  expire at .expiresAt
  read <- allow
  insert <- viewer = 'service:ops'
  delete <- viewer = 'service:ops'
  online only
table mediaReaders:
  document: mediaDocuments
  principal: principal
  expiresAt: time
  unique document, principal
  by byExpiry: expiresAt
  immutable document, principal, expiresAt
  expire at .expiresAt
  read <- .principal = viewer or viewer = 'service:ops'
  insert <- .principal = viewer
  delete <- viewer = 'service:ops'
  online only
mutation mediaDocument(title: text 1..80):
  return insert mediaDocuments { owner: viewer, title }
mutation placeMedia(document: mediaDocuments, image: image <=5000000):
  update mediaDocuments[document] { image }
  return null
mutation mediaLink(document: mediaDocuments, secret: text 32..100, expiresAt: time):
  require viewer = 'service:ops' else NOT_OPERATOR
  d = mediaDocuments[document] ! else NOT_FOUND
  require expiresAt > now else EXPIRED_LINK
  return insert mediaLinks { document: d.id, secret, expiresAt }
mutation claimMedia(secret: text 32..100):
  t = mediaLinks[secret = secret] ! else BAD_LINK
  return insert mediaReaders { document: t.document, principal: viewer, expiresAt: t.expiresAt }
mutation revokeMediaLink(secret: text 32..100):
  require viewer = 'service:ops' else NOT_OPERATOR
  t = mediaLinks[secret = secret] ! else BAD_LINK
  delete mediaLinks[t.id]
  return null
mutation revokeMediaReader(document: mediaDocuments, who: principal):
  require viewer = 'service:ops' else NOT_OPERATOR
  delete mediaReaders[document = document, principal = who]
  return null
query mediaDocumentById(document: mediaDocuments):
  return mediaDocuments[document]
```

Only expose claimMedia as the reader writer. A generic insert of a grant would
bypass possession and expiry checks. Repeated claims use the declared unique
constraint; they do not extend a grant's expiry.

## N_LOOKUP_NEVER_VISIBLE

N_LOOKUP_NEVER_VISIBLE means a nullable point lookup is always null for callers
satisfying its preceding require/branch conditions: those conditions contradict
the table read rule, so a non-null branch cannot run. Authorize the read or
write by key under the table rule; Enrolment into hidden things shows the latter.
Unknown relationships and role overlap do not trigger this proof.

## Self-join through a public catalogue

The public catalogue is the root metadata; the private payload has a separate
row rule. Open entries permit self-join without an invitation. Closed entries
refuse the join even though their metadata is readable. Opening an entry is
an explicit owner decision, not a consequence of knowing its id.

```quarry
table clubCatalogue:
  owner: principal
  title: text 1..80
  open: bool
  immutable owner
  public 'club titles and whether enrolment is open are public metadata'
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
table catalogueMembers:
  club: clubCatalogue
  principal: principal
  unique club, principal
  immutable club, principal
  read <- .principal = viewer
  insert <- .principal = viewer and exists clubCatalogue[.club, open = true]
  online only
table clubSheets:
  club: clubCatalogue
  owner: principal
  body: text 1..200
  unique club
  immutable club, owner
  read <- .owner = viewer or exists catalogueMembers[.club, viewer]
  insert <- .owner = viewer and exists clubCatalogue[.club, owner = .owner]
  online only
mutation catalogueClub(title: text 1..80, open: bool, body: text 1..200):
  c = insert clubCatalogue { owner: viewer, title, open }
  insert clubSheets { club: c.id, owner: viewer, body }
  return c
mutation selfJoinClub(club: clubCatalogue):
  return insert catalogueMembers { club, principal: viewer }
query catalogueClubById(club: clubCatalogue):
  return clubCatalogue[club]
query clubSheet(club: clubCatalogue):
  return clubSheets[club = club]
```
