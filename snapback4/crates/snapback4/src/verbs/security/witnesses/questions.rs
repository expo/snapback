//! Replay questions without promoting guessed product intent into enforcement.
// @ref LLP 3000.036.004.001#question-candidates — hypotheses remain advisory even when a replay is available.
use super::*;
use snapback4_core::{Context, Engine, ir, schema::{RuleExpr, RuleTerm}};

pub(super) fn advisory(code:&str)->bool {
    matches!(code,"N_OPTIONAL_EVIDENCE"|"N_TEXT_EVIDENCE"|"N_CHILD_EVIDENCE_PRESENCE"|"N_GUARD_NOT_CONSUMED"|"N_BROAD_READ")
}
pub(super) fn candidates(bound:&Bound,sources:&[(String,String)],index:usize,n:&Diagnostic)->Vec<(usize,security::Invariant)> {
    let mut lines=Vec::new();
    if n.code=="N_OPTIONAL_EVIDENCE" {
        if let Some((table,column))=n.message.split_whitespace().next().and_then(|s|s.split_once('.'))
            && let Some(kind)=bound.schema.table(table).and_then(|t|t.columns.get(column)) {
            let presence=if matches!(kind.required(),ColumnType::List{..}|ColumnType::ListRange{..}) {
                format!(".{column} != null and count(.{column}) > 0")
            } else {format!(".{column} != null")};
            lines.push(format!("invariant {table}.insert only {presence}"));
        }
    }
    if n.code=="N_TEXT_EVIDENCE" {
        if let Some((table,column))=n.message.split(':').next().and_then(|s|s.split_once('.'))
            && bound.schema.table(table).is_some_and(|t|t.columns.contains_key(column)) {
            lines.push(format!("invariant {table}.insert only deny"));
        }
    }
    if n.code=="N_CHILD_EVIDENCE_PRESENCE" {
        if let Some((table,detail))=n.message.split_once(": transitions ")
            && let Some((operations,child))=detail.split_once(" do not require attached ")
            && let Some((child,keys))=child.split_once('[')
            && let Some((reference,_))=keys.split_once(" = parent]") {
            for operation in operations.split(", ") {
                lines.push(format!("invariant {table}.{operation} only count({child}[{reference} = .id]) > 0"));
            }
        }
    }
    if n.code=="N_BROAD_READ" {
        if let Some(subject)=n.message.split(':').next()
            && let Some((table,tail))=subject.split_once('.')
            && let Some(t)=bound.schema.table(table) {
            // Use existing row relationships, not a guessed owner/staff name.
            // Broad staff exceptions may be deliberate; this is a question.
            let related=t.rules.read.disjuncts().into_iter().filter(|rule|rule.any_term(&|term|
                matches!(term,RuleTerm::Field(_)|RuleTerm::Reference{..}|RuleTerm::ReferenceChain{..})))
                .cloned().collect::<Vec<_>>();
            if !related.is_empty(){
                let target=if let Some(column)=tail.strip_suffix(" read").filter(|c|t.columns.contains_key(*c)){format!("{table}.{column} read")}else{format!("{table}.read")};
                lines.push(format!("invariant {target} only {}",RuleExpr::Or(related).quarry()));
            }
        }
    }
    if n.code=="N_GUARD_NOT_CONSUMED" {
        if let Some(operation)=n.message.split(':').next()
            && let Some(p)=bound.programs.iter().find(|p|p.program.name==operation) {
            for (table,_) in ir::write_tables(&p.program) {
                lines.push(format!("invariant {table}.{operation} only deny"));
            }
        }
    }
    lines.into_iter().filter_map(|line|candidate(sources,&line).map(|inv|(index,inv))).collect()
}

pub(super) fn text_evidence(mut value:serde_json::Value,n:&Diagnostic)->serde_json::Value {
    let subject=n.message.split(':').next().unwrap_or("evidence");
    value["kind"]="text-evidence".into();
    value["candidate"]=format!("question: is {subject} deliberately text rather than a verified upload?").into();
    value["summary"]=format!("{} as {} → admitted insert with text-typed {subject}; no verified-upload type is required at this boundary (finite generated-fixture replay, not proof)",value["operation"].as_str().unwrap_or("operation"),value["viewer"].as_str().unwrap_or("caller")).into();
    value["compactSummary"]=value["summary"].clone();
    super::super::super::security_reviews::witness::stamp(value)
}

