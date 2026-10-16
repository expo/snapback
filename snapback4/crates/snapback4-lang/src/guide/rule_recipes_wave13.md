
## Offline roster with a supervisor

Use `guide rule-recipes offline-roster` for a field roster (wave-13 lanes 057,
059, 063). Put workers and supervisors in one membership table with a role.
Enroll a supervisor in each precinct they need offline; this is explicit access,
not a second group audience. A county-wide supervisor query stays online and
reads the same rows without acquiring every precinct. Provision the first
supervisor through the operator seat; never let workers grant themselves roles.
Bare union sync holds all authorized rows after acquisition; it has no history
window. An online adapter without a device does not acquire those rows.
Union horizons and read-through children of unions remain open language work.
Completeness-planner changes belong to LANG2.

```quarry
use personas alice, bob, carol
table supervisors:
  principal: principal
  unique principal
  read <- .principal = viewer
  insert <- viewer = 'service:ops'
  online only
table precincts:
  title: text 1..80
  public 'precinct names are public'
  insert <- viewer = 'service:ops'
  online only
table fieldRoster:
  precinct: precincts
  principal: principal
  role: enum('worker', 'supervisor')
  unique precinct, principal
  cap 100 by precinct
  immutable precinct, principal
  read <- exists fieldRoster[.precinct, viewer]
  insert <- (exists supervisors[viewer] and exists fieldRoster[.precinct, viewer, role = 'supervisor']) or viewer = 'service:ops'
  delete <- exists fieldRoster[.precinct, viewer, role = 'supervisor']
  sync to fieldRoster[.precinct] by .principal
table fieldVoters:
  cap 500 by precinct
  precinct: precincts
  name: text 1..80
  checked: bool default false
  immutable precinct
  read <- exists fieldRoster[.precinct, viewer]
  insert <- exists supervisors[viewer]
  update <- exists fieldRoster[.precinct, viewer]
  sync to fieldRoster[.precinct] by .principal
mutation unassignField(precinct: precincts, who: principal):
  delete fieldRoster[precinct, who]
mutation assignField(precinct: precincts, who: principal, role: enum('worker', 'supervisor')):
  p = precincts[precinct] ! else NOT_FOUND
  return insert fieldRoster { precinct: p.id, principal: who, role }
query fieldPeople(precinct: precincts, c: cursor ?):
  return fieldRoster where .precinct = precinct first 50 by .id after c
query fieldList(precinct: precincts, c: cursor ?):
  return fieldVoters where .precinct = precinct first 100 by .id after c
query supervisorList(precinct: precincts, c: cursor ?):
  require exists supervisors[viewer] else SUPERVISOR_ONLY
  require exists fieldRoster[precinct, viewer, role = 'supervisor'] else NOT_ASSIGNED
  return fieldVoters where .precinct = precinct first 100 by .id after c
```

The online-only supervisor probe makes supervisorList a server read. It still
needs precinct membership: enroll the supervisor in each precinct, with role
supervisor. This deliberately replaces the two independent group audiences
from lane 057. Revoking one assignment removes that precinct's offline rows;
revoking the supervisor seat also requires removing those explicit assignments.

## Quantified consent via maintained counts

`guide rule-recipes quantified-consent` replaces lane 007's thirty nullable tag
slots with a relation. Counts are deliberately readable metadata; photo bodies
remain private. Every tag addition/removal and global student-consent change
refreshes the clearance in the same transaction. The engine maintains counts;
the trusted helper maintains the grant. No background repair may be the
revocation boundary. Only expose the mutations below, never a generic grant
writer. Thirty tags per student is this example's product limit on withdrawal
fanout; choose a product limit for your own application.

