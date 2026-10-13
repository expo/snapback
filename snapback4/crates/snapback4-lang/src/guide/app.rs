// @ref LLP 3000.021#3.1 — ordinary history and separate decorations.
// @ref LLP 3000.021#3.4 — retain the parent and pin its own screen query.
pub(super) const CARD: &str = r##"# App: a complete chat backend

This chat backend gives conversation members live messages and offline writes.
Tables, membership rules and operations share one Quarry file.

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
  after insert <- exists memberships[conversationId = .id, principal = .creatorId, role = 'admin']
  retain delivered-history
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique conversationId, principal
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  delete <- .principal = viewer or exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000 ?
  quote: messages ?
  editedAt: time ?
  at: time
  immutable conversationId, authorId
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  delete <- .authorId = viewer
  retain delivered-history
  sync to memberships[.conversationId] last 500 by .at

view messageCounts: count messages by .conversationId
  read <- exists memberships[.conversationId, viewer]

query thread(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId after c last 50 by .at

query conversationScreen(conversationId: conversations):
  return conversations[conversationId]

query inbox(c: cursor ?):
  return memberships where .principal = viewer after c first 50 by .conversationId
    { conversationId, conversation: conversations[.conversationId], count: messageCounts[.conversationId] }

mutation send(conversationId: conversations, body: text <=4000):
  conversation = conversations[conversationId] ! else NOT_FOUND
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  row = insert messages { conversationId: conversation.id, authorId: viewer, body, at: now }
  return { id: row.id }

mutation edit(messageId: messages, body: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  update messages[msg] { body, editedAt: now }
  return null

table profiles:
  principal: principal
  name: text <=80
  unique principal
  public 'display names are public'
  sync last 500 by .id

table reactions:
  message: messages
  principal: principal
  emoji: text <=16
  unique message, principal
  cap 32 by message
  immutable message, principal
  read through .message
  online only

query messageAuthor(message: messages):
  return profiles[principal = messages[message].authorId]

query quotedMessage(message: messages):
  return messages[messages[message].quote]

query messageReactions(message: messages):
  return reactions where .message = message first 32 by .principal

```

The screen pins `conversationScreen` by its conversation id beside the bare
`thread` page. Both queries are ordinary, with no membership `require`:
table rules still decide every server read. A device keeps the conversation
and delivered messages after leave, through remount and reopen, offline and
online. The inbox reads memberships and drops the row when that member row
is deleted; keep the screen pinned by id rather than by the inbox result.
An online-only client cannot recover a departed member's retained rows.

Render profiles, quotes and reactions from their own queries beside the page;
`guide receipts` shows the separate receipt query. A decoration that loads or
refuses must not take history with it. Use ordinary search for current and retained hits in either link state
(`guide search`).
Ordinary history asks the server before acquisition or beyond its horizon,
and keeps a left group's retained page local.

Comments start with `--`. Blocks indent with two spaces. A file holds
directives, tables, views, shapes, helpers, queries, mutations, jobs
and schedules, in any order. `snapback4 guide` prints the card index;
`guide language` prints the core program, followed by a "With `use server`"
section, and the idiom for each thing the language leaves out on purpose.

The example's §4 (identity) and §5 (personas) refer to CLIENT-AND-OPERATIONS.md.

Offline `edit` predicts after the author leaves the conversation. Its new
image is hidden because the membership read rule no longer holds; a server
refusal restores the delivered retained image, which remains trusted.
See `guide prediction`.

## With `use server`

One `use server` in any module (`schema.q` is usual) enables the whole
project; repeating it is harmless. Actions, routes and schedules naming an
action require it. Effects (including secrets, retry, backoff, deadline and
cancellation), jobs, schedules naming a job and service seats need no directive.
See `guide actions`, `guide routes` and `guide jobs`."##;