fn replay_ids(first:&str,offset:usize)->Option<Vec<String>> {
    const DIGITS:&[u8;32]=b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    if first.len()!=26{return None;}
    let mut start=0u128;
    for b in first.bytes(){start=start.checked_mul(32)?.checked_add(DIGITS.iter().position(|d|*d==b)? as u128)?;}
    let count=snapback4_core::meter::Ceilings::default().rows_written as usize;
    (offset..offset+count).map(|offset|{
        let mut n=start.checked_add(offset as u128)?;let mut bytes=[b'0';26];
        for b in bytes.iter_mut().rev(){*b=DIGITS[(n&31)as usize];n>>=5;}
        String::from_utf8(bytes.to_vec()).ok()
    }).collect()
}
fn single_mint(program:&ir::Program)->bool {
    fn inspect(value:&serde_json::Value,mints:&mut usize)->bool {
        match value {
            serde_json::Value::Object(fields)=>{
                if ["For","Emit","JobAs","JobQuery"].iter().any(|key|fields.contains_key(*key)){return false;}
                if fields.get("Input").is_some_and(|v|v=="NewId"){*mints+=1;}
                fields.values().all(|v|inspect(v,mints))
            },
            serde_json::Value::Array(values)=>values.iter().all(|v|inspect(v,mints)),_=>true,
        }
    }
    let mut mints=0;
    !program.native&&inspect(&serde_json::to_value(program).unwrap(),&mut mints)&&mints<=1
}

// A narrow repeat replay: one real producer on a validated generated world,
// followed by the identical call. Complex histories/assets remain uncovered.
// This is not a one-use entitlement assertion; it asks whether reuse is intended.
pub(super) fn repeat(bound:&Bound,inv:&security::Invariant,c:&Counterexample,n:&Diagnostic,sources:&[(String,String)])->Option<serde_json::Value> {
    if c.history.len()!=1||c.effect!="insert" {return None;}
    let step=&c.history[0];
    let guard=n.message.split(": checks ").nth(1)?.split_whitespace().next()?;
    let (table,column)=guard.split_once('.')?;
    let p=bound.programs.iter().find(|p|p.program.name==step.operation)?;
    // Opaque execution and explicit id generators can mint without writing a
    // row. They do not fit this reconstruction's row-write ID reservation.
    if !single_mint(&p.program){return None;}
    let refs=p.program.args.iter().filter(|(_,kind)|matches!(kind,ir::ArgType::Ref{table:t} if t==table)).collect::<Vec<_>>();
    if refs.len()!=1{return None;}
    let key=step.args.get(refs[0].0)?;
    let initial=c.supporting_rows.get(table)?.iter().find(|r|r.field("id").ok()==Some(key))?;
    let guard_value=initial.field(column).ok()?;
    let mut engine=Engine::memory(bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone())).ok()?;
    let now=step.clock.unwrap_or(challenges::NOW);
    engine.seed_at(c.supporting_rows.iter().flat_map(|(t,rs)|rs.iter().map(move|r|(t.clone(),r.clone()))).collect::<Vec<_>>(),now).ok()?;
    let unchanged=|engine:&Engine|engine.store().rows(table).ok().and_then(|rs|rs.into_iter().find(|r|r.field("id").ok()==Some(key))).is_some_and(|r|r.field(column).ok()==Some(guard_value));
    // Preserve the observed first insertion's id. No other minted identities
    // may be needed to reconstruct this supported single-insert shape.
    if ir::write_tables(&p.program).len()!=1{return None;}
    let first_id=c.row.field("id").ok()?.as_str().ok()?.to_owned();
    let first=engine.mutate(&step.operation,None,Context::new(&step.viewer,step.args.clone()).at(now).with_ids(replay_ids(&first_id,0)?)).ok()?;
    let first=serde_json::to_value(first.state).ok()?;
    if first["state"]!="sent"||!unchanged(&engine){return None;}
    let before=engine.store().rows(&inv.table).ok()?;
    if !before.contains(&c.row){return None;}
    let second=engine.mutate(&step.operation,None,Context::new(&step.viewer,step.args.clone()).at(now).with_ids(replay_ids(&first_id,snapback4_core::meter::Ceilings::default().rows_written as usize)?)).ok()?;
    let second=serde_json::to_value(second.state).ok()?;
    if second["state"]!="sent"||!unchanged(&engine){return None;}
    let after=engine.store().rows(&inv.table).ok()?;
    let added=after.iter().filter(|r|!before.contains(r)).collect::<Vec<_>>();
    if added.len()!=1||after.len()!=before.len()+1{return None;}
    let mut repeated=c.clone();repeated.row=added[0].clone();repeated.old=None;
    repeated.history[0].result=first;
    let mut next=step.clone();next.result=second;repeated.history.push(next);
    let mut value=evidence(sources,bound,inv,&repeated);
    value["generatedIds"].as_array_mut()?.push(first_id.into());
    // This is an observed reuse question, not a claimed invariant that all
    // executions of the producer must be denied.
    value["kind"]="guard-reuse".into();
    value["candidate"]=format!("question: may {} reuse unchanged {guard} on the same resource?",step.operation).into();
    value["summary"]=format!("{} as {} twice with the same arguments → two admitted inserts into {}; {guard} remains {} on the same resource (reconstructed generated fixture; finite replay, not proof)",step.operation,step.viewer,inv.table,safe(guard_value,bound.schema.table(table).and_then(|t|t.columns.get(column)))).into();
    value["compactSummary"]=value["summary"].clone();
    value["committedRows"]=json!({inv.table.clone():after.iter().map(|row|image(bound,&inv.table,row)).collect::<Vec<_>>()});
    Some(super::super::super::security_reviews::witness::stamp(value))
}

