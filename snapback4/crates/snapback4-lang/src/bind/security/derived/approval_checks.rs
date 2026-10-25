//! Reissuing a stamp must check the replacement, not its old input image.
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — source custody alone cannot validate changed evidence.
use super::*;
use snapback4_core::Value;
#[derive(Clone)]struct Clause{columns:BTreeSet<String>,predicate:Option<ast::Expr>}
#[derive(Clone)]pub(crate) struct ApprovalCheck{complete:bool,authorized_subject:BTreeSet<String>,clauses:Vec<Clause>,bindings:BTreeMap<String,String>,selectors:Vec<Option<ast::Expr>>}
const ARG:&str="$approval-arg:";
fn walk(e:&ast::Expr,mut visit:impl FnMut(&ast::Expr)){let mut e=e.clone();super::super::super::intent_walk::expression(&mut e,&mut |e|visit(e));}
fn clauses(e:&ast::Expr)->Vec<&ast::Expr>{match e{ast::Expr::Binary{op,left,right,..} if op=="and"=>clauses(left).into_iter().chain(clauses(right)).collect(),_=>vec![e]}}
pub(super) fn collect(sources:&[(String,String)],bound:&Bound)->BTreeMap<(String,String,String,String),Vec<ApprovalCheck>>{
    let docs=sources.iter().map(|(file,text)|crate::parse_document(file,text).0).collect::<Vec<_>>();let catalog=Catalog::build(docs.clone(),&mut Vec::new());let mut out=BTreeMap::<_,Vec<_>>::new();
    let stages=stage_columns::collect(&catalog,bound);
    for doc in &docs{for p in doc.programs.iter().filter(|p|p.kind==ast::ProgramKind::Mutation){
        let writes=authority_walk::writes(&catalog,p);
        for (write,context) in &writes{let ast::Expr::Write{table,keys,fields,site,..}=write else{continue;};
            let Some(target)=bound.schema.tables.get(table)else{continue;};
            let program=super::super::super::operation_name(std::path::Path::new(&doc.file).file_stem().and_then(|s|s.to_str()).unwrap_or(&doc.file),&p.name);
            let focal=||ast::Expr::Focal{site:site.clone()};let member=|name:String|ast::Expr::Member{base:Box::new(focal()),name,site:site.clone()};
            let arguments=p.args.iter().map(|arg|(arg.name.clone(),member(format!("{ARG}{}",arg.name)))).collect();
            let admissions=stage_columns::admissions(&catalog,&stages,table,keys,p,context,fields,bound);
            let mut checks=Vec::new();
            for condition in context.body.iter().filter_map(|stmt|if let ast::Stmt::Require{condition,..}=stmt{Some(condition)}else{None}).flat_map(clauses){
                let mut condition=condition.clone();omit_preconditions(&mut condition,false,&|field|matches!(field,ast::Expr::Member{base,name,..} if same_resource(base,table,keys,p)&&admissions.contains(name)));condition=super::super::creation_advice::simplify_boolean(&condition);let mut columns=BTreeSet::new();
                walk(&condition,|e|match e{
                    ast::Expr::Member{base,name,..} if same_resource(base,table,keys,p)=>{columns.insert(name.clone());},
                    ast::Expr::Name{name,..}=>{for field in fields{if field.value.as_ref().is_some_and(|value|payload_arguments(value,p).contains(name)){columns.insert(field.name.clone());}}},_=>{},
                });
                if columns.is_empty(){continue;}
                // Resolve only the selected row. A different resource's checks
                // remain a different resource, even with the same column name.
                super::super::super::intent_walk::expression(&mut condition,&mut |e|if same_resource(e,table,keys,p){*e=focal();});
                let mut predicate=workflow::normalize(&condition,&bound.schema,table,&arguments);
                // Non-identity argument mappings retain the output dependency,
                // but cannot validate replacement data by pretending output=input.
                if fields.iter().any(|field|columns.contains(&field.name)&&field.value.as_ref().is_some_and(|value|(stored_argument(value,p).is_none()&&!payload_arguments(value,p).is_empty())||(row_input_use(value,table,keys,p,&field.name)&&!row_input_copy(value,table,keys,p,&field.name)))){predicate=None;}
                // A foreign row changed earlier in the operation may no longer
                // be the row image on which its actual require was evaluated.
                walk(&condition,|e|if let ast::Expr::Read(read)|ast::Expr::Exists{read,..}=e&&writes.iter().any(|(write,_)|matches!(write,ast::Expr::Write{table:target,..} if target==&read.table)){predicate=None;});
                if let Some(normalized)=&predicate{let mut foreign=false;walk(normalized,|e|if let ast::Expr::Member{base,..}=e&&let Some(owner)=super::super::concrete::reference_table(base,&bound.schema,table)&&!matches!(base.as_ref(),ast::Expr::Focal{..})&&writes.iter().any(|(write,_)|matches!(write,ast::Expr::Write{table:target,..} if target==owner)){foreign=true;});if foreign{predicate=None;}}
                checks.push(Clause{columns,predicate});
            }
            let bindings=fields.iter().filter_map(|field|field.value.as_ref().and_then(|value|stored_argument(value,p)).map(|name|(field.name.clone(),name))).collect();
            // Different expanded helper invocations can share a write site.
            // Select their actual caller branch/bindings before judging data.
            let selectors=context.body.iter().filter_map(|stmt|if let ast::Stmt::Require{condition,code,..}=stmt&&code=="$advice"{Some(condition)}else{None}).map(|condition|{
                let mut stable=true;walk(condition,|e|if matches!(e,ast::Expr::Read(_)|ast::Expr::Member{..}|ast::Expr::Exists{..}){stable=false;});
                if stable{workflow::normalize(condition,&bound.schema,table,&arguments)}else{None}
            }).collect();
            let complete=super::super::creation_advice::applicability_known(context,&catalog);let invocation=ApprovalCheck{complete,authorized_subject:BTreeSet::new(),clauses:checks,bindings,selectors};
            for stamp in target.columns.keys().filter(|stamp|named_approval(stamp,&target.columns[*stamp])){
                let mut invocation=invocation.clone();invocation.authorized_subject=fields.iter().filter(|field|subject::authorized(bound,&catalog,p,context,table,stamp,&field.name)).map(|field|field.name.clone()).collect();
                out.entry((program.clone(),table.clone(),stamp.clone(),site.to_string())).or_default().push(invocation);
            }
        }
    }}out
}
/// Validate each changed input against the complete relevant Boolean clause on
/// its replacement image. Unsupported expressions remain unknown, never FIX.
pub(crate) fn revalidated(bound:&Bound,program:&str,table:&str,stamp:&str,site:Option<&str>,old:&Value,next:&Value,columns:&BTreeSet<String>,rows:&BTreeMap<String,Vec<Value>>,viewer:&str,now:i64,args:&BTreeMap<String,Value>)->Option<bool>{
    let cell=|row:&Value,column:&str|row.field(column).ok().cloned().unwrap_or(Value::Null);
    let Some(checks)=site.and_then(|site|bound.security_approval_checks.get(&(program.into(),table.into(),stamp.into(),site.into())))else{return None;};
    let mut image=next.clone();if let Value::Row(fields)|Value::Map(fields)=&mut image{for (name,value) in args{fields.insert(format!("{ARG}{name}"),value.clone());}}
    let mut verdicts=Vec::new();
    for invocation in checks{
        if invocation.bindings.iter().any(|(column,arg)|args.get(arg).is_some_and(|value|cell(next,column)!=*value)){continue;}
        if checks.len()>1&&invocation.selectors.iter().any(|selector|selector.as_ref().and_then(|selector|super::super::concrete::evaluate(selector,&image,rows,&bound.schema,viewer,table,now))==Some(false)){continue;}
        let verdict=(||{
    if !invocation.complete{return None;}
    let mut unknown=false;
    for column in columns.iter().filter(|column|cell(old,column)!=cell(next,column)){
        // Atomic consumption of another approval is not ordinary replacement
        // data. Its receipt graph, rather than a negative new stamp, governs it.
        if bound.schema.tables[table].columns.get(column).is_some_and(|kind|named_approval(column,kind))&&matches!(cell(old,column),Value::Bool(true)|Value::Int(_))&&matches!(cell(next,column),Value::Bool(false)|Value::Null){unknown=true;continue;}
        let relevant=invocation.clauses.iter().filter(|check|check.columns.contains(column)).collect::<Vec<_>>();if relevant.is_empty(){if invocation.authorized_subject.contains(column){continue;}return Some(false);}
        for check in relevant{match check.predicate.as_ref().and_then(|predicate|super::super::concrete::evaluate(predicate,&image,rows,&bound.schema,viewer,table,now)){Some(false)=>return Some(false),None=>unknown=true,_=>{}}}
    }
    if unknown{None}else{Some(true)}
        })();verdicts.push(verdict);
    }
    // Ambiguous executions may agree, but one unexecuted alternative's check
    // must never refute a legitimate invocation or mint a trusted receipt.
    if !verdicts.is_empty()&&verdicts.iter().all(|verdict|*verdict==Some(true)){Some(true)}else if !verdicts.is_empty()&&verdicts.iter().all(|verdict|*verdict==Some(false)){Some(false)}else{None}
}

