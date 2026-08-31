table employees:
  name: text <=80
  title: text <=100
  manager: employees          -- absent at the top

query chain(employeeId: employees):
  walk employees[employeeId] up .manager depth 12
