effect notify

query connections(principal: principal):
  return connected[principal]

effect pushCandidate

mutation dispatch(targetUserId: principal, chatId: id, senderDisplayName: text 1..50, preview: text <=80):
  require viewer = 'service:worker' else SERVICE_ONLY
  if not replayMode() and not exists connected[targetUserId]:
    emit notify { targetUserId, chatId, senderDisplayName, preview }
  return null
