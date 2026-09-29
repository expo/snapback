effect notify
fn notifyRecipients():
  emit notify { text: 'hello' }
mutation send():
  notifyRecipients()
