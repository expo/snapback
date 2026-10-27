//! Replay questions without promoting guessed product intent into enforcement.
// @ref LLP 3000.036.004.001#question-candidates — hypotheses remain advisory even when a replay is available.
use super::*;
use snapback4_core::{Context, Engine, ir, schema::{RuleExpr, RuleTerm}};

pub(super) fn advisory(code:&str)->bool {
    matches!(code,"N_OPTIONAL_EVIDENCE"|"N_TEXT_EVIDENCE"|"N_CHILD_EVIDENCE_PRESENCE"|"N_GUARD_NOT_CONSUMED"|"N_BROAD_READ"|"N_APPROVAL_PATH"|"N_CALLER_HISTORY"|"N_LATEST_SUBJECT"|"N_ASSIGNMENT_SCOPE"|"N_TRANSITION_BYPASS")
}
pub(super) fn candidates(bound:&Bound,sources:&[(String,String)],index:usize,n:&Diagnostic)->Vec<(usize,security::Invariant)> {
    let mut lines=Vec::new();
    if n.code=="N_OPTIONAL_EVIDENCE" {
        if let Some((table,column))=n.message.split_whitespace().next().and_then(|s|s.split_once('.'))
            && let Some(kind)=bound.schema.table(table).and_then(|t|t.columns.get(column)) {
            let presence=if matches!(kind.required(),ColumnType::List{..}|ColumnType::ListRange{..}) {
                format!(".{column} != null and count(.{column}) > 0")
            } else {format!(".{column} != null")};
            for p in &bound.programs {
                let writes=ir::write_tables(&p.program);
                if single_mint(&p.program)
                    && writes.len()==1
                    && writes.iter().any(|(t,k)|t==table&&*k=="insert")
                    && bound.schema.maintains.is_empty() {
                    lines.push(format!("invariant {table}.{} only {presence}",p.program.name));
                }
            }
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
                // The observer captures a write boundary, not the final store.
                // Limit this question to a sole parent update, with no maintains,
                // branch, loop or opaque execution: later
                // work in the same atomic call must not repair the observation.
                let Some(p)=bound.programs.iter().find(|p|p.program.name==operation) else {continue;};
                let writes=ir::write_tables(&p.program);
                if !single_mint(&p.program)
                    || writes.len()!=1
                    || !writes.iter().any(|(t,k)|t==table&&*k=="update")
                    || writes.iter().any(|(t,_)|t==child)
                    || !bound.schema.maintains.is_empty() {continue;}
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
    lines.into_iter().filter_map(|line|candidate(sources,&line).map(|mut inv|{
        if matches!(n.code.as_str(),"N_OPTIONAL_EVIDENCE"|"N_CHILD_EVIDENCE_PRESENCE") {
            inv.site.file=inv.site.file.replace("/dx11/","/sec11-absence/");
        }
        (index,inv)
    })).collect()
}

// @ref LLP 3000.036.004.004#transition-questions — public questions retain complete normalized source hypotheses and a persistent actual edge.
pub(super) fn transition_evidence(mut value:serde_json::Value,n:&Diagnostic,inv:&security::Invariant)->Option<serde_json::Value>{
    if value["effect"]!="update"{return None;}let column=inv.column.as_ref()?;
    let old=value["old"].get(column)?.clone();let next=value["row"].get(column)?.clone();if old==next{return None;}
    let committed=value["committedRows"][&inv.table].as_array()?.iter().find(|row|row["id"]==value["row"]["id"])?;
    if committed.get(column)!=Some(&next){return None;}
    let op=value["operation"].as_str()?.to_owned();let viewer=value["viewer"].as_str()?.to_owned();
    value["hypothesis"]=json!({"basis":inv.predicate});value["questionKind"]="declared-transition".into();
    value["transition"]=json!({"table":inv.table,"column":column,"from":old,"to":next});
    value["candidate"]=format!("question: {}",n.message).into();
    value["summary"]=format!("{op} as {viewer} committed {}.{column} {old} -> {next}; {} (bounded typed write replay; not proof or inferred enum-order authority)",inv.table,n.message).into();
    let question=n.message.split_once(": ").map(|(_,s)|s).unwrap_or(&n.message);let prefix=format!("{op} ");let question=question.strip_prefix(&prefix).unwrap_or(question);
    value["compactSummary"]=format!("{op} as {viewer} changed {}.{column} {old} -> {next}; {question}",inv.table).into();
    Some(super::super::super::security_reviews::witness::stamp(value))
}

pub(super) fn assignment_evidence(mut value:serde_json::Value,n:&Diagnostic,inv:&security::Invariant)->Option<serde_json::Value> {
    // One actual query on the recorded initial world keeps assignment facts
    // tied to that observation, rather than borrowing a stale pre-history row.
    if value["kind"]!="read-payload"||value["history"].as_array()?.len()!=1{return None;}
    let mut assigned=String::new();
    if let Some(RuleExpr::Or(parts))=&inv.policy&&let [_,relation]=parts.as_slice(){
        let principal=match relation{
            RuleExpr::Eq(RuleTerm::Field(column),RuleTerm::Viewer)=>value["row"].get(column)?.clone(),
            RuleExpr::Exists{table,key,equalities,..}=>{
                let [RuleTerm::Field(reference)]=key.as_slice()else{return None;};
                let [(column,RuleTerm::Viewer)]=equalities.as_slice()else{return None;};
                let parent=value["supportingRows"][table].as_array()?.iter().find(|row|row["id"]==value["row"][reference])?;
                parent.get(column)?.clone()
            },_=>return None,
        };
        let principal=principal.as_str()?;
        if value["viewer"]==principal{return None;}
        value["assignment"]=json!({"relation":relation.quarry(),"principal":principal});
        assigned=format!(" assigned to {principal};");
    }
    value["hypothesis"]=json!({"policy":inv.policy});
    value["questionKind"]="assignment-scope".into();
    value["candidate"]=format!("question: {}",n.message).into();
    value["summary"]=format!("{} as {} → actually disclosed {};{} {} (bounded typed payload replay; not proof or inferred assignment intent)",value["operation"].as_str().unwrap_or("query"),value["viewer"].as_str().unwrap_or("caller"),n.message.split(" read:").next().unwrap_or("payload"),assigned,n.message).into();
    value["compactSummary"]=value["summary"].clone();
    Some(super::super::super::security_reviews::witness::stamp(value))
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
                if ["If","For","Emit","JobAs","JobQuery"].iter().any(|key|fields.contains_key(*key)){return false;}
                if fields.get("Input").is_some_and(|v|v=="NewId"){*mints+=1;}
                fields.values().all(|v|inspect(v,mints))
            },
            serde_json::Value::Array(values)=>values.iter().all(|v|inspect(v,mints)),_=>true,
        }
    }
    let mut mints=0;
    !program.native&&inspect(&serde_json::to_value(program).unwrap(),&mut mints)&&mints<=1
}
fn direct_guard(program:&ir::Program,table:&str,column:&str,arg:&str)->bool {
    use ir::{Expr as E,Stmt as S};
    fn identity(e:&E,vars:&BTreeMap<String,E>,arg:&str,depth:usize)->bool {
        if depth>32{return false;}
        matches!(e,E::Variable(name) if vars.get(name).map_or(name==arg,|e|identity(e,vars,arg,depth+1)))
    }
    fn row(e:&E,vars:&BTreeMap<String,E>,table:&str,arg:&str,depth:usize)->bool {
        if depth>32{return false;}
        match e {
            E::Get(read)=>read.table==table&&read.index=="byId"&&read.key.len()==1&&identity(&read.key[0],vars,arg,0),
            E::Variable(name)=>vars.get(name).is_some_and(|e|row(e,vars,table,arg,depth+1)),
            E::Block{body,value}=>{
                let mut vars=vars.clone();for stmt in body{match stmt{
                    S::Const{name,value}|S::Let{name,value}=>{vars.insert(name.clone(),value.clone());},S::Require{..}=>{},_=>return false,
                }}row(value,&vars,table,arg,depth+1)
            },_=>false,
        }
    }
    fn necessary(e:&E,vars:&BTreeMap<String,E>,table:&str,column:&str,arg:&str,negated:bool,depth:usize)->bool {
        if depth>32{return false;}
        let field=|e:&E|matches!(e,E::Field{base,name} if name==column&&row(base,vars,table,arg,0));
        match e {
            E::Field{..}=>field(e),
            E::Variable(name)=>vars.get(name).is_some_and(|e|necessary(e,vars,table,column,arg,negated,depth+1)),
            E::Unary{op:ir::UnaryOp::Not,value}=>necessary(value,vars,table,column,arg,!negated,depth+1),
            E::Binary{op:ir::BinaryOp::And|ir::BinaryOp::Or,left,right}=>{
                let a=necessary(left,vars,table,column,arg,negated,depth+1);let b=necessary(right,vars,table,column,arg,negated,depth+1);
                if matches!(e,E::Binary{op:ir::BinaryOp::And,..})!=negated{a||b}else{a&&b}
            },
            E::Binary{op:ir::BinaryOp::Eq|ir::BinaryOp::Ne,left,right}=>[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].into_iter().any(|(a,b)|field(a)&&matches!(b,E::Literal(snapback4_core::Value::Bool(_)|snapback4_core::Value::String(_)))),_=>false,
        }
    }
    let mut vars=BTreeMap::new();let mut found=false;
    for stmt in &program.body{match stmt{
        S::Const{name,value}|S::Let{name,value}=>{if vars.contains_key(name)||program.args.contains_key(name){return false;}vars.insert(name.clone(),value.clone());},
        S::Require{condition,..}=>found|=necessary(condition,&vars,table,column,arg,false,0),
        S::Assign{..}|S::If{..}|S::For{..}=>return false,
        S::Return(_)=>break,_=>{},
    }}found
}
pub(super) fn transition(inv:&security::Invariant,c:&Counterexample,stages:&std::collections::BTreeSet<(String,String)>)->bool {
    c.effect=="update"&&stages.iter().filter(|(table,_)|table==&inv.table).any(|(_,column)|
        c.old.as_ref().and_then(|r|r.field(column).ok()).zip(c.row.field(column).ok()).is_some_and(|(old,next)|old!=next))
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
    if !direct_guard(&p.program,table,column,refs[0].0){return None;}
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
    use snapback4_core::Value;
    fn examples(source:&str,code:&str,message:&str)->Vec<serde_json::Value>{
        let sources=vec![("schema.q".into(),source.into())];let mut bound=snapback4_lang::compile(&sources);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let n=Diagnostic::new(&Default::default(),code,message,"state intent");
        let stages=security::derived::workflow_columns_from_sources(&sources,&bound);
        let selected=candidates(&bound,&sources,0,&n);assert!(!selected.is_empty(),"no candidate for {message}");
        bound.invariants=selected.iter().map(|(_,i)|i.clone()).collect();
        let mut campaign=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&bound,&mut campaign,false);
        selected.iter().flat_map(|(_,inv)|campaign.violations.iter().filter(|c|c.invariant_site==inv.site.to_string()&&c.reachability.is_reachable()).filter_map(|c|{
            if code=="N_CHILD_EVIDENCE_PRESENCE"&&!transition(inv,c,&stages){return None;}
            let value=if code=="N_GUARD_NOT_CONSUMED" {repeat(&bound,inv,c,&n,&sources)?}else{evidence(&sources,&bound,inv,c)};
            super::super::super::super::security_reviews::witness::concrete(&value).then_some(value)
        })).collect()
    }
    fn assignment_values(source:&str,table:&str)->Vec<serde_json::Value>{
        let sources=vec![("schema.q".into(),source.into())];let mut bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty());
        let selected=security::derived::assignment_questions(&sources,&bound).into_iter().filter(|(_,i)|i.table==table).collect::<Vec<_>>();
        assert!(!selected.is_empty());bound.invariants=selected.iter().map(|(_,i)|i.clone()).collect();let mut c=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&bound,&mut c,false);
        selected.iter().flat_map(|(n,i)|c.violations.iter().filter(|v|v.invariant_site==i.site.to_string()&&v.history.len()==1&&v.history.last().is_some_and(|s|s.observed_data.is_some())).filter_map(|v|assignment_evidence(evidence(&sources,&bound,i,v),n,i))).collect()
    }
    #[test]fn assignment_cards_keep_actual_assignees_and_require_private_payloads(){
        let source=include_str!("../../../../../snapback4-lang/tests/security/sec10-shipping/w30-004.q");
        let values=assignment_values(source,"jobPrivate");assert!(!values.is_empty());
        for v in values{assert_eq!(v["kind"],"read-payload");assert_ne!(v["assignment"]["principal"],v["viewer"]);assert!(v["candidate"].as_str().unwrap().starts_with("question:"));assert!(v["summary"].as_str().unwrap().contains(v["assignment"]["principal"].as_str().unwrap()));}
        let id_only=source.replace("return { details: jobPrivate[job = job], cancellation: cancellations[job = job] }","secret = jobPrivate[job = job] ! else NOT_FOUND\n  return { id: secret.id }");
        assert!(assignment_values(&id_only,"jobPrivate").is_empty(),"returning the resource id does not disclose private payload");
        let source=include_str!("../../../../../snapback4-lang/tests/security/sec10-shipping/w30-014.q");
        let values=assignment_values(source,"projects");assert!(!values.is_empty());assert!(values.iter().all(|v|v.get("assignment").is_none()&&v["candidate"].as_str().unwrap().contains("no modeled assignment constraint")));
    }
    #[test]fn changed_assignment_audience_renews_the_same_payload_question(){
        let original=include_str!("../../../../../snapback4-lang/tests/security/sec10-shipping/w30-004.q");
        let original=original.replace("  principal: principal\n","  principal: principal\n  active: bool default false\n");
        let changed=original.replace("  read <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']\n","  read <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator', active = false]\n");
        let before=assignment_values(&original,"jobPrivate");let after=assignment_values(&changed,"jobPrivate");assert!(!before.is_empty()&&!after.is_empty());
        let a=&before[0];let b=after.iter().find(|v|v["viewer"]==a["viewer"]&&v["operation"]==a["operation"]).unwrap();
        assert_eq!(a["candidate"],b["candidate"],"the factual role/assignment question stays the same");assert_ne!(a["hypothesis"],b["hypothesis"]);assert_ne!(a["id"],b["id"],"changed audience qualifiers must renew the decision");
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
    #[test]fn changing_delivered_fields_renews_a_read_decision_with_the_same_policy_row(){
        let source="use personas owner,reader\ntable docs:\n  owner: principal\n  secret: text <=50 read <- .owner = viewer\n  read <- .owner = viewer or viewer = 'dev:reader'\n  insert <- allow\n  online only\nquery read(doc: docs):\n  return docs[doc]\n";
        let before=examples(source,"N_BROAD_READ","docs.read: broad exception");assert!(!before.is_empty());
        let changed=source.replace("secret: text <=50 read <- .owner = viewer","secret: text <=50");
        let after=examples(&changed,"N_BROAD_READ","docs.read: broad exception");assert!(!after.is_empty());
        let (a,b)=(&before[0],&after[0]);assert_eq!(a["row"],b["row"]);
        assert_ne!(a["observation"]["data"],b["observation"]["data"]);assert_ne!(a["id"],b["id"]);
        assert_eq!(b["observation"]["data"]["secret"],"<redacted>");
    }
    #[test]fn missing_child_is_observed_at_the_named_transition(){
        let prefix="table docs:\n  state: enum('draft','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable photos:\n  doc: docs\n  image: image <=1000\n  read <- allow\n  online only\n";
        let source=format!("{prefix}mutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.state = 'draft' else STATE\n  update docs[doc] {{state:'done'}}\n");
        assert!(!examples(&source,"N_CHILD_EVIDENCE_PRESENCE","docs: transitions finish do not require attached photos[doc = parent].image; evidence?").is_empty());
        let fixed=source.replace("  update docs[doc]","  require exists photos[doc = doc] else MISSING\n  update docs[doc]");
        assert!(examples(&fixed,"N_CHILD_EVIDENCE_PRESENCE","docs: transitions finish do not require attached photos[doc = parent].image; evidence?").is_empty());
    }
    #[test]fn an_omission_repaired_in_the_same_call_is_not_a_missing_evidence_question(){
        let source="table docs:\n  photos: [text <=20] <=3 ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create():\n  d = insert docs {photos:null}\n  update docs[d.id] {photos:['attached']}\n  return d\n";
        let sources=vec![("schema.q".into(),source.into())];let bound=snapback4_lang::compile(&sources);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let mut engine=Engine::memory(bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone())).unwrap();
        let result=engine.mutate("create",None,Context::new("dev:alice",BTreeMap::new()).at(challenges::NOW)).unwrap();
        assert_eq!(serde_json::to_value(result.state).unwrap()["state"],"sent");
        assert!(matches!(engine.store().rows("docs").unwrap()[0].field("photos").unwrap(),Value::Array(values) if values.len()==1));
        let note=Diagnostic::new(&Default::default(),"N_OPTIONAL_EVIDENCE","docs.photos permits omitted or empty media evidence","");
        assert!(candidates(&bound,&sources,0,&note).is_empty(),"a multiwrite call requires final-store replay even when the intermediate insert omitted evidence");
    }
    #[test]fn an_atomic_call_can_attach_evidence_after_advancing_the_parent(){
        let source="table docs:\n  state: enum('draft','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable photos:\n  doc: docs\n  proof: text <=20\n  read <- allow\n  insert <- allow\n  online only\nmutation finish(doc: docs):\n  update docs[doc] {state:'done'}\n  return insert photos {doc, proof:'attached'}\n";
        let sources=vec![("schema.q".into(),source.into())];
        let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let mut engine=Engine::memory(bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone())).unwrap();
        let doc="01ARZ3NDEKTSV4RRFFQ69G5FAV";
        let row=snapback4_core::value::object([("id",Value::Id(doc.into())),("state",Value::String("draft".into()))]);
        engine.seed_at(vec![("docs".into(),row)],challenges::NOW).unwrap();
        let result=engine.mutate("finish",None,Context::new("dev:alice",BTreeMap::from([("doc".into(),Value::Id(doc.into()))])).at(challenges::NOW)).unwrap();
        assert_eq!(serde_json::to_value(result.state).unwrap()["state"],"sent");
        assert_eq!(engine.store().rows("photos").unwrap().len(),1);
        assert_eq!(engine.store().rows("docs").unwrap()[0].field("state").unwrap().as_str().unwrap(),"done");
        let note=Diagnostic::new(&Default::default(),"N_CHILD_EVIDENCE_PRESENCE","docs: transitions finish do not require attached photos[doc = parent].proof; evidence?","");
        assert!(candidates(&bound,&sources,0,&note).is_empty(),"an intermediate childless write is not a committed missing-evidence witness");
        let reverted=source.replace("  return insert photos {doc, proof:'attached'}","  update docs[doc] {state:'draft'}");
        let changed=vec![("schema.q".into(),reverted)];let bound=snapback4_lang::compile(&changed);
        assert!(bound.diagnostics.is_empty());assert!(candidates(&bound,&changed,0,&note).is_empty(),"intermediate state can also be reverted");
    }
    #[test]fn a_later_cascade_cannot_supply_a_committed_childless_transition(){
        let source="table projects:\n  read <- allow\n  delete <- allow\n  online only\ntable docs:\n  project: projects on delete cascade\n  cap 3 by project\n  state: enum('draft','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\ntable photos:\n  doc: docs\n  proof: text <=20\n  read <- allow\n  online only\nmutation finish(doc: docs, project: projects):\n  update docs[doc] {state:'done'}\n  delete projects[project]\n";
        let sources=vec![("schema.q".into(),source.into())];let bound=snapback4_lang::compile(&sources);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let mut engine=Engine::memory(bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone())).unwrap();
        let project="01ARZ3NDEKTSV4RRFFQ69G5FAA";let doc="01ARZ3NDEKTSV4RRFFQ69G5FAV";
        let row=|fields:Vec<(&str,Value)>|snapback4_core::value::object(fields);
        engine.seed_at(vec![("projects".into(),row(vec![("id",Value::Id(project.into()))])),("docs".into(),row(vec![("id",Value::Id(doc.into())),("project",Value::Id(project.into())),("state",Value::String("draft".into()))]))],challenges::NOW).unwrap();
        let args=BTreeMap::from([("doc".into(),Value::Id(doc.into())),("project".into(),Value::Id(project.into()))]);
        let result=engine.mutate("finish",None,Context::new("dev:alice",args).at(challenges::NOW)).unwrap();
        assert_eq!(serde_json::to_value(result.state).unwrap()["state"],"sent");assert!(engine.store().rows("docs").unwrap().is_empty());
        let note=Diagnostic::new(&Default::default(),"N_CHILD_EVIDENCE_PRESENCE","docs: transitions finish do not require attached photos[doc = parent].proof; evidence?","");
        assert!(candidates(&bound,&sources,0,&note).is_empty());
    }
    #[test]fn commit_end_expiry_cannot_supply_an_absence_question(){
        let source="table docs:\n  state: enum('draft','done') default 'draft'\n  photos: [image <=1000] <=3 ?\n  until: time\n  expire at .until\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable photos:\n  doc: docs\n  proof: text <=20\n  read <- allow\n  online only\nmutation create():\n  return insert docs {photos:null,until:now}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.state = 'draft' else STATE\n  update docs[doc] {state:'done',until:now}\n";
        let sources=vec![("schema.q".into(),source.into())];let bound=snapback4_lang::compile(&sources);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let mut engine=Engine::memory(bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone())).unwrap();
        let result=engine.mutate("create",None,Context::new("dev:alice",BTreeMap::new()).at(challenges::NOW)).unwrap();
        assert_eq!(serde_json::to_value(result.state).unwrap()["state"],"sent");assert!(engine.store().rows("docs").unwrap().is_empty());
        let doc="01ARZ3NDEKTSV4RRFFQ69G5FAV";
        engine.seed_at(vec![("docs".into(),snapback4_core::value::object([("id",Value::Id(doc.into())),("state",Value::String("draft".into())),("photos",Value::Null),("until",Value::Int(challenges::NOW+86400000))]))],challenges::NOW).unwrap();
        let result=engine.mutate("finish",None,Context::new("dev:alice",BTreeMap::from([("doc".into(),Value::Id(doc.into()))])).at(challenges::NOW)).unwrap();
        assert_eq!(serde_json::to_value(result.state).unwrap()["state"],"sent");assert!(engine.store().rows("docs").unwrap().is_empty());
        assert!(examples(source,"N_OPTIONAL_EVIDENCE","docs.photos permits omitted or empty media evidence").is_empty());
        assert!(examples(source,"N_CHILD_EVIDENCE_PRESENCE","docs: transitions finish do not require attached photos[doc = parent].proof; evidence?").is_empty());
    }
    #[test]fn indirect_same_table_guards_do_not_borrow_the_argument_rows_identity(){
        let source="table credits:\n  parent: credits ?\n  spent: bool default false\n  read <- allow\n  insert <- allow\n  online only\ntable receipts:\n  credit: credits\n  insert <- allow\n  online only\nmutation redeem(credit: credits):\n  c = credits[credit] ! else MISSING\n  require c.parent != null else PARENT\n  p = credits[c.parent] ! else MISSING\n  require not p.spent else USED\n  return insert receipts {credit}\n";
        let bound=snapback4_lang::compile(&[("schema.q".into(),source.into())]);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        assert!(!direct_guard(&bound.programs[0].program,"credits","spent","credit"));
    }
    #[test]fn a_childless_draft_edit_cannot_supply_a_transition_witness(){
        let source="table docs:\n  state: enum('draft','done') default 'draft'\n  note: text <=30 default ''\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable photos:\n  doc: docs\n  image: image <=1000\n  read <- allow\n  online only\nmutation finish(doc: docs, advance: bool):\n  d = docs[doc] ! else MISSING\n  if advance:\n    require d.state = 'draft' else STATE\n    require count(photos[doc = doc]) > 0 else PHOTO\n    update docs[doc] {state:'done'}\n  else:\n    update docs[doc] {note:'draft edit'}\n";
        let sources=vec![("schema.q".into(),source.into())];let mut bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let stages=security::derived::workflow_columns_from_sources(&sources,&bound);assert!(stages.contains(&("docs".into(),"state".into())));
        let inv=candidate(&sources,"invariant docs.finish only count(photos[doc = .id]) > 0").unwrap();bound.invariants=vec![inv.clone()];
        let mut campaign=challenges::Campaign::work_bounded(2048);challenges::generated_campaign(&bound,&mut campaign,false);
        assert!(campaign.violations.iter().any(|c|c.old.as_ref().and_then(|r|r.field("note").ok())!=c.row.field("note").ok()),"the harmless edit must actually execute");
        assert!(campaign.violations.iter().all(|c|!transition(&inv,c,&stages)));
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
        let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);assert!(direct_guard(&b.programs[0].program,"credits","spent","credit"));
        let conditional=source.replace("require not c.spent else USED","require not (c.spent and false) else USED");
        let conditional=snapback4_lang::compile(&[("schema.q".into(),conditional)]);assert!(conditional.diagnostics.is_empty());assert!(!direct_guard(&conditional.programs[0].program,"credits","spent","credit"));
        let message="redeem: checks credits.spent but leaves it unchanged while changing receipts state; reuse?";
        let values=examples(source,"N_GUARD_NOT_CONSUMED",message);assert!(!values.is_empty());assert!(values.iter().all(|v|v["kind"]=="guard-reuse"&&v["history"].as_array().unwrap().len()==2));
        let again=examples(source,"N_GUARD_NOT_CONSUMED",message);assert_eq!(values.iter().map(|v|&v["id"]).collect::<Vec<_>>(),again.iter().map(|v|&v["id"]).collect::<Vec<_>>());
        let fixed=source.replace("  return insert receipts", "  update credits[credit] {spent:true}\n  return insert receipts");assert!(examples(&fixed,"N_GUARD_NOT_CONSUMED",message).is_empty());
    }
}