```quarry
use personas alice, bob, carol
table photoStaff:
  principal: principal
  role: enum('advisor', 'editor')
  unique principal
  read <- .principal = viewer
  online only
table pupils:
  guardian: principal
  consented: bool default false
  immutable guardian
  read <- .guardian = viewer or exists photoStaff[viewer]
  update <- .guardian = viewer
  online only
table consentPhotos:
  body: text 1..200
  read <- exists photoStaff[viewer, role = 'advisor'] or (exists photoStaff[viewer, role = 'editor'] and exists photoClearances[photo = .id])
  insert <- exists photoStaff[viewer]
  online only
table photoTags:
  photo: consentPhotos
  pupil: pupils
  consented: bool
  unique photo, pupil
  cap 30 by pupil
  immutable photo, pupil
  read <- exists pupils[.pupil, guardian = viewer] or exists photoStaff[viewer]
  insert <- exists photoStaff[viewer] and exists pupils[.pupil, consented = .consented]
  update <- exists pupils[.pupil, guardian = viewer, consented = .consented]
  delete <- exists photoStaff[viewer]
  online only
view taggedCount: count photoTags by .photo
  read <- allow
  disclosure reviewed 'tag totals are deliberately public metadata'
view consentedCount: count photoTags where .consented = true by .photo
  read <- allow
  disclosure reviewed 'consented totals and their deltas are deliberately public metadata'
table photoClearances:
  photo: consentPhotos
  refreshedBy: pupils
  unique photo
  read <- allow
  insert <- exists photoStaff[viewer] or exists pupils[.refreshedBy, guardian = viewer]
  delete <- allow
  online only
fn refreshConsent(photo: consentPhotos, pupil: pupils):
  total = taggedCount[photo] ?? 0
  cleared = consentedCount[photo] ?? 0
  grant = photoClearances[photo = photo]
  if total > 0 and cleared = total:
    if grant = null:
      insert photoClearances { photo, refreshedBy: pupil }
  else:
    if grant != null:
      delete photoClearances[grant.id]
mutation tagPhoto(photo: consentPhotos, pupil: pupils):
  require exists photoStaff[viewer] else STAFF_ONLY
  p = pupils[pupil] ! else NOT_FOUND
  f = consentPhotos[photo] ! else NOT_FOUND
  insert photoTags { photo: f.id, pupil, consented: p.consented }
  refreshConsent(photo, pupil)
mutation untagPhoto(photo: consentPhotos, pupil: pupils):
  require exists photoStaff[viewer] else STAFF_ONLY
  delete photoTags[photo = photo, pupil = pupil]
  refreshConsent(photo, pupil)
mutation pupilConsent(pupil: pupils, consented: bool):
  p = pupils[pupil] ! else NOT_FOUND
  require p.guardian = viewer else GUARDIAN_ONLY
  update pupils[pupil] { consented }
  for tag in photoTags where .pupil = pupil:
    update photoTags[tag.id] { consented }
    refreshConsent(tag.photo, pupil)
query clearedPhoto(photo: consentPhotos):
  return consentPhotos[photo]
```

The grant rule proves staff/guardian authority, while refreshConsent proves the
count condition. These are the two authorization layers; adding a generic grant
mutation would bypass the latter. Universal relation quantifiers remain open.

## Mutable workflow gate as an explicit probe

`guide rule-recipes mutable-workflow` answers lanes 011 and 019. `read through`
captures immutable audience inputs; a conference release or privacy flag must
be checked live. A keyed table-rule probe sees the current parent even when a
program lookup would hide it. Revoking the flag hides existing children on the
next read. This online recipe adds no copied audience or captured lifetime.

```quarry
use personas alice, bob, carol
table conferences:
  observer: principal
  teacher: principal
  released: bool default false
  immutable observer, teacher
  read <- .observer = viewer or (.teacher = viewer and .released = true)
  insert <- .observer = viewer
  update <- .observer = viewer
  online only
table conferenceResponses:
  conference: conferences
  body: text 1..200
  unique conference
  immutable conference
  read <- exists conferences[.conference, observer = viewer] or exists conferences[.conference, teacher = viewer, released = true]
  insert <- exists conferences[.conference, teacher = viewer, released = true]
  update <- exists conferences[.conference, teacher = viewer, released = true]
  online only
mutation releaseConference(conference: conferences, released: bool):
  update conferences[conference] { released }
mutation respondConference(conference: conferences, body: text 1..200):
  c = conferences[conference] ! else NOT_FOUND
  require c.teacher = viewer else TEACHER_ONLY
  return upsert conferenceResponses[conference = conference] { conference, body }
query conferenceResponse(conference: conferences):
  return conferenceResponses[conference = conference]
```

