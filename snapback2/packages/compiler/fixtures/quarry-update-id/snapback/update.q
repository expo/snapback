mutation updateId(owner: principal):
  ~keyedRows[owner] { id: new, label: "changed" }
  return true

mutation upsertId(owner: principal):
  +~keyedRows[owner] { id: new, label: "changed" }
  return true
