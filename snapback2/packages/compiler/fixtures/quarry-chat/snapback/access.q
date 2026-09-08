fn isMember(c: conversations, p: principal) = exists memberships[c, p]
fn isAdmin(c: conversations, p: principal) = exists memberships[c, p, 'admin']
fn conversationMembers(c: conversations) = memberships[c] first 50 by byConversationPrincipal
fn conversationLog(c: conversations, p: principal) = deliveries[p, c, 'message'] last 50 by byRecipientConversationKindAt
fn conversationPreview(c: conversations, p: principal) = deliveries[p, c, 'message'] last 1 by byRecipientConversationKindAt
