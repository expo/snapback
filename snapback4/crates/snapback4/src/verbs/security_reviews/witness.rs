//! Current concrete evidence controls SEC10 gates and witness acknowledgments.
// @ref LLP 3000.036.004.000#13-witness-backed-enforcement-and-shipping-precision — a stale rationale never supplies a current witness.
use super::*;
pub(in crate::verbs) fn concrete(value:&serde_json::Value)->bool {
    let Some(history)=value["history"].as_array().filter(|h|!h.is_empty())else{return false;};
    matches!(value["reachability"].as_str(),Some("generated-fixture-trace"|"authored-fixture-trace"))
        && value["candidate"].as_str().is_some_and(|s|!s.is_empty())
        && value["operation"].as_str().is_some_and(|s|!s.is_empty())
        && history.last().is_some_and(|step|step["operation"]==value["operation"]&&step["viewer"]==value["viewer"]
            && (step["state"]=="sent" || value["kind"]=="read-payload" && step["state"]=="observed"
                && value["observation"]["complete"].is_boolean()
                && (value["observation"]["data"].is_object()||value["observation"]["data"].is_array())))
}
fn canonical(value:&serde_json::Value)->serde_json::Value {
    use serde_json::Value;
    use std::collections::BTreeSet;
    fn replace(value:&mut Value,ids:&BTreeMap<String,String>){match value{
        Value::String(s)=>if let Some(alias)=ids.get(s){*s=alias.clone();},
        Value::Object(fields)=>for v in fields.values_mut(){replace(v,ids)},
        Value::Array(xs)=>for v in xs{replace(v,ids)},_=>{}
    }}
    fn sorted(mut value:Value)->Value {
        for key in ["supportingRows","committedRows"]{if let Some(tables)=value.get_mut(key).and_then(Value::as_object_mut){
            for rows in tables.values_mut().filter_map(Value::as_array_mut){rows.sort_by_cached_key(Value::to_string);}
        }}value
    }
    // Refine by the entire typed occurrence context, including reference edges.
    // Individualization resolves any remaining graph symmetry; only an actual
    // transposition automorphism may prune a branch, never a tied local key.
    fn refine(value:&Value,mut colors:BTreeMap<String,String>)->BTreeMap<String,String>{
        loop {
            let signatures=colors.keys().map(|id|{
                let mut labels=colors.clone();labels.insert(id.clone(),"$self".into());
                let mut image=value.clone();replace(&mut image,&labels);
                (id.clone(),(colors[id].clone(),sorted(image).to_string()))
            }).collect::<BTreeMap<_,_>>();
            let ranks=signatures.values().cloned().collect::<BTreeSet<_>>().into_iter().enumerate().map(|(i,s)|(s,format!("$color-{i:04}"))).collect::<BTreeMap<_,_>>();
            let next=signatures.into_iter().map(|(id,s)|(id,ranks[&s].clone())).collect::<BTreeMap<_,_>>();
            let old_count=colors.values().collect::<BTreeSet<_>>().len();
            let new_count=next.values().collect::<BTreeSet<_>>().len();
            if old_count==new_count{return next;}colors=next;
        }
    }
    fn search(value:&Value,colors:BTreeMap<String,String>)->Value {
        let colors=refine(value,colors);
        let mut classes=BTreeMap::<String,Vec<String>>::new();
        for (id,color) in &colors{classes.entry(color.clone()).or_default().push(id.clone());}
        let Some(tied)=classes.values().find(|ids|ids.len()>1)else{
            let labels=classes.values().enumerate().map(|(i,ids)|(ids[0].clone(),format!("$generated-{i}"))).collect();
            let mut result=value.clone();replace(&mut result,&labels);return sorted(result);
        };
        let base=sorted(value.clone());let mut representatives=Vec::<String>::new();let mut best=None::<Value>;
        for id in tied{
            let equivalent=representatives.iter().any(|other|{
                let mut swapped=value.clone();replace(&mut swapped,&BTreeMap::from([(id.clone(),other.clone()),(other.clone(),id.clone())]));sorted(swapped)==base
            });
            if equivalent{continue;}representatives.push(id.clone());
            let mut branch=colors.clone();branch.insert(id.clone(),format!("{}-individual",colors[id]));
            let result=search(value,branch);
            if best.as_ref().is_none_or(|old|result.to_string()<old.to_string()){best=Some(result);}
        }best.unwrap()
    }
    let generated=value["generatedIds"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|s|(s.to_owned(),"$color-0000".to_owned())).collect();
    let mut value=value.clone();if let Some(fields)=value.as_object_mut(){for key in ["id","summary","compactSummary","scope","generatedIds","advisory"]{fields.remove(key);}}
    search(&value,generated)
}

