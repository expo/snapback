//! SEC5 advice works without an invariant and remains non-refusing.
use snapback4_lang::{compile,security};
fn notes(source:&str)->Vec<snapback4_lang::Diagnostic>{let sources=vec![("schema.q".into(),source.into())];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&sources,&b);assert!(!r.refuted());r.notes}
const ROLES:&str="table roles:\n  principal: principal\n  role: enum('helper','manager')\n  unique principal\n  read <- .principal = viewer\n  insert <- viewer = 'service:operator'\n  online only\n";
#[test]
fn roster_disjunct_is_reported_but_roster_conjunct_is_not_broadened(){
    let source=format!("{ROLES}table docs:\n  owner: principal\n  private: text <=80 read <- exists roles[viewer, role = 'manager']\n  read <- .owner = viewer or exists roles[principal = viewer]\n  insert <- .owner = viewer\n  online only\n");
    let ns=notes(&source);assert!(ns.iter().any(|n|n.code=="N_BROAD_READ"&&n.message.contains("helper")&&n.message.contains("manager")&&n.site.line>0));
    assert!(!notes(&source.replace(" or exists roles"," and exists roles")).iter().any(|n|n.code=="N_BROAD_READ"));
    assert!(notes(&source.replace("exists roles[principal = viewer]","allow")).iter().any(|n|n.code=="N_BROAD_READ"));
}
#[test]
fn pure_role_lifecycle_advice_names_reader_without_advising_complete_creators(){
    let source=format!("{ROLES}table docs:\n  owner: principal\n  phase: enum('open','closed')\n  payload: image <=5000\n  read <- .owner = viewer or exists roles[viewer, role = 'helper'] or exists roles[viewer, role = 'manager']\n  insert <- exists roles[viewer, role = 'manager']\n  update <- exists roles[viewer, role = 'manager']\n  online only\nmutation close(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.phase = 'open' else CLOSED\n  update docs[doc] {{phase: 'closed'}}\n  return null\n");
    let ns=notes(&source);let ns=ns.iter().filter(|n|n.code=="N_ROLE_WIDE_READ").collect::<Vec<_>>();assert_eq!(ns.len(),1,"{ns:?}");assert!(ns[0].message.contains("helper")&&ns[0].message.contains("every value of [phase]"));
    assert!(!notes(&source.replace("exists roles[viewer, role = 'helper']","(exists roles[viewer, role = 'helper'] and .phase = 'open')")).iter().any(|n|n.code=="N_ROLE_WIDE_READ"&&n.message.contains("every value")));
    assert!(!notes(source.split("mutation close").next().unwrap()).iter().any(|n|n.code=="N_ROLE_WIDE_READ"));
}
const RELATION:&str="table people:\n  guardian: principal ?\n  read <- allow\n  insert <- allow\n  update (old, next) <- old.guardian = null and next.guardian = viewer\n  online only\ntable notes:\n  person: people\n  body: text <=80\n  read <- exists people[.person, guardian = viewer]\n  insert <- allow\n  online only\nmutation claim(person: people):\n  update people[person] {guardian: viewer}\n  return null\n";
#[test]
fn claiming_a_relationship_trusted_downstream_is_advised(){let ns=notes(RELATION);assert!(ns.iter().any(|n|n.code=="N_SELF_CLAIMED_RELATIONSHIP"&&n.message.contains("people.guardian")&&n.message.contains("notes")),"{ns:?}");assert!(!notes(&RELATION.replace("old.guardian = null and next.guardian = viewer","viewer = 'service:operator'")).iter().any(|n|n.code=="N_SELF_CLAIMED_RELATIONSHIP"));}
#[test]
fn self_owned_content_without_a_downstream_relationship_is_quiet(){assert!(!notes("table docs:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation create():\n  return insert docs {owner: viewer}\n").iter().any(|n|n.code=="N_SELF_CLAIMED_RELATIONSHIP"));}
const TIME:&str="table docs:\n  proofAt: time\n  unrelated: time ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation put(at: time):\n  return insert docs {proofAt: at}\nmutation use(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.proofAt >= now - 30d else OLD\n  return null\n";
#[test]
fn caller_time_follows_alias_flow_and_requires_a_dominating_clock_bound(){
    let ns=notes(TIME);assert!(ns.iter().any(|n|n.code=="N_CALLER_TIME"&&n.message.contains("docs.proofAt")),"{ns:?}");
    let bounded=TIME.replace("  return insert docs", "  require at <= now else FUTURE\n  return insert docs");assert!(!notes(&bounded).iter().any(|n|n.code=="N_CALLER_TIME"));
    let unrelated=TIME.replace("d.proofAt >= now - 30d","d.unrelated != null");assert!(!notes(&unrelated).iter().any(|n|n.code=="N_CALLER_TIME"));
    let alias=TIME.replace("{proofAt: at}","{proofAt: supplied + 1d}").replace("  return insert docs","  supplied = at\n  return insert docs");assert!(notes(&alias).iter().any(|n|n.code=="N_CALLER_TIME"));
    let bypass=bounded.replace("at <= now","at <= now or at > now");assert!(notes(&bypass).iter().any(|n|n.code=="N_CALLER_TIME"));
}
#[test]
fn clock_guard_in_the_taken_branch_is_evidence_but_a_sibling_guard_is_not(){
    let conditional=TIME.replace("  return insert docs {proofAt: at}","  if at <= now:\n    insert docs {proofAt: at}\n  return null");assert!(!notes(&conditional).iter().any(|n|n.code=="N_CALLER_TIME"));
    let sibling=TIME.replace("  return insert docs {proofAt: at}","  if at <= now:\n    require at <= now else FUTURE\n  return insert docs {proofAt: at}");assert!(notes(&sibling).iter().any(|n|n.code=="N_CALLER_TIME"));
}
#[test]
fn a_scoped_invitation_suppresses_the_narrow_self_claim_pattern(){
    let source=format!("table approvals:\n  person: people\n  principal: principal\n  unique person, principal\n  read <- .principal = viewer\n  insert <- viewer = 'service:operator'\n  online only\n{RELATION}");
    let source=source.replace("  update people[person]", "  require exists approvals[person, viewer] else NO_INVITATION\n  update people[person]");assert!(!notes(&source).iter().any(|n|n.code=="N_SELF_CLAIMED_RELATIONSHIP"));
}
/// External evidence is read only; no check-generated files are written to lanes.
#[test]
#[ignore = "requires the local wave20 evidence checkout"]
fn wave20_confirmed_lane_notes_with_and_without_invariants(){
    let apps=std::path::Path::new("/home/ccheever/sb4-loop/wave20/apps");
    for number in ["001","006","025","033","036","048","050"]{
        let lane=std::fs::read_dir(apps).unwrap().map(Result::unwrap).find(|e|e.file_name().to_string_lossy().starts_with(&format!("{number}-snapback-"))).unwrap().path();
        let mut sources=std::fs::read_dir(lane.join("snapback")).unwrap().map(Result::unwrap).filter(|e|e.path().extension().is_some_and(|x|x=="q")).map(|e|(e.file_name().to_string_lossy().into_owned(),std::fs::read_to_string(e.path()).unwrap())).collect::<Vec<_>>();sources.sort();
        for stripped in [false,true]{let input=sources.iter().map(|(name,source)|(name.clone(),if stripped{source.lines().filter(|line|!line.trim_start().starts_with("invariant ")).collect::<Vec<_>>().join("\n")}else{source.clone()})).collect::<Vec<_>>();
            let b=compile(&input);assert!(b.diagnostics.is_empty(),"{number}: {:?}",b.diagnostics);let mut report=security::analyze_rules(&b);security::add_source_notes(&mut report,&input,&b);
            for n in &report.notes{if matches!(n.code.as_str(),"N_ROLE_WIDE_READ"|"N_BROAD_READ"|"N_SELF_CLAIMED_RELATIONSHIP"|"N_CALLER_TIME"){println!("{number} stripped={stripped} {} {}",n.code,n.message);}}
            let has=|code:&str,part:&str|report.notes.iter().any(|n|n.code==code&&n.message.contains(part));
            match number{"001"=>assert!(has("N_ROLE_WIDE_READ","apprentice")),"006"=>assert!(has("N_SELF_CLAIMED_RELATIONSHIP","claimChild")),"025"=>assert!(has("N_CALLER_TIME","examAt")&&has("N_CALLER_TIME","suspensionUntil")),"033"=>assert!(has("N_ROLE_WIDE_READ","crew")),"036"=>assert!(has("N_ROLE_WIDE_READ","sharpener")),"048"=>assert!(has("N_BROAD_READ","riders.read")),"050"=>assert!(has("N_ROLE_WIDE_READ","protected columns [address, ownerName]")&&has("N_ROLE_WIDE_READ","intake")),_=>{}}
        }
    }
}

