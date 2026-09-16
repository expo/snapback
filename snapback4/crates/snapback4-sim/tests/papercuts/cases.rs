pub const LISTS: &str = "table batches:
  recipients: [principal] <=3
  numbers: [int] <=3
  public 'batches'
  sync
  update <- allow
table members:
  principal: principal
  by byPrincipal: principal, id
  cap 3
  public 'members'
  sync
  update <- allow
effect notify
";

pub const LOOPS: &[(&str, &str, usize)] = &[
    ("column", "  batch = batches[batchId] ! else NOT_FOUND
  for p in batch.recipients:
    emit notify { recipient: p, numbers: batches[batchId].numbers }
", 2),
    ("scalar_column", "  batch = batches[batchId] ! else NOT_FOUND
  for p in batch.numbers:
    emit notify { recipient: p }
", 3),
    ("alias", "  batch = batches[batchId] ! else NOT_FOUND
  recipients = batch.recipients
  for p in recipients:
    emit notify { recipient: p }
", 2),
    ("filtered", "  recipients = []
  for m in members first 3 by byPrincipal:
    if m.principal != viewer:
      recipients = recipients + [m.principal]
  for p in recipients:
    emit notify { recipient: p }
", 2),
    ("shaped", "  recipients = members first 3 by byPrincipal { principal }
  for p in recipients:
    if p.principal != viewer:
      emit notify { recipient: p.principal }
", 2),
    ("helper", "  batch = batches[batchId] ! else NOT_FOUND
  recipients = recipientsOf(batch)
  for p in recipients:
    emit notify { recipient: p }
", 2),
];

pub fn loop_source(body: &str) -> String {
    format!("{LISTS}fn recipientsOf(batch: batches):
  return batch.recipients
mutation send(batchId: batches):
{body}  return true
")
}

pub fn profiles(hook: &str) -> String {
    format!("table profiles:
  handle: text 1..30
  unique byHandle: handle{hook}
  public 'profiles'
  sync
  insert <- allow
  update <- allow
mutation create(handle: text 1..30):
  return insert profiles {{ handle }}
mutation rename(profile: profiles, handle: text 1..30):
  update profiles[profile] {{ handle }}
mutation tryCreate(handle: text 1..30):
  return insert profiles {{ handle }} if absent
query all():
  return profiles first 10 by byId
")
}