pub(in crate::verbs) fn id(value:&serde_json::Value)->String {hash(&serde_json::to_vec(&canonical(value)).unwrap())}
pub(in crate::verbs) fn stamp(mut value:serde_json::Value)->serde_json::Value {value["id"]=id(&value).into();value}
pub(super) fn identities(notes:&[snapback4_lang::Diagnostic],sources:&[(String,String)],evidence:&[Option<serde_json::Value>])->Vec<(String,String,String)> {
    let mut identities=binding::identities(notes,sources);let mut occurrences=BTreeMap::<(String,String),usize>::new();
    for (index,note) in notes.iter().enumerate(){
        if let Some(value)=evidence.get(index).and_then(Option::as_ref).filter(|v|concrete(v)){
            let witness=id(value);let ordinal=occurrences.entry((note.code.clone(),witness.clone())).or_default();
            identities[index]=(hash(&serde_json::to_vec(&("witness-decision-1",&note.code,&witness,*ordinal)).unwrap()),witness,"current replayed witness; source edits alone do not invalidate this decision".into());*ordinal+=1;
        }
    }identities
}
pub(super) fn gate(code:&str,evidence:Option<&serde_json::Value>)->bool {
    // Required-to-optional adoption review is an explicit predecessor contract,
    // not an inferred SEC10 effect. Other questions need current replay evidence.
    gated(code)&&(code=="N_PRESENCE_LOOSENING"||evidence.is_some_and(|value|concrete(value)&&value["advisory"]!=true))
}
pub(in crate::verbs) fn reason_template(value:&serde_json::Value)->String {
    let operation=value["operation"].as_str().unwrap_or("operation");
    let answer=if matches!(value["effect"].as_str(),Some("insert"|"upsert")){format!("audience: <intended roles for {operation}>; <spec rationale>")}else{format!("intended effect: <why {operation} is permitted by the spec>")};
    format!("witness {}; permit {} as {}; {answer}",id(value),operation,value["viewer"].as_str().unwrap_or("caller"))
}
pub(super) fn validate_reason(reason:&str,value:&serde_json::Value)->Result<(),String>{
    if !concrete(value){return Ok(());}
    let witness=id(value);let operation=value["operation"].as_str().unwrap();
    let clauses=reason.split(';').map(str::trim).collect::<Vec<_>>();
    let permits=format!("permit {operation} as {}",value["viewer"].as_str().unwrap());
    let marker=if matches!(value["effect"].as_str(),Some("insert"|"upsert")){"audience:"}else{"intended effect:"};
    let answers=clauses.iter().filter_map(|clause|clause.strip_prefix(marker).map(str::trim)).collect::<Vec<_>>();
    let answer=if answers.len()==1{answers[0]}else{""};
    if !clauses.contains(&format!("witness {witness}").as_str())||!clauses.contains(&permits.as_str())||snapback4_core::visible_text::visible_length(answer)<8||answer.contains('<')||answer.contains('>'){
        return Err(format!("this decision must answer the current witness and name its operation; use --reason '{}', replacing the placeholders with the intended audience/effect and specification rationale, or repair the source and rerun check\nWitness {witness}: {}",reason_template(value),value["summary"].as_str().unwrap_or("see check --review --json for the replay")));
    }Ok(())
}
pub(super) fn retained(entry:&Entry,fingerprint:&str,evidence:Option<&serde_json::Value>)->bool {
    if let Some(value)=evidence.filter(|v|concrete(v)){
        entry.sources==fingerprint&&entry.witness.as_ref().is_some_and(|old|concrete(old)&&id(old)==id(value))&&validate_reason(&entry.reason,value).is_ok()
    }else{entry.sources==fingerprint&&entry.analyzer==ANALYZER}
}

