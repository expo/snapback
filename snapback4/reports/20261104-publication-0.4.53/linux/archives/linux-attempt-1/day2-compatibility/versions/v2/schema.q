use identity guests
table notes:
  title: text <=80
  color: text <=20 default 'blue'
  public 'shared'
  insert <- allow
  update <- allow
query list():
  return notes first 20 by .id
mutation add(title: text <=80):
  return insert notes { title }
mutation paint(id: notes, color: text <=20):
  update notes[id] { color }
