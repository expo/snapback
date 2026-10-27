//! Release-relative creation authority; a static difference is only a candidate.
// @ref LLP 3000.036.004.002#s2-release-narrowing — predecessor narrowing plus an actual excluded-role insert supplies a gate.
use super::*;
use snapback4_core::schema::Constraint;

#[derive(Clone,Debug)]
pub struct Candidate {pub note:Diagnostic,pub invariant:Invariant,pub creator:String,pub column:String}
#[derive(Clone)]
struct Write {operation:String,table:String,column:String,create:bool,guard:RuleExpr,opaque:Vec<String>,identity:String,site:Site}
fn safe(rule:&RuleExpr)->bool{match rule{RuleExpr::Not(inner)=>safe(inner),RuleExpr::And(parts)|RuleExpr::Or(parts)=>parts.iter().all(safe),_=>super::operation::safe(rule)}}
fn necessary(rule:&RuleExpr)->RuleExpr{match rule{
 RuleExpr::And(parts)=>RuleExpr::And(parts.iter().map(necessary).collect()),
 _ if safe(rule)=>rule.clone(),_=>RuleExpr::Allow,
}}
fn trailing_guards(p:&snapback4_core::ir::Program)->Option<String>{
 fn contains(value:&serde_json::Value,keys:&[&str])->bool{match value{serde_json::Value::Object(fields)=>fields.iter().any(|(key,value)|keys.contains(&key.as_str())||contains(value,keys)),serde_json::Value::Array(values)=>values.iter().any(|v|contains(v,keys)),_=>false}}
 let mut wrote=false;
 for stmt in &p.body{let value=serde_json::to_value(stmt).ok()?;let writes=contains(&value,&["Insert","InsertIfAbsent","Update","WriteTarget","Delete","Emit","JobAs","JobQuery"]);
  if (wrote||writes)&&contains(&value,&["Require"]){return Some(format!("post-write requirements: {}",serde_json::to_string(&p.body).ok()?));}wrote|=writes;
 }None
}
fn opaque_cell(t:&snapback4_core::schema::Table,column:&str)->bool{t.frozen_columns.contains_key(column)||t.column_reads.contains_key(column)||t.written_by.contains_key(column)||t.immutable_fields().any(|c|c==column)}
fn writes(sources:&[(String,String)],bound:&Bound)->Vec<Write>{
 let docs=sources.iter().map(|(file,text)|crate::parse_document(file,text).0).collect::<Vec<_>>();
 let catalog=Catalog::build(docs.clone(),&mut Vec::new());let mut out=Vec::new();
 for doc in &docs{let module=std::path::Path::new(&doc.file).file_stem().and_then(|s|s.to_str()).unwrap_or("");
  for p in &doc.programs{if p.kind!=ast::ProgramKind::Mutation{continue;}
   let operation=super::super::operation_name(module,&p.name);
   for (write,context) in super::authority_walk::writes(&catalog,p){
    let ast::Expr::Write{op,table,fields,site,..}=write else{continue;};
    // Upsert's arm must be established by replay; it is not a historical setter.
    if !matches!(op,ast::WriteOp::Insert|ast::WriteOp::Upsert|ast::WriteOp::Update){continue;}
    let Some(info)=catalog.tables.get(&table)else{continue;};let t=&bound.schema.tables[&table];
    let create=matches!(op,ast::WriteOp::Insert|ast::WriteOp::Upsert);
    for field in &fields{
     if create&&!super::write_advice::supplied(field,p){continue;}
     let base=if create{t.rules.insert.clone()}else{t.update_rule_judged().into_owned()};
     let mut requirements=Vec::new();let mut opaque=bound.programs.iter().find(|p|p.program.name==operation).and_then(|p|trailing_guards(&p.program)).into_iter().collect::<Vec<_>>();
     if let Some(program)=bound.programs.iter().find(|p|p.program.name==operation){opaque.extend(super::release_authority::opaque_inputs(p,&program.program));if !create&&(super::release_authority::opaque_program(&program.program)||(snapback4_core::ir::write_tables(&program.program).len()!=1||snapback4_core::ir::write_tables(&program.program).iter().any(|(target,kind)|target!=&table||*kind!="update"))){opaque.push("other operation effects may restrict predecessor admission".into());}}
     for stmt in context.prelude.iter().chain(&context.body){if let ast::Stmt::Require{condition,site,..}=stmt{
      let decl=ast::RuleDecl{effect:ast::Effect::Read,bindings:Vec::new(),value:condition.clone(),site:site.clone()};
      match super::super::schema::bind_rule(&catalog,info,&decl){Ok(rule) if safe(&rule)&&super::release_authority::public_probes(bound,&rule)=>requirements.push(rule),_=>{let mut condition=condition.clone();crate::bind::intent_walk::expression(&mut condition,&mut |e|if let ast::Expr::Name{name,..}=e&&let Some(index)=p.args.iter().position(|arg|arg.name==*name){*name=format!("$argument{index}");});opaque.push(crate::print::expression(&condition));}}
     }else{opaque.push("unsupported guard context".into());}}
     if !create&&(fields.len()!=1||!field.value.as_ref().map_or_else(||p.args.iter().any(|a|a.name==field.name),|v|matches!(v,ast::Expr::Name{name,..} if p.args.iter().any(|a|a.name==*name)))){opaque.push("computed or companion writes may restrict predecessor admission".into());}
     if !create&&opaque_cell(t,&field.name){opaque.push("predecessor cell admission requires runtime replay".into());}
     for rule in std::iter::once(&base).chain(t.column_writes.get(&field.name)){if !safe(rule){opaque.push(rule.quarry());}}
     let guard=necessary(&RuleExpr::And(requirements.into_iter().chain([base]).chain(t.column_writes.get(&field.name).cloned()).collect()));
     let identity=bound.programs.iter().find(|p|p.program.name==operation).map(|program|super::release_authority::body_identity(p,&program.program,&field.name)).unwrap_or_default();
     out.push(Write{identity,operation:operation.clone(),table:table.clone(),column:field.name.clone(),create,guard,opaque,site:site.clone()});
    }
   }
  }
 }
 // A setter's audience is the union of every lexical path writing this cell.
 // One newly restricted branch cannot manufacture a release-wide narrowing.
 let mut groups=BTreeMap::<(String,String,String,bool),Vec<Write>>::new();
 for write in out{groups.entry((write.operation.clone(),write.table.clone(),write.column.clone(),write.create)).or_default().push(write);}
 groups.into_values().map(|paths|{
  let mut write=paths[0].clone();
  write.opaque=paths.iter().flat_map(|path|path.opaque.iter().cloned()).collect();
  write.guard=RuleExpr::Or(paths.into_iter().map(|path|path.guard).collect());write
 }).collect()
}
pub fn candidates(sources:&[(String,String)],bound:&Bound,previous:&[(String,String)],old:&Bound)->Vec<Candidate>{
 let current=writes(sources,bound);let prior=writes(previous,old);let mut result=Vec::new();let mut seen=BTreeSet::new();
 for editor in current.iter().filter(|w|!w.create){
  let Some(editor_program)=bound.programs.iter().find(|p|p.program.name==editor.operation)else{continue;};
  let editor_writes=snapback4_core::ir::write_tables(&editor_program.program);
  if super::release_authority::opaque_program(&editor_program.program)||editor_writes.len()!=1||editor_writes.iter().any(|(table,kind)|table!=&editor.table||*kind!="update"||kernel::dependencies(&editor.guard).contains(table)){continue;}
  let Some(old_table)=old.schema.table(&editor.table).filter(|t|t.columns.contains_key(&editor.column))else{continue;};
  let current_table=&bound.schema.tables[&editor.table];
  if [(old,old_table),(bound,current_table)].iter().any(|(b,t)|t.through.is_some()||t.expire.is_some()||t.not_before.is_some()||t.constraints.iter().any(|c|matches!(c,Constraint::AppendOnly))||b.schema.maintains.iter().any(|m|m.source==editor.table||m.target==editor.table)){continue;}
  if trailing_guards(&editor_program.program).is_some(){continue;}
  let old_editors=prior.iter().filter(|w|!w.create&&w.operation==editor.operation&&w.table==editor.table&&w.column==editor.column).collect::<Vec<_>>();
  let previous_guard=if old_editors.is_empty(){
   // A new setter narrows a previously existing write surface, not a new table.
   if old.programs.iter().any(|p|p.program.name==editor.operation){continue;}
   let was_immutable=old_table.immutable_fields().any(|c|c==&editor.column);
   let now_immutable=bound.schema.tables[&editor.table].immutable_fields().any(|c|c==&editor.column);
   if old_table.frozen_columns.contains_key(&editor.column)||old_table.written_by.contains_key(&editor.column)||(was_immutable&&now_immutable){continue;}
   // Reopening an immutable creation field introduces its first setter. Its
   // prior setting audience is creation, not the previously absent update.
   let base=if was_immutable{old_table.rules.insert.clone()}else{old_table.update_rule_judged().into_owned()};
   let rule=RuleExpr::And(std::iter::once(base).chain(old_table.column_writes.get(&editor.column).cloned()).collect());
   if !safe(&rule){continue;}rule
  }else{if old_editors.iter().any(|w|!w.opaque.is_empty()){continue;}RuleExpr::Or(old_editors.iter().map(|w|w.guard.clone()).collect())};
  if kernel::dependencies(&previous_guard).iter().any(|table|old.schema.table(table).zip(bound.schema.table(table)).is_none_or(|(a,b)|a!=b)){continue;}
  if kernel::implies(&editor.guard,&previous_guard)!=Ok(true)||kernel::implies(&previous_guard,&editor.guard)!=Ok(false){continue;}
  for creator in current.iter().filter(|w|w.create&&w.table==editor.table&&w.column==editor.column){
   fn creation_shape(mut table:snapback4_core::schema::Table,column:&str)->snapback4_core::schema::Table{
    if let Some(kind)=table.columns.get_mut(column){*kind=kind.required().clone();}table.column_writes.remove(column);table.frozen_columns.remove(column);
    table.rules.update=RuleExpr::Allow;
    for c in &mut table.constraints{if let Constraint::Immutable{fields}=c{fields.retain(|f|f!=column);}}
    table.constraints.retain(|c|!matches!(c,Constraint::Immutable{fields}if fields.is_empty()));table
   }
   if creation_shape(old_table.clone(),&creator.column)!=creation_shape(bound.schema.tables[&creator.table].clone(),&creator.column){continue;}
   let Some(current_program)=bound.programs.iter().find(|p|p.program.name==creator.operation)else{continue;};
   let Some(old_program)=old.programs.iter().find(|p|p.program.name==creator.operation)else{continue;};
   let mut reads=snapback4_core::ir::read_sites(&current_program.program).into_iter().chain(snapback4_core::ir::read_sites(&old_program.program)).filter(|r|r.kind!="write target").map(|r|r.table).collect::<BTreeSet<_>>();
   loop{let before=reads.len();for table in reads.clone(){for schema in [&bound.schema,&old.schema]{if let Some(t)=schema.table(&table){for rule in super::columns::rules(t){reads.extend(kernel::dependencies(rule));}if let Some(edge)=&t.through{reads.insert(edge.parent.clone());}}}}if before==reads.len(){break;}}
   if reads.iter().any(|table|old.schema.table(table).zip(bound.schema.table(table)).is_none_or(|(a,b)|a!=b)){continue;}
   if [&current_program.program,&old_program.program].iter().any(|p|super::release_authority::opaque_program(p)||snapback4_core::ir::write_tables(p).len()!=1||snapback4_core::ir::write_tables(p).iter().any(|(table,kind)|table!=&creator.table||!matches!(*kind,"insert"|"upsert")||reads.contains(table))){continue;}
   let unchanged=|path:&Write|prior.iter().any(|w|w.create&&w.table==path.table&&w.column==path.column&&w.operation==path.operation&&w.identity==path.identity&&w.opaque==path.opaque&&kernel::implies(&w.guard,&path.guard)==Ok(true)&&kernel::implies(&path.guard,&w.guard)==Ok(true));
   if !current.iter().filter(|w|w.create&&w.table==creator.table&&w.column==creator.column&&w.operation==creator.operation).all(unchanged){continue;}
   if kernel::implies(&creator.guard,&editor.guard)!=Ok(false)||!seen.insert((creator.operation.clone(),creator.table.clone(),creator.column.clone(),editor.guard.quarry())){continue;}
   let line=format!("invariant {}.{} write only {}",creator.table,creator.column,editor.guard.quarry());
   let mut selected=sources.to_vec();selected.push(("$sec12-release.q".into(),format!("{line}\n")));
   let checked=crate::compile(&selected);if !checked.diagnostics.is_empty(){continue;}
   let Some(mut inv)=checked.invariants.into_iter().find(|i|i.site.file=="$sec12-release.q")else{continue;};
   inv.site.file=format!("$derived/sec12-release/{}/{}/{}",creator.table,creator.column,creator.operation);
   inv.operation=Some(creator.operation.clone());
   let mut note=Diagnostic::new(&creator.site,"N_RELEASE_CREATE_AUTHORITY",format!("{}: {}.{} still accepts creation after {} narrowed this column's setter to {}; predecessor audience: {}",creator.operation,creator.table,creator.column,editor.operation,editor.guard.quarry(),previous_guard.quarry()),format!("narrow the creating path or apply `{}: <type> write <- {}`; if creation is deliberately broader, answer with an evaluated `allow {}.{} insert when <creation audience>`",creator.column,editor.guard.quarry(),creator.table,creator.column)).guide("security");
   note.details=Some(serde_json::json!({"releaseCreate":{"table":creator.table,"column":creator.column,"operation":creator.operation,"policy":editor.guard.quarry(),"predecessorPolicy":previous_guard.quarry()}}).to_string());
   result.push(Candidate{note,invariant:inv,creator:creator.operation.clone(),column:creator.column.clone()});
  }
 }result
}

