# Rule recipes: audiences, disclosure and blind writers

These compiled recipes express roles, copied audiences, consent, publication, link enrollment and anonymity. Each makes the intended disclosure and write authority explicit, including the trade-offs of materialising a grant.

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