#[cfg(test)]mod tests {
 use super::*;
 fn example(operation:&str)->serde_json::Value {stamp(json!({"operation":operation,"viewer":"account:security-clerk","effect":"insert","candidate":"invariant docs.insert only viewer = 'service:manager'","history":[{"operation":operation,"viewer":"account:security-clerk","state":"sent","args":{"n":1}}],"row":{"n":1},"reachability":"generated-fixture-trace","summary":"current witness","scope":"generated initialization"}))}
 #[test]fn blank_or_synthetic_evidence_never_gates(){
  assert!(!gate("N_APPROVAL_NOT_ENFORCED",None));let mut value=example("create");assert!(gate("N_APPROVAL_NOT_ENFORCED",Some(&value)));
  value["history"]=json!([]);assert!(!gate("N_APPROVAL_NOT_ENFORCED",Some(&value)));
  let mut value=example("create");value["reachability"]="trusted-seed-only".into();assert!(!gate("N_APPROVAL_NOT_ENFORCED",Some(&value)));
  assert!(!gate("N_INSERT_WRITE_INTENT",Some(&example("create"))));
 }
 #[test]fn a_witness_requires_an_explicit_creation_audience_answer(){
  let value=example("create");for reason in ["one decision","a specification rationale","audience: clerks create documents"]{assert!(validate_reason(reason,&value).is_err());}
  let reason=format!("witness {}; permit create as account:security-clerk; audience: create is deliberately available to clerks for draft documents",id(&value));assert!(validate_reason(&reason,&value).is_ok());
  assert!(validate_reason(&format!("witness {}; audience: managers are allowed",id(&value)),&value).is_err());
  for permit in ["permit create as account:security-clerk-manager","do not permit create as account:security-clerk","permit create as account:security-clerk is forbidden"]{
   assert!(validate_reason(&format!("witness {}; {permit}; audience: clerks create documents",id(&value)),&value).is_err());
  }
 }
 #[test]fn a_payload_cannot_borrow_the_following_witness_or_permission_clause(){
  for (effect,marker) in [("insert","audience:"),("update","intended effect:")]{
   let mut value=example("create");value["effect"]=effect.into();
   for payload in ["","   ","short","\u{200b}\u{200b}\u{200b}\u{200b}"]{let reason=format!("{marker} {payload}; witness {}; permit create as account:security-clerk",id(&value));assert!(validate_reason(&reason,&value).is_err());}
   let reason=format!("{marker} clerks deliberately perform this specified effect; witness {}; permit create as account:security-clerk",id(&value));assert!(validate_reason(&reason,&value).is_ok());
   let repeated=format!("{reason}; {marker} another conflicting audience");assert!(validate_reason(&repeated,&value).is_err());
  }
 }
 #[test]fn unchanged_witnesses_survive_source_edits_and_changed_witnesses_drop_old_reasons(){
  let sources=vec![("schema.q".into(),"query q():\n  return true\n".into())];let n=snapback4_lang::Diagnostic::new(&Default::default(),"N_APPROVAL_NOT_ENFORCED","docs.approved: effect","require approval");let notes=[n];let value=example("create");let evidence=[Some(value.clone())];
  let first=identities(&notes,&sources,&evidence);let changed=vec![("schema.q".into(),"query q():\n  return false\n".into())];assert_eq!(first,identities(&notes,&changed,&evidence));
  let entry=Entry{sources:first[0].1.clone(),analyzer:"an older revision".into(),reason:format!("witness {}; permit create as account:security-clerk; audience: create is intended for clerks",id(&value)),witness:Some(value.clone())};
  assert!(retained(&entry,&first[0].1,Some(&value)));let replacement=example("otherCreate");let next=identities(&notes,&changed,&[Some(replacement.clone())]);assert_ne!(first[0].0,next[0].0);assert!(!retained(&entry,&next[0].1,Some(&replacement)));
 }
 #[test]fn fresh_generated_ids_preserve_relationships_without_staling_decisions(){
  let mut a=example("create");a["row"]=json!({"id":"01MCC5RM00STQZ9VVFA6F49YWR","parent":"01MCC5RM00STQZ9VVFA6F49YWS"});a["args"]=json!({"parent":"01MCC5RM00STQZ9VVFA6F49YWS"});a["supportingRows"]=json!({"parents":[{"id":"01MCC5RM00STQZ9VVFA6F49YWS","approved":false}]});a["generatedIds"]=json!(["01MCC5RM00STQZ9VVFA6F49YWR","01MCC5RM00STQZ9VVFA6F49YWS"]);
  let b:serde_json::Value=serde_json::from_str(&a.to_string().replace("01MCC5RM00STQZ9VVFA6F49YWR","01MCC5RM00STQZ9VVFA6F49YWT").replace("01MCC5RM00STQZ9VVFA6F49YWS","01MCC5RM00STQZ9VVFA6F49YWV")).unwrap();assert_eq!(id(&a),id(&b));
  let mut changed=b.clone();changed["args"]["parent"]="01MCC5RM00STQZ9VVFA6F49YWW".into();changed["generatedIds"].as_array_mut().unwrap().push("01MCC5RM00STQZ9VVFA6F49YWW".into());assert_ne!(id(&a),id(&changed));
 }
 #[test]fn supporting_graph_identity_is_independent_of_tied_link_order(){
  let mut a=example("create");a["generatedIds"]=json!(["link-a","link-b","target-a","target-b"]);
  a["supportingRows"]=json!({"links":[{"id":"link-a","target":"target-a"},{"id":"link-b","target":"target-b"}],"targets":[{"id":"target-a","enabled":true},{"id":"target-b","enabled":false}]});
  let mut b=a.clone();b["supportingRows"]["links"]=json!([{"id":"link-b","target":"target-a"},{"id":"link-a","target":"target-b"}]);assert_eq!(id(&a),id(&b));
  b["supportingRows"]["links"][1]["target"]="target-a".into();assert_ne!(id(&a),id(&b));
 }
 #[test]fn symmetric_graphs_keep_identity_but_distinct_edges_change_it(){
  let mut a=example("create");a["generatedIds"]=json!(["a","b","c","d"]);
  a["supportingRows"]=json!({"links":[{"id":"a","next":"b"},{"id":"b","next":"c"},{"id":"c","next":"d"},{"id":"d","next":"a"}]});
  let mut b=a.clone();b["supportingRows"]=json!({"links":[{"id":"d","next":"b"},{"id":"a","next":"c"},{"id":"b","next":"a"},{"id":"c","next":"d"}]});assert_eq!(id(&a),id(&b));
  b["supportingRows"]=json!({"links":[{"id":"a","next":"b"},{"id":"b","next":"a"},{"id":"c","next":"d"},{"id":"d","next":"c"}]});assert_ne!(id(&a),id(&b));
 }
 #[test]fn presentation_text_is_not_witness_identity(){let a=example("create");let mut b=a.clone();b["summary"]="new formatting".into();b["compactSummary"]="fresh-id display only".into();b["scope"]="another display".into();assert_eq!(id(&a),id(&b));}
}
