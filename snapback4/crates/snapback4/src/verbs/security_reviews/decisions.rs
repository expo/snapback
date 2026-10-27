//! A family command expands to current individual, source-bound records.
// @ref LLP 3000.036.004#18-wave-26-security-decisions-dx9 — review questions lead, and gates never enter the audience family.
use super::*;
use snapback4_lang::Diagnostic;

pub(super) fn audience(code: &str) -> bool {
    !gated(code) && matches!(code, "N_INVARIANT_RESTATES_RULE" | "N_ROLE_WIDE_READ" | "N_ROLE_WIDE_WRITE" | "N_BROAD_READ")
}
pub(super) fn family(notes: &[Diagnostic], identities: &[(String,String,String)]) -> Option<String> {
    let mut members = notes.iter().zip(identities).filter(|(note,_)| audience(&note.code))
        .map(|(_, (id,source,_))| (id,source)).collect::<Vec<_>>();
    if members.is_empty() { return None; }
    members.sort();
    Some(format!("audience:{}", hash(&serde_json::to_vec(&(ANALYZER,members)).unwrap())))
}
pub(in crate::verbs) fn count(dispositions: &[Disposition]) -> usize {
    let audience = dispositions.iter().any(|d| !d.acknowledged && d.family.is_some());
    usize::from(audience) + dispositions.iter().filter(|d| !d.acknowledged && d.family.is_none()
        && crate::note_rank::tier(&d.code)==crate::note_rank::Tier::Review).count()
}
pub(in crate::verbs) fn print(dispositions: &[Disposition], notes: &[Diagnostic]) {print!("{}",render(dispositions,notes));}
pub(in crate::verbs) fn render(dispositions: &[Disposition], notes: &[Diagnostic]) -> String {
    use std::fmt::Write;
    let mut output=String::new();
    let mut ordered=notes.iter().zip(dispositions).collect::<Vec<_>>();
    // @ref LLP 3000.036.004#165-review-clarification-exact-detector-and-command-boundaries — grouping must preserve gate/authority priority.
    ordered.sort_by_key(|(n,d)|(if d.gated&&!d.acknowledged {0} else if d.witness.is_some(){1}else{2},crate::note_rank::summary_order(&n.code),n.site.file.clone(),n.site.line,n.site.col));
    let members=ordered.iter().filter(|(_,d)|d.family.is_some()&&!d.acknowledged&&d.witness.is_none()).collect::<Vec<_>>();
    let mut family_output=String::new();
    if let Some((_,first))=members.first().copied() {
        let codes=members.iter().map(|(n,_)|n.code.as_str()).collect::<std::collections::BTreeSet<_>>().into_iter().collect::<Vec<_>>().join(", ");
        writeln!(&mut family_output,"decision audience ({codes}): Are these {} row/column audiences, roles and lifecycle states intended?",members.len()).unwrap();
        for (n,_) in &members {
            // The expanded branch cross-product stays in JSON. One question
            // names the source subject without repeating every equivalent path.
            let subject = n.message.split(" matches or weakens").next().unwrap_or(&n.message)
                .split(": ").next().unwrap_or(&n.message);
            writeln!(&mut family_output,"  ? {}: Is {} intended?",n.site,subject.trim_end_matches('.')).unwrap();
        }
        writeln!(&mut family_output,"  Intended: snapback4 check --ack-security {} --reason '<spec rationale>'",first.family.as_deref().unwrap()).unwrap();
        writeln!(&mut family_output,"  Narrower: restrict the listed rules; declare independent intent; run snapback4 test. Full audiences: check --json.").unwrap();
    }
    let mut family_printed=false;
    for (n,d) in ordered {
        if d.acknowledged {if d.witness.is_none() {writeln!(&mut output,"  Witness: this code has no replay witness available; acknowledgment records specification rationale, not validation").unwrap();} if let Some(w)=&d.witness {writeln!(&mut output,"  Witness recorded: {}",w["summary"].as_str().unwrap_or("see check --json")).unwrap();} writeln!(&mut output,"security reviewed {} {}: {}",d.id,d.code,d.reason.as_deref().unwrap_or("")).unwrap(); continue; }
        if d.family.is_some() {
            if d.witness.is_some() { /* witnessed audience questions render individually below */ }
            else { if !family_printed {output.push_str(&family_output);family_printed=true;}
            continue; }
        }
        if !d.gated && d.witness.is_none() && crate::note_rank::tier(&n.code)>crate::note_rank::Tier::Review { continue; }
        let subject=n.message.split(": ").next().unwrap_or(&n.message);
        let concise=match n.code.as_str() {
            "N_APPROVAL_NOT_ENFORCED" if d.witness.as_ref().is_some_and(witness::concrete)=>format!("{subject}: the replayed {} effect via {} proceeds without this approval",d.witness.as_ref().unwrap()["effect"].as_str().unwrap_or("write"),d.witness.as_ref().unwrap()["operation"].as_str().unwrap_or("operation")),
            "N_COLUMN_RESULT_EXPOSURE"=>format!("{subject}: should operation results/refusals expose protected or projected-out columns to every admitted caller"),
            _=>n.message.trim_end_matches(['.', '?']).to_owned(),
        };
        let concise=concise.replace("insert/upsert", "insert, or edit an existing row via upsert");
        let question=concise.trim_end_matches(['.', '?']);
        writeln!(&mut output,"decision {} at {}: {question}; is this intended?",d.code,d.site).unwrap();
        if let Some(witness)=&d.witness {writeln!(&mut output,"  Witness: {}",witness["summary"].as_str().unwrap_or("concrete campaign behavior; check --json for replay")).unwrap();}
        else if matches!(n.code.as_str(),"N_APPROVAL_NOT_ENFORCED"|"N_ARGUMENT_GRANT"|"N_INSERT_WRITE_INTENT"|"N_DERIVED_WRITE_AUTHORITY"|"N_OPTIONAL_EVIDENCE"|"N_TEXT_EVIDENCE"|"N_CHILD_EVIDENCE_PRESENCE"|"N_GUARD_NOT_CONSUMED"|"N_BROAD_READ") {writeln!(&mut output,"  Witness: none obtained in this bounded campaign; `check --review` searches for concrete behavior; this remains a specification question").unwrap();}
        if d.witness.is_none() && !matches!(n.code.as_str(),"N_APPROVAL_NOT_ENFORCED"|"N_ARGUMENT_GRANT"|"N_INSERT_WRITE_INTENT"|"N_DERIVED_WRITE_AUTHORITY"|"N_OPTIONAL_EVIDENCE"|"N_TEXT_EVIDENCE"|"N_CHILD_EVIDENCE_PRESENCE"|"N_GUARD_NOT_CONSUMED"|"N_BROAD_READ") {
            writeln!(&mut output,"  Witness: unavailable for this code; this is specification advice, not a validated behavior").unwrap();
        }
        let repair=match n.code.as_str() {
            "N_COLUMN_RESULT_EXPOSURE"=>"restrict result/refusal audiences with column rules and independent intent; run snapback4 test",
            "N_ARGUMENT_GRANT"=>"validate the recipient's current role and relationship; caller authority alone is insufficient",
            _=>n.rewrite.as_str(),
        };
        writeln!(&mut output,"  Repair: {repair}").unwrap();
        let rationale=d.witness.as_ref().filter(|v|witness::concrete(v)).map(witness::reason_template).unwrap_or_else(||"<spec rationale>".into());
        writeln!(&mut output,"  Intended: snapback4 check --ack-security {} --reason '{}'{}",d.id,rationale,if d.gated {" (required before check can pass)"}else{""}).unwrap();
    }
    output
}