#[cfg(test)]mod tests{
 use super::*;
 pub(super) fn source(editor:&str,creator:&str)->Vec<(String,String)>{vec![("schema.q".into(),format!("table roles:\n  principal: principal\n  role: enum('owner', 'editor')\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  value: text\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(value: text):\n  {creator}\n  return insert docs {{ value }}\n{editor}"))]}
 pub(super) fn count(old:&[(String,String)],new:&[(String,String)])->usize{let oldb=crate::compile(old);let newb=crate::compile(new);assert!(oldb.diagnostics.is_empty(),"{:?}",oldb.diagnostics);assert!(newb.diagnostics.is_empty(),"{:?}",newb.diagnostics);candidates(new,&newb,old,&oldb).len()}
 pub(super) fn edit(guard:&str)->String{format!("mutation edit(doc: docs, value: text):\n  require {guard} else DENIED\n  update docs[doc] {{ value }}\n  return null\n")}
 #[test]fn only_release_narrowing_with_an_existing_creator_selects_a_candidate(){
  let owner="exists roles[viewer, role = 'owner']";let wider=format!("{owner} or exists roles[viewer, role = 'editor']");
  let old=source("","require true else DENIED");let new=source(&edit(owner),"require true else DENIED");
  assert_eq!(count(&old,&new),1);assert_eq!(count(&new,&new),0);assert_eq!(count(&new,&old),0);
  assert_eq!(count(&source(&edit(&wider),"require true else DENIED"),&new),1);
  assert_eq!(count(&source("","require true else DENIED"),&source(&edit(owner),&format!("require {owner} else DENIED"))),0);
  let no_creator=old.iter().map(|(f,s)|(f.clone(),s.split("mutation create").next().unwrap().into())).collect::<Vec<_>>();assert_eq!(count(&no_creator,&new),0);
 }
}

