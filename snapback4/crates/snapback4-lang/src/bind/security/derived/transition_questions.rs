//! Typed source edges commission exact questions, never enum-order authority.
// @ref LLP 3000.036.004.004#transition-questions — sibling guards supply hypotheses; only committed actual edges supply witnesses.
use super::*;
use ast::{Expr,Stmt,TypeKind,WriteOp};
use snapback4_core::{Value,schema::{ColumnType as C,ColumnDefault},ir};
fn string(s:&str)->Expr{Expr::Literal{value:ast::Literal::Str(s.into()),site:Site::default()}}
fn literal(e:&Expr)->Option<&str>{if let Expr::Literal{value:ast::Literal::Str(s),..}=e{Some(s)}else{None}}
fn choices(e:&Expr,column:&str)->Option<BTreeSet<String>>{match e{
    Expr::Binary{op,left,right,..} if op=="="=>[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].into_iter().find_map(|(field,value)|if matches!(field,Expr::Member{base,name,..}if name==column&&matches!(base.as_ref(),Expr::Focal{..})){literal(value).map(|s|BTreeSet::from([s.into()]))}else{None}),
    Expr::Binary{op,left,right,..}if op=="or"=>Some(choices(left,column)?.union(&choices(right,column)?).cloned().collect()),
    Expr::Binary{op,left,right,..}if op=="and"=>Some(choices(left,column)?.intersection(&choices(right,column)?).cloned().collect()),_=>None,
}}
// Only a positive, unique roster membership is an actor check. Other stored
// conditions remain prerequisites even when they do not mention this resource.
fn actor_check(e:&Expr,bound:&Bound)->bool{match e{
    Expr::Binary{op,left,right,..}if op=="and"||op=="or"=>actor_check(left,bound)&&actor_check(right,bound),
    Expr::Exists{read,..}=>{
        let Some(principal)=super::super::privilege::global_principal(bound,&read.table)else{return false;};
        if read.keys.len()!=2||read.filter.is_some()||read.range.is_some()||read.matching.is_some()||!read.seeks.is_empty()||!read.computed.is_empty(){return false;}
        let roles=super::super::privilege::role_columns(bound,&read.table);let mut actor=false;let mut role=false;
        for(at,key)in read.keys.iter().enumerate(){let Some(column)=key.column.as_deref().or_else(||(at==0).then_some(principal.as_str()))else{return false;};
            if column==principal&&matches!(&key.value,Expr::Name{name,..}if name=="viewer"){actor=true;}
            else if roles.contains(column)&&literal(&key.value).is_some(){role=true;}else{return false;}
        }actor&&role
    },_=>false,
}}
fn plain_guard(e:&Expr)->bool{let mut e=e.clone();let mut safe=true;super::super::super::intent_walk::expression(&mut e,&mut |e|if matches!(e,Expr::Assert{..}|Expr::Call{..}|Expr::Write{..}){safe=false;});safe}
fn conjuncts(e:&Expr,out:&mut Vec<Expr>){if let Expr::Binary{op,left,right,..}=e&&op=="and"{conjuncts(left,out);conjuncts(right,out);}else{out.push(e.clone());}}
#[derive(Clone)]struct Step{table:String,column:String,value:Expr,site:Site,operation:String,effect:String,types:BTreeMap<String,C>,context:String,guards:Vec<Expr>,anchor:bool}
fn direct(p:&ast::ProgramDecl,site:&Site)->Option<usize>{
    if !p.prelude.is_empty()||p.body.iter().any(|s|matches!(s,Stmt::If{..}|Stmt::For{..}|Stmt::As{..}|Stmt::Break{..}|Stmt::Continue{..})){return None;}
    let at=p.body.iter().position(|s|matches!(s,Stmt::Expr{value:Expr::Write{site:s,..},..}|Stmt::Return{value:Expr::Write{site:s,..},..}if s==site))?;
    if p.body[..at].iter().any(|s|matches!(s,Stmt::Return{..})){return None;}Some(at)
}
// Type units also matter in guard reads and call arguments when their wire
// values happen to match (for example zero in two currencies). Keep the typed
// dependency closure, without source sites or unrelated program bodies.
fn type_context(bound:&Bound,p:&ast::ProgramDecl,operation:&str,root:&str)->String{
    fn references(kind:&C,out:&mut BTreeSet<String>){match kind.required(){C::Ref{table}=>{out.insert(table.clone());},C::List{of,..}|C::ListRange{of,..}=>references(of,out),_=>{}}}
    let mut tables=BTreeSet::from([root.to_owned()]);if let Some(program)=bound.programs.iter().find(|p|p.program.name==operation){tables.extend(ir::read_sites(&program.program).into_iter().map(|s|s.table));tables.extend(ir::write_tables(&program.program).into_iter().map(|(t,_)|t));}
    loop{let before=tables.clone();for name in &before{if let Some(table)=bound.schema.tables.get(name){for kind in table.columns.values(){references(kind,&mut tables);}}}if before==tables{break;}}
    let types=tables.iter().filter_map(|name|bound.schema.tables.get(name).map(|t|(name,&t.columns))).collect::<BTreeMap<_,_>>();let args=p.args.iter().map(|a|(&a.name,&a.type_)).collect::<BTreeMap<_,_>>();format!("arguments {args:?}; dependency types {types:?}")
}
fn steps(sources:&[(String,String)],bound:&Bound)->Vec<Step>{
    let docs=sources.iter().map(|(f,s)|crate::parse_document(f,s).0).collect::<Vec<_>>();let catalog=Catalog::build(docs.clone(),&mut Vec::new());let mut out=Vec::new();
    for p in docs.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ast::ProgramKind::Mutation){
        let operation=super::super::super::operation_name(std::path::Path::new(&p.site.file).file_stem().and_then(|s|s.to_str()).unwrap_or(""),&p.name);
        if !bound.programs.iter().any(|b|b.program.name==operation){continue;}
        let writes=authority_walk::writes(&catalog,p);
        for(write,context)in &writes{let Expr::Write{op:WriteOp::Update,table,keys,fields,site,condition:None,if_absent:false,..}=write else{continue;};
            let Some(at)=direct(p,site)else{continue;};let Some(arg)=workflow::target_arg(p,write,table)else{continue;};
            let mapping=BTreeMap::from([(arg.name.clone(),workflow::member(workflow::focal(),"id"))]);
            // Eligibility inspects authored fields before returned()/helper
            // reduction can erase an asserted-read prerequisite.
            let raw_write=match &p.body[at]{Stmt::Expr{value,..}|Stmt::Return{value,..}=>value,_=>unreachable!()};
            let Expr::Write{table:raw_table,keys:raw_keys,fields:raw_fields,..}=raw_write else{unreachable!()};
            let authored_target_simple=if raw_keys.is_empty(){raw_table==&arg.name||p.body[..at].iter().any(|s|matches!(s,Stmt::Bind{names,value,..}if names.contains(raw_table)&&super::plain_row(value)&&super::same_resource(value,table,keys,p)))}else{workflow::target_arg(p,raw_write,table).is_some_and(|a|a.name==arg.name)};
            let authored_fields_simple=raw_fields.iter().all(|f|!f.spread&&f.value.as_ref().is_some_and(|v|matches!(v,Expr::Literal{..})||matches!(v,Expr::Name{name,..}if name=="now"||name=="viewer")));
            let anchor=authored_target_simple&&authored_fields_simple&&p.args.len()==1&&p.body[..at].iter().all(|s|match s{Stmt::Require{condition,..}=>plain_guard(condition),Stmt::Bind{value,..}=>super::plain_row(value)&&super::same_resource(value,table,keys,p),_=>false})&&p.body[at+1..].iter().all(|s|matches!(s,Stmt::Return{value:Expr::Literal{value:ast::Literal::Null,..},..}))&&fields.iter().all(|f|f.value.as_ref().is_some_and(|v|matches!(v,Expr::Literal{..})||matches!(v,Expr::Name{name,..}if name=="now"||name=="viewer")));
            let mut guards=Vec::new();let mut complete=true;
            for s in &context.body{if let Stmt::Require{condition,..}=s{if let Some(value)=workflow::normalize(condition,&bound.schema,table,&mapping){conjuncts(&value,&mut guards);}else{complete=false;}}}
            if fields.iter().any(|f|f.spread){continue;}
            // A source spread has no field name; the binder expands it with
            // overwrite semantics. Until this lane shares that reduction, no
            // partial field list may commission a hypothesis or an index panic.
            let Some(types)=fields.iter().map(|f|bound.schema.tables[table].columns.get(&f.name).map(|kind|(f.name.clone(),kind.clone()))).collect::<Option<BTreeMap<_,_>>>()else{continue;};
            for field in fields{
                let Some(C::Enum{variants})=bound.schema.tables[table].columns.get(&field.name)else{continue;};if variants.len()<3{continue;}
                if writes.iter().filter(|(w,_)|matches!(w,Expr::Write{table:t,fields,..}if t==table&&fields.iter().any(|f|f.name==field.name))).count()!=1{continue;}
                let Some(value)=&field.value else{continue;};let literal=literal(value).is_some();
                let caller=if let Expr::Name{name,..}=value{p.args.iter().any(|a|a.name==*name&&matches!(&a.type_.kind,TypeKind::Enum{variants:v}if v.iter().collect::<BTreeSet<_>>()==variants.iter().collect::<BTreeSet<_>>()))}else{false};
                if literal||caller{out.push(Step{table:table.clone(),column:field.name.clone(),value:value.clone(),site:site.clone(),operation:operation.clone(),effect:crate::print::expression(write),types:types.clone(),context:type_context(bound,p,&operation,table),guards:guards.clone(),anchor:anchor&&complete&&writes.len()==1});}
            }
        }
    }out
}
fn add(out:&mut Vec<(Diagnostic,Invariant)>,write:&Step,anchor:&Step,from:&str,to:&str,focus:&str,message:String,bound:&Bound){
    let applicable=anchor.guards.iter().filter(|g|choices(g,focus).is_none()&&!actor_check(g,bound)).cloned().reduce(|a,b|workflow::binary("and",a,b)).unwrap_or(Expr::Literal{value:ast::Literal::Bool(true),site:Site::default()});
    let basis=format!("{} effect {}; guards {}; bypass {} effect {}; types {:?}; anchor types {:?}; inputs {}; anchor inputs {}",anchor.operation,anchor.effect,anchor.guards.iter().map(|g|format!("({})",crate::print::expression(g))).collect::<Vec<_>>().join(" and "),write.operation,write.effect,write.types,anchor.types,write.context,anchor.context);
    let policy=Expr::Call{name:"$sec11-transition".into(),args:vec![string(&write.site.to_string()),string(&write.column),string(from),string(to),applicable,string(&basis)],site:Site::default()};let mut invs=Vec::new();
    workflow::add_syntax(&mut invs,&write.table,Some(&write.column),"update",policy,&write.site,"sec11-transition",Some(write.operation.clone()));let mut inv=invs.remove(0);
    inv.predicate=format!("question hypothesis {}.{} {from} -> {to}; {basis}",write.table,write.column);
    let note=Diagnostic::new(&inv.site,"N_TRANSITION_BYPASS",message,"declare and enforce the intended old/next transitions, or answer this exact witnessed question with its intended effect and specification rationale").guide("security");
    if !out.iter().any(|(n,_)|n.site==note.site){out.push((note,inv));}
}
pub fn questions(sources:&[(String,String)],bound:&Bound)->Vec<(Diagnostic,Invariant)>{
    let steps=steps(sources,bound);let mut out=Vec::new();
    for write in &steps{for anchor in steps.iter().filter(|a|a.anchor&&a.table==write.table&&a.operation!=write.operation){
        let Some(target)=literal(&anchor.value)else{continue;};
        if anchor.column==write.column{
            let Some(to)=literal(&write.value)else{continue;};let old=write.guards.iter().filter_map(|g|choices(g,&write.column)).reduce(|a,b|a.intersection(&b).cloned().collect());
            let prior=anchor.guards.iter().filter_map(|g|choices(g,&write.column)).reduce(|a,b|a.intersection(&b).cloned().collect());
            if let(Some(old),Some(prior))=(old,prior)&&old.len()==2&&prior.len()==1&&old.contains(target)&&!old.contains(to){let from=prior.first().unwrap();if from!=target&&old.contains(from){add(&mut out,write,anchor,from,to,&write.column,format!("{}.{}: {} can bypass sibling {}'s {from} -> {target} step; must {to} require {target}?",write.table,write.column,write.operation,anchor.operation),bound);}}
        }else if matches!(write.value,Expr::Name{..}){
            let Some(ColumnDefault::Literal(Value::String(from)))=bound.schema.tables[&write.table].defaults.get(&write.column)else{continue;};
            let prior=anchor.guards.iter().filter_map(|g|choices(g,&anchor.column)).reduce(|a,b|a.intersection(&b).cloned().collect());
            if prior.as_ref().is_none_or(|s|s.len()!=1||s.contains(target)){continue;}
            for to in anchor.guards.iter().filter_map(|g|choices(g,&write.column)).filter(|s|s.len()==1).filter_map(|s|s.first().cloned()){
                if &to==from{continue;}
                add(&mut out,write,anchor,from,&to,&write.column,format!("{}.{}: {} accepts a caller-selected stage; sibling {} requires {to}; must intermediate declared values have explicit transitions?",write.table,write.column,write.operation,anchor.operation),bound);
            }
        }
    }}out
}
pub(crate) fn judge(inv:&Invariant,old:Option<&Value>,row:&Value,rows:&BTreeMap<String,Vec<Value>>,schema:&Schema,viewer:&str,now:i64,site:Option<&str>)->Option<bool>{
    let Expr::Call{name,args,..}=inv.syntax.as_ref()?else{return None;};if name!="$sec11-transition"||args.len()!=6{return None;}
    let expected=literal(&args[0])?;let column=literal(&args[1])?;let from=literal(&args[2])?;let to=literal(&args[3])?;
    let old=old?;if site!=Some(expected)||old.field(column).ok()!=Some(&Value::String(from.into()))||row.field(column).ok()!=Some(&Value::String(to.into())){return Some(true);}
    super::super::concrete::evaluate(&args[4],old,rows,schema,viewer,&inv.table,now).map(|applicable|!applicable)
}

