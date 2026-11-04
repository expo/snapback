use identity guests
table notes:
  title: text <=80
  public 'shared'
  insert <- allow
  update <- allow
query list():
  return notes first 20 by .id
mutation add(title: text <=80):
  return insert notes { title }
