//! Candidate workflow contracts anchored in authored guards and reference paths.
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — only replayed violations refuse production.
use super::*;
use ast::{Expr,Stmt,WriteOp,TypeKind};
use snapback4_core::schema::ColumnType as C;
fn expr(source:&str)->Option<Expr>{
    let (doc,errors)=crate::parse_document("$workflow",&format!("query value():\n  return {source}\n"));
    if !errors.is_empty(){return None;}
    doc.programs.first()?.body.iter().find_map(|s|if let Stmt::Return{value,..}=s{Some(value.clone())}else{None})
}
fn string(value:&str)->Expr{Expr::Literal{value:ast::Literal::Str(value.into()),site:Site::default()}}
fn binary(op:&str,left:Expr,right:Expr)->Expr{Expr::Binary{op:op.into(),left:Box::new(left),right:Box::new(right),site:Site::default()}}
fn focal()->Expr{Expr::Focal{site:Site::default()}}
fn member(base:Expr,name:&str)->Expr{Expr::Member{base:Box::new(base),name:name.into(),site:Site::default()}}
fn walk(e:&mut Expr,f:&mut impl FnMut(&mut Expr)){super::super::super::intent_walk::expression(e,f)}
const LOCAL:&str="$derived:local-focal";
// Preserve focal binders in populations through outer-resource substitution.
// Captured program arguments inside a filter need a separate capture reduction;
// omit that mapping rather than silently binding them to the population row.
fn mask_locals(e:&mut Expr,args:&BTreeMap<String,Expr>)->bool{
    fn protect(e:&mut Expr,args:&BTreeMap<String,Expr>)->bool{
        let mut capture=false;walk(e,&mut |e|match e{
            Expr::Name{name,..} if args.contains_key(name)=>capture=true,
            Expr::Focal{site}=>*e=Expr::Name{name:LOCAL.into(),site:site.clone()},_=>{}
        });!capture
    }
    let mut valid=true;
    walk(e,&mut |e|match e{
        Expr::Read(read)|Expr::Exists{read,..}=>if let Some(filter)=&mut read.filter{valid&=protect(filter,args);},
        Expr::Call{name,args:values,..} if name=="sum"&&values.len()==2=>valid&=protect(&mut values[1],args),_=>{}
    });valid
}
fn approval(name:&str)->bool{["approv","authoriz"].iter().any(|s|name.to_lowercase().contains(s))}
// An absence check prevents duplicate approvals; it is not permission for a
// governed effect. Preserve conditional alternatives in the complete predicate.
pub(super) fn approval_receipts(e:&Expr)->Vec<Expr>{
    fn named(e:&Expr)->bool{let mut e=e.clone();let mut found=false;walk(&mut e,&mut |e|match e{Expr::Member{name,..} if approval(name)=>found=true,Expr::Exists{read,..}|Expr::Read(read) if approval(&read.table)=>found=true,_=>{}});found}
    fn collect(e:&Expr,negated:bool,out:&mut Vec<Expr>){
        let positive=match e{
            Expr::Unary{op,value,..} if op=="not"=>{collect(value,!negated,out);return;},
            Expr::Binary{op,left,right,..} if matches!(op.as_str(),"and"|"or")=>{collect(left,negated,out);collect(right,negated,out);return;},
            Expr::Binary{op,left,right,..} if matches!(op.as_str(),"="|"!=")=>{
                let literal=if named(left){Some(right.as_ref())}else if named(right){Some(left.as_ref())}else{None};
                match literal{Some(Expr::Literal{value:ast::Literal::Null,..})=>(op=="!=")!=negated,Some(Expr::Literal{value:ast::Literal::Bool(value),..})=>((op=="=")==*value)!=negated,_=>false}
            },
            Expr::Member{name,..}=>approval(name)&&!negated,
            Expr::Exists{read,..}=>approval(&read.table)&&!negated,_=>false,
        };
        if positive{out.push(if negated{Expr::Unary{op:"not".into(),value:Box::new(e.clone()),site:e.site().clone()}}else{e.clone()});}
    }
    let mut out=Vec::new();collect(e,false,&mut out);out
}
fn contains_approval(e:&Expr)->bool{!approval_receipts(e).is_empty()}
fn guards(p:&ast::ProgramDecl)->impl Iterator<Item=&Expr>{p.body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{Some(condition)}else{None})}
fn ref_table<'a>(e:&Expr,schema:&'a Schema,root:&'a str)->Option<&'a str>{match e{
    Expr::Focal{..}=>Some(root),
    Expr::Member{base,name,..}=>{let t=ref_table(base,schema,root)?;match schema.tables.get(t)?.columns.get(name)?.required(){C::Ref{table}=>Some(table),_=>None}},_=>None,
}}
// Only id reads on a typed reference become a row expression. Secondary-key
// lookups, arbitrary arguments and ambiguous references are not guessed.
fn normalize(e:&Expr,schema:&Schema,root:&str,args:&BTreeMap<String,Expr>)->Option<Expr>{
    let mut e=e.clone();if !mask_locals(&mut e,args){return None;}walk(&mut e,&mut |e|{
        if let Expr::Name{name,..}=e&&let Some(value)=args.get(name){*e=value.clone();}
        if let Expr::Read(read)=e&&read.keys.len()==1&&read.filter.is_none()&&read.range.is_none()&&read.seeks.is_empty()&&read.matching.is_none()&&read.computed.is_empty(){
            let key=&read.keys[0];
            if key.column.as_deref().is_none_or(|c|c=="id") {
                if matches!(&key.value,Expr::Member{base,name,..} if name=="id"&&ref_table(base,schema,root)==Some(read.table.as_str())) {
                    if let Expr::Member{base,..}=&key.value{*e=*base.clone();}
                }else if ref_table(&key.value,schema,root)==Some(read.table.as_str()){*e=key.value.clone();}
            }
        }
        if let Expr::Assert{value,..}=e&&matches!(value.as_ref(),Expr::Focal{..}|Expr::Member{..}){*e=*value.clone();}
        if let Expr::Member{base,name,..}=e&&name=="id"&&matches!(base.as_ref(),Expr::Member{..})&&ref_table(base,schema,root).is_some(){*e=*base.clone();}
        if let Expr::Exists{read,..}=e&&read.keys.len()==1&&read.keys[0].column.is_none(){
            let value=&read.keys[0].value;
            let target=if let Expr::Member{base,name,..}=value&&name=="id"{ref_table(base,schema,root)}else{ref_table(value,schema,root)};
            if target==Some(read.table.as_str()) {read.keys[0].column=Some("id".into());}
            else if let Some(target)=target {
                let columns=schema.tables[&read.table].indexes.values().filter(|i|i.unique&&i.columns().len()==1).map(|i|i.columns()[0].clone()).filter(|c|matches!(schema.tables[&read.table].columns[c].required(),C::Ref{table} if table==target)).collect::<BTreeSet<_>>();
                if columns.len()==1{read.keys[0].column=columns.into_iter().next();}
            }
        }
    });
    let mut unknown=false;walk(&mut e,&mut |e|if matches!(e,Expr::Name{name,..} if name!="now"&&name!="viewer"&&name!=LOCAL) {unknown=true;});
    (!unknown).then_some(e)
}
fn paths(schema:&Schema,from:&str,to:&str)->Vec<Expr>{
    fn visit(schema:&Schema,from:&str,to:&str,value:Expr,seen:&BTreeSet<String>,out:&mut Vec<Expr>){
        if from==to{out.push(value);return;}
        if seen.len()>=4||seen.contains(from){return;}
        let mut seen=seen.clone();seen.insert(from.into());
        for (c,k) in &schema.tables[from].columns{if let C::Ref{table}=k.required(){visit(schema,table,to,member(value.clone(),c),&seen,out);}}
    }
    let mut out=Vec::new();visit(schema,from,to,focal(),&BTreeSet::new(),&mut out);out
}
fn lift(e:&Expr,root:&Expr)->Expr{let mut e=e.clone();walk(&mut e,&mut |e|if matches!(e,Expr::Focal{..}){*e=root.clone();});e}
fn add_syntax(out:&mut Vec<Invariant>,table:&str,column:Option<&str>,target:&str,mut policy:Expr,site:&Site,label:&str,operation:Option<String>){
    use sha2::{Digest,Sha256};
    walk(&mut policy,&mut |e|if let Expr::Name{name,site}=e&&name==LOCAL{*e=Expr::Focal{site:site.clone()};});
    let predicate=crate::print::expression(&policy);
    let hash=format!("{:x}",Sha256::digest(format!("{table}/{column:?}/{target}/{predicate}/{operation:?}")));
    let site=Site::new(&format!("$derived/{label}/{hash}/{}",site.file),site.line,site.col);
    if out.iter().any(|i|i.site==site){return;}
    out.push(Invariant{table:table.into(),column:column.map(str::to_owned),target:target.into(),predicate,policy:None,site,operation,requirements:Vec::new(),syntax:Some(policy),unsupported:Some("derived workflow predicate requires concrete executed-boundary replay; no rule-fragment proof".into())});
}
pub(super) fn invariants(docs:&[ast::Document],catalog:&Catalog,bound:&Bound,out:&mut Vec<Invariant>){
    let writes=docs.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ast::ProgramKind::Mutation).flat_map(|p|authority_walk::writes(catalog,p).into_iter().map(move |(w,c)|(p,w,c))).collect::<Vec<_>>();
    for (p,write,context) in &writes{
        let Expr::Write{op,table,fields,keys,site,..}=write else{continue;};
        if !matches!(op,WriteOp::Insert|WriteOp::Update|WriteOp::Upsert)||!bound.schema.tables.contains_key(table){continue;}
        for arg in &p.args {let TypeKind::Ref{table:root}=&arg.type_.kind else{continue;};
            let args=BTreeMap::from([(arg.name.clone(),member(focal(),"id"))]);
            if matches!(op,WriteOp::Insert|WriteOp::Upsert)&&root==table {
                for field in fields.iter().filter(|f|matches!(bound.schema.tables[table].columns.get(&f.name).map(C::required),Some(C::Ref{table:t}) if t==root)) {
                    let Some(value)=field.value.as_ref().and_then(|e|normalize(e,&bound.schema,root,&args))else{continue;};
                    if !matches!(value,Expr::Member{base,name,..} if name=="id"&&matches!(base.as_ref(),Expr::Focal{..})){continue;}
                    let guarded=guards(context).filter_map(|c|normalize(c,&bound.schema,root,&args)).any(|c|{let mut found=false;let mut c=c;walk(&mut c,&mut |e|if let Expr::Member{base,name,..}=e&&matches!(base.as_ref(),Expr::Focal{..})&&matches!(bound.schema.tables[root].columns.get(name).map(C::required),Some(C::Bool|C::Enum{..})){found=true;});found});
                    let consumed=writes.iter().any(|(other,w,_)|std::ptr::eq(*other,*p)&&matches!(w,Expr::Write{op:WriteOp::Update|WriteOp::Delete,table:t,..} if t==root));
                    if guarded&&!consumed&&guards(context).any(contains_approval) {
                        if let Some(policy)=expr(&format!(".{} = null or count({table}[{} = .{}]) <= 1",field.name,field.name,field.name)){add_syntax(out,table,None,"insert",policy,site,"repeat-create",None);}
                    }
                }
            }
            for condition in guards(context).filter(|c|contains_approval(c)) {
                let Some(contract)=normalize(condition,&bound.schema,root,&args)else{continue;};
                // Ignore an approval mentioned solely on a different resource.
                if !crate::print::expression(&contract).contains('.') {continue;}
                if matches!(op,WriteOp::Insert|WriteOp::Upsert)&&root==table{
                    // A guarded retry copied a stable identity from the prior
                    // row. A fresh sibling insert must not reset that history.
                    let identity=fields.iter().filter(|f|matches!(bound.schema.tables[table].columns.get(&f.name).map(C::required),Some(C::Principal|C::Ref{..}))).find(|f|f.value.as_ref().and_then(|e|normalize(e,&bound.schema,root,&args)).is_some_and(|e|matches!(e,Expr::Member{base,name,..} if matches!(base.as_ref(),Expr::Focal{..})&&name==f.name)));
                    let Some(identity)=identity else{continue;};
                    let Some(Expr::Read(mut population))=expr(&format!("{root}[{} = .{}]",identity.name,identity.name))else{continue;};
                    let prerequisites=guards(context).filter(|c|!contains_approval(c)).filter_map(|c|normalize(c,&bound.schema,root,&args)).filter(|c|{let text=crate::print::expression(c);text.contains('.')&&!text.contains("viewer")}).collect::<Vec<_>>();
                    let negative=Expr::Unary{op:"not".into(),value:Box::new(contract.clone()),site:site.clone()};
                    population.filter=Some(Box::new(prerequisites.into_iter().chain([negative]).reduce(|a,b|binary("and",a,b)).unwrap()));
                    let policy=Expr::Binary{op:"=".into(),left:Box::new(Expr::Call{name:"count".into(),args:vec![Expr::Read(population)],site:site.clone()}),right:Box::new(expr("0").unwrap()),site:site.clone()};
                    add_syntax(out,table,None,"insert",policy,site,"approval-history",None);
                    continue;
                }
                let selected=if *op==WriteOp::Update{
                    fields.iter().find(|f|matches!(f.name.as_str(),"status"|"stage"|"state"|"phase")).and_then(|f|f.value.as_ref()).and_then(|e|normalize(e,&bound.schema,root,&args))
                }else{None};
                let mut roots=paths(&bound.schema,table,root);
                // A target update must identify this exact resource argument.
                if table==root&&*op==WriteOp::Update&&target_arg(p,write,root).is_none_or(|selected|selected.name!=arg.name){continue;}
                if roots.len()!=1{continue;}let base=roots.remove(0);
                if *op==WriteOp::Update&&table!=root{
                    let Expr::Member{base:owner,name:reference,..}=&base else{continue;};
                    if !matches!(owner.as_ref(),Expr::Focal{..})||keys.len()!=1||!matches!(&keys[0].value,Expr::Name{name,..} if name==&arg.name)||keys[0].column.as_deref().is_some_and(|c|c!=reference)||!bound.schema.tables[table].indexes.values().any(|index|index.unique&&index.columns()==vec![reference.clone()]){continue;}
                }

                if root!=table&&matches!(op,WriteOp::Insert|WriteOp::Upsert){
                    // A related ledger insert in an atomic stage transition
                    // records that destination; it does not make every ledger
                    // event require the transition's approval. The exact
                    // parent destination already supplies its own contract.
                    let stage_effect=writes.iter().any(|(producer,effect,_)|std::ptr::eq(*producer,*p)&&target_arg(producer,effect,root).is_some_and(|selected|selected.name==arg.name)&&matches!(effect,Expr::Write{table:target,fields,..} if target==root&&state_field(bound,root,fields).is_some_and(|field|matches!(&field.value,Some(Expr::Literal{..})))));
                    if stage_effect{continue;}
                    // The guarded resource must be the one actually placed
                    // on this effect, not another argument of the same type.
                    let mut placed=base.clone();walk(&mut placed,&mut |e|if let Expr::Member{base,name,..}=e&&matches!(base.as_ref(),Expr::Focal{..})&&let Some(value)=fields.iter().find(|f|f.name==*name).and_then(|f|f.value.as_ref()){*e=value.clone();});
                    if !normalize(&placed,&bound.schema,root,&args).is_some_and(|e|matches!(e,Expr::Member{base,name,..} if name=="id"&&matches!(base.as_ref(),Expr::Focal{..}))){continue;}
                }

                for (candidate,_) in bound.schema.visible_tables(){
                    let descendants=paths(&bound.schema,candidate,table);if descendants.len()!=1{continue;}
                    if *op==WriteOp::Update&&candidate!=table{continue;}
                    let mut root_path=base.clone();let outer=&descendants[0];root_path=lift(&root_path,outer);
                    let mut policy=lift(&contract,&root_path);
                    if *op==WriteOp::Update{
                        let Some(selected)=&selected else{continue;};
                        // Destinations must be literals: dynamic status inputs
                        // require an explicit operation-bound history instead.
                        if !matches!(selected,Expr::Literal{..}){continue;}
                        let column=fields.iter().find(|f|matches!(f.name.as_str(),"status"|"stage"|"state"|"phase")).unwrap();
                        policy=Expr::Binary{op:"or".into(),left:Box::new(Expr::Binary{op:"!=".into(),left:Box::new(member(focal(),&column.name)),right:Box::new(selected.clone()),site:site.clone()}),right:Box::new(policy),site:site.clone()};
                    }
                    add_syntax(out,candidate,if *op==WriteOp::Update{fields.iter().find(|f|matches!(f.name.as_str(),"status"|"stage"|"state"|"phase")).map(|f|f.name.as_str())}else{None},if *op==WriteOp::Update{"update"}else{"insert"},policy,site,"sibling-approval",None);
                }
            }
        }
    }
    lifecycle(&writes,bound,out);
}