## Publication maintained from its source

`guide rule-recipes source-publication` answers lane 097. Only the public copy
carries the public read rule. Its write rule probes the source owner. Source rows stay
private, including private production notes. A removal requester looks up the
public copy, never the private source. All source edits call one helper in the
same transaction; approval, alias edits, replies and takedown cannot drift.
A native publication construct remains open language work.

```quarry
use personas alice, bob, carol
table producers:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table sourceClips:
  owner: principal
  alias: text 1..30
  transcript: text 1..200
  privateNote: text <=200
  response: text <=200 default ''
  approved: bool default false
  immutable owner
  read <- .owner = viewer or exists producers[viewer]
  insert <- .owner = viewer
  update <- .owner = viewer or exists producers[viewer]
  online only
table publishedClips:
  clip: sourceClips
  alias: text 1..30
  transcript: text 1..200
  response: text <=200
  unique clip
  immutable clip
  public 'only the approved projection is copied here'
  insert <- exists producers[viewer]
  update <- exists producers[viewer] or exists sourceClips[.clip, owner = viewer]
  delete <- exists producers[viewer]
  online only
table clipRemovalRequests:
  clip: sourceClips
  requester: principal
  unique clip, requester
  read <- .requester = viewer or exists producers[viewer]
  insert <- .requester = viewer and exists sourceClips[.clip, approved = true]
  online only
fn mirrorClip(clip: sourceClips):
  c = sourceClips[clip] ! else NOT_FOUND
  if c.approved:
    upsert publishedClips[clip = clip] { clip, alias: c.alias, transcript: c.transcript, response: c.response }
  else:
    p = publishedClips[clip = clip]
    if p != null:
      delete publishedClips[p.id]
mutation submitClip(alias: text 1..30, transcript: text 1..200, privateNote: text <=200):
  return insert sourceClips { owner: viewer, alias, transcript, privateNote }
mutation approveClip(clip: sourceClips):
  require exists producers[viewer] else PRODUCER_ONLY
  update sourceClips[clip] { approved: true }
  mirrorClip(clip)
mutation renameClip(clip: sourceClips, alias: text 1..30):
  c = sourceClips[clip] ! else NOT_FOUND
  require c.owner = viewer else OWNER_ONLY
  update sourceClips[clip] { alias }
  mirrorClip(clip)
mutation replyClip(clip: sourceClips, response: text <=200):
  require exists producers[viewer] else PRODUCER_ONLY
  update sourceClips[clip] { response }
  mirrorClip(clip)
mutation requestClipRemoval(clip: sourceClips):
  p = publishedClips[clip = clip] ! else NOT_FOUND
  return insert clipRemovalRequests { clip: p.clip, requester: viewer }
mutation takeDownClip(clip: sourceClips):
  require exists producers[viewer] else PRODUCER_ONLY
  update sourceClips[clip] { approved: false }
  mirrorClip(clip)
query publicClip(clip: sourceClips):
  return publishedClips[clip = clip]
query privateClip(clip: sourceClips):
  return sourceClips[clip]
```

## Owner now, peers at deadline

`guide rule-recipes owner-now` answers lane 053. A table lifetime applies to
every reader, so store the private current count separately from the timed
peer projection. One transaction updates both. The deadline is immutable;
no caller can advance disclosure. Freeze reports at the deadline. Final totals
are computed only after opening, so no pre-deadline aggregate leaks the count.