#[cfg(test)]mod tests{
 use super::*;
 const STUDY:&str=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-030.q"));
 const BATCH:&str=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-035.q"));
 fn compile(s:&str)->(Bound,Vec<(Diagnostic,Invariant)>){let sources=vec![("schema.q".into(),s.into())];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let qs=questions(&sources,&b);assert!(!super::super::augmented(&sources,&b).invariants.iter().any(|i|i.site.file.contains("/sec11-transition/")));(b,qs)}
 #[test]fn source_edges_do_not_depend_on_names_or_enum_order(){
  for(source,op,from,to)in[(STUDY,"publishReport","measured","reported"),(BATCH,"advanceStage","inspection","finished")]{
   let(_,qs)=compile(source);assert_eq!(qs.len(),1,"{:?}",qs.iter().map(|(n,_)|&n.message).collect::<Vec<_>>());let inv=&qs[0].1;assert_eq!(inv.operation.as_deref(),Some(op));assert!(inv.predicate.contains(from)&&inv.predicate.contains(to));assert!(super::super::advisory(inv));
   let source=source.replace(op,"arbitraryVerb").replace(from,"stateA").replace(to,"stateZ");assert_eq!(compile(&source).1.len(),1);
  }
  let reversed=BATCH.replace("enum('inspection', 'cleaning', 'flameproofing', 'pleating', 'finished')","enum('finished', 'pleating', 'inspection', 'flameproofing', 'cleaning')");let(_,qs)=compile(&reversed);assert_eq!(qs.len(),1);assert!(qs[0].1.predicate.contains("inspection -> finished"));
 }
 #[test]fn actual_committed_edges_and_minimal_repairs(){
  for(source,op,from,to,broken,fixed)in[
   (STUDY,"publishReport","measured","reported","require s.status = 'measured' or s.status = 'reviewed' else BAD_STATUS","require s.status = 'reviewed' else BAD_STATUS"),
   (BATCH,"advanceStage","inspection","finished","require stage != b.stage else NO_CHANGE","require stage != b.stage else NO_CHANGE\n  require (b.stage = 'inspection' and stage = 'cleaning') or (b.stage = 'cleaning' and stage = 'flameproofing') or (b.stage = 'flameproofing' and stage = 'pleating') or (b.stage = 'pleating' and stage = 'finished') else BAD_TRANSITION")]{
   let(mut b,qs)=compile(source);b.invariants=qs.iter().map(|(_,i)|i.clone()).collect();let mut c=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&b,&mut c,false);
   assert!(c.violations.iter().any(|v|v.operation==op&&v.old.as_ref().and_then(|r|r.field(qs[0].1.column.as_ref().unwrap()).ok())==Some(&Value::String(from.into()))&&v.row.field(qs[0].1.column.as_ref().unwrap()).ok()==Some(&Value::String(to.into()))&&v.reachability.is_reachable()),"{op} missing actual edge: {} calls; {:?}",c.attempted,c.unsupported);
   let repaired=source.replace(broken,fixed);let(mut fixed_bound,fixed_questions)=compile(&repaired);
   if op=="advanceStage"{assert_eq!(fixed_questions.len(),1);fixed_bound.invariants=fixed_questions.into_iter().map(|(_,i)|i).collect();}
   else{assert!(fixed_questions.is_empty());let mut retained=qs[0].1.clone();let doc=crate::parse_document("schema.q",&repaired).0;let program=doc.programs.iter().find(|p|p.name==op).unwrap();let site=program.body.iter().find_map(|s|if let Stmt::Expr{value:Expr::Write{op:WriteOp::Update,site,..},..}=s{Some(site)}else{None}).unwrap();if let Some(Expr::Call{args,..})=&mut retained.syntax{args[0]=string(&site.to_string());}fixed_bound.invariants=vec![retained];}
   let mut fixed_campaign=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&fixed_bound,&mut fixed_campaign,false);assert!(fixed_campaign.violations.is_empty(),"the same bad-edge hypothesis survives the repair: {:?}",fixed_campaign.violations);
  }
 }
 #[test]fn anchor_scope_and_domain_are_material_and_unrelated_targets_are_uncovered(){
  let(b,qs)=compile(STUDY);let scoped=STUDY.replace("require s.status = 'measured' else BAD_STATUS","require s.status = 'measured' else BAD_STATUS\n  require s.siteKind = 'office' else WRONG_KIND");
  let(_,changed)=compile(&scoped);assert_eq!(changed.len(),1);assert_ne!(qs[0].1.predicate,changed[0].1.predicate);
  let(_,renamed)=compile(&STUDY.replace("mutation markReviewed(study: studies):","mutation markReviewed(study: studies, other: studies):").replace("update studies[study] { status: 'reviewed' }","update studies[other] { status: 'reviewed' }"));assert!(renamed.is_empty());
  let(_,original)=compile(BATCH);let(_,domain)=compile(&BATCH.replace("'flameproofing', 'pleating'","'flameproofing', 'drying', 'pleating'"));assert_ne!(original[0].1.predicate,domain[0].1.predicate);
  let old=snapback4_core::value::object([("status",Value::String("measured".into())),("siteKind",Value::String("venue".into()))]);let next=snapback4_core::value::object([("status",Value::String("reported".into())),("siteKind",Value::String("venue".into()))]);let inv=&changed[0].1;let Expr::Call{args,..}=inv.syntax.as_ref().unwrap()else{panic!()};let site=literal(&args[0]).unwrap();assert_eq!(judge(inv,Some(&old),&next,&BTreeMap::new(),&b.schema,"actor",0,Some(site)),Some(true));
 }
 const SMALL:&str="table docs:\n  phase: enum('a','b','c') default 'a'\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\nmutation create():\n  return insert docs {}\nmutation middle(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.phase = 'a' else WRONG\n  update docs[doc] {phase:'b'}\n  return null\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.phase = 'a' or d.phase = 'b' else WRONG\n  update docs[doc] {phase:'c'}\n  return null\n";
 #[test]fn noops_reverted_deleted_and_expired_updates_do_not_supply_cards(){
  let(b,qs)=compile(SMALL);assert_eq!(qs.len(),1);let inv=&qs[0].1;let Expr::Call{args,..}=inv.syntax.as_ref().unwrap()else{panic!()};let site=literal(&args[0]).unwrap();let row=snapback4_core::value::object([("phase",Value::String("a".into()))]);assert_eq!(judge(inv,Some(&row),&row,&BTreeMap::new(),&b.schema,"actor",0,Some(site)),Some(true));
  let reverted=SMALL.replace("update docs[doc] {phase:'c'}","update docs[doc] {phase:'c'}\n  update docs[doc] {phase:'a'}");assert!(compile(&reverted).1.is_empty());
  let deleted=SMALL.replace("update docs[doc] {phase:'c'}","update docs[doc] {phase:'c'}\n  delete docs[doc]");
  let expired=SMALL.replace("  phase: enum", "  deadline: time\n  expire at .deadline\n  phase: enum").replace("return insert docs {}","return insert docs {deadline:now + 1d}").replace("update docs[doc] {phase:'c'}","update docs[doc] {phase:'c',deadline:now}");
  for source in [deleted,expired]{let(mut b,qs)=compile(&source);assert_eq!(qs.len(),1);b.invariants=qs.into_iter().map(|(_,i)|i).collect();let mut campaign=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&b,&mut campaign,false);assert!(campaign.violations.is_empty(),"transient or expired edge became a question: {:?}",campaign.violations);}
 }

 #[test]fn external_stored_prerequisites_are_preserved_and_auxiliary_assertions_are_uncovered(){
  let source=format!("table reviewWindows:\n  open: bool\n  unique open\n  read <- allow\n  insert <- allow\n  online only\n{}",STUDY.replace("require s.status = 'measured' else BAD_STATUS","require s.status = 'measured' else BAD_STATUS\n  require exists reviewWindows[open = true] else REVIEW_CLOSED"));
  let(b,qs)=compile(&source);assert_eq!(qs.len(),1);let inv=&qs[0].1;assert!(inv.predicate.contains("reviewWindows"));let Expr::Call{args,..}=inv.syntax.as_ref().unwrap()else{panic!()};let site=literal(&args[0]).unwrap();let old=snapback4_core::value::object([("status",Value::String("measured".into()))]);let next=snapback4_core::value::object([("status",Value::String("reported".into()))]);
  let closed=BTreeMap::from([("reviewWindows".into(),Vec::new())]);assert_eq!(judge(inv,Some(&old),&next,&closed,&b.schema,"actor",0,Some(site)),Some(true),"closed stored prerequisite must not become an unconditional hypothesis");
  let open=BTreeMap::from([("reviewWindows".into(),vec![snapback4_core::value::object([("id",Value::Id("window".into())),("open",Value::Bool(true))])])]);assert_eq!(judge(inv,Some(&old),&next,&open,&b.schema,"actor",0,Some(site)),Some(false));
  let asserted=STUDY.replace("require s.status = 'measured' else BAD_STATUS","customerRole = roles[principal = s.customer] ! else NO_CUSTOMER_ROLE\n  require s.status = 'measured' else BAD_STATUS");assert!(compile(&asserted).1.is_empty(),"an auxiliary asserted read is an unmodeled prerequisite");
  let guard=STUDY.replace("require s.status = 'measured' else BAD_STATUS","require (roles[principal = s.customer] ! else NO_CUSTOMER_ROLE).role = 'customer' else WRONG_ROLE\n  require s.status = 'measured' else BAD_STATUS");assert!(compile(&guard).1.is_empty(),"an assertion inside a guard must not escape the anchor boundary");
 }

 #[test]fn guard_presence_cannot_hide_an_admitted_jump_and_secondary_types_bind_the_basis(){
  let source=BATCH.replace("require stage != b.stage else NO_CHANGE","require stage != b.stage and stage != b.stage else NO_CHANGE");let(mut b,qs)=compile(&source);assert_eq!(qs.len(),1);b.invariants=qs.into_iter().map(|(_,i)|i).collect();let mut c=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&b,&mut c,false);assert!(c.violations.iter().any(|c|c.operation=="advanceStage"));
  let usd=STUDY.replace("table studies:\n","table studies:\n  reviewFee: money USD default 0\n").replace("update studies[study] { status: 'reviewed' }","update studies[study] { status: 'reviewed', reviewFee: 100 }");let eur=usd.replace("reviewFee: money USD","reviewFee: money EUR");let(_,a)=compile(&usd);let(_,b)=compile(&eur);assert_eq!(a.len(),1);assert_eq!(b.len(),1);assert_ne!(a[0].1.predicate,b[0].1.predicate);assert!(a[0].1.predicate.contains("USD")&&b[0].1.predicate.contains("EUR"));
 }

 #[test]fn guarded_and_argument_currencies_are_material_even_without_a_money_write(){
  let usd=STUDY.replace("table studies:\n","table studies:\n  reviewBudget: money USD default 0\n").replace("require s.status = 'measured' else BAD_STATUS","require s.status = 'measured' else BAD_STATUS\n  require s.reviewBudget <= 100 else OVER_BUDGET");let eur=usd.replace("reviewBudget: money USD","reviewBudget: money EUR");let(_,a)=compile(&usd);let(_,b)=compile(&eur);assert_eq!(a.len(),1);assert_eq!(b.len(),1);assert_ne!(a[0].1.predicate,b[0].1.predicate);
  let usd=SMALL.replace("mutation finish(doc: docs):","mutation finish(doc: docs, amount: money USD):");let eur=usd.replace("amount: money USD","amount: money EUR");let(_,a)=compile(&usd);let(_,b)=compile(&eur);assert_eq!(a.len(),1);assert_eq!(b.len(),1);assert_ne!(a[0].1.predicate,b[0].1.predicate);
 }

 #[test]fn valid_object_spreads_are_uncovered_without_panics_or_partial_hypotheses(){
  for write in ["update docs[doc] { ...{}, phase: 'c' }","update docs[doc] { phase: 'c', ...{ phase: 'a' } }"]{let source=SMALL.replace("update docs[doc] {phase:'c'}",write);let(_,q)=compile(&source);assert!(q.is_empty(),"unreduced spread cannot supply a partial typed effect");}
 }

 #[test]fn helper_reduction_cannot_erase_an_anchor_field_prerequisite(){
  let source=format!("table reviewWindows:\n  open: bool\n  unique open\n  read <- allow\n  insert <- allow\n  online only\nfn stamp():\n  w = reviewWindows[open = true] ! else CLOSED\n  return 0\n{}",STUDY.replace("table studies:\n","table studies:\n  reviewStamp: int default 0\n").replace("update studies[study] { status: 'reviewed' }","update studies[study] { status: 'reviewed', reviewStamp: stamp() }"));
  assert!(compile(&source).1.is_empty());assert!(compile(&source.replace("open = true","open = false")).1.is_empty());
  let source=format!("table reviewWindows:\n  open: bool\n  unique open\n  read <- allow\n  insert <- allow\n  online only\nfn selectTarget(study: studies):\n  w = reviewWindows[open = true] ! else CLOSED\n  return study\n{}",STUDY.replace("update studies[study] { status: 'reviewed' }","update studies[selectTarget(study)] { status: 'reviewed' }"));assert!(compile(&source).1.is_empty(),"a reduced target helper cannot erase its prerequisite either");
  let source=STUDY.replace("update studies[study] { status: 'reviewed' }","update s { status: 'reviewed' }");assert_eq!(compile(&source).1.len(),1,"the paved direct-row update retains its typed target");
 }

}