#[cfg(test)]mod regression_tests{
 use super::*;
 #[test]fn equivalent_negation_is_not_narrowing_and_argument_renames_do_not_escape(){
  let old=super::tests::source(&super::tests::edit("not (viewer != 'service:owner')"),"require true else DENIED");
  let new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED");
  assert_eq!(super::tests::count(&old,&new),0);
  let old=super::tests::source("","require true else DENIED");let new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED");
  let old=old.into_iter().map(|(file,source)|(file,source.replace("create(value: text)","create(v: text)").replace("insert docs { value }","insert docs { value: v }"))).collect::<Vec<_>>();
  assert_eq!(super::tests::count(&old,&new),1);
 }
 #[test]fn upsert_is_a_candidate_but_an_unchanged_broad_branch_prevents_setter_narrowing(){
  let old=super::tests::source("","require true else DENIED");let new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED");
  let convert=|sources:Vec<(String,String)>|sources.into_iter().map(|(f,s)|(f,s.replace("create(value: text)","create(id: id, value: text)").replace("insert docs { value }","upsert docs[id] { value }"))).collect::<Vec<_>>();
  assert_eq!(super::tests::count(&convert(old.clone()),&convert(new)),1);
  let editor="mutation edit(doc: docs, value: text, restricted: bool):\n  if restricted:\n    require viewer = 'service:owner' else DENIED\n    update docs[doc] { value }\n  else:\n    update docs[doc] { value }\n  return null\n";
  assert_eq!(super::tests::count(&super::tests::source(&super::tests::edit("true"),"require true else DENIED"),&super::tests::source(editor,"require true else DENIED")),0);
 }
}

