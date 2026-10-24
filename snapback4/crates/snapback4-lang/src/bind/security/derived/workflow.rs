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
fn approval(name:&str)->bool{["approv","authoriz"].iter().any(|s|name.to_lowercase().contains(s))}
fn contains_approval(e:&Expr)->bool{
    let mut e=e.clone();let mut found=false;walk(&mut e,&mut |e|match e{
        Expr::Member{name,..} if approval(name)=>found=true,
        Expr::Exists{read,..} if approval(&read.table)=>found=true,_=>{}
    });found
}
fn guards(p:&ast::ProgramDecl)->impl Iterator<Item=&Expr>{p.body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{Some(condition)}else{None})}
fn ref_table<'a>(e:&Expr,schema:&'a Schema,root:&'a str)->Option<&'a str>{match e{
    Expr::Focal{..}=>Some(root),
    Expr::Member{base,name,..}=>{let t=ref_table(base,schema,root)?;match schema.tables.get(t)?.columns.get(name)?.required(){C::Ref{table}=>Some(table),_=>None}},_=>None,
}}
// Only id reads on a typed reference become a row expression. Secondary-key
// lookups, arbitrary arguments and ambiguous references are not guessed.
fn normalize(e:&Expr,schema:&Schema,root:&str,args:&BTreeMap<String,Expr>)->Option<Expr>{
    let mut e=e.clone();walk(&mut e,&mut |e|{
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
    let mut unknown=false;walk(&mut e,&mut |e|if matches!(e,Expr::Name{name,..} if name!="now"&&name!="viewer") {unknown=true;});
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
fn add_syntax(out:&mut Vec<Invariant>,table:&str,column:Option<&str>,target:&str,policy:Expr,site:&Site,label:&str,operation:Option<String>){
    use sha2::{Digest,Sha256};
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
        if !matches!(op,WriteOp::Insert|WriteOp::Update|WriteOp::Upsert){continue;}
        for arg in &p.args {let TypeKind::Ref{table:root}=&arg.type_.kind else{continue;};
            let args=BTreeMap::from([(arg.name.clone(),member(focal(),"id"))]);
            if matches!(op,WriteOp::Insert|WriteOp::Upsert)&&root==table {
                for field in fields.iter().filter(|f|matches!(bound.schema.tables[table].columns.get(&f.name).map(C::required),Some(C::Ref{table:t}) if t==root)) {
                    let Some(value)=field.value.as_ref().and_then(|e|normalize(e,&bound.schema,root,&args))else{continue;};
                    if !matches!(value,Expr::Member{base,name,..} if name=="id"&&matches!(base.as_ref(),Expr::Focal{..})){continue;}
                    let guarded=guards(context).filter_map(|c|normalize(c,&bound.schema,root,&args)).any(|c|{let mut found=false;let mut c=c;walk(&mut c,&mut |e|if let Expr::Member{base,name,..}=e&&matches!(base.as_ref(),Expr::Focal{..})&&matches!(bound.schema.tables[root].columns.get(name).map(C::required),Some(C::Bool|C::Enum{..})){found=true;});found});
                    let consumed=writes.iter().any(|(other,w,_)|std::ptr::eq(*other,*p)&&matches!(w,Expr::Write{op:WriteOp::Update|WriteOp::Delete,table:t,..} if t==root));
                    if guarded&&!consumed {
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
                    let mut population=expr(&format!("{root}[{} = .{}]",identity.name,identity.name));
                    let prerequisites=guards(context).filter(|c|!contains_approval(c)).filter_map(|c|normalize(c,&bound.schema,root,&args)).filter(|c|{let text=crate::print::expression(c);text.contains('.')&&!text.contains("viewer")}).map(|c|format!("({})",crate::print::expression(&c))).collect::<Vec<_>>();
                    let filter=format!("{}not ({})",if prerequisites.is_empty(){String::new()}else{format!("{} and ",prerequisites.join(" and "))},crate::print::expression(&contract));
                    if let (Some(Expr::Read(read)),Some(filter))=(&mut population,expr(&filter)){read.filter=Some(Box::new(filter));}
                    if let Some(population)=population {let policy=Expr::Binary{op:"=".into(),left:Box::new(Expr::Call{name:"count".into(),args:vec![population],site:site.clone()}),right:Box::new(expr("0").unwrap()),site:site.clone()};add_syntax(out,table,None,"insert",policy,site,"approval-history",None);}
                    continue;
                }
                let selected=if *op==WriteOp::Update{
                    fields.iter().find(|f|matches!(f.name.as_str(),"status"|"stage"|"state"|"phase")).and_then(|f|f.value.as_ref()).and_then(|e|normalize(e,&bound.schema,root,&args))
                }else{None};
                let mut roots=paths(&bound.schema,table,root);
                // A target update must identify this exact resource argument.
                if table==root&&*op==WriteOp::Update&&!keys.iter().any(|k|matches!(&k.value,Expr::Name{name,..} if name==&arg.name)){continue;}
                if roots.len()!=1{continue;}let base=roots.remove(0);
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
                    add_syntax(out,candidate,None,if *op==WriteOp::Update{"update"}else{"insert"},policy,site,"sibling-approval",None);
                }
            }
        }
    }
    lifecycle(&writes,bound,out);
}

fn state_field<'a>(bound:&Bound,table:&str,fields:&'a [ast::ObjectField])->Option<&'a ast::ObjectField>{
    fields.iter().find(|f|matches!(f.name.as_str(),"status"|"stage"|"phase"|"state")&&matches!(bound.schema.tables[table].columns.get(&f.name).map(C::required),Some(C::Enum{..})))
}
fn roles(context:&ast::ProgramDecl,bound:&Bound)->BTreeSet<String>{
    guards(context).filter(|c|{let mut c=(*c).clone();let mut found=false;walk(&mut c,&mut |e|if let Expr::Exists{read,..}=e&& !privilege::role_columns(bound,&read.table).is_empty(){found=true;});found}).map(crate::print::expression).collect()
}
fn literals(e:&Expr)->BTreeSet<String>{let mut e=e.clone();let mut out=BTreeSet::new();walk(&mut e,&mut |e|if let Expr::Literal{value:ast::Literal::Str(s),..}=e{out.insert(s.clone());});out}
fn lifecycle(writes:&[(&ast::ProgramDecl,Expr,ast::ProgramDecl)],bound:&Bound,out:&mut Vec<Invariant>){
    for (child_p,child_write,child_context) in writes {
        let Expr::Write{op:WriteOp::Update,table:child,fields:child_fields,site:child_site,..}=child_write else{continue;};
        let Some(child_state)=state_field(bound,child,child_fields)else{continue;};
        let child_roles=roles(child_context,bound);if child_roles.is_empty(){continue;}
        for (reference,kind) in &bound.schema.tables[child].columns{let C::Ref{table:parent}=kind.required()else{continue;};if parent==child{continue;}
            for (parent_p,parent_write,parent_context) in writes {
                let Expr::Write{op:WriteOp::Update,table,fields,site,..}=parent_write else{continue;};if table!=parent{continue;}
                let Some(parent_state)=state_field(bound,parent,fields)else{continue;};
                if roles(parent_context,bound)!=child_roles{continue;}
                let Some(arg)=parent_p.args.iter().find(|a|matches!(&a.type_.kind,TypeKind::Ref{table} if table==parent))else{continue;};
                let args=BTreeMap::from([(arg.name.clone(),member(focal(),"id"))]);
                let requirements=guards(parent_context).filter_map(|c|normalize(c,&bound.schema,parent,&args)).filter(|c|{let mut c=c.clone();let mut found=false;walk(&mut c,&mut |e|if matches!(e,Expr::Member{base,name,..} if matches!(base.as_ref(),Expr::Focal{..})&&name==&parent_state.name){found=true;});found}).collect::<Vec<_>>();
                let Some(destination)=parent_state.value.as_ref()else{continue;};
                let Expr::Literal{value:ast::Literal::Str(destination),..}=destination else{continue;};
                let sources=requirements.iter().flat_map(literals).collect::<BTreeSet<_>>();
                if sources.is_empty(){continue;}
                // Work follows a prior parent transition by this same role.
                // Admit both its explicit source and destination states.
                let outgoing=writes.iter().any(|(_,w,c)|roles(c,bound)==child_roles&&matches!(w,Expr::Write{op:WriteOp::Update,table:t,..} if t==parent)&&guards(c).filter_map(|c|normalize(c,&bound.schema,parent,&args)).any(|c|literals(&c).contains(destination)));
                if outgoing {
                    let allowed=sources.iter().cloned().chain([destination.clone()]).collect::<BTreeSet<_>>();
                    let policy=allowed.into_iter().map(|v|binary("=",member(member(focal(),reference),&parent_state.name),string(&v))).reduce(|a,b|binary("or",a,b));
                    if let Some(policy)=policy{
                        let operation=super::super::super::operation_name(std::path::Path::new(&child_p.site.file).file_stem().and_then(|s|s.to_str()).unwrap_or(""),&child_p.name);
                        add_syntax(out,child,Some(&child_state.name),"update",policy,child_site,"parent-state",Some(operation));
                    }
                }
                // A terminal parent destination has no same-role outgoing
                // transition. Infer the child's terminal only from its graph.
                if outgoing{continue;}
                let mut assigned=BTreeSet::new();let mut from=BTreeSet::new();
                for (p,w,c) in writes.iter().filter(|(_,w,c)|roles(c,bound)==child_roles&&matches!(w,Expr::Write{op:WriteOp::Update,table:t,..} if t==child)){
                    if let Expr::Write{fields,..}=w&&let Some(value)=fields.iter().find(|f|f.name==child_state.name).and_then(|f|f.value.as_ref()){assigned.extend(literals(value));}
                    if let Some(arg)=p.args.iter().find(|a|matches!(&a.type_.kind,TypeKind::Ref{table} if table==child)){
                        let args=BTreeMap::from([(arg.name.clone(),member(focal(),"id"))]);
                        for condition in guards(c).filter_map(|c|normalize(c,&bound.schema,child,&args)) {if crate::print::expression(&condition).contains(&format!(".{}",child_state.name)){from.extend(literals(&condition));}}
                    }
                }
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
}