#[test]
fn protected_column_audience_groups_roles_and_does_not_exempt_row_creators(){
    let source=format!("{ROLES}table docs:\n  owner: principal\n  phase: enum('open','closed')\n  a: text <=80\n  b: text <=80\n  read <- .owner = viewer or exists roles[viewer, role = 'helper'] or exists roles[viewer, role = 'manager']\n  read (a, b) <- .owner = viewer or exists roles[viewer, role = 'manager']\n  insert <- exists roles[viewer, role = 'manager']\n  online only\n");
    let ns=notes(&source);let ns=ns.iter().filter(|n|n.code=="N_ROLE_WIDE_READ"&&n.message.contains("protected columns")).collect::<Vec<_>>();assert_eq!(ns.len(),1,"{ns:?}");assert!(ns[0].message.contains("[a, b]")&&ns[0].message.contains("manager"));
    let scoped=source.replace("read (a, b) <- .owner = viewer or exists roles[viewer, role = 'manager']","read (a, b) <- .owner = viewer");assert!(!notes(&scoped).iter().any(|n|n.code=="N_ROLE_WIDE_READ"&&n.message.contains("protected columns")));
}

#[test]
fn arbitrary_arithmetic_or_another_clock_argument_is_not_a_server_clock_bound(){
    let erased=TIME.replace("  return insert docs", "  require at - at <= now - now else BAD\n  return insert docs");assert!(notes(&erased).iter().any(|n|n.code=="N_CALLER_TIME"));
    let clock_arg=TIME.replace("mutation put(at: time):","mutation put(at: time, periodEnd: time):").replace("  return insert docs", "  require at <= periodEnd else BAD\n  return insert docs");assert!(notes(&clock_arg).iter().any(|n|n.code=="N_CALLER_TIME"));
}