#[cfg(test)]mod trailing_tests{
 use super::*;
 #[test]fn moving_a_trailing_guard_before_the_write_is_not_new_authority(){
  let old_editor="mutation edit(doc: docs, value: text):\n  update docs[doc] { value }\n  require viewer = 'service:owner' else DENIED\n  return null\n";
  let old=super::tests::source(old_editor,"require true else DENIED");
  let new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED");
  assert_eq!(super::tests::count(&old,&new),0);
 }
}

#[cfg(test)]mod operation_read_tests{
 use super::*;
 #[test]fn point_read_assertion_to_require_is_not_a_new_setter_narrowing(){
  let old_editor="mutation edit(doc: docs, value: text):\n  r = roles[viewer, role = 'owner'] ! else DENIED\n  update docs[doc] { value }\n  return null\n";
  let old=super::tests::source(old_editor,"require true else DENIED");let new=super::tests::source(&super::tests::edit("exists roles[viewer, role = 'owner']"),"require true else DENIED");
  assert_eq!(super::tests::count(&old,&new),0);
 }
 #[test]fn an_unreadable_role_row_does_not_establish_a_predecessor_audience(){
  let old=super::tests::source(&super::tests::edit("exists roles[viewer]"),"require true else DENIED");
  let new=super::tests::source(&super::tests::edit("exists roles[viewer] and viewer = 'service:owner'"),"require true else DENIED");
  let private=|mut source:Vec<(String,String)>|{source[0].1=source[0].1.replacen("read <- allow","read <- viewer = 'service:owner'",1);source};
  assert_eq!(super::tests::count(&private(old),&private(new)),0);
 }
}