fn state_field<'a>(bound:&Bound,table:&str,fields:&'a [ast::ObjectField])->Option<&'a ast::ObjectField>{
    let definition=bound.schema.tables.get(table)?;
    fields.iter().find(|f|matches!(f.name.as_str(),"status"|"stage"|"phase"|"state")&&matches!(definition.columns.get(&f.name).map(C::required),Some(C::Enum{..})))
}
fn roles(context:&ast::ProgramDecl,bound:&Bound)->BTreeSet<String>{
    guards(context).filter(|c|{let mut c=(*c).clone();let mut found=false;walk(&mut c,&mut |e|if let Expr::Exists{read,..}=e&& !privilege::role_columns(bound,&read.table).is_empty(){found=true;});found}).map(crate::print::expression).collect()
}
fn literals(e:&Expr)->BTreeSet<String>{let mut e=e.clone();let mut out=BTreeSet::new();walk(&mut e,&mut |e|if let Expr::Literal{value:ast::Literal::Str(s),..}=e{out.insert(s.clone());});out}
// A typed id argument binds only the actual selected row, never an arbitrary
// argument of the same table or a named secondary reference key.
fn target_arg<'a>(p:&'a ast::ProgramDecl,w:&Expr,table:&str)->Option<&'a ast::ArgDecl>{
    let Expr::Write{op:WriteOp::Update,table:target,keys,..}=w else{return None;};
    if target!=table||keys.len()!=1||keys[0].column.as_deref().is_some_and(|c|c!="id"){return None;}
    let Expr::Name{name,..}=&keys[0].value else{return None;};
    p.args.iter().find(|a|a.name==*name&&matches!(&a.type_.kind,TypeKind::Ref{table:t} if t==table))
}
fn state_requirements(p:&ast::ProgramDecl,w:&Expr,context:&ast::ProgramDecl,bound:&Bound,table:&str,state:&str)->Option<Vec<Expr>>{
    fn conjuncts<'a>(e:&'a Expr,out:&mut Vec<&'a Expr>){if let Expr::Binary{op,left,right,..}=e&&op=="and"{conjuncts(left,out);conjuncts(right,out);}else{out.push(e);}}
    let arg=target_arg(p,w,table)?;let args=BTreeMap::from([(arg.name.clone(),member(focal(),"id"))]);let mut parts=Vec::new();for guard in guards(context){conjuncts(guard,&mut parts);}
    Some(parts.into_iter().filter_map(|c|normalize(c,&bound.schema,table,&args)).filter(|c|{let mut c=c.clone();let mut found=false;walk(&mut c,&mut |e|if matches!(e,Expr::Member{base,name,..} if name==state&&matches!(base.as_ref(),Expr::Focal{..})){found=true;});found}).collect())
}
fn lifecycle(writes:&[(&ast::ProgramDecl,Expr,ast::ProgramDecl)],bound:&Bound,out:&mut Vec<Invariant>){
    for (child_p,child_write,child_context) in writes {
        let Expr::Write{op:WriteOp::Update,table:child,fields:child_fields,site:child_site,..}=child_write else{continue;};
        let Some(child_state)=state_field(bound,child,child_fields)else{continue;};
        let child_roles=roles(child_context,bound);if child_roles.is_empty(){continue;}
        // A child write inside a parent transition is the authored atomic
        // coupling itself. Do not turn its intermediate image into a bypass.

        for (reference,kind) in &bound.schema.tables[child].columns{let C::Ref{table:parent}=kind.required()else{continue;};if parent==child{continue;}
            let atomic_parent=writes.iter().any(|(p,w,_)|std::ptr::eq(*p,*child_p)&&matches!(w,Expr::Write{op:WriteOp::Update,table,..} if table==parent));
            let parent_gate=guards(child_context).any(|condition|{let mut condition=condition.clone();let mut found=false;walk(&mut condition,&mut |e|if let Expr::Member{base,name,..}=e&&matches!(name.as_str(),"status"|"stage"|"state"|"phase"){let mut base=*base.clone();walk(&mut base,&mut |e|if matches!(e,Expr::Read(read) if &read.table==parent){found=true;});});found});

            for (parent_p,parent_write,parent_context) in writes {
                let Expr::Write{op:WriteOp::Update,table,fields,site,..}=parent_write else{continue;};if table!=parent{continue;}
                let Some(parent_state)=state_field(bound,parent,fields)else{continue;};
                if roles(parent_context,bound)!=child_roles{continue;}
                let Some(requirements)=state_requirements(parent_p,parent_write,parent_context,bound,parent,&parent_state.name)else{continue;};
                // Unresolved state-write targets cannot establish terminality.
                if writes.iter().any(|(p,w,c)|matches!(w,Expr::Write{op:WriteOp::Update,table:t,fields,..} if t==parent&&state_field(bound,parent,fields).is_some())&&state_requirements(p,w,c,bound,parent,&parent_state.name).is_none()){continue;}
                let Some(destination)=parent_state.value.as_ref()else{continue;};
                let Expr::Literal{value:ast::Literal::Str(destination),..}=destination else{continue;};
                let sources=requirements.iter().flat_map(literals).collect::<BTreeSet<_>>();
                if sources.is_empty(){continue;}
                // Work follows a prior parent transition by this same role.
                // Admit both its explicit source and destination states.
                let outgoing=writes.iter().any(|(p,w,c)|roles(c,bound)==child_roles&&state_requirements(p,w,c,bound,parent,&parent_state.name).is_some_and(|guards|guards.iter().any(|c|literals(c).contains(destination))));
                if outgoing&&!atomic_parent&&!parent_gate {
                    // A role may work throughout its parent's intermediate
                    // phase. Adjacent edges form one window, not mutually
                    // contradictory per-edge prerequisites.
                    let mut allowed=BTreeSet::new();
                    for (producer,write,context) in writes{
                        let Expr::Write{op:WriteOp::Update,table,fields,..}=write else{continue;};
                        if table!=parent||roles(context,bound)!=child_roles{continue;}
                        let Some(requirements)=state_requirements(producer,write,context,bound,parent,&parent_state.name)else{continue;};
                        let Some(state)=state_field(bound,parent,fields)else{continue;};if state.name!=parent_state.name{continue;}
                        let Some(Expr::Literal{value:ast::Literal::Str(to),..})=&state.value else{continue;};
                        let next_edge=writes.iter().any(|(p,w,c)|roles(c,bound)==child_roles&&state_requirements(p,w,c,bound,parent,&parent_state.name).is_some_and(|guards|guards.iter().any(|c|literals(c).contains(to))));
                        if !next_edge{continue;}
                        allowed.insert(to.clone());
                        allowed.extend(requirements.iter().flat_map(literals));
                    }
                    let policy=allowed.into_iter().map(|v|binary("=",member(member(focal(),reference),&parent_state.name),string(&v))).reduce(|a,b|binary("or",a,b));
                    if let Some(policy)=policy{
                        let operation=super::super::super::operation_name(std::path::Path::new(&child_p.site.file).file_stem().and_then(|s|s.to_str()).unwrap_or(""),&child_p.name);
                        add_syntax(out,child,Some(&child_state.name),"update",policy,child_site,"parent-state",Some(operation));
                    }
                }
                // A terminal parent destination has no same-role outgoing
                // transition. Infer the child's terminal only from its graph.
                let any_outgoing=writes.iter().any(|(p,w,c)|state_requirements(p,w,c,bound,parent,&parent_state.name).is_some_and(|guards|guards.iter().any(|c|literals(c).contains(destination))));
                let atomic_child=writes.iter().any(|(p,w,_)|std::ptr::eq(*p,*parent_p)&&matches!(w,Expr::Write{op:WriteOp::Update,table:t,..} if t==child));
                if any_outgoing||atomic_child{continue;}
                // A single open/closed toggle does not establish a completion
                // workflow across child stages. Require an authored predecessor
                // transition into this completion's source phase.
                let predecessor=writes.iter().any(|(p,w,c)|matches!(w,Expr::Write{op:WriteOp::Update,table:t,fields,..} if t==parent&&state_field(bound,parent,fields).and_then(|field|field.value.as_ref()).is_some_and(|value|matches!(value,Expr::Literal{value:ast::Literal::Str(to),..} if sources.contains(to))))&&state_requirements(p,w,c,bound,parent,&parent_state.name).is_some_and(|guards|!guards.is_empty()));
                if !predecessor{continue;}
                let mut assigned=BTreeSet::new();let mut from=BTreeSet::new();let mut ambiguous=false;
                for (p,w,c) in writes.iter().filter(|(_,w,_)|matches!(w,Expr::Write{op:WriteOp::Update,table:t,..} if t==child)){
                    let Expr::Write{fields,..}=w else{continue;};let Some(state)=fields.iter().find(|f|f.name==child_state.name)else{continue;};
                    let Some(requirements)=state_requirements(p,w,c,bound,child,&child_state.name)else{ambiguous=true;break;};
                    if requirements.is_empty(){
                        // A privileged unconditional reset to the declared
                        // creation state is a restart, not a forward completion
                        // edge. Other source-free destinations are ambiguous.
                        let reset=matches!(&state.value,Some(Expr::Literal{value:ast::Literal::Str(value),..}) if bound.schema.tables[child].defaults.get(&child_state.name).is_some_and(|d|d.value(challenges::NOW,"$derived")==snapback4_core::Value::String(value.clone())));
                        if reset{continue;}ambiguous=true;break;
                    }
                    if let Some(value)=&state.value{assigned.extend(literals(value));}
                    from.extend(requirements.iter().flat_map(literals));
                }
                if ambiguous{continue;}
                if let Some(C::Enum{variants})=bound.schema.tables[child].columns.get(&child_state.name).map(C::required){assigned.retain(|value|variants.contains(value));from.retain(|value|variants.contains(value));}
                let terminal=assigned.difference(&from).collect::<Vec<_>>();if terminal.len()!=1{continue;}
                if let Some(mut population)=expr(&format!("{child}[{reference} = .id]")){
                    if let Expr::Read(read)=&mut population{read.filter=Some(Box::new(binary("!=",member(focal(),&child_state.name),string(terminal[0]))));}
                    let policy=Expr::Binary{op:"or".into(),left:Box::new(binary("!=",member(focal(),&parent_state.name),string(destination))),right:Box::new(Expr::Binary{op:"=".into(),left:Box::new(Expr::Call{name:"count".into(),args:vec![population],site:site.clone()}),right:Box::new(expr("0").unwrap()),site:site.clone()}),site:site.clone()};
                    add_syntax(out,parent,Some(&parent_state.name),"update",policy,site,"child-stage",None);
                }
            }
        }
    }
}