/// One mode selector for the CLI and captured-analyzer format replays.
pub(in crate::verbs) fn render_mode(dispositions:&[Disposition],notes:&[Diagnostic],review:bool)->String {
    if !review {
        let mut output=String::new();
        for (d,n) in dispositions.iter().zip(notes) {
            if d.gated&&!d.acknowledged || d.recorded {
                output.push_str(&render(&[d.clone()],&[n.clone()]));
            } else if !d.acknowledged && let Some(w)=&d.witness {
                // @ref LLP 3000.036.004.003#assignment-questions — the new tier keeps actual read facts in one default line; full evidence remains in review/JSON.
                if d.code=="N_ASSIGNMENT_SCOPE" {
                    let subject=n.message.split(" read:").next().unwrap_or("private payload");
                    let assignment=w["assignment"]["principal"].as_str().map(|p|format!("; assigned to {p}")).unwrap_or_else(||"; assignment not modeled".into());
                    output.push_str(&format!("fix question {} at {}: {} as {} disclosed {subject}{assignment}; assigned or any? (bounded replay; doesn't block; check --review)\n",d.code,d.site,w["operation"].as_str().unwrap_or("query"),w["viewer"].as_str().unwrap_or("caller")));
                    continue;
                }
                if d.code=="N_TRANSITION_BYPASS"&&w["questionKind"]=="declared-transition"{
                    output.push_str(&format!("fix question {} at {}: {} (bounded replay; doesn't block; check --review)\n",d.code,d.site,w["compactSummary"].as_str().unwrap_or("see check --json for replay")));continue;
                }
                let rationale=if witness::concrete(w) {witness::reason_template(w)} else {"<spec rationale>".into()};
                output.push_str(&format!("fix question {} at {}: {}; is this intended?\n  Witness: {} — repair or check --ack-security {} --reason '{}' (doesn't block)\n",d.code,d.site,n.message.trim_end_matches(['.','?']),w["compactSummary"].as_str().or_else(||w["summary"].as_str()).unwrap_or("see check --json for replay"),d.id,rationale));
            }
        }
        return output;
    }
    let selected=dispositions.iter().zip(notes).collect::<Vec<_>>();
    render(&selected.iter().map(|(d,_)|(*d).clone()).collect::<Vec<_>>(),&selected.iter().map(|(_,n)|(*n).clone()).collect::<Vec<_>>())
}
#[cfg(test)]mod tests {
 use super::*;
 #[test]fn authority_and_gates_precede_one_complete_audience_family(){
  let codes=["N_BROAD_READ","N_PRIVILEGE_ESCALATION","N_OPTIONAL_UPLOAD_CREATE","N_INVARIANT_RESTATES_RULE"];
  let notes=codes.iter().map(|code|Diagnostic::new(&Default::default(),*code,"subject: review authority","repair enforcement")).collect::<Vec<_>>();
  let dispositions=codes.iter().map(|code|Disposition{family:audience(code).then(||"audience:family".into()),id:(*code).into(),code:(*code).into(),site:"schema.q:1:1".into(),gated:gated(code),acknowledged:false,recorded:false,reason:None,witness:None,scope:"test".into()}).collect::<Vec<_>>();
  let text=render(&dispositions,&notes);
  assert!(text.find("decision N_OPTIONAL_UPLOAD_CREATE").unwrap()<text.find("decision N_PRIVILEGE_ESCALATION").unwrap(),"{text}");
  assert!(text.find("decision N_PRIVILEGE_ESCALATION").unwrap()<text.find("decision audience").unwrap(),"{text}");
  assert_eq!(text.matches("decision audience").count(),1,"{text}");
  assert!(text.contains("Are these 2 row/column audiences")&&text.contains("audience:family"),"{text}");
 }
 #[test]fn every_gate_is_one_decision_and_never_a_family_member(){
  for code in snapback4_lang::security::GATED_NOTE_CODES {
   assert!(!audience(code));
   let n=Diagnostic::new(&Default::default(),*code,"explicit review required","repair enforcement");
   let d=Disposition{family:None,id:"id".into(),code:(*code).into(),site:"schema.q:1:1".into(),gated:true,acknowledged:false,recorded:false,reason:None,witness:None,scope:"test".into()};
   let text=render(&[d],&[n]);assert_eq!(text.matches(code).count(),1,"{text}");assert!(text.contains("is this intended?")&&text.contains("Repair:")&&text.contains("Intended:"));
  }
  for code in ["N_DERIVED_WRITE_AUTHORITY","N_CALLER_TIME","N_OPTIONAL_EVIDENCE","N_APPROVAL_NOT_ENFORCED","E_SECURITY_REVIEW"] {assert!(!audience(code));}
 }
}