```quarry
use personas alice, bob, carol
table sprintMembers:
  sprint: sprints
  principal: principal
  unique sprint, principal
  read <- .principal = viewer
  online only
table sprints:
  endsAt: time
  immutable endsAt
  public 'sprint deadlines are public'
  online only
table ownCounts:
  sprint: sprints
  writer: principal
  words: int 0..20000
  unique sprint, writer
  cap 100 by sprint
  immutable sprint, writer
  read <- .writer = viewer
  insert <- .writer = viewer and exists sprintMembers[.sprint, viewer]
  update <- .writer = viewer and exists sprintMembers[.sprint, viewer]
  online only
table peerCounts:
  sprint: sprints
  writer: principal
  words: int 0..20000
  opensAt: time
  unique sprint, writer
  cap 100 by sprint
  immutable sprint, writer, opensAt
  by byOpening: opensAt
  not before .opensAt
  read <- exists sprintMembers[.sprint, viewer]
  insert <- .writer = viewer and .opensAt = .sprint.endsAt and exists sprintMembers[.sprint, viewer]
  update <- .writer = viewer and exists sprintMembers[.sprint, viewer]
  online only
mutation reportWords(sprint: sprints, words: int 0..20000):
  s = sprints[sprint] ! else NOT_FOUND
  require now < s.endsAt else SPRINT_ENDED
  upsert ownCounts[sprint, viewer] { sprint, writer: viewer, words }
  upsert peerCounts[sprint, viewer] { sprint, writer: viewer, words, opensAt: s.endsAt }
query ownWords(sprint: sprints):
  return ownCounts[sprint, viewer]
query peerWords(sprint: sprints, writer: principal):
  return peerCounts[sprint, writer]
query finalWords(sprint: sprints):
  s = sprints[sprint] ! else NOT_FOUND
  require exists sprintMembers[sprint, viewer] else MEMBER_ONLY
  require now >= s.endsAt else NOT_FINISHED
  total = 0
  for p in peerCounts where .sprint = sprint first 100 by .id:
    total = total + p.words
  return total
```

The 100 writers per sprint cap is an explicit product limit, shared by the
private and peer rows. The final query covers that entire capped group.
LANG2 owns completeness-planner improvements.

## Grant expiry versus owner visibility

`guide rule-recipes grant-expiry` answers lane 005. Opening and expiry hide a
grant from everyone, including its owner. Keep owner-visible history in a
separate non-expiring audit table; do not widen the grant read rule to fight
its lifetime. An expired grant need not be read or deleted to revoke access.
The audit stores metadata only, never a capability secret.

```quarry
use personas alice, bob, carol
table ledgers:
  owner: principal
  immutable owner
  read <- .owner = viewer or exists ledgerGrants[ledger = .id, accountant = viewer]
  insert <- .owner = viewer
  online only
table ledgerGrants:
  ledger: ledgers
  owner: principal
  accountant: principal
  expiresAt: time
  unique ledger, accountant
  immutable ledger, owner, accountant, expiresAt
  expire at .expiresAt
  read <- .owner = viewer or .accountant = viewer
  insert <- .owner = viewer and exists ledgers[.ledger, owner = viewer]
  delete <- .owner = viewer
  online only
table grantAudit:
  ledger: ledgers
  owner: principal
  accountant: principal
  expiresAt: time
  immutable ledger, owner, accountant, expiresAt
  read <- .owner = viewer
  insert <- .owner = viewer and exists ledgers[.ledger, owner = viewer]
  online only
mutation shareLedger(ledger: ledgers, accountant: principal, expiresAt: time):
  l = ledgers[ledger] ! else NOT_FOUND
  require l.owner = viewer else OWNER_ONLY
  require expiresAt > now else BAD_WINDOW
  g = insert ledgerGrants { ledger, owner: viewer, accountant, expiresAt }
  insert grantAudit { ledger, owner: viewer, accountant, expiresAt }
  return g
query ledgerById(ledger: ledgers):
  return ledgers[ledger]
query liveGrant(ledger: ledgers, accountant: principal):
  return ledgerGrants[ledger, accountant]
query grantHistory(c: cursor ?):
  return grantAudit where .owner = viewer first 50 by .id after c
```

## End-to-end role workflow

