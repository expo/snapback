use snapback4_lang::compile;
const BASE: &str = "table roles:\n  principal: principal\n  role: enum('staff','customer')\n  unique principal\n  read <- .principal = viewer\n  online only\ntable things:\n  owner: principal\n  value: int\n  immutable owner\n  read <- POLICY\n  insert <- .owner = viewer\n  online only\nquery one(id: things):\n  return things[id]\n";
#[test]
fn audience_helpers_lower_to_the_exact_handwritten_rule() {
 let inline=BASE.replace("POLICY",".owner = viewer or exists roles[principal=viewer,role='staff']");
 let source=format!("fn owns(owner: principal): owner = viewer\nfn staff(): exists roles[principal=viewer,role='staff']\nfn audience(owner: principal): owns(owner) or staff()\n{}",BASE.replace("POLICY","audience(.owner)"));
 let a=compile(&[("schema.q".into(),inline)]);let b=compile(&[("schema.q".into(),source)]);
 assert!(a.diagnostics.is_empty(),"{:?}",a.diagnostics);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 assert_eq!(a.schema.tables["things"].rules.read,b.schema.tables["things"].rules.read);
 assert_eq!(a.schema.tables["roles"].indexes,b.schema.tables["roles"].indexes);
}
#[test]
fn rule_helpers_refuse_bad_types_cycles_effects_and_accidental_capture() {
 for (function,policy) in [
  ("fn audience(owner: int): owner = 1", "audience(.owner)"),
  ("fn audience(): audience()", "audience()"),
  ("fn audience(): nested()\nfn nested(): audience()", "audience()"),
  ("fn audience(): .owner = viewer", "audience()"),
  ("fn audience(owner: principal): now = 1", "audience(.owner)"),
  ("fn audience(viewer: principal): viewer = viewer", "audience(.owner)"),
  ("fn audience(owner: principal):\n  require true else BAD\n  return owner = viewer", "audience(.owner)"),
  ("fn audience(owner: principal): owner = viewer", "audience()"),
 ] {
  let source=format!("{function}\n{}",BASE.replace("POLICY",policy));
  let b=compile(&[("schema.q".into(),source.clone())]);
  let expected=if function.contains("audience(viewer:"){ "E_QUARRY_RESERVED" }else{ "E_QUARRY_RULE_OPERATOR" };
  assert!(b.diagnostics.iter().any(|d|d.code==expected),"{source}\n{:?}",b.diagnostics);
 }
}
#[test]
fn helper_expansion_is_bounded_before_planning() {
 let mut functions=String::from("fn leaf(owner: principal): owner = viewer\n");
 let mut previous=String::from("leaf");
 for i in 0..9 {let name=format!("level{i}");functions.push_str(&format!("fn {name}(owner: principal): {previous}(owner) and {previous}(owner)\n"));previous=name;}
 let b=compile(&[("schema.q".into(),functions+&BASE.replace("POLICY",&format!("{previous}(.owner)")))]);
 assert!(b.diagnostics.iter().any(|d|d.code=="E_QUARRY_RULE_OPERATOR"),"{:?}",b.diagnostics);
}
