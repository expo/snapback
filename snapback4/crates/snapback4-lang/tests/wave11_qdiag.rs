use snapback4_lang::compile;
fn checked(source: &str) -> snapback4_lang::Bound { compile(&[("schema.q".into(), source.into())]) }
const REFS: &str = "table parents:\n  read <- allow\ntable kids:\n  parent: parents ? on delete keep\n  read <- allow\n  insert <- allow\n";
#[test]
fn optional_reference_checks_join_the_null_edge() {
    for condition in ["parent != null", "not (parent = null)", "null != parent"] {
        let b = checked(&format!("{REFS}mutation add(parent: parents ?):\n  if {condition}:\n    row = parents[parent] ! else NOT_FOUND\n  insert kids {{ parent }}\n"));
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        assert!(!b.notes.iter().any(|n| n.code == "N_REFERENCE_UNCHECKED"), "{:?}", b.notes);
    }
    for body in ["  if parent != null:\n    unused = true\n", "  if parent != null and skip:\n    row = parents[parent] ! else NOT_FOUND\n"] {
        let b = checked(&format!("{REFS}mutation add(parent: parents ?, other: parents ?, skip: bool):\n{body}  insert kids {{ parent }}\n"));
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        assert!(b.notes.iter().any(|n| n.code == "N_REFERENCE_UNCHECKED"), "{:?}", b.notes);
    }
}
#[test]
fn syntax_repairs_name_the_actual_form() {
    let b = checked("mutation add(body: text <=20 = 'hi'):\n  return body\n");
    assert!(b.diagnostics.iter().any(|d| d.rewrite.contains("body ?? 'hi'") && d.rewrite.contains("text <=20 ?")), "{:?}", b.diagnostics);
    let b = checked("mutation add(a: bool, b: bool):\n  require (a or\n    b)\n  else NOPE\n  return true\n");
    assert!(b.diagnostics.iter().any(|d| d.rewrite.contains("closing line") && d.rewrite.contains("else NOPE")), "{:?}", b.diagnostics);
    let b = checked("table parents:\n  public\ntable kids:\n  parent: parents on delete keep ?\n");
    assert!(b.diagnostics.iter().any(|d| d.rewrite == "parent: parents ? on delete keep"), "{:?}", b.diagnostics);
}

