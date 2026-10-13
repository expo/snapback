# Rule recipes: composite roles and blind writers

These compiled recipes cover two rule shapes where a short-looking probe or
parent lookup changes the authority being expressed.

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

When one principal may hold several independent roles, make the pair unique.
Every point probe then supplies both columns. A bare `exists roles[viewer]`
is deliberately refused: under `unique principal, role` it names every role
row for that principal, not one row. Prefer the named spelling in policy;
the full positional spelling, such as `roles[viewer, 'commander']`, has the
same meaning. Spell an “any staff role” grant as the `or` of the exact roles
that grant it.

Seed the first commander or grant it through `service:ops`. A commander may
also have a coordinator row; the pair constraint prevents only a duplicate
of the same role. Test both grants separately:

```jsonl
{"as":"alice","op":"canCoordinate","args":{},"data":true,"label":"alice has the coordinator row"}
{"as":"alice","op":"canCommand","args":{},"data":true,"label":"alice also has the commander row"}
{"as":"bob","op":"canCoordinate","args":{},"data":true}
{"as":"bob","op":"canCommand","args":{},"data":false}
```

## A writer who cannot read the parent

A reference value does not itself read or validate its target. When a writer
may create a child but must not read its parent, put the parent checks in the
child's insert rule and insert without a program lookup. Rule probes see the
target row for authorization even when a program lookup would return null.
Here a recommender can write a letter for an application, while the student
cannot write their own letter and cannot read any letter. A missing application
and the student's own application both refuse `E_RULE`; neither is exposed by
a preliminary `applications[id] !` lookup.

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

This form is for a blind writer. If the operation needs parent contents, that
is a read and the parent must admit the caller. If existing children should
follow a parent's changing audience, keep the child online and probe each live
parent condition explicitly. If they should retain the audience chosen at
creation, copy those audience columns onto the child, make the copies immutable,
and check every copy against the parent in this same insert rule.
