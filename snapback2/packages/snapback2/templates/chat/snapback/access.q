fn isMember(c: conversations, p: principal) = exists memberships[c, p]
fn isAdmin(c: conversations, p: principal) = exists memberships[c, p, 'admin']
fn conversationMembers(c: conversations) = memberships[c] first 50 by byConversationPrincipal
fn conversationLog(c: conversations, p: principal) = deliveries[p, c, 'message'] last 50 by byRecipientConversationKindAt
fn conversationPreview(c: conversations, p: principal) = deliveries[p, c, 'message'] last 1 by byRecipientConversationKindAt

-- @ref LLP 1018.005#4-the-recipe — one fan-out, used by every mutation that writes a message event; kind is the event the recipients drain.
proc deliver(c: conversations, messageId: messages, kind: enum('message', 'edit', 'removed', 'expired')):
  for m in conversationMembers(c):
    insert deliveries { recipient: m.principal, conversationId: c, messageId, kind, at: now }
