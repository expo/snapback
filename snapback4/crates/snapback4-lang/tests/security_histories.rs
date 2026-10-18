use snapback4_lang::{compile,security};
use snapback4_core::{Engine,Value};
const SOURCE:&str="use personas alice, bob\ntable roles:\n  principal: principal\n  role: enum('inspector', 'member')\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:ops'\n  update <- viewer = 'service:ops'\n  online only\ntable grants:\n  principal: principal\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:ops'\n  online only\ntable reports:\n  body: text <=80\n  read <- exists grants[viewer]\n  online only\nmutation grant(who: principal):\n  return insert grants { principal: who }\nmutation demote(who: principal):\n  update roles[who] { role: 'member' }\n  return null\ninvariant reports.read only exists roles[viewer, role = 'inspector']\n";
fn row(fields:&[(&str,Value)])->Value{Value::Row(fields.iter().map(|(n,v)|(n.to_string(),v.clone())).collect())}
#[test]
fn actual_grant_demotion_and_read_has_a_replayable_trace(){
 for fixed in [false,true]{
  let source=if fixed{SOURCE.replace("read <- exists grants[viewer]","read <- exists grants[viewer] and exists roles[viewer, role = 'inspector']")}else{SOURCE.into()};
  let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  let mut fixture=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
  fixture.seed_at(vec![("roles".into(),row(&[("id",Value::Id("role-a".into())),("principal",Value::Id("dev:security-a".into())),("role",Value::String("inspector".into()))])),
   ("reports".into(),row(&[("id",Value::Id("report".into())),("body",Value::String("private".into()))]))],1_800_000_000_000).unwrap();
  let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
  assert!(c.sequences>0);assert_eq!(c.violations.is_empty(),fixed,"{c:?}");
  if !fixed{assert!(c.violations.iter().any(|v|v.history.iter().any(|s|s.operation=="grant")&&v.history.iter().any(|s|s.operation=="demote")),"{c:?}");}
 }
}
#[test]
fn all_named_service_seats_and_enum_argument_tuples_are_exercised(){
 let b=compile(&[("schema.q".into(),"use personas alice, bob\ntable notes:\n  role: text <=20\n  read <- viewer = 'service:one' or viewer = 'service:two'\n  online only\ninvariant notes.read only viewer != 'service:policy-only'\nquery inspect(a: enum('one','two','three'), b: enum('x','y'), c: enum('u','v') ?):\n  require viewer != 'service:program-only' else DIFFERENT_SEAT\n  return { a, b, c, who: viewer }\n".into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let fixture=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
 // Four generic viewers, two personas and four seats (including operation-only
 // and intent-only literals) × eighteen tuples, including nullable variants.
 assert_eq!(c.operations["inspect"],10*18,"{c:?}");
}

#[test]
fn generated_foreign_asset_and_non_image_challenges_use_real_ledgers(){
 let b=compile(&[("schema.q".into(),"table photos:\n  owner: principal\n  image: image <=5000\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\ntable documents:\n  owner: principal\n  attachment: file <=5000 ('application/pdf')\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation photo(image: image <=5000):\n  return insert photos { owner: viewer, image }\nmutation attach(attachment: file <=5000 ('application/pdf')):\n  return insert documents { owner: viewer, attachment }\n".into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let fixture=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
 assert!(c.boundary_failures.is_empty(),"{c:?}");assert!(c.attempted>=3);
 assert_eq!(c.operations["photo"],6,"four ordinary viewers plus foreign-image and non-image ledger challenges: {c:?}");
 assert_eq!(c.operations["attach"],5,"four ordinary viewers plus the foreign-file ledger challenge: {c:?}");
}