#[test]
fn an_optional_time_defaulting_to_now_retains_its_dominating_bound(){
    let source=TIME.replace("mutation put(at: time):","mutation put(at: time ?):").replace("  return insert docs {proofAt: at}","  actual = at ?? now\n  require actual <= now else FUTURE\n  return insert docs {proofAt: actual}");assert!(!notes(&source).iter().any(|n|n.code=="N_CALLER_TIME"));
}
#[test]
fn caller_time_used_as_an_engine_expiry_is_also_a_deadline(){
    let source="table docs:\n  until: time\n  immutable until\n  expire at .until\n  read <- allow\n  insert <- allow\n  online only\nmutation put(until: time):\n  return insert docs {until}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_CALLER_TIME"&&n.message.contains("docs.until")));
}
#[test]
fn mutable_enum_categories_without_literal_transitions_do_not_get_state_advice(){
    let source=format!("{ROLES}table docs:\n  owner: principal\n  size: enum('small','large')\n  read <- .owner = viewer or exists roles[viewer, role = 'helper']\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  online only\nmutation resize(doc: docs, size: enum('small','large')):\n  d = docs[doc] ! else NOT_FOUND\n  require d.size = 'small' else LARGE\n  update docs[doc] {{size}}\n  return null\n");assert!(!notes(&source).iter().any(|n|n.code=="N_ROLE_WIDE_READ"));
}
#[test]
#[ignore = "explicit local corpus qualification writes an evidence report"]
fn external_notes_census(){
    use sha2::{Digest,Sha256};
    let manifest=std::env::var("SEC5_NOTES_CENSUS_INPUT").expect("set SEC5_NOTES_CENSUS_INPUT");
    let output=std::env::var("SEC5_NOTES_CENSUS_OUT").expect("set SEC5_NOTES_CENSUS_OUT");
    let inputs:serde_json::Value=serde_json::from_slice(&std::fs::read(manifest).unwrap()).unwrap();
    let mut results=Vec::new();
    for item in inputs.as_array().unwrap(){
        let mut hashes=Vec::new();
        let sources=item["sources"].as_array().unwrap().iter().map(|s|{
            let path=std::path::Path::new(s["path"].as_str().unwrap());let source=std::fs::read_to_string(path).unwrap();
            let digest=format!("{:x}",Sha256::digest(source.as_bytes()));if item["wave"].as_u64().unwrap()<=20{assert_eq!(Some(digest.as_str()),s["sha256"].as_str(),"frozen source drift {}",path.display());}hashes.push(digest);
            (path.file_name().unwrap().to_string_lossy().into_owned(),source)
        }).collect::<Vec<_>>();
        let b=compile(&sources);let mut r=security::analyze_rules(&b);security::add_source_notes(&mut r,&sources,&b);
        results.push(serde_json::json!({"wave":item["wave"],"lane":item["lane"],"snapshot_hashes":item["sources"].as_array().unwrap().iter().map(|s|s["sha256"].clone()).collect::<Vec<_>>(),"hashes":hashes,"diagnostics":b.diagnostics,"notes":r.notes}));
    }
    std::fs::write(output,serde_json::to_vec_pretty(&results).unwrap()).unwrap();println!("notes census {} inputs",results.len());
}

