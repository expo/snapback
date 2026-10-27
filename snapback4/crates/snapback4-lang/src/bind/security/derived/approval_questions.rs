//! Receipt reads identify acts; projected policy is a question, never authority.
// @ref LLP 3000.036.004.002#approval-questions — exact receipts and descendant effects remain advisory.
use super::*;
use ast::{Expr, Stmt, TypeKind, WriteOp};
use snapback4_core::{Value, schema::ColumnType as C};
fn walk(e:&Expr,mut visit:impl FnMut(&Expr)){let mut e=e.clone();super::super::super::intent_walk::expression(&mut e,&mut |e|visit(e));}
fn name(e:&Expr)->Option<&str>{if let Expr::Name{name,..}=e{Some(name)}else{None}}
fn text(s:&str)->Expr{Expr::Literal{value:ast::Literal::Str(s.into()),site:Site::default()}}
fn add(out:&mut Vec<(Diagnostic,Invariant)>,table:&str,column:Option<&str>,target:&str,policy:Expr,site:&Site,label:&str,operation:&str,code:&str,message:String){
    let mut invs=Vec::new();workflow::add_syntax(&mut invs,table,column,target,policy,site,label,Some(operation.into()));
    let mut inv=invs.remove(0);
    if let Some(Expr::Call{name,args,..})=&inv.syntax{
        if name=="$sec11-latest"&&args.len()==5{inv.predicate=format!("selected {} is latest for {} by {}; receipt {}; applicability {}",crate::print::expression(&args[0]),crate::print::expression(&args[1]),crate::print::expression(&args[2]),crate::print::expression(&args[3]),crate::print::expression(&args[4]));}
        if name=="$sec11-completion"&&args.len()==3{inv.predicate=format!("false -> true completion requires {}",crate::print::expression(&args[0]));}
    }
    let note=Diagnostic::new(&inv.site,code,message,"require the exact receipt/history prerequisite on this operation, or answer the witnessed question with its intended effect and specification rationale").guide("security");
    if !out.iter().any(|(n,_)|n.site==note.site){out.push((note,inv));}
}
fn receipt_guards(body:&[Stmt],path:&[Expr],out:&mut Vec<(Expr,Vec<Expr>)>){
    for stmt in body{match stmt{
        Stmt::Require{condition,..} if !workflow::approval_receipts(condition).is_empty()=>out.push((condition.clone(),path.to_vec())),
        Stmt::If{condition,then_body,else_body,..}=>{
            let mut yes=path.to_vec();yes.push(condition.clone());receipt_guards(then_body,&yes,out);
            let mut no=path.to_vec();no.push(Expr::Unary{op:"not".into(),value:Box::new(condition.clone()),site:condition.site().clone()});receipt_guards(else_body,&no,out);
        },_=>{},
    }}
}
pub fn questions(sources:&[(String,String)],bound:&Bound)->Vec<(Diagnostic,Invariant)>{
    let docs=sources.iter().map(|(file,text)|crate::parse_document(file,text).0).collect::<Vec<_>>();
    let catalog=Catalog::build(docs.clone(),&mut Vec::new());let mut out=Vec::new();
    let writes=docs.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ast::ProgramKind::Mutation).flat_map(|p|authority_walk::writes(&catalog,p).into_iter().map(move |(w,c)|(p,w,c))).collect::<Vec<_>>();
    for (p,write,context) in &writes{
        let Expr::Write{op,table,fields,site,..}=write else{continue;};

        if !bound.programs.iter().any(|b|b.program.name==p.name){continue;}
        let mut clauses=context.body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{Some((condition.clone(),Vec::new()))}else{None}).collect::<Vec<_>>();
        if matches!(op,WriteOp::Insert|WriteOp::Upsert){
            clauses.clear();
            // This bounded lane supports a sole, unconditional top-level
            // returned insert. Early exits, helper calls and rebinding of
            // caller arguments cannot commission a whole-body receipt.
            fn safe(body:&[Stmt],p:&ast::ProgramDecl)->bool{body.iter().all(|stmt|match stmt{
                Stmt::Require{..}=>true,
                Stmt::Bind{names,..}=>names.iter().all(|name|!p.args.iter().any(|arg|arg.name==*name)),
                Stmt::If{then_body,else_body,..}=>safe(then_body,p)&&safe(else_body,p),_=>false,
            })}
            let prefix=p.body.iter().position(|stmt|matches!(stmt,Stmt::Return{value:Expr::Write{site:returned,..},..} if returned==site));
            if let Some(at)=prefix&&safe(&p.body[..at],p)&&bound.programs.iter().find(|b|b.program.name==p.name).is_some_and(|b|snapback4_core::ir::write_tables(&b.program).len()==1){receipt_guards(&p.body[..at],&[],&mut clauses);}
        }
        for (condition,premises) in &clauses{
            for receipt in workflow::approval_receipts(condition){
                // The actual typed effect reads the receipt. Its verb supplies
                // neither a destination nor an exemption from this inference.
                if *op==WriteOp::Update{
                    for arg in &p.args{let TypeKind::Ref{table:root}=&arg.type_.kind else{continue;};if root!=table||workflow::target_arg(p,write,table).is_none_or(|selected|selected.name!=arg.name){continue;}
                        let args=BTreeMap::from([(arg.name.clone(),workflow::member(workflow::focal(),"id"))]);
                        let Some(contract)=workflow::scoped_contract(condition,context,&bound.schema,root,&args)else{continue;};
                        if !workflow::typed_approval(&contract,&bound.schema,root)||!fields.iter().any(|f|matches!(bound.schema.tables[table].columns.get(&f.name).map(C::required),Some(C::Enum{..}))){continue;}
                        for (q,effect,_) in &writes{let Expr::Write{op:WriteOp::Update,table:child,fields:changed,..}=effect else{continue;};
                            if child==table||std::ptr::eq(*p,*q){continue;}
                            let paths=workflow::paths(&bound.schema,child,table);if paths.len()!=1{continue;}
                            for f in changed.iter().filter(|f|matches!(bound.schema.tables[child].columns.get(&f.name).map(C::required),Some(C::Bool))&&matches!(f.value,Some(Expr::Literal{value:ast::Literal::Bool(true),..}))){
                                let policy=Expr::Call{name:"$sec11-completion".into(),args:vec![workflow::lift(&contract,&paths[0]),text(&effect.site().to_string()),text(&f.name)],site:site.clone()};
                                add(&mut out,child,Some(&f.name),"update",policy,site,"sec11-approval-path",&q.name,"N_APPROVAL_PATH",format!("{child}.{}: {} reads an approval for {table}; should {} require that same scoped receipt on this related effect?",f.name,p.name,q.name));
                            }
                        }
                    }
                }
                if !matches!(op,WriteOp::Insert|WriteOp::Upsert){continue;}
                if bound.schema.tables[table].expire.is_some()||bound.schema.tables[table].not_before.is_some(){continue;}
                // A bare positive require guarantees that this receipt is
                // actually evaluated. Short-circuit alternatives and wrappers
                // need execution-path tracking and remain uncovered here.
                if !matches!(condition,Expr::Exists{..}){continue;}
                let Expr::Exists{read,..}=&receipt else{continue;};
                let prior=read.keys.iter().filter_map(|k|name(&k.value)).filter_map(|n|p.args.iter().find(|a|a.name==n&&matches!(&a.type_.kind,TypeKind::Ref{table:parent} if parent==table))).collect::<Vec<_>>();
                if prior.len()!=1{continue;}let prior=&prior[0].name;
                for identity in fields.iter().filter(|f|matches!(bound.schema.tables[table].columns.get(&f.name).map(C::required),Some(C::Principal))){
                    let Some(identity_arg)=identity.value.as_ref().and_then(name)else{continue;};
                    if !read.keys.iter().any(|key|name(&key.value)==Some(identity_arg)){continue;}
                    for ordinal in fields.iter().filter(|f|matches!(bound.schema.tables[table].columns.get(&f.name).map(C::required),Some(C::Int|C::IntRange{..}))){
                        let Some(ordinal_arg)=ordinal.value.as_ref().and_then(name)else{continue;};
                        let depends=premises.iter().any(|condition|{let mut found=false;walk(condition,|e|if name(e)==Some(ordinal_arg){found=true;});found});
                        if !depends{continue;}
                        let mut thresholds=Vec::new();
                        for premise in premises{if let Expr::Binary{op,left,right,..}=premise&&op==">="&&name(left)==Some(ordinal_arg)&&matches!(right.as_ref(),Expr::Literal{value:ast::Literal::Number(_),..}){thresholds.push(*right.clone());}}
                        fn ordinal_only(e:&Expr,arg:&str)->bool{match e{
                            Expr::Literal{..}=>true,Expr::Name{name,..}=>name==arg,
                            Expr::Unary{value,..}=>ordinal_only(value,arg),
                            Expr::Binary{left,right,..}=>ordinal_only(left,arg)&&ordinal_only(right,arg),_=>false,
                        }}
                        if thresholds.len()!=1||!premises.iter().all(|e|ordinal_only(e,ordinal_arg)){continue;}
                        let threshold=crate::print::expression(&thresholds[0]);
                        // Witness the applicability bypass itself: a caller
                        // already claiming the approval-requiring ordinal must
                        // not supply the caller-history question's evidence.
                        let line=format!(".{0} >= {threshold} or .{0} >= count({table}[{1} = .{1}])",ordinal.name,identity.name);
                        let parsed=crate::parse_document("$question",&format!("query q():\n  return {line}\n")).0;
                        let Some(Stmt::Return{value:policy,..})=parsed.programs[0].body.first()else{continue;};
                        add(&mut out,table,None,"insert",policy.clone(),site,"sec11-approval-history",&p.name,"N_CALLER_HISTORY",format!("{table}.{}: {} uses caller {ordinal_arg} to select an approval requirement; should it derive the sitting number from {} history?",ordinal.name,p.name,identity.name));
                        // Private analysis metadata evaluated with the exact
                        // arguments at the executed write, never application IR.
                        let policy=Expr::Call{name:"$sec11-latest".into(),args:vec![text(prior),text(&identity.name),text(&ordinal.name),receipt.clone(),premises.iter().cloned().reduce(|a,b|workflow::binary("and",a,b)).unwrap_or(Expr::Literal{value:ast::Literal::Bool(true),site:site.clone()})],site:site.clone()};
                        add(&mut out,table,None,"insert",policy,site,"sec11-approval-latest",&p.name,"N_LATEST_SUBJECT",format!("{table}: {} selects {} by caller {prior}; must this approval bind to the latest {} sitting?",p.name,read.table,identity.name));
                        
                    }
                }
            }
        }
    }
    out
}
/// False requires an actual selected older row, a newer same-identity ordinal,
/// and the exact matching receipt. Unknown values are coverage gaps.
pub(crate) fn judge(inv:&Invariant,old:Option<&Value>,row:&Value,rows:&BTreeMap<String,Vec<Value>>,schema:&Schema,args:&BTreeMap<String,Value>,viewer:&str,now:i64,write_site:Option<&str>)->Option<bool>{
    let Expr::Call{name,args:spec,..}=inv.syntax.as_ref()? else{return None;};
    if name=="$sec11-completion"&&spec.len()==3{
        let Expr::Literal{value:ast::Literal::Str(site),..}=&spec[1]else{return None;};
        let Expr::Literal{value:ast::Literal::Str(column),..}=&spec[2]else{return None;};
        if write_site!=Some(site)||old.and_then(|r|r.field(column).ok())!=Some(&Value::Bool(false))||row.field(column).ok()!=Some(&Value::Bool(true)){return Some(true);}
        return super::super::concrete::evaluate(&spec[0],row,rows,schema,viewer,&inv.table,now);
    }
    if name!="$sec11-latest"||spec.len()!=5{return None;}
    let string=|e:&Expr|if let Expr::Literal{value:ast::Literal::Str(s),..}=e{Some(s.clone())}else{None};
    let prior=string(&spec[0])?;let identity=string(&spec[1])?;let ordinal=string(&spec[2])?;
    let selected=args.get(&prior)?;if *selected==Value::Null{return Some(true);}
    let population=rows.get(&inv.table)?;let old=population.iter().find(|r|r.field("id").ok()==Some(selected))?;
    if old.field(&identity).ok()!=row.field(&identity).ok(){return None;}
    let Value::Int(before)=old.field(&ordinal).ok()? else{return None;};
    let newer=population.iter().any(|r|r.field("id").ok()!=row.field("id").ok()&&r.field(&identity).ok()==row.field(&identity).ok()&&matches!(r.field(&ordinal),Ok(Value::Int(n)) if n>before));
    if !newer{return Some(true);}
    let mut image=row.clone();let Value::Row(fields)=&mut image else{return None;};
    for (name,value) in args{fields.insert(format!("$arg:{name}"),value.clone());}
    let bind=|source:&Expr|{let mut value=source.clone();super::super::super::intent_walk::expression(&mut value,&mut |e|if let Expr::Name{name,..}=e&&args.contains_key(name){*e=workflow::member(workflow::focal(),&format!("$arg:{name}"));});value};
    match super::super::concrete::evaluate(&bind(&spec[4]),&image,rows,schema,viewer,&inv.table,now){Some(true)=>{},Some(false)=>return Some(true),None=>return None}
    let receipt=bind(&spec[3]);
    match super::super::concrete::evaluate(&receipt,&image,rows,schema,viewer,&inv.table,now){Some(true)=>{},Some(false)=>return Some(true),None=>return None}
    Some(false)
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn receipt_effects_are_questions_independent_of_operation_names(){
        for (source,expected) in [(include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-018.q")),"N_APPROVAL_PATH"),(include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-025.q")),"N_CALLER_HISTORY")]{
            let sources=vec![("schema.q".into(),source.into())];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty());
            let qs=questions(&sources,&b);
            assert!(qs.iter().any(|(n,_)|n.code==expected),"expected {expected}, got {:?}",qs.iter().map(|(n,_)|&n.message).collect::<Vec<_>>());
            assert!(qs.iter().all(|(n,_)|!super::super::super::gated_note(&n.code)));
        }
    }
    #[test]fn approval_questions_have_actual_targeted_replays(){
        for (source,expected,operation) in [(include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-018.q")),"N_APPROVAL_PATH","pruneTouchup"),(include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-025.q")),"N_CALLER_HISTORY","logExam")]{
            let sources=vec![("schema.q".into(),source.into())];let mut b=crate::compile(&sources);
            let qs=questions(&sources,&b);assert!(qs.iter().any(|(n,_)|n.code==expected));
            b.invariants=qs.iter().map(|(_,i)|i.clone()).collect();
            let mut campaign=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&b,&mut campaign,false);
            for (note,inv) in qs{
                assert!(campaign.violations.iter().any(|c|c.invariant_site==inv.site.to_string()&&c.operation==operation&&c.reachability.is_reachable()),"{} lacks {operation} replay; {} attempts; gaps {:?}",note.code,campaign.attempted,campaign.unsupported);
            }
        }
    }

    fn compiled(source:&str)->(Bound,Vec<(Diagnostic,Invariant)>){let sources=vec![("schema.q".into(),source.into())];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let qs=questions(&sources,&b);(b,qs)}
    #[test]fn unrelated_parent_targets_and_early_returns_supply_no_question(){
        let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-018.q"));
        let source=source.replace("mutation pruneVisit(visit: visits):","mutation pruneVisit(visit: visits, other: visits):").replace("update visits[visit] { status: 'pruned' }","update visits[other] { status: 'pruned' }");
        assert!(!compiled(&source).1.iter().any(|(n,_)|n.code=="N_APPROVAL_PATH"));
        let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-025.q"));
        let exited=source.replace("if attempt >= 3:","if attempt >= 3:\n      return null");
        assert!(!compiled(&exited).1.iter().any(|(n,_)|n.code=="N_CALLER_HISTORY"||n.code=="N_LATEST_SUBJECT"));
        let alternative=source.replace("require exists retestApprovals", "require true or exists retestApprovals");
        assert!(!compiled(&alternative).1.iter().any(|(n,_)|n.code=="N_CALLER_HISTORY"||n.code=="N_LATEST_SUBJECT"));
        let opposite=source.replace("if attempt >= 3:","if not (attempt >= 3):");
        assert!(!compiled(&opposite).1.iter().any(|(n,_)|n.code=="N_CALLER_HISTORY"||n.code=="N_LATEST_SUBJECT"));
    }
    #[test]fn completion_judges_only_the_selected_false_to_true_write(){
        use snapback4_core::value::object;
        let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-018.q"));
        let (b,qs)=compiled(source);let inv=&qs.iter().find(|(n,_)|n.code=="N_APPROVAL_PATH").unwrap().1;
        let Expr::Call{args:spec,..}=inv.syntax.as_ref().unwrap()else{panic!()};let Expr::Literal{value:ast::Literal::Str(site),..}=&spec[1]else{panic!()};
        let done=object([("done",Value::Bool(true))]);let pending=object([("done",Value::Bool(false))]);
        assert_eq!(judge(inv,Some(&done),&pending,&BTreeMap::new(),&b.schema,&BTreeMap::new(),"actor",0,Some(site)),Some(true));
        assert_eq!(judge(inv,Some(&pending),&done,&BTreeMap::new(),&b.schema,&BTreeMap::new(),"actor",0,Some("other-site")),Some(true));
        assert_eq!(judge(inv,Some(&done),&done,&BTreeMap::new(),&b.schema,&BTreeMap::new(),"actor",0,Some(site)),Some(true));
    }
    #[test]fn latest_subject_keeps_unknown_receipts_and_full_semantics(){
        use snapback4_core::value::object;
        let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-025.q"));
        let (b,qs)=compiled(source);let mut inv=qs.iter().find(|(n,_)|n.code=="N_LATEST_SUBJECT").unwrap().1.clone();
        assert!(inv.predicate.contains("attempt")&&inv.predicate.contains("retestApprovals")&&inv.predicate.contains(">= 3"));
        let row=|id:&str,attempt:i64|object([("id",Value::Id(id.into())),("candidate",Value::Id("person".into())),("attempt",Value::Int(attempt))]);
        let rows=BTreeMap::from([("exams".into(),vec![row("old",1),row("newer",2)])]);
        let args=BTreeMap::from([("priorExam".into(),Value::Id("old".into())),("candidate".into(),Value::Id("person".into())),("attempt".into(),Value::Int(3))]);
        if let Some(Expr::Call{args:spec,..})=&mut inv.syntax{spec[3]=Expr::Call{name:"unsupported".into(),args:vec![],site:Site::default()};}
        assert_eq!(judge(&inv,None,&row("inserted",3),&rows,&b.schema,&args,"actor",10,None),None);
    }

}