#[cfg(test)]mod transition_cards{
 use super::*;
 #[test]fn committed_transition_cards_keep_full_hypotheses_and_reject_transient_images(){
  let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../snapback4-lang/tests/security/sec10-shipping/w30-030.q"));let sources=vec![("schema.q".into(),source.into())];let mut bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty());let qs=security::derived::transition_questions(&sources,&bound);assert_eq!(qs.len(),1);let(n,inv)=&qs[0];bound.invariants=vec![inv.clone()];let mut campaign=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&bound,&mut campaign,false);
  let c=campaign.violations.iter().find(|c|c.operation=="publishReport"&&c.reachability.is_reachable()).unwrap();let raw=evidence(&sources,&bound,inv,c);let card=transition_evidence(raw.clone(),n,inv).unwrap();assert_eq!(card["transition"]["from"],"measured");assert_eq!(card["transition"]["to"],"reported");assert!(card["summary"].as_str().unwrap().contains("markReviewed"));assert!(super::super::super::super::security_reviews::witness::concrete(&card));
  let changed=source.replace("require s.status = 'measured' else BAD_STATUS","require s.status = 'measured' else BAD_STATUS\n  require s.siteKind = 'office' else WRONG_KIND");let sources2=vec![("schema.q".into(),changed)];let b2=snapback4_lang::compile(&sources2);assert!(b2.diagnostics.is_empty());let qs2=security::derived::transition_questions(&sources2,&b2);let next=transition_evidence(raw.clone(),&qs2[0].0,&qs2[0].1).unwrap();assert_eq!(card["candidate"],next["candidate"]);assert_eq!(card["transition"],next["transition"]);assert_ne!(card["id"],next["id"],"source prerequisite qualifiers remain material after factual candidate rewriting");
  let sources3=vec![("schema.q".into(),format!("-- harmless source line\n{source}"))];let b3=snapback4_lang::compile(&sources3);let qs3=security::derived::transition_questions(&sources3,&b3);let same=transition_evidence(raw.clone(),&qs3[0].0,&qs3[0].1).unwrap();assert_eq!(card["id"],same["id"],"source coordinates do not define meaning");
  let mut missing=raw.clone();missing["committedRows"][&inv.table]=json!([]);assert!(transition_evidence(missing,n,inv).is_none());
  let mut reverted=raw.clone();let id=reverted["row"]["id"].clone();let committed=reverted["committedRows"][&inv.table].as_array_mut().unwrap().iter_mut().find(|row|row["id"]==id).unwrap();committed[inv.column.as_ref().unwrap()]="measured".into();assert!(transition_evidence(reverted,n,inv).is_none());
  let mut noop=raw;noop["old"]=noop["row"].clone();assert!(transition_evidence(noop,n,inv).is_none());
 }
 #[test]fn calibrated_questions_survive_the_complete_default_collector(){
  for(label,source,code,operation)in[
   ("030",include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../snapback4-lang/tests/security/sec10-shipping/w30-030.q")),"N_TRANSITION_BYPASS","publishReport"),
   ("035",include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../snapback4-lang/tests/security/sec10-shipping/w30-035.q")),"N_TRANSITION_BYPASS","advanceStage"),
   ("018",include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../snapback4-lang/tests/security/sec10-shipping/w30-018.q")),"N_APPROVAL_PATH","pruneTouchup")]{
   struct Scratch(std::path::PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
   let root=std::env::temp_dir().join(format!("sb4-sec11-transition-collector-{}-{label}",std::process::id()));let _scratch=Scratch(root.clone());std::fs::create_dir_all(root.join("snapback")).unwrap();std::fs::write(root.join("snapback/schema.q"),source).unwrap();let project=Project{root};let sources=project.sources().unwrap();let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty());let mut report=security::analyze_rules(&bound);security::add_source_notes(&mut report,&sources,&bound);let options=Options{positionals:Vec::new(),flags:Default::default(),json:false};let values=super::super::collect(&project,&bound,&sources,&report.notes,true,&options);
   let witness=report.notes.iter().zip(values).find_map(|(n,w)|w.filter(|w|n.code==code&&w["operation"]==operation)).unwrap_or_else(||panic!("{label}: exact target question lost in the shared default campaign"));
   if let Some(role)=match label{"030"=>Some("engineer"),"035"=>Some("cleaner"),_=>None}{assert!(witness["supportingRows"]["roles"].as_array().unwrap().iter().any(|r|r["principal"]==witness["viewer"]&&r["role"]==role),"{label}: expected actual {role} caller, got {}",witness["viewer"]);}
  }
 }

 #[test]fn a_secondary_written_currency_renews_an_identical_zero_value_replay(){
  let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../snapback4-lang/tests/security/sec10-shipping/w30-030.q"));let usd=source.replace("table studies:\n","table studies:\n  reviewFee: money USD default 0\n").replace("update studies[study] { status: 'reviewed' }","update studies[study] { status: 'reviewed', reviewFee: 100 }");let eur=usd.replace("reviewFee: money USD","reviewFee: money EUR");
  let sources=vec![("schema.q".into(),usd)];let mut bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty());let qs=security::derived::transition_questions(&sources,&bound);assert_eq!(qs.len(),1);let(n,inv)=&qs[0];bound.invariants=vec![inv.clone()];let mut campaign=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&bound,&mut campaign,false);let c=campaign.violations.iter().find(|c|c.operation=="publishReport"&&c.reachability.is_reachable()).unwrap();let raw=evidence(&sources,&bound,inv,c);assert_eq!(raw["row"]["reviewFee"],0);let first=transition_evidence(raw.clone(),n,inv).unwrap();
  let changed_sources=vec![("schema.q".into(),eur)];let changed=snapback4_lang::compile(&changed_sources);assert!(changed.diagnostics.is_empty());let qs2=security::derived::transition_questions(&changed_sources,&changed);let raw2=evidence(&changed_sources,&changed,&qs2[0].1,c);assert_eq!(raw["row"],raw2["row"]);assert_eq!(raw["old"],raw2["old"]);assert_eq!(raw["args"],raw2["args"]);
  let second=transition_evidence(raw2,&qs2[0].0,&qs2[0].1).unwrap();assert_eq!(first["candidate"],second["candidate"]);assert_eq!(first["transition"],second["transition"]);assert_ne!(first["id"],second["id"],"identical zero-value JSON cannot erase the source write currency");
 }

}