#[cfg(test)]mod inline_checks{use super::*;
#[test]fn non_identity_checked_mappings_retain_dependencies_and_unknown_revalidation(){
    use snapback4_core::value::object;
    let source="table docs:\n  consent: bool\n  approved: bool default true\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(consent: bool):\n  require consent else CONSENT\n  return insert docs {consent:not consent}\nmutation replace(doc: docs,value: bool):\n  require value else CONSENT\n  update docs[doc] {consent:not value,approved:true}\n";let sources=vec![("schema.q".into(),source.into())];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let b=super::super::augmented(&sources,&b);assert!(b.security_approval_inputs[&("docs".into(),"approved".into())].contains("consent"));let site=b.security_approval_checks.keys().find(|key|key.0=="replace").unwrap().3.clone();let old=object([("id",Value::Id("d".into())),("consent",Value::Bool(true)),("approved",Value::Bool(true))]);let next=object([("id",Value::Id("d".into())),("consent",Value::Bool(false)),("approved",Value::Bool(true))]);let args=BTreeMap::from([("doc".into(),Value::Id("d".into())),("value".into(),Value::Bool(true))]);assert_eq!(revalidated(&b,"replace","docs","approved",Some(&site),&old,&next,&BTreeSet::from(["consent".into()]),&BTreeMap::new(),"actor",0,&args),None);assert!(crate::security::source_inference_gaps(&sources,&b).iter().any(|gap|gap.contains("non-identity checked argument mapping")));
}
#[test]fn truncated_helper_requirements_are_unknown_not_unchecked(){
    use snapback4_core::value::object;
    let source=format!("table docs:\n  payload: int\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.payload > 0 else INVALID\n  update docs[doc] {{approved:true}}\nmutation replace(doc: docs,value: int):\n  update docs[doc] {{payload:checked(value),approved:true}}\nfn checked(value: int):\n  require {}c(value) else INVALID\n  return value\nfn c(value: int):\n  require value > 0 else INVALID\n  return true\n","not ".repeat(36));
    let sources=vec![("schema.q".into(),source)];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let b=super::super::augmented(&sources,&b);let site=b.security_approval_checks.keys().find(|key|key.0=="replace"&&key.2=="approved").unwrap().3.clone();
    let old=object([("id",Value::Id("d".into())),("payload",Value::Int(0)),("approved",Value::Bool(true))]);let next=object([("id",Value::Id("d".into())),("payload",Value::Int(1)),("approved",Value::Bool(true))]);let args=BTreeMap::from([("doc".into(),Value::Id("d".into())),("value".into(),Value::Int(1))]);
    assert_eq!(revalidated(&b,"replace","docs","approved",Some(&site),&old,&next,&BTreeSet::from(["payload".into()]),&BTreeMap::new(),"actor",0,&args),None);
    assert!(crate::security::source_inference_gaps(&sources,&b).iter().any(|gap|gap.contains("helper guard scan cut")));
}
#[test]fn actual_write_boundary_retains_key_and_field_helper_requirements(){
    use snapback4_core::value::object;
    let source="table docs:\n  payload: int\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.payload > 0 else INVALID\n  update docs[doc] {approved:true}\nmutation replace(doc: docs,value: int):\n  update docs[KEY] {payload:FIELD,approved:true}\nfn checked(value: int):\n  require value > 0 else INVALID\n  return value\nfn checkedDoc(doc: docs,value: int):\n  require value > 0 else INVALID\n  return doc\n";
    for (key,field) in [("doc","checked(value)"),("checkedDoc(doc,value)","value")]{
        let source=source.replace("KEY",key).replace("FIELD",field);let sources=vec![("schema.q".into(),source)];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let b=super::super::augmented(&sources,&b);
        let site=b.security_approval_checks.keys().find(|key|key.0=="replace"&&key.1=="docs"&&key.2=="approved").unwrap().3.clone();
        let old=object([("id",Value::Id("d".into())),("payload",Value::Int(0)),("approved",Value::Bool(true))]);let next=object([("id",Value::Id("d".into())),("payload",Value::Int(1)),("approved",Value::Bool(true))]);let args=BTreeMap::from([("doc".into(),Value::Id("d".into())),("value".into(),Value::Int(1))]);
        assert_eq!(revalidated(&b,"replace","docs","approved",Some(&site),&old,&next,&BTreeSet::from(["payload".into()]),&BTreeMap::new(),"actor",0,&args),Some(true),"{key}/{field}");
    }
}
}

#[cfg(test)]mod sec10_metadata_revalidation{use super::*;
#[test]fn cleared_edit_metadata_is_ordinary_replacement_data(){
    use snapback4_core::value::object;
    let source="table docs:\n  authorizationRouteUpdatedAt: time ?\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation replace(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.authorizationRouteUpdatedAt != null else NO_ROUTE\n  update docs[doc] {authorizationRouteUpdatedAt:null,approved:true}\n";
    let sources=vec![("schema.q".into(),source.into())];let b=super::super::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(!b.security_approval_checks.keys().any(|key|key.2=="authorizationRouteUpdatedAt"));let site=b.security_approval_checks.keys().find(|key|key.2=="approved").unwrap().3.clone();let old=object([("id",Value::Id("d".into())),("authorizationRouteUpdatedAt",Value::Int(123)),("approved",Value::Bool(false))]);let next=object([("id",Value::Id("d".into())),("authorizationRouteUpdatedAt",Value::Null),("approved",Value::Bool(true))]);assert_eq!(revalidated(&b,"replace","docs","approved",Some(&site),&old,&next,&BTreeSet::from(["authorizationRouteUpdatedAt".into()]),&BTreeMap::new(),"actor",0,&BTreeMap::new()),Some(false));
}}
