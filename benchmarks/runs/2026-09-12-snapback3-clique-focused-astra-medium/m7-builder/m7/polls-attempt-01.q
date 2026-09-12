mutation create(id: messages, conversationId: conversations, question: text 1..200, optionA: text 1..50, optionB: text 1..50, optionC: text 1..50 ?, optionD: text 1..50 ?):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  require conversations[id=conversationId].kind = "group" else GROUP_ONLY
  require optionD = null or optionC != null else BAD_OPTIONS
  require conversations[id=conversationId].messageCount != null else COUNT_NOT_MIGRATED
  insert messages { id: id, conversationId: conversationId, senderId: viewer, text: question, type: "poll", serverTimestamp: now, replyTo: null, edited: false, tombstone: false }
  insert polls { id: id, conversationId: conversationId, question: question, optionA: optionA, optionB: optionB, optionC: optionC, optionD: optionD }
  update conversations[id=conversationId] { messageCount: conversations[id=conversationId].messageCount + 1 }
  return messages[id=id]

query get(conversationId: conversations, pollId: polls):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  poll = polls[id=pollId] ! else NOT_FOUND
  require poll.conversationId = conversationId else WRONG_CONVERSATION
  return { poll: poll, mine: votes[pollId=pollId, userId=viewer].optionId, a: count(votes[conversationId=conversationId, pollId=pollId, optionId="a"] first 10000 by byPoll), b: count(votes[conversationId=conversationId, pollId=pollId, optionId="b"] first 10000 by byPoll), c: count(votes[conversationId=conversationId, pollId=pollId, optionId="c"] first 10000 by byPoll), d: count(votes[conversationId=conversationId, pollId=pollId, optionId="d"] first 10000 by byPoll) }

mutation vote(pollId: polls, optionId: text 1..1):
  poll = polls[id=pollId] ! else NOT_FOUND
  require exists members[conversationId=poll.conversationId, userId=viewer] else NOT_MEMBER
  require messages[id=pollId].tombstone = false else DELETED
  require optionId = "a" or optionId = "b" or (optionId = "c" and poll.optionC != null) or (optionId = "d" and poll.optionD != null) else BAD_OPTION
  upsert votes[pollId=pollId, userId=viewer] { pollId: pollId, conversationId: poll.conversationId, userId: viewer, optionId: optionId }
  return true