#[cfg(test)]mod predecessor_custody_tests{
 use super::*;
 #[test]fn an_existing_conditional_freeze_is_not_a_new_setter_restriction(){
  let freeze=|mut sources:Vec<(String,String)>|{sources[0].1=sources[0].1.replace("  update <- allow\n","  update <- allow\n  immutable value when viewer != 'service:owner'\n");sources};
  let old=freeze(super::tests::source(&super::tests::edit("true"),"require true else DENIED"));let new=freeze(super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED"));assert_eq!(super::tests::count(&old,&new),0);
 }
 #[test]fn required_creator_reads_keep_their_predecessor_authority(){
  let creator="r = roles[viewer] ! else DENIED";
  let mut old=super::tests::source("",creator);old[0].1=old[0].1.replacen("read <- allow","read <- .role = 'owner'",1);
  let new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),creator);
  assert_eq!(super::tests::count(&old,&new),0);
 }
}

#[cfg(test)]mod reviewed_admission_tests{
 use super::*;
 #[test]fn a_new_setter_does_not_remove_an_existing_cell_restriction(){
  let freeze=|mut sources:Vec<(String,String)>|{sources[0].1=sources[0].1.replace("  update <- allow\n","  update <- allow\n  immutable value when viewer != 'service:owner'\n");sources};
  assert_eq!(super::tests::count(&freeze(super::tests::source("","require true else DENIED")),&freeze(super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED"))),0);
 }
 #[test]fn changed_assertion_inputs_do_not_preserve_creator_admission(){
  let old=super::tests::source("","eligible = 1 if viewer = 'service:owner' else null\n  checked = eligible ! else DENIED");
  let new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"eligible = 1\n  checked = eligible ! else DENIED");
  assert_eq!(super::tests::count(&old,&new),0);
 }
 #[test]fn earlier_protected_writes_already_restrict_the_predecessor_setter(){
  let old_editor="mutation edit(doc: docs, value: text):\n  insert logs { value }\n  update docs[doc] { value }\n  return null\n";
  let add_logs=|mut sources:Vec<(String,String)>|{sources[0].1.push_str("table logs:\n  value: text\n  read <- allow\n  insert <- viewer = 'service:owner'\n  online only\n");sources};
  assert_eq!(super::tests::count(&add_logs(super::tests::source(old_editor,"require true else DENIED")),&add_logs(super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED"))),0);
 }
}

#[cfg(test)]mod companion_admission_tests{
 #[test]fn companion_column_admission_is_not_a_new_setter_restriction(){
  let old_editor="mutation edit(doc: docs, value: text):\n  update docs[doc] { value, locked: not (docs[doc].locked ?? false) }\n  return null\n";
  let add_column=|mut sources:Vec<(String,String)>|{sources[0].1=sources[0].1.replace("  value: text\n","  value: text\n  locked: bool default false write <- viewer = 'service:owner'\n");sources};
  let old=add_column(super::tests::source(old_editor,"require true else DENIED"));let new=add_column(super::tests::source(&old_editor.replace("  update docs","  require viewer = 'service:owner' else DENIED\n  update docs"),"require true else DENIED"));assert_eq!(super::tests::count(&old,&new),0);
 }
 #[test]fn expanded_guard_argument_contract_is_not_predecessor_creator_continuity(){
  let old=super::tests::source("","require bypass = 1 or viewer = 'service:owner' else DENIED").into_iter().map(|(f,s)|(f,s.replace("create(value: text)","create(value: text, bypass: int 0..0)"))).collect::<Vec<_>>();
  let new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require bypass = 1 or viewer = 'service:owner' else DENIED").into_iter().map(|(f,s)|(f,s.replace("create(value: text)","create(value: text, bypass: int 0..1)"))).collect::<Vec<_>>();assert_eq!(super::tests::count(&old,&new),0);
 }
}

