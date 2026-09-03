mutation updateId(owner: principal):
  update keyedRows[owner] { id: new, label: "changed" }
  return true

mutation upsertId(owner: principal):
  upsert keyedRows[owner] { id: new, label: "changed" }
  return true