#[cfg(test)]mod tests {use super::*;
#[test]fn descendant_approval_policy_uses_the_same_visit(){
    use snapback4_core::{Value,value::object};
    let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/wave26/018.q"));let sources=vec![("schema.q".into(),source.into())];let b=crate::compile(&sources);
    let contracts=super::super::invariants(&sources,&b);let i=contracts.iter().find(|i|i.table=="rescans"&&i.site.file.contains("sibling-approval")).unwrap();
    let row=object([("id",Value::Id("r".into())),("scan",Value::Id("s".into()))]);
    let rows=BTreeMap::from([("herds".into(),vec![object([("id",Value::Id("h".into())),("restricted",Value::Bool(true))])]),("visits".into(),vec![object([("id",Value::Id("v".into())),("herd",Value::Id("h".into()))])]),("scans".into(),vec![object([("id",Value::Id("s".into())),("visit",Value::Id("v".into()))])])]);
    assert_eq!(super::super::super::concrete::evaluate(i.syntax.as_ref().unwrap(),&row,&rows,&b.schema,"actor","rescans",challenges::NOW),Some(false),"{}",i.predicate);
}
#[test]fn filtered_approval_keeps_its_population_focal(){
    use snapback4_core::{Value,value::object};
    let source="table jobs:\n  approved: bool default false\n  read <- allow\n  online only\ntable approvals:\n  job: jobs\n  approved: bool default false\n  unique job\n  read <- allow\n  online only\ntable effects:\n  job: jobs\n  read <- allow\n  insert <- allow\n  online only\nmutation guarded(job: jobs):\n  require exists approvals[job = job] where .approved else NO_APPROVAL\n  return insert effects {job}\n";
    let sources=vec![("schema.q".into(),source.into())];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let cs=super::super::invariants(&sources,&b);let i=cs.iter().find(|i|i.table=="effects"&&i.site.file.contains("sibling-approval")).unwrap();
    let rows=BTreeMap::from([("jobs".into(),vec![object([("id",Value::Id("j".into())),("approved",Value::Bool(false))])]),("approvals".into(),vec![object([("id",Value::Id("a".into())),("job",Value::Id("j".into())),("approved",Value::Bool(true))])])]);
    let row=object([("id",Value::Id("e".into())),("job",Value::Id("j".into()))]);
    assert_eq!(super::super::super::concrete::evaluate(i.syntax.as_ref().unwrap(),&row,&rows,&b.schema,"actor","effects",challenges::NOW),Some(true),"{}",i.predicate);
}
}