#[cfg(test)]mod sec10_replay {
 use super::*;
 fn diagnostic(n:&serde_json::Value)->Diagnostic {Diagnostic::new(&snapback4_lang::Site::new(n["site"]["file"].as_str().unwrap(),n["site"]["line"].as_u64().unwrap() as u32,n["site"]["col"].as_u64().unwrap() as u32),n["code"].as_str().unwrap(),n["message"].as_str().unwrap(),n["rewrite"].as_str().unwrap())}
 fn disposition(n:&Diagnostic,gated:bool)->Disposition {Disposition{family:None,id:n.code.clone(),code:n.code.clone(),site:n.site.to_string(),gated,acknowledged:false,recorded:false,reason:None,scope:"captured SEC10 source-bound decision".into(),witness:None}}
 #[test]fn captured_sec10_codes_keep_every_gate_and_hide_advisories_by_default(){
  let codes:serde_json::Value=serde_json::from_str(include_str!("../../../tests/fixtures/dx11/sec10-codes.json")).unwrap();
  for n in codes.as_object().unwrap().values(){let n=diagnostic(n);let d=disposition(&n,false);assert!(render_mode(&[d],&[n.clone()],false).is_empty());let d=disposition(&n,true);let output=render_mode(&[d],&[n.clone()],false);assert!(output.contains(&n.code)&&output.contains("Intended:"),"{output}");}
 }
 /// Opt-in measurement on all 50 actual SEC10 structured reports. No analyzer
 /// or source is modified: only the production presentation function runs.
 #[test]fn captured_sec10_measurement(){
  let Ok(path)=std::env::var("SNAPBACK4_DX11_SEC10_REPORTS")else{return;};
  let rows:serde_json::Value=serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();let mut measured=Vec::new();
  for row in rows.as_array().unwrap(){
   let notes=row["notes"].as_array().unwrap().iter().map(diagnostic).collect::<Vec<_>>();
   let ds=row["dispositions"].as_array().unwrap().iter().zip(&notes).map(|(d,n)|disposition(n,d["gated"]==true)).collect::<Vec<_>>();
   let gate_count=ds.iter().filter(|d|d.gated).count();
   let project=crate::project::Project{root:std::path::PathBuf::from(format!("/tmp/dx11-replay/sec10/{}",row["lane"].as_str().unwrap()))};
   let sources=project.sources().unwrap();let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty());
   let mut report=snapback4_lang::security::analyze_rules(&bound);report.notes=notes.clone();
   let advice=ds.iter().filter(|d|!d.gated&&crate::note_rank::tier(&d.code)==crate::note_rank::Tier::Review).count();
   let verdict=crate::presentation::check_verdict(gate_count>0,&crate::verbs::table_counts(&bound.schema),bound.schema.synced().count(),bound.programs.len(),if gate_count==0{"compiled"}else{"security review required"},gate_count,0,advice,0,row["noteCount"].as_u64().unwrap_or(0) as usize,row["ms"].as_f64().unwrap(),crate::verbs::init::client_setup_hint(&project.root),"");
   let text=format!("{verdict}\n{}\n{}",crate::verbs::security::enforced_text(&report,&bound),render_mode(&ds,&notes,false));
   let lines=text.lines().count();if gate_count==0{assert!(lines<=5);}
   measured.push(serde_json::json!({"lane":row["lane"],"exit":if gate_count==0{0}else{1},"lines":lines,"chars":text.chars().count(),"gates":gate_count}));
  }
  if let Ok(path)=std::env::var("SNAPBACK4_DX11_RENDER_OUTPUT"){std::fs::write(path,serde_json::to_vec_pretty(&measured).unwrap()).unwrap();}
 }
}