#[cfg(test)]mod tests {
    use super::*;
    fn examples(source:&str,code:&str,message:&str)->Vec<serde_json::Value>{
        let sources=vec![("schema.q".into(),source.into())];let mut bound=snapback4_lang::compile(&sources);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let n=Diagnostic::new(&Default::default(),code,message,"state intent");
        let selected=candidates(&bound,&sources,0,&n);assert!(!selected.is_empty(),"no candidate for {message}");
        bound.invariants=selected.iter().map(|(_,i)|i.clone()).collect();
        let mut campaign=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&bound,&mut campaign,false);
        selected.iter().flat_map(|(_,inv)|campaign.violations.iter().filter(|c|c.invariant_site==inv.site.to_string()&&c.reachability.is_reachable()).filter_map(|c|{
            let value=if code=="N_GUARD_NOT_CONSUMED" {repeat(&bound,inv,c,&n,&sources)?}else{evidence(&sources,&bound,inv,c)};
            super::super::super::super::security_reviews::witness::concrete(&value).then_some(value)
        })).collect()
    }
    #[test]fn omitted_and_empty_media_are_actual_inserts(){
        let prefix="table docs:\n  photos: [image <=1000] <=3 ?\n  read <- allow\n  insert <- allow\n  online only\n";
        for payload in ["null","[]"] {
            let source=format!("{prefix}mutation create():\n  return insert docs {{photos:{payload}}}\n");
            let values=examples(&source,"N_OPTIONAL_EVIDENCE","docs.photos permits omitted or empty media evidence");
            assert!(!values.is_empty(),"{payload}");assert!(values.iter().all(|v|v["operation"]=="create"));
        }
    }
    #[test]fn text_insert_is_a_representation_question_not_a_deny_contract(){
        let source="table docs:\n  scan: text 1..100\n  read <- allow\n  insert <- allow\n  online only\nmutation create(scan: text 1..100):\n  return insert docs {scan}\n";
        let values=examples(source,"N_TEXT_EVIDENCE","docs.scan: text evidence");assert!(!values.is_empty());
        let n=Diagnostic::new(&Default::default(),"N_TEXT_EVIDENCE","docs.scan: text evidence","");
        let value=text_evidence(values[0].clone(),&n);assert!(value["candidate"].as_str().unwrap().contains("deliberately text"));assert_eq!(value["row"]["scan"],"<redacted>");
    }
    #[test]fn typed_query_payload_records_the_observer_on_a_generated_fixture(){
        let source="use personas owner,reader\ntable docs:\n  owner: principal\n  read <- .owner = viewer or viewer = 'dev:reader'\n  insert <- allow\n  online only\nquery read(doc: docs):\n  return docs[doc]\n";
        let values=examples(source,"N_BROAD_READ","docs.read: broad exception");assert!(!values.is_empty());
        for v in values{assert!(v["history"].as_array().unwrap().last().unwrap()["clock"].is_i64());let mut later=v.clone();later["history"].as_array_mut().unwrap().last_mut().unwrap()["clock"]=json!(challenges::NOW+1);assert_ne!(super::super::super::super::security_reviews::witness::id(&v),super::super::super::super::security_reviews::witness::id(&later));assert_eq!(v["kind"],"read-payload");assert_eq!(v["operation"],"read");assert_eq!(v["history"].as_array().unwrap().last().unwrap()["state"],"observed");}
        let fixed=source.replace(" or viewer = 'dev:reader'","");assert!(examples(&fixed,"N_BROAD_READ","docs.read: broad exception").is_empty());
    }
    #[test]fn missing_child_is_observed_at_the_named_transition(){
        let prefix="table docs:\n  state: enum('draft','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable photos:\n  doc: docs\n  image: image <=1000\n  read <- allow\n  online only\n";
        let source=format!("{prefix}mutation finish(doc: docs):\n  update docs[doc] {{state:'done'}}\n");
        assert!(!examples(&source,"N_CHILD_EVIDENCE_PRESENCE","docs: transitions finish do not require attached photos[doc = parent].image; evidence?").is_empty());
        let fixed=source.replace("  update docs[doc]","  require exists photos[doc = doc] else MISSING\n  update docs[doc]");
        assert!(examples(&fixed,"N_CHILD_EVIDENCE_PRESENCE","docs: transitions finish do not require attached photos[doc = parent].image; evidence?").is_empty());
    }
    #[test]fn one_insert_followed_by_more_than_the_id_reservation_remains_uncovered(){
        let source="table docs:\n  insert <- allow\n  online only\nmutation create():\n  return insert docs {}\n";
        let bound=snapback4_lang::compile(&[("schema.q".into(),source.into())]);assert!(bound.diagnostics.is_empty());
        let mut program=bound.programs[0].program.clone();assert!(single_mint(&program));
        let at=program.body.len().saturating_sub(1);
        program.body.insert(at,ir::Stmt::For{binding:"n".into(),domain:ir::LoopDomain::LiteralRange{start:0,end_exclusive:1025},body:vec![ir::Stmt::Let{name:"unused".into(),value:ir::Expr::Input(ir::Input::NewId)}]});
        assert_eq!(ir::write_tables(&program).len(),1);
        assert!(!single_mint(&program),"one write table does not bound mint evaluations");
    }
    #[test]fn guard_reuse_requires_two_distinct_effects_and_an_unchanged_resource(){
        let source="table credits:\n  spent: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable receipts:\n  credit: credits\n  read <- allow\n  insert <- allow\n  online only\nmutation redeem(credit: credits):\n  c = credits[credit] ! else MISSING\n  require not c.spent else USED\n  return insert receipts {credit}\n";
        let message="redeem: checks credits.spent but leaves it unchanged while changing receipts state; reuse?";
        let values=examples(source,"N_GUARD_NOT_CONSUMED",message);assert!(!values.is_empty());assert!(values.iter().all(|v|v["kind"]=="guard-reuse"&&v["history"].as_array().unwrap().len()==2));
        let again=examples(source,"N_GUARD_NOT_CONSUMED",message);assert_eq!(values.iter().map(|v|&v["id"]).collect::<Vec<_>>(),again.iter().map(|v|&v["id"]).collect::<Vec<_>>());
        let fixed=source.replace("  return insert receipts", "  update credits[credit] {spent:true}\n  return insert receipts");assert!(examples(&fixed,"N_GUARD_NOT_CONSUMED",message).is_empty());
    }
}
