//! Original schemas copied read-only from wave16-repro; input hashes and
//! source provenance live in reports/20261018-sec/inputs.json.
use snapback4_lang::{compile,security};
const CASES:&[(&str,&str,&str)]=&[
("015",include_str!("security/wave16/015.q"),"invariant pets always .currentFoster = null or exists handoffs[pet = .id, toParty = .currentFoster]"),
("019",include_str!("security/wave16/019.q"),"invariant hives.read only .landOwner = viewer or (exists routes[inspector = viewer, route = .route] and exists roles[viewer, role = 'inspector']) or exists roles[viewer, role = 'lead']"),
("020",include_str!("security/wave16/020.q"),"invariant vehicles.liftHold only exists roster[principal = viewer, role = 'liaison']"),
("021",include_str!("security/wave16/021.q"),"invariant directors.createTournament only exists directors[viewer] or viewer = 'service:ops'"),
("045",include_str!("security/wave16/045.q"),"invariant repairNotes.read only exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']"),
("048",include_str!("security/wave16/048.q"),"invariant gauges.read only exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'engineer'] or (exists assignments[.id, viewer] and exists roles[viewer, role = 'contractor'])"),
];
#[test]fn original_high_finding_rules_receive_concrete_engine_counterexamples(){
 for (number,source,policy) in CASES {
  let b=compile(&[("schema.q".into(),format!("{source}\n{policy}\n"))]);assert!(b.diagnostics.is_empty(),"{number}: {:?}",b.diagnostics);
  let campaign=security::challenges::run(&b);println!("{number}: {}",serde_json::to_string(&campaign).unwrap());
  assert!(!campaign.violations.is_empty(),"{number}: {campaign:?}");
 }
}

#[test]fn repaired_authority_rules_refuse_the_same_generated_adversaries(){
 for (number,source,policy) in CASES.iter().filter(|(n,_,_)|*n!="015") {
  let fixed=match *number{
   "019"=>source.replace("read <- .landOwner = viewer or exists routes[inspector = viewer, route = .route] or exists roles[viewer, role = 'lead']","read <- .landOwner = viewer or (exists routes[inspector = viewer, route = .route] and exists roles[viewer, role = 'inspector']) or exists roles[viewer, role = 'lead']"),
   "020"=>source.replace("require exists roster[principal = viewer, role = 'liaison'] or exists roster[principal = viewer, role = 'manager'] else NOT_LIAISON","require exists roster[principal = viewer, role = 'liaison'] else NOT_LIAISON"),
   "021"=>source.replace("mutation createTournament(code: text 1..40, name: text 1..120, briefDeadline: time):","mutation createTournament(code: text 1..40, name: text 1..120, briefDeadline: time):\n  require exists directors[viewer] or viewer = 'service:ops' else NOT_DIRECTOR"),
   "045"=>source.replace("read <- exists roles[viewer, role = 'luthier'] or exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']","read <- exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']"),
   "048"=>source.replace("read <- exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'engineer'] or exists assignments[.id, viewer]","read <- exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'engineer'] or (exists assignments[.id, viewer] and exists roles[viewer, role = 'contractor'])"),_=>unreachable!()};
  assert_ne!(fixed,*source,"{number}: patch must apply");let b=compile(&[("schema.q".into(),format!("{fixed}\n{policy}\n"))]);assert!(b.diagnostics.is_empty(),"{number}: {:?}",b.diagnostics);
  let campaign=security::challenges::run(&b);assert!(campaign.attempted>0,"{number}: not exercised");assert!(campaign.violations.is_empty(),"{number}: {campaign:?}");
 }
}