#[cfg(test)]mod local_input_tests{
 #[test]fn changed_local_inputs_to_the_same_require_do_not_preserve_creator_admission(){
  let old=super::tests::source("","eligible = 1 if viewer = 'service:owner' else 0\n  require eligible = 1 else DENIED");
  let new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"eligible = 1\n  require eligible = 1 else DENIED");assert_eq!(super::tests::count(&old,&new),0);
 }
}

#[cfg(test)]mod release_shape_tests{
 #[test]fn reopening_an_immutable_field_requires_a_creation_audience_answer(){
  let old=super::tests::source("","require true else DENIED").into_iter().map(|(f,s)|(f,s.replace("  update <- allow\n","  update <- allow\n  immutable value\n"))).collect::<Vec<_>>();
  let new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED");assert_eq!(super::tests::count(&old,&new),1);
 }
 #[test]fn separate_companion_writes_cannot_supply_broad_predecessor_admission(){
  let editor="mutation edit(doc: docs, value: text):\n  update docs[doc] { value }\n  update docs[doc] { locked: true }\n  return null\n";
  let add=|mut sources:Vec<(String,String)>|{sources[0].1=sources[0].1.replace("  value: text\n","  value: text\n  locked: bool default false write <- viewer = 'service:owner'\n");sources};
  assert_eq!(super::tests::count(&add(super::tests::source(editor,"require true else DENIED")),&add(super::tests::source(&editor.replace("  update docs","  require viewer = 'service:owner' else DENIED\n  update docs"),"require true else DENIED"))),0);
 }
 #[test]fn changed_sibling_creation_authority_breaks_predecessor_continuity(){
  let mut old=super::tests::source("","require true else DENIED");old[0].1=old[0].1.replace("  value: text\n","  value: text\n  locked: bool default false write <- viewer = 'service:owner'\n").replace("insert docs { value }","insert docs { value, locked: true }");
  let mut new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED");new[0].1=new[0].1.replace("  value: text\n","  value: text\n  locked: bool default false\n").replace("insert docs { value }","insert docs { value, locked: true }");assert_eq!(super::tests::count(&old,&new),0);
 }
 #[test]fn a_setter_cannot_manufacture_its_narrower_role(){
  let editor="mutation edit(doc: docs, value: text):\n  upsert roles[viewer] { principal: viewer, role: 'owner' }\n  require exists roles[viewer, role = 'owner'] else DENIED\n  update docs[doc] { value }\n  return null\n";
  assert_eq!(super::tests::count(&super::tests::source(&super::tests::edit("true"),"require true else DENIED"),&super::tests::source(editor,"require true else DENIED")),0);
 }
}