#[cfg(test)] mod dx13_tests {
 use super::*;
 #[test] fn witnessed_questions_are_default_visible_and_unwitnessable_ack_is_explicit() {
  let n=Diagnostic::new(&Default::default(),"N_APPROVAL_NOT_ENFORCED","jobs.approved: transitions do not inspect approval","add guard");
  let mut d=Disposition{family:None,id:"question-id".into(),code:n.code.clone(),site:n.site.to_string(),gated:false,acknowledged:false,recorded:false,reason:None,witness:Some(serde_json::json!({"summary":"advance as staff -> ok; approved=false"})),scope:"test".into()};
  let output=render_mode(&[d.clone()],&[n.clone()],false);assert!(output.contains("Witness: advance")&&output.contains("fix question")&&output.contains("doesn't block"));
  d.code="N_CHILD_EVIDENCE_PRESENCE".into();d.witness=None;
  assert!(render_mode(&[d.clone()],&[n.clone()],false).is_empty());
  d.acknowledged=true;d.recorded=true;d.reason=Some("spec rationale".into());
  let output=render_mode(&[d],&[n],false);assert!(output.contains("no replay witness available")&&output.contains("specification rationale, not validation"),"{output}");
 }
}

#[cfg(test)] mod assignment_format_replay {
 use super::*;
 fn disposition(d:&serde_json::Value)->Disposition {Disposition{family:d["family"].as_str().map(Into::into),id:d["id"].as_str().unwrap().into(),code:d["code"].as_str().unwrap().into(),site:d["site"].as_str().unwrap().into(),gated:d["gated"]==true,acknowledged:d["acknowledged"]==true,recorded:d["recorded"]==true,reason:d["reason"].as_str().map(Into::into),scope:"captured native survey".into(),witness:d.get("witness").filter(|w|w.is_object()).cloned()}}
 /// Replace exact old native blocks with production-rendered cards; preserve
 /// every other byte except the explicitly replaced positive feature summary.
 #[test] fn captured_assignment_default_output() {
  let Ok(path)=std::env::var("SNAPBACK4_SEC11_ASSIGNMENT_REPORTS")else{return;};
  let rows:serde_json::Value=serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();let mut measured=Vec::new();
  for row in rows.as_array().unwrap(){
   let ds=row["reviews"].as_array().unwrap().iter().map(disposition).collect::<Vec<_>>();
   let mut phases=["defaultCheck","defaultDeploy"].map(|field|{let p=&row[field];assert!(p["exit"]==0||p["exit"]==1,"censored display must be retried");let text=format!("{}{}",p["stdout"].as_str().unwrap(),p["stderr"].as_str().unwrap());assert_eq!(text.lines().count(),p["lines"].as_u64().unwrap()as usize);text});let mut cards=0;
   for d in ds.iter().filter(|d|d.code=="N_ASSIGNMENT_SCOPE"&&!d.acknowledged&&!d.recorded&&!d.gated&&d.witness.is_some()){
    let n=row["notes"].as_array().unwrap().iter().find(|n|n["code"]==d.code&&format!("{}:{}:{}",n["site"]["file"].as_str().unwrap(),n["site"]["line"],n["site"]["col"])==d.site).unwrap();
    let n=Diagnostic::new(&Default::default(),"N_ASSIGNMENT_SCOPE",n["message"].as_str().unwrap(),"scope assignment");let w=d.witness.as_ref().unwrap();let text=render_mode(&[d.clone()],&[n.clone()],false);
    assert_eq!(text.lines().count(),1,"{text}");assert!(text.contains(w["operation"].as_str().unwrap())&&text.contains(w["viewer"].as_str().unwrap())&&text.contains("assigned or any?")&&text.contains("bounded replay")&&text.contains("check --review"),"{text}");
    if let Some(p)=w["assignment"]["principal"].as_str(){assert!(text.contains(p),"{text}");}else{assert!(text.contains("assignment not modeled"));}
    let review=render_mode(&[d.clone()],&[n.clone()],true);assert!(review.contains(&d.id)&&review.contains(w["summary"].as_str().unwrap()));
    let rationale=if witness::concrete(w){witness::reason_template(w)}else{"<spec rationale>".into()};
    let original=format!("fix question {} at {}: {}; is this intended?\n  Witness: {} — repair or check --ack-security {} --reason '{}' (doesn't block)\n",d.code,d.site,n.message.trim_end_matches(['.','?']),w["compactSummary"].as_str().or_else(||w["summary"].as_str()).unwrap(),d.id,rationale);
    for phase in &mut phases {assert_eq!(phase.matches(&original).count(),1,"native card differs for {} {}",row["wave"],row["lane"]);*phase=phase.replace(&original,&text);}
    cards+=1;
   }
   let original=phases[1].lines().find(|line|line.starts_with("security: enforced by the language —")).map(|line|format!("{line}\n"));
   if let Some(original)=original{let mut replacement=String::new();crate::verbs::security::append_deploy_language_summary(&mut replacement,&original,&ds,false);phases[1]=phases[1].replace(&original,&replacement);}
   measured.push(serde_json::json!({"wave":row["wave"],"lane":row["lane"],"defaultCheck":{"before":row["defaultCheck"]["lines"],"after":phases[0].lines().count()},"defaultDeploy":{"before":row["defaultDeploy"]["lines"],"after":phases[1].lines().count()},"cards":cards}));
  }
  if let Ok(path)=std::env::var("SNAPBACK4_SEC11_ASSIGNMENT_RENDER_OUTPUT"){std::fs::write(path,serde_json::to_vec_pretty(&measured).unwrap()).unwrap();}
 }
 #[test] fn assignment_budget_does_not_hide_gates_test_status_or_expanded_summary(){
  let n=Diagnostic::new(&Default::default(),"N_ASSIGNMENT_SCOPE","docs.private read: assigned or any?","scope");let mut d=Disposition{family:None,id:"id".into(),code:n.code.clone(),site:"site".into(),gated:false,acknowledged:false,recorded:false,reason:None,scope:"test".into(),witness:Some(serde_json::json!({"operation":"read","viewer":"staff"}))};
  let mut text=String::new();crate::verbs::security::append_deploy_language_summary(&mut text,"positive feature counts\n",&[d.clone()],false);assert!(text.is_empty());
  crate::verbs::security::append_deploy_language_summary(&mut text,"positive feature counts\n",&[d.clone()],true);assert!(text.contains("positive feature counts"));
  d.gated=true;text.clear();crate::verbs::security::append_deploy_language_summary(&mut text,"positive feature counts\n",&[d],false);assert!(text.contains("positive feature counts"));
 }
}
