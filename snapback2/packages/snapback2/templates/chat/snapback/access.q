fn isMember(c: conversations, p: principal): exists memberships[c, p]
fn isAdmin(c: conversations, p: principal): exists memberships[c, p, 'admin']
fn conversationMembers(c: conversations): memberships[c] first 50 by byConversationPrincipal