`guide rule-recipes role-workflow` answers lane 009. A host drafts a sponsor
read, a manager edits it, and the sponsor approves it. Rates remain host-only.
A role query drives access UI; hiding a button grants no authority. The table
transition locks approved scripts even if a new mutation forgets a guard.
A mutation's require decides intent; each write still passes its table's rule.

```quarry
use personas alice, bob, carol
table workflowStaff:
  principal: principal
  role: enum('host', 'manager')
  unique principal
  immutable principal, role
  read <- .principal = viewer
  online only
table sponsorReads:
  contact: principal
  script: text 1..200
  state: enum('pending', 'approved') default 'pending'
  immutable contact
  read <- .contact = viewer or exists workflowStaff[viewer]
  insert <- exists workflowStaff[viewer, role = 'host'] and .state = 'pending'
  update (old, next) <- old.state = 'pending' and ((exists workflowStaff[viewer] and next.state = old.state) or (old.contact = viewer and next.script = old.script and next.state = 'approved'))
  online only
table sponsorRates:
  adRead: sponsorReads
  cents: int 0..1000000
  unique adRead
  immutable adRead
  read <- exists workflowStaff[viewer, role = 'host']
  insert <- exists workflowStaff[viewer, role = 'host']
  update <- exists workflowStaff[viewer, role = 'host']
  online only
mutation draftSponsorRead(contact: principal, script: text 1..200):
  require exists workflowStaff[viewer, role = 'host'] else HOST_ONLY
  return insert sponsorReads { contact, script }
mutation editSponsorRead(adRead: sponsorReads, script: text 1..200):
  r = sponsorReads[adRead] ! else NOT_FOUND
  require exists workflowStaff[viewer] else STAFF_ONLY
  require r.state = 'pending' else READ_LOCKED
  update sponsorReads[adRead] { script }
mutation approveSponsorRead(adRead: sponsorReads):
  r = sponsorReads[adRead] ! else NOT_FOUND
  require r.contact = viewer else SPONSOR_ONLY
  require r.state = 'pending' else READ_LOCKED
  update sponsorReads[adRead] { state: 'approved' }
mutation setSponsorRate(adRead: sponsorReads, cents: int 0..1000000):
  require exists workflowStaff[viewer, role = 'host'] else HOST_ONLY
  r = sponsorReads[adRead] ! else NOT_FOUND
  return upsert sponsorRates[adRead = r.id] { adRead: r.id, cents }
query workflowRole():
  return workflowStaff[viewer]
query sponsorRead(adRead: sponsorReads):
  return sponsorReads[adRead]
query sponsorRate(adRead: sponsorReads):
  return sponsorRates[adRead = adRead]
```

## Update images and the two authorization layers

`guide rule-recipes update-images` answers lane 094. An unnamed update rule
must hold before and after the patch. Requiring pending in a mutation cannot
override a table rule that also requires the resulting state to be pending.
For an intended transition out of pending, explicitly judge the pre-write
state and constrain the allowed result. This changes the policy deliberately.

```quarry
use personas alice, bob, carol
table pendingClaims:
  owner: principal
  state: enum('pending', 'withdrawn') default 'pending'
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer and .state = 'pending'
  update (old, next) <- old.owner = viewer and old.state = 'pending' and next.state = 'withdrawn'
  online only
mutation claimPending():
  return insert pendingClaims { owner: viewer }
mutation withdrawPending(claim: pendingClaims):
  c = pendingClaims[claim] ! else NOT_FOUND
  require c.state = 'pending' else ALREADY_DECIDED
  update pendingClaims[claim] { state: 'withdrawn' }
```

N_WRITE_DENIED names the refusing table layer and old/next image when its
bounded proof can distinguish one. A cross-image contradiction says combined
old/next; a named rule says named transition. Under dev, E_RULE's `why recent`
record names the image without re-running probes. Client messages name the
table layer and this rewrite, while hidden targets keep their generic
NOT_FOUND and no image detail. This preserves the hidden-row disclosure floor.
