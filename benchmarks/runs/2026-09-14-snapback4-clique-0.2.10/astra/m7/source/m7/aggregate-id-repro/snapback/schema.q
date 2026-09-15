use personas alice

table votes:
  conversationKey: text 1..50
  messageKey: text 1..50
  optionKey: text 1..50
  public
  insert <- allow
  sync public

maintain tallies: count votes by conversationKey, messageKey, optionKey
  read <- allow

mutation add(conversationKey: text 1..50, messageKey: text 1..50, optionKey: text 1..50):
  insert votes { conversationKey, messageKey, optionKey }

query all():
  return votes first 10 by byId
