// Deterministic schema family: renamed audience fields, two/three-hop paths,
// optional retention and child horizons. Both spellings retain source layout.
pub fn source(depth: usize, sugar: bool, keep: bool, horizon: bool, field: &str) -> String {
    let middle = if depth == 3 { format!("table links:\n  message: messages\n  immutable message\n  read through .message\n  insert <- allow\n  sync\n") } else { String::new() };
    let parent = if depth == 3 { "links" } else { "messages" };
    let path = if depth == 3 { format!("parent.message.{field}") } else { format!("parent.{field}") };
    let read = if sugar { format!("read <- exists members[.{path}, viewer]") } else { "read through .parent".into() };
    let audience = if sugar { format!("sync to members[.{path}]") } else { "sync".into() };
    let retain = if keep { "retain delivered-history" } else { "retain until-revoked" };
    let window = if horizon { " last 2 by .id" } else { "" };
    format!(r#"table groups:
  title: text <=20
  public
  insert <- allow
  sync public

table members:
  {field}: groups
  principal: principal
  unique {field}, principal
  immutable {field}, principal
  cap 50 by {field}
  read <- exists members[.{field}, viewer]
  insert <- exists members[.{field}, viewer] or created groups[.{field}]
  delete <- allow
  sync

table messages:
  {field}: groups
  immutable {field}
  read <- exists members[.{field}, viewer]
  insert <- allow
  update <- allow
  {retain}
  sync last 10 by .id

{middle}
table reactions:
  parent: {parent}
  principal: principal
  emoji: text <=32
  immutable parent, principal
  unique parent, principal
  cap 50 by parent
  {read}
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  {retain}
  {audience}{window}

query page(parent: {parent}):
  return reactions where .parent = parent by .principal

mutation react(parent: {parent}, emoji: text <=32, allowed: bool):
  require allowed else REACTION_REFUSED
  return upsert reactions[parent, viewer] {{ emoji }}

mutation membership(group: groups, who: principal, present: bool):
  if present:
    insert members {{ {field}: group, principal: who }} if absent
  else:
    delete members[group, who]

mutation move(message: messages, group: groups):
  update messages[message] {{ {field}: group }}
"#)
}
