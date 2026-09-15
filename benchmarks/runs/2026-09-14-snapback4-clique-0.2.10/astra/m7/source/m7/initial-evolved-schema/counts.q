-- Stored aggregate, exposed as the messageCount field of every conversation.
-- countWeight is backfilled before the evolved app is admitted.
maintain conversationMessageCounts: sum messages of countWeight by conversationId
  read <- exists members[.conversationId, viewer]

shape conversationCard = { *, messageCount: conversationMessageCounts[.id] }

job backfill():
  chunk m in messages first 100 by byId:
    update messages[m.id] { countWeight: 0 if m.deleted = true else 1 }
