pub(super) const CARD: &str = r##"# App: a complete chat backend

Comments start with `--`. Blocks indent with two spaces. A file holds
directives, tables, maintains, shapes, helpers, queries, mutations, jobs
and schedules, in any order. `snapback4 guide` prints the card index;
`guide language` prints the core program, followed by a "With `use server`"
section, and the idiom for each thing the language leaves out on purpose.

The example's §4 (identity) and §5 (personas) refer to CLIENT-AND-OPERATIONS.md.

```quarry
use identity                       -- guests and password accounts (§4)
use personas alice, bob, carol     -- a development cast (§5)

table conversations:
  title: text <=120
  creatorId: principal
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- deny
  delete <- deny
  after insert <- exists memberships[.id, .creatorId, 'admin']
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique byConversationPrincipal: conversationId, principal
  by byConversationPrincipalRole: conversationId, principal, role
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer, 'admin']
  delete <- .principal = viewer or exists memberships[.conversationId, viewer, 'admin']
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000 ?
  editedAt: time ?
  at: time
  by byConvTime: conversationId, at, id
  immutable conversationId, authorId
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  delete <- .authorId = viewer
  retain delivered-history
  sync to memberships[.conversationId] last 500 by byConvTime

maintain messageCounts: count messages by conversationId
  read <- exists memberships[.conversationId, viewer]

query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50 by byConvTime

query inbox(c: cursor ?):
  return memberships[viewer] after c first 50 by byPrincipalConversation
    { conversationId, conversation: conversations[.conversationId], count: messageCounts[.conversationId] }

mutation send(conversationId: conversations, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, at: now }
  return { id: row.id }

mutation edit(messageId: messages, body: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  update messages[msg] { body, editedAt: now }
  return null
```

## With `use server`

One `use server` in any module (`schema.q` is usual) enables the whole
project; repeating it is harmless. Actions, routes and schedules naming an
action require it. Effects (including secrets, retry, backoff, deadline and
cancellation), jobs, schedules naming a job and service seats need no directive.
See `guide actions`, `guide routes` and `guide jobs`.
"##;