#[test]
fn whole_cascade_recipe_fits_once_across_children() {
    let source="table roots:\n  owner: principal\n  read <- .owner = viewer\n  delete <- .owner = viewer\n  sync\ntable votes:\n  root: roots on delete cascade\n  owner: principal\n  read <- .owner = viewer\n  sync\ntable comments:\n  root: roots on delete cascade\n  owner: principal\n  body: text <=10000\n  read <- .owner = viewer\n  sync\nmutation remove(root: roots):\n  delete roots[root]\n";
    for source in [source.to_owned(),source.replace("  owner: principal\n  read <- .owner = viewer\n  sync\ntable comments:","  owner: principal\n  cap 500 by root\n  read <- .owner = viewer\n  sync\ntable comments:").replace("  body: text <=10000\n","  body: text <=10000\n  cap 500 by root\n")] {
        let b=checked(&source);
        let d=b.diagnostics.iter().find(|d|d.code=="E_CASCADE_BOUND").unwrap_or_else(||panic!("{:?}",b.diagnostics));
        assert!(d.rewrite.contains("heap bytes") && d.rewrite.contains("3 ×"),"{}",d.rewrite);
        let caps: Vec<_>=d.rewrite.split('`').filter(|s|s.starts_with("cap ")).collect();
        assert_eq!(caps.len(),2,"{}",d.rewrite);
        let edited=source.lines().filter(|line|!line.trim().starts_with("cap 500")).collect::<Vec<_>>().join("\n");
        let edited=edited.replace("  root: roots on delete cascade",&format!("  root: roots on delete cascade\n  {}",caps[0]));
        let fixed=checked(&(edited+"\n"));
        assert!(fixed.diagnostics.is_empty(),"{}\n{:?}",d.rewrite,fixed.diagnostics);
        let price=fixed.schema.delete_total_reservation("roots").unwrap();
        let ceiling=snapback4_core::Ceilings::default();
        assert!(price[3]<=ceiling.rows_written && price[4]<=ceiling.heap_bytes,"{price:?}");
    }
}
const COERCION: &str="table parents:\n  name: text <=20\n  read <- allow\n  insert <- allow\ntable kids:\n  parent: parents on delete keep\n  read <- allow\n  insert <- allow\nfn label(p: parents): p.name\nquery parentName(p: parents):\n  return parents[p] { name }\nmutation add(id: id):\n  p = insert parents { id, name: 'new' }\n  insert kids { id: 'child', parent: p }\n  return { label: label(p), key: parents[p] }\n";
#[test]
fn contextual_row_ids_preserve_helper_snapshots_and_explicit_ir() {
    let implicit=checked(COERCION);
    assert!(implicit.diagnostics.is_empty(),"{:?}",implicit.diagnostics);
    let explicit=checked(&COERCION.replace("parent: p }","parent: p.id }").replace("key: parents[p]","key: parents[p.id]"));
    assert!(explicit.diagnostics.is_empty(),"{:?}",explicit.diagnostics);
    fn erase_sites(v:&mut serde_json::Value) { match v { serde_json::Value::Object(o)=> { o.remove("site"); for v in o.values_mut(){erase_sites(v);} }, serde_json::Value::Array(a)=>for v in a{erase_sites(v);},_=>{} } }
    let programs=|b:&snapback4_lang::Bound| {let mut v=serde_json::to_value(b.programs.iter().map(|p|&p.program).collect::<Vec<_>>()).unwrap();erase_sites(&mut v);v};
    assert_eq!(programs(&implicit),programs(&explicit));
    for source in [COERCION.replace("parent: p }","parent: (parents[id]) }"),COERCION.replace("id: 'child', parent: p","id: p, parent: p"),COERCION.replace("table kids:","table strangers:\n  public\ntable kids:").replace("parent: parents on delete keep","parent: strangers on delete keep")] {
        let refused=checked(&source); assert!(!refused.diagnostics.is_empty(),"unexpectedly accepted: {source}");
    }
}
#[test]
fn media_units_and_precise_type_repairs() {
    let b=checked("table pictures:\n  photo: image <=5MB\n  video: video <=2GB ?\n  public\n");
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(checked("table pictures:\n  photo: image <=5GB\n").diagnostics.iter().any(|d|d.message.contains("4,294,967,295")));
    assert!(checked("table pictures:\n  photo: image\n").diagnostics.iter().any(|d|d.rewrite.contains("image <=5MB")));
    let b=checked("table values:\n  owner: principal\n  n: int 1..100 ?\n  public\nview totals: sum values of .n by .owner\n");
    assert!(b.diagnostics.iter().any(|d|d.message.contains("optional") && d.message.contains("range is accepted")),"{:?}",b.diagnostics);
    let b=checked("table names:\n  name: text <=10\n  public\nmutation add(name: text <=10):\n  insert names { name: lower(name) }\n");
    assert!(b.diagnostics.iter().any(|d|d.rewrite.contains("Unicode") && d.rewrite.contains("3 ×")),"{:?}",b.diagnostics);
    let b=checked("query q(text: text <=20, q: text <=10):\n  return text matching q first 5 by .id\n");
    assert!(b.diagnostics.iter().any(|d|d.rewrite.contains("tokens(text)")),"{:?}",b.diagnostics);
}
#[test]
fn seats_and_hidden_refusal_order_have_actionable_notes() {
    let b=checked("use personas alice\ntable rows:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\nmutation create(owner: principal):\n  require viewer = 'service:ops' else NOPE\n  insert rows { owner }\nmutation access(row: rows):\n  r = rows[row] ! else NOT_FOUND\n  require r.owner = viewer else NOT_OWNER\n  return r\nmutation bad():\n  insert rows { owner: 'alice' }\n");
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    for (code,word) in [("N_WRITE_DENIED","or viewer = 'service:ops'"),("N_REQUIRE_HIDDEN","never NOT_OWNER"),("N_PERSONA_PRINCIPAL","dev:alice")] {assert!(b.notes.iter().any(|n|n.code==code && (n.message.contains(word)||n.rewrite.contains(word))),"{:?}",b.notes);}
}
#[test]
fn small_population_filter_and_verified_child_ownership_are_quiet(){
 let source="table rows:\n  owner: principal\n  score: int\n  cap 20\n  public\nquery page(c: cursor ?):\n  return rows where .score > 0 first 10 by .id after c\n";
 assert!(!checked(source).notes.iter().any(|n|n.code=="N_SPARSE_FILTER"));
 let source="table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\ntable kids:\n  parent: parents on delete keep\n  owner: principal\n  unique parent\n  immutable parent,owner\n  read <- .owner = viewer\n  insert <- .owner = viewer and .parent.owner = viewer\nmutation check(parent: parents):\n  p = parents[parent] ! else NOT_FOUND\n  require p.owner = viewer else NOPE\n  require not exists kids[parent = parent] else HAS_CHILD\n  return true\nquery list(c: cursor ?):\n  return parents first 10 by .id after c { id, has: exists kids[parent = .id] }\n";
 let b=checked(source);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 assert!(!b.notes.iter().any(|n|n.code=="N_UNREADABLE_PROBE" && n.message.contains("kids")),"{:?}",b.notes);
 let unverified=checked(&source.replace("and .parent.owner = viewer",""));
 assert!(unverified.notes.iter().any(|n|n.code=="N_UNREADABLE_PROBE" && n.message.contains("kids")));
}

