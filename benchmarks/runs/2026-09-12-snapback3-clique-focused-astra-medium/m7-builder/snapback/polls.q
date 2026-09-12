mutation create(id: messages, conversationId: conversations, question: text 1..200, optionA: text 1..50, optionB: text 1..50, optionC: text 1..50 ?, optionD: text 1..50 ?):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  require conversations[id=conversationId].kind = "group" else GROUP_ONLY
  require optionD = null or optionC != null else BAD_OPTIONS
  require conversations[id=conversationId].messageCount != null else COUNT_NOT_MIGRATED
  insert messages { id: id, conversationId: conversationId, senderId: viewer, text: question, type: "poll", serverTimestamp: now, replyTo: null, edited: false, tombstone: false }
  insert polls { id: id, messageId: id, conversationId: conversationId, question: question, optionA: optionA, optionB: optionB, optionC: optionC, optionD: optionD }
  update conversations[id=conversationId] { messageCount: (conversations[id=conversationId].messageCount ?? 0) + 1 }
  return messages[id=id]

query get(conversationId: conversations, pollId: polls):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  poll = polls[id=pollId] ! else NOT_FOUND
  require poll.conversationId = conversationId else WRONG_CONVERSATION
  return { poll: poll, mine: votes[pollId=pollId, userId=viewer].optionId, a: pollTallies[conversationId=conversationId, pollId=pollId, optionId="a"], b: pollTallies[conversationId=conversationId, pollId=pollId, optionId="b"], c: pollTallies[conversationId=conversationId, pollId=pollId, optionId="c"], d: pollTallies[conversationId=conversationId, pollId=pollId, optionId="d"] }

mutation vote(pollId: polls, optionId: text 1..1):
  poll = polls[id=pollId] ! else NOT_FOUND
  require exists members[conversationId=poll.conversationId, userId=viewer] else NOT_MEMBER
  require messages[id=poll.messageId].tombstone = false else DELETED
  require optionId = "a" or optionId = "b" or (optionId = "c" and poll.optionC != null) or (optionId = "d" and poll.optionD != null) else BAD_OPTION
  upsert votes[pollId=pollId, userId=viewer] { pollId: pollId, conversationId: poll.conversationId, userId: viewer, optionId: optionId }
  return true
