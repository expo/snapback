use server
-- The chat backend as Snapback 4 wants to read it. This file is the desired
-- authoring surface (LLP 2000 §4: write the application in the interface we
-- wish to provide); nothing compiles it until week 2. It is the Snapback 2
-- chat schema with one word changed per table: `sync` (LLP 2000.000 §7.1)
-- says which rows reach a viewer's device and how far back. Everything the
-- certifier keeps — rules, indexes, caps, `deliver`'s audience computation —
-- is unchanged in meaning.

use identity -- This starter mints guests; an email-and-password product declares `use identity password`.
use personas alice, bob, charlie

action invite(email: text <=200)

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  avatarUrl: text <=2048 format url ?
  unique byPrincipal: principal
  unique byHandle: handle
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  sync last 2000 by byHandle        -- everyone holds the same bounded partition

table conversations:
  title: text <=120
  creatorId: principal
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- deny
  delete <- deny
  after insert <- exists memberships[conversationId = .id, principal = .creatorId, role = 'admin']
  sync                 -- a member's device holds its conversations

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
  insert <- exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  delete <- .principal = viewer or exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  sync     -- and the roster of each

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000 ?
  photo: image <=5000000 ?
  editedAt: time ?
  at: time
  by byConvTime: conversationId, at, id
  immutable conversationId, authorId
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  delete <- .authorId = viewer
  retain delivered-history                 -- an expelled member keeps what was delivered
  sync last 500 by byConvTime   -- the horizon: 500 per conversation

maintain messageCounts: count messages by conversationId
  read <- exists memberships[.conversationId, viewer]
  -- delivered into the partition as a value row: a count is a local fact

query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50 by byConvTime

query inbox():
  return memberships[viewer] first 50 by byPrincipalConversation
    { conversationId, conversation: conversations[.conversationId], count: messageCounts[.conversationId] }

mutation addMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] by byConversationPrincipalRole else NOT_ADMIN
  return insert memberships { conversationId, principal, role: 'member', joinedAt: now } if absent

mutation leave(conversationId: conversations):
  membership = memberships[conversationId, viewer] ! else NOT_MEMBER
  delete memberships[membership]
  return null

mutation send(conversationId: conversations, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, at: now }
  return { id: row.id }

mutation sendPhoto(conversationId: conversations, photo: image <=5000000, body: text <=4000 ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, photo, at: now }
  return { id: row.id }

mutation edit(messageId: messages, body: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  update messages[msg] { body, editedAt: now }
  return null

mutation unsend(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  delete messages[msg]
  return null

-- @ref LLP 3000.011.003.000#2 — navigation reads held facts before any mutation.
query myMembership(conversationId: conversations):
  return memberships[conversationId, viewer]

query room(conversationId: conversations):
  return { conversation: conversations[conversationId], membership: memberships[conversationId, viewer] }

-- Online-only state deliberately demonstrates a write with no predicted row.
-- It is not needed to render the held thread.
table readMarkers:
  conversationId: conversations
  principal: principal
  at: time
  unique byConversationPrincipal: conversationId, principal
  read <- .principal = viewer
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer and exists memberships[.conversationId, viewer]

mutation markRead(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  upsert readMarkers[conversationId, viewer] { at: now }
  return null
