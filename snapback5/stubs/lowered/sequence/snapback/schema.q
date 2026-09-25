-- Exact proposed LLP 3000.015 §2 addition.
table conversations:
  title: text
  public
table messages:
  conversationId: conversations
  ordinal: sequence by conversationId
  public
