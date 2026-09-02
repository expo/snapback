query unknownTable(id: id):
  return missing[id]

query unknownColumn(owner: principal):
  return items[absent = owner]

mutation unknownName():
  return nowhere