#[cfg(test)]mod calibrated_source_pairs{
 #[test]fn each_requested_day_two_create_hole_retains_a_release_candidate(){
  for (lane,old,new) in [
   ("002",include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../../reports/sec12/fixtures/002-before.q")),include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../../reports/sec12/fixtures/002-after.q"))),
   ("014",include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../../reports/sec12/fixtures/014-before.q")),include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../../reports/sec12/fixtures/014-after.q"))),
   ("019",include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../../reports/sec12/fixtures/019-before.q")),include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../../reports/sec12/fixtures/019-after.q"))),
  ]{let old=vec![("schema.q".into(),old.into())];let new=vec![("schema.q".into(),new.into())];let oldb=crate::compile(&old);let newb=crate::compile(&new);let candidates=super::candidates(&new,&newb,&old,&oldb);if candidates.is_empty(){for (label,s,b) in [("old",&old,&oldb),("new",&new,&newb)]{for w in super::writes(s,b).iter().filter(|w|w.create&&w.operation=="openProject"&&w.column=="entrancePhoto"){eprintln!("{label} identity {}",w.identity);}}}assert!(!candidates.is_empty(),"{lane}");}
 }
}

#[cfg(test)]mod creator_payload_tests{
 #[test]fn companion_values_and_their_validation_contracts_are_creation_admission(){
  let add=|mut sources:Vec<(String,String)>|{sources[0].1=sources[0].1.replace("  value: text\n","  value: text\n  locked: bool default false write <- viewer = 'service:owner'\n");sources};
  let mut old=add(super::tests::source("","require true else DENIED"));old[0].1=old[0].1.replace("insert docs { value }","insert docs { value, locked: true }");
  let mut new=add(super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED"));new[0].1=new[0].1.replace("insert docs { value }","insert docs { value, locked: false }");assert_eq!(super::tests::count(&old,&new),0);
  old[0].1=old[0].1.replace("create(value: text)","create(value: text, flag: int 1..1)").replace("locked: true","locked: flag = 1");
  new[0].1=new[0].1.replace("create(value: text)","create(value: text, flag: int 0..1)").replace("locked: false","locked: flag = 1");assert_eq!(super::tests::count(&old,&new),0);
 }
}

#[cfg(test)]mod diagnostic_named_payload_tests{
 #[test]fn diagnostic_field_names_are_preserved_in_creator_payload_identity(){
  for column in ["code","message","site"]{
   let mut old=super::tests::source("","require true else DENIED");old[0].1=old[0].1.replace("  value: text\n",&format!("  value: text\n  {column}: bool default false write <- viewer = 'service:owner'\n")).replace("insert docs { value }",&format!("insert docs {{ value, {column}: true }}"));
   let mut new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),"require true else DENIED");new[0].1=new[0].1.replace("  value: text\n",&format!("  value: text\n  {column}: bool default false write <- viewer = 'service:owner'\n")).replace("insert docs { value }",&format!("insert docs {{ value, {column}: false }}"));assert_eq!(super::tests::count(&old,&new),0,"{column}");
  }
 }
}
#[cfg(test)]mod multiple_creator_tests{
 #[test]fn a_companion_create_cannot_relax_a_different_argument_contract(){
  let source="table docs:\n  value: text ?\n  locked: bool default false write <- .value = null or viewer = 'service:owner'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(value: text, companion: text):\n  insert docs { value, locked: false }\n  return insert docs { value: companion, locked: true }\n";
  let old=vec![("schema.q".into(),source.into())];let new=vec![("schema.q".into(),format!("{}{}",source.replace("companion: text)","companion: text ?)"),super::tests::edit("viewer = 'service:owner'")))];assert_eq!(super::tests::count(&old,&new),0);
 }
}


#[cfg(test)]mod reviewed_validation_tests{
 #[test]fn changed_reviewed_field_validation_cannot_broaden_predecessor_creation(){
  let creator="require value = 'z' or viewer = 'service:owner' else DENIED";
  let mut old=super::tests::source("",creator);old[0].1=old[0].1.replacen("  value: text\n","  value: text 2..80\n",1).replace("value: text)","value: text <=80)");
  let mut new=super::tests::source(&super::tests::edit("viewer = 'service:owner'"),creator);new[0].1=new[0].1.replacen("  value: text\n","  value: text 1..80\n",1).replace("value: text)","value: text <=80)");assert_eq!(super::tests::count(&old,&new),0);
 }
}
