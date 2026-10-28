//! Release admission before opening an archived population.
use snapback4_lang::{compile,release_bridge};
fn source(s:&str)->Vec<(String,String)>{vec![("schema.q".into(),s.into())]}
#[test]
fn global_and_grouped_caps_keep_their_authored_population(){
 for cap in ["cap 100", "cap 100 by owner"] {
  let old=format!("table jobs:\n  owner: principal\n  amount: int 0..10\n  {cap}\n  public\n  online only\n");
  let new=old.replace("amount: int 0..10","amount: int 0..20");
  let bridge=release_bridge::loosen(&source(&old),&source(&new));assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
  let b=compile(&bridge.sources);assert!(b.schema.tables["jobs"].constraints.contains(&snapback4_core::schema::Constraint::Cap{by:if cap.contains("by"){vec!["owner".into()]}else{vec![]},max:100}));
 }
}
#[test]
fn extraction_nonliteral_defaults_are_named_before_adoption(){
 let base="table jobs:\n  createdAt: time default now\n  public\n  online only\ntable photos:\n  job: jobs on delete cascade\n  photo: file <=1000 ?\n  immutable job\n  read through .job\n  online only\nextract photos from jobs via job: {photo:photo}\n";
 for default in ["time default now","principal default viewer"] {
  let bad=base.replace("table photos:\n",&format!("table photos:\n  born: {default}\n"));let b=compile(&source(&bad));
  assert!(b.diagnostics.iter().any(|d|d.message.contains("photos.born")&&d.rewrite.contains("literal default")),"{:?}",b.diagnostics);
 }
 for column in ["born: time ?","born: time default 0"] {
  let good=base.replace("table photos:\n",&format!("table photos:\n  {column}\n"));let b=compile(&source(&good));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 }
 let mapped=base.replace("table photos:\n","table photos:\n  born: time default now\n").replace("{photo:photo}","{photo:photo,born:createdAt}");let b=compile(&source(&mapped));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
}