#[test]
fn every_prescribed_syntax_rewrite_compiles() {
 for source in [
  "mutation add(body: text <=20 ?):\n  bodyValue = body ?? 'hi'\n  return bodyValue\n",
  "mutation add(a: bool,b: bool):\n  require (a or\n    b) else NOPE\n  return true\n",
  "table parents:\n  public\ntable kids:\n  parent: parents ? on delete keep\n",
  "table values:\n  owner: principal\n  n: int 1..100\n  public\nview totals: sum values of .n by .owner\n",
  "query check(text: text <=20,q: text <=10):\n  return q in tokens(text)\n",
 ] { assert!(checked(source).diagnostics.is_empty(),"{source}: {:?}",checked(source).diagnostics); }
}
#[test]
fn maintained_sum_bulk_unwind_is_an_ordinary_job() {
 let source="table parents:\n  public\n  delete <- allow\ntable kids:\n  parent: parents on delete cascade\n  owner: principal\n  n: int\n  cap 20 by parent\n  public\nview totals: sum kids of .n by .owner\n";
 let b=checked(source);assert!(b.diagnostics.iter().any(|d|d.code=="E_REFERENCE_ACTION" && d.rewrite.contains("each delete updates the sum")),"{:?}",b.diagnostics);
 let fixed=source.replace("on delete cascade","on delete restrict")+"job unwind():\n  for row in kids:\n    delete kids[row.id]\n";
 assert!(checked(&fixed).diagnostics.is_empty(),"{:?}",checked(&fixed).diagnostics);
}
#[test]
fn defaults_and_job_literals_use_the_persona_note() {
 let b=checked("use personas alice\ntable profiles:\n  owner: principal default 'alice'\n  public\n  insert <- allow\njob build():\n  for row in profiles:\n    insert profiles { owner:'alice' }\n");
 assert_eq!(b.notes.iter().filter(|n|n.code=="N_PERSONA_PRINCIPAL").count(),2,"{:?}",b.notes);
}
#[test]
fn media_unit_spelling_has_identical_backend_bounds_and_model_exclusion(){
 let units="table media:\n  photo: image <=5MB\n  clip: video <=2GB ?\n  public\n";
 let bytes=units.replace("5MB","5000000").replace("2GB","2000000000");
 let a=checked(units);let b=checked(&bytes);assert!(a.diagnostics.is_empty() && b.diagnostics.is_empty());
 assert_eq!(a.schema,b.schema);
 let model=|source:&str|format!("{:?}",snapback4_lang::emit::lean::lean(&[("schema.q".into(),source.into())]).unwrap_err());
 assert_eq!(model(units),model(&bytes));
}
#[test]
fn nested_cascade_has_one_consistent_recipe_for_the_authored_root(){
 let source="table roots:\n  public\n  delete <- allow\ntable children:\n  root: roots on delete cascade\n  public\ntable leaves:\n  child: children on delete cascade\n  public\nmutation remove(root: roots):\n  delete roots[root]\n";
 let b=checked(source);let ds=b.diagnostics.iter().filter(|d|d.code=="E_CASCADE_BOUND").collect::<Vec<_>>();assert_eq!(ds.len(),1,"{:?}",b.diagnostics);
 let caps=ds[0].rewrite.split('`').filter(|s|s.starts_with("cap ")).collect::<Vec<_>>();assert_eq!(caps.len(),2);
 let fixed=source.replace("  root: roots on delete cascade",&format!("  root: roots on delete cascade\n  {}",caps.iter().find(|c|c.ends_with("by root")).unwrap())).replace("  child: children on delete cascade",&format!("  child: children on delete cascade\n  {}",caps.iter().find(|c|c.ends_with("by child")).unwrap()));
 assert!(checked(&fixed).diagnostics.is_empty(),"{:?}",checked(&fixed).diagnostics);
}
#[test]
fn owner_equality_does_not_survive_kept_parent_recreation_or_expiry(){
 let base="table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\ntable kids:\n  parent: parents on delete keep\n  owner: principal\n  unique parent\n  immutable parent,owner\n  read <- .owner = viewer\n  insert <- .owner = viewer and .parent.owner = viewer\nmutation probe(parent: parents):\n  p = parents[parent] ! else NOT_FOUND\n  require not exists kids[parent = parent] else HAS_CHILD\n  return true\n";
 assert!(!checked(base).notes.iter().any(|n|n.code=="N_UNREADABLE_PROBE"));
 for source in [base.replace("  insert <- .owner = viewer\ntable kids:","  insert <- .owner = viewer\n  delete <- .owner = viewer\ntable kids:"),base.replace("  immutable owner\n","  immutable owner\n  until: time\n  index until\n  expire at .until\n"),base.replace("table parents:\n","table roots:\n  public\n  delete <- allow\ntable parents:\n  root: roots on delete cascade\n  cap 1 by root\n")] {
  let b=checked(&source);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.notes.iter().any(|n|n.code=="N_UNREADABLE_PROBE"),"{:?}",b.notes);
 }
}
#[test]
fn nested_read_alternatives_can_reach_the_custom_require(){
 let source="table rows:\n  owner: principal\n  read <- (.owner = viewer or viewer = 'service:ops') and viewer != 'blocked'\nmutation access(row: rows):\n  r = rows[row] ! else NOT_FOUND\n  require r.owner = viewer else NOT_OWNER\n  return r\n";
 let b=checked(source);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(!b.notes.iter().any(|n|n.code=="N_REQUIRE_HIDDEN"),"{:?}",b.notes);
 let owner=checked(&source.replace("(.owner = viewer or viewer = 'service:ops')", "(.owner = viewer or .owner = viewer)"));assert!(owner.notes.iter().any(|n|n.code=="N_REQUIRE_HIDDEN"));
}
#[test]
fn required_row_expression_keys_keep_intrinsic_identity_precedence(){
 let source="table parents:\n  sibling: parents ? on delete keep\n  unique sibling\n  public\nquery get(p: parents):\n  return parents[parents[p] ! else NOT_FOUND]\n";
 let b=checked(source);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let explicit=checked(&source.replace("return parents[parents[p] ! else NOT_FOUND]","return parents[(parents[p] ! else NOT_FOUND).id]"));assert!(explicit.diagnostics.is_empty(),"{:?}",explicit.diagnostics);
 let strip=|b:&snapback4_lang::Bound|{let mut v=serde_json::to_value(&b.programs[0].program).unwrap();fn erase(v:&mut serde_json::Value){match v{serde_json::Value::Object(o)=>{o.remove("site");for v in o.values_mut(){erase(v);}},serde_json::Value::Array(a)=>for v in a{erase(v);},_=>{}}}erase(&mut v);v};assert_eq!(strip(&b),strip(&explicit));
}
