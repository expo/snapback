table employees:
  name: text <=80
  title: text <=100
  manager: employees          -- absent at the top

query chain(e: employees):
  walk e up .manager depth 12