#[test]
fn a_single_admin_roster_disjunct_is_not_the_heterogeneous_member_pattern(){
    let source="table admins:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  insert <- viewer = 'service:operator'\n  online only\ntable docs:\n  owner: principal\n  body: text <=80 read <- .owner = viewer\n  read <- .owner = viewer or exists admins[viewer]\n  insert <- .owner = viewer\n  online only\n";assert!(!notes(source).iter().any(|n|n.code=="N_BROAD_READ"));
}

#[test]
fn lifecycle_without_private_media_or_asset_children_does_not_get_board_advice(){
    let source=format!("{ROLES}table docs:\n  owner: principal\n  phase: enum('open','closed')\n  read <- .owner = viewer or exists roles[viewer, role = 'helper']\n  insert <- .owner = viewer\n  update <- exists roles[viewer, role = 'helper']\n  online only\nmutation close(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.phase = 'open' else CLOSED\n  update docs[doc] {{phase: 'closed'}}\n  return null\n");assert!(!notes(&source).iter().any(|n|n.code=="N_ROLE_WIDE_READ"));
}

#[test]
fn transitive_affine_bounds_retain_the_server_clock_anchor(){
    for guard in ["at >= startsAt and startsAt >= now", "at <= startsAt + 1d and startsAt <= now + 2d"]{
        let source=TIME.replace("mutation put(at: time):", "mutation put(at: time, startsAt: time):").replace("  return insert docs", &format!("  require {guard} else RANGE\n  return insert docs"));assert!(!notes(&source).iter().any(|n|n.code=="N_CALLER_TIME"),"{guard}");
    }
    let cycle=TIME.replace("mutation put(at: time):", "mutation put(at: time, other: time):").replace("  return insert docs", "  require at <= other and other <= at else RANGE\n  return insert docs");assert!(notes(&cycle).iter().any(|n|n.code=="N_CALLER_TIME"));
}
#[test]
fn exact_service_seat_authority_is_outside_caller_clock_advice(){
    let operator=TIME.replace("  return insert docs", "  require viewer = 'service:operator' else OPERATOR\n  return insert docs");assert!(!notes(&operator).iter().any(|n|n.code=="N_CALLER_TIME"));
    let mixed=operator.replace("viewer = 'service:operator'", "viewer = 'service:operator' or at > other").replace("mutation put(at: time):", "mutation put(at: time, other: time):");assert!(notes(&mixed).iter().any(|n|n.code=="N_CALLER_TIME"));
}

#[test]
fn immutable_principal_upsert_is_enrollment_not_existing_relationship_takeover(){
    let source="table people:\n  guardian: principal\n  unique guardian\n  immutable guardian\n  read <- .guardian = viewer\n  insert <- .guardian = viewer\n  update <- .guardian = viewer\n  online only\ntable notes:\n  person: people\n  read <- exists people[.person, guardian = viewer]\n  insert <- allow\n  online only\nmutation enroll():\n  return upsert people[guardian = viewer] {guardian: viewer}\n";assert!(!notes(source).iter().any(|n|n.code=="N_SELF_CLAIMED_RELATIONSHIP"));
}
