//! Source-constructor relationships for review advice, never runtime assumptions.
// @ref LLP 3000.036.004.003#2-read-guards — complete immutable constructor copies answer source advice, never database authority.
use super::catalog::Catalog;
use crate::ast::*;
use snapback4_core::schema::{Schema,ColumnType,Constraint};
use std::collections::BTreeSet;
#[derive(Clone,Debug)]pub(super) struct Link{pub child:String,pub reference:String,pub field:String,pub parent:String,pub parent_field:String}
#[derive(Default)]pub(super) struct Model{pub links:Vec<Link>,pub writes:Vec<(Expr,ProgramDecl)>,pub complete:bool}
fn immutable(schema:&Schema,table:&str,column:&str)->bool{column=="id"||schema.tables[table].constraints.iter().any(|c|matches!(c,Constraint::Immutable{fields} if fields.contains(&column.to_string())))}
fn plain(value:&Expr)->&Expr{if let Expr::Assert{value,..}=value{plain(value)}else{value}}
fn key(value:&Expr)->String{
    let mut value=value.clone();super::intent_walk::expression(&mut value,&mut |e|if let Expr::Assert{value,..}=e{*e=*value.clone();});crate::print::expression(&value)
}
fn ref_type(value:&Expr,p:&ProgramDecl,schema:&Schema)->Option<String>{match plain(value){
    Expr::Name{name,..}=>p.args.iter().find_map(|arg|if arg.name==*name&&let TypeKind::Ref{table}=&arg.type_.kind{Some(table.clone())}else{None}),
    Expr::Member{base,name,..}=>match plain(base){Expr::Read(read)=>if name=="id"{Some(read.table.clone())}else{match schema.table(&read.table)?.columns.get(name)?.required(){ColumnType::Ref{table}=>Some(table.clone()),_=>None}},Expr::Write{table,..} if name=="id"=>Some(table.clone()),_=>None},_=>None,
}}
fn copied(value:&Expr,reference:&Expr,parent:&str,column:&str,p:&ProgramDecl,schema:&Schema)->bool{
    if let Expr::Member{base:owner,name,..}=plain(reference)&&name=="id"&&let Expr::Write{table,fields,..}=plain(owner)&&table==parent&&fields.iter().find(|f|f.name==column).is_some_and(|f|f.value.as_ref().map(|v|key(v)).unwrap_or_else(||f.name.clone())==key(value)){return true;}
    let Expr::Member{base,name,..}=plain(value)else{return false;};if name!=column{return false;}
    match plain(base){
        Expr::Read(read) if read.table==parent&&read.keys.len()==1&&read.filter.is_none()&&read.range.is_none()=>(read.keys[0].column.as_deref()==Some("id")||read.keys[0].column.is_none()&&ref_type(&read.keys[0].value,p,schema).as_deref()==Some(parent))&&(key(&read.keys[0].value)==key(reference)||matches!(plain(reference),Expr::Member{base,name,..} if name=="id"&&key(base)==key(&Expr::Read(read.clone())))),
        Expr::Write{table,..} if table==parent=>matches!(plain(reference),Expr::Member{base:owner,name,..} if name=="id"&&key(owner)==key(base)),_=>false,
    }
}
fn guarded(value:&Expr,reference:&Expr,parent:&str,column:&str,chosen:&Expr,p:&ProgramDecl,schema:&Schema)->bool{match value{
    Expr::Binary{op,left,right,..} if op=="and"=>guarded(left,reference,parent,column,chosen,p,schema)||guarded(right,reference,parent,column,chosen,p,schema),
    Expr::Binary{op,left,right,..} if op=="or"=>guarded(left,reference,parent,column,chosen,p,schema)&&guarded(right,reference,parent,column,chosen,p,schema),
    Expr::Binary{op,left,right,..} if op=="="=>[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().any(|(field,value)|key(value)==key(chosen)&&copied(field,reference,parent,column,p,schema)),_=>false,
}}
pub(super) fn derive(catalog:&Catalog,schema:&Schema)->Model{
    // Refuse expensive or effectful helper expansion before the source walk.
    // This model is optional; its budget cannot make compilation scale with
    // repeated helper expansion or recursively duplicated arguments.
    let mut nodes=0;let mut calls=Vec::new();let mut helper_effect=false;let mut sizes=std::collections::BTreeMap::new();
    for doc in &catalog.documents{super::intent_walk::document(&mut doc.clone(),&mut |e|{nodes+=1;if matches!(e,Expr::Call{name,..} if catalog.functions.contains_key(name)){calls.push(e.clone());}});}
    for function in catalog.functions.values(){let mut body=match &function.body{FunctionBody::Block(body)=>body.clone(),FunctionBody::Expression(value)=>vec![Stmt::Return{value:value.clone(),site:value.site().clone()}]};let mut size=0;super::intent_walk::statements(&mut body,&mut |e|{size+=1;if matches!(e,Expr::Write{..}){helper_effect=true;}});sizes.insert(function.name.clone(),size);}
    if nodes>4096||calls.iter().map(|call|if let Expr::Call{name,..}=call{sizes.get(name).copied().unwrap_or(1)}else{1}).sum::<usize>()>4096||helper_effect||calls.iter().any(|call|super::advisory_guards::expand(catalog,call).is_none()){return Model::default();}
    let mut programs=catalog.documents.iter().flat_map(|doc|doc.programs.clone()).collect::<Vec<_>>();
    if programs.iter().any(|p|p.native){return Model::default();}
    for function in catalog.functions.values(){programs.push(ProgramDecl{delivery:None,held:false,predicts:false,server:false,kind:ProgramKind::Mutation,name:format!("$helper:{}",function.name),args:function.args.clone(),prelude:Vec::new(),body:match &function.body{FunctionBody::Block(body)=>body.clone(),FunctionBody::Expression(value)=>vec![Stmt::Return{value:value.clone(),site:value.site().clone()}]},native:false,site:function.site.clone()});}
    let writes=programs.iter().flat_map(|p|super::security::authority_walk::advice_writes(catalog,p)).collect::<Vec<_>>();
    // Every raw construction site must be represented, including uncalled
    // helper bodies. A cut/unknown target cannot silently supply consistency.
    let resolved=writes.iter().filter_map(|(e,_)|if let Expr::Write{table,site,..}=e&&catalog.tables.contains_key(table){Some(site.to_string())}else{None}).collect::<BTreeSet<_>>();
    let mut complete=true;for doc in &catalog.documents{super::intent_walk::document(&mut doc.clone(),&mut |e|if let Expr::Write{table,site,..}=e{if !catalog.tables.contains_key(table)||!resolved.contains(&site.to_string()){complete=false;}});}
    let mut model=Model{links:Vec::new(),writes,complete};if !complete{return model;}
    for (child,t) in schema.visible_tables(){
        if t.through.is_some()||!t.maintained.is_empty(){continue;}
        for (reference,kind) in &t.columns{
            let ColumnType::Ref{table:parent}=kind else{continue;};if !immutable(schema,child,reference){continue;}
            let constructors=model.writes.iter().filter_map(|(e,p)|if let Expr::Write{op:WriteOp::Insert|WriteOp::Upsert,table,fields,keys,..}=e&&table==child{Some((e,p,fields,keys))}else{None}).collect::<Vec<_>>();
            if constructors.is_empty(){continue;}
            for field in t.columns.keys().filter(|field|*field!=reference&&immutable(schema,child,field)){
                for parent_field in schema.table(parent).into_iter().flat_map(|table|table.columns.keys()).filter(|field|immutable(schema,parent,field)){
                    let consistent=constructors.iter().all(|(e,p,fields,keys)|{
                        if fields.iter().any(|f|f.spread){return false;}
                        let Some(link)=fields.iter().find(|f|f.name==*reference).and_then(|f|f.value.as_ref()).or_else(||keys.iter().find(|key|key.column.as_deref()==Some(reference)).map(|key|&key.value))else{return false;};
                        let Some(chosen)=fields.iter().find(|f|f.name==*field).and_then(|f|f.value.as_ref())else{return false;};
                        // A parent replacement before this constructor makes a
                        // captured read insufficient. Fresh parent-write images
                        // are self-contained and may still establish the copy.
                        let prior_parent=model.writes.iter().take_while(|(other,_)|!std::ptr::eq(other,*e)).any(|(other,owner)|owner.name==p.name&&matches!(other,Expr::Write{table,..} if table==parent));
                        if prior_parent&&matches!(plain(chosen),Expr::Member{base,..} if matches!(plain(base),Expr::Read(_))){return false;}
                        copied(chosen,link,parent,parent_field,p,schema)||p.body.iter().any(|s|matches!(s,Stmt::Require{condition,..} if guarded(condition,link,parent,parent_field,chosen,p,schema)))
                    });
                    if consistent{model.links.push(Link{child:child.clone(),reference:reference.clone(),field:field.clone(),parent:parent.clone(),parent_field:parent_field.clone()});}
                }
            }
        }
    }model
}

// A visible point supplies its reader policy at this exact row, not merely raw
// existence. Unsupported policy atoms weaken to true and cannot grant advice.
pub(super) fn normalize_point(read:&mut ReadExpr,args:&[ArgDecl]){
    if read.keys.first().is_some_and(|k|k.column.is_none()&&matches!(&k.value,Expr::Name{name,..} if args.iter().any(|arg|arg.name==*name&&matches!(&arg.type_.kind,TypeKind::Ref{table} if table==&read.table))))&&read.keys.iter().skip(1).all(|k|k.column.is_some()){read.keys[0].column=Some("id".into());}
}
pub(super) fn visible_policy(catalog:&Catalog,original:&ReadExpr,args:&[ArgDecl])->Option<Expr>{
    let mut read=original.clone();
    normalize_point(&mut read,args);
    let read=&read;
    let info=catalog.tables.get(&read.table)?;let rule=info.decl.rules.iter().find(|r|r.effect==Effect::Read)?;
    let pins=super::auth_lints::pins(catalog,read)?;
    if !info.indexes.iter().any(|i|info.total_unique(i)&&i.columns.iter().all(|c|pins.contains_key(c))){return None;}
    fn scope(value:&Expr,read:&ReadExpr)->Expr{match value{
        Expr::Binary{op,left,right,site} if op=="and"||op=="or"=>Expr::Binary{op:op.clone(),left:Box::new(scope(left,read)),right:Box::new(scope(right,read)),site:site.clone()},
        Expr::Binary{op,left,right,site} if op=="="=>{
            for (field,value) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())]{if let Expr::Member{base,name,..}=field&&matches!(base.as_ref(),Expr::Focal{..})&&matches!(value,Expr::Name{name,..} if name=="viewer"){
                let mut probe=read.clone();probe.keys.push(KeyPart{column:Some(name.clone()),value:value.clone(),site:site.clone()});return Expr::Exists{read:probe,site:site.clone()};
            }}
            let mut copy=value.clone();let mut focal=false;super::intent_walk::expression(&mut copy,&mut |e|if matches!(e,Expr::Focal{..}){focal=true;});
            if focal{Expr::Literal{value:Literal::Bool(true),site:value.site().clone()}}else{value.clone()}
        },_=>{
            let mut copy=value.clone();let mut focal=false;super::intent_walk::expression(&mut copy,&mut |e|if matches!(e,Expr::Focal{..}){focal=true;});
            if focal{Expr::Literal{value:Literal::Bool(true),site:value.site().clone()}}else{value.clone()}
        },
    }}
    let mut value=super::advisory_guards::expand(catalog,&rule.value)?;
    super::program::maintain_types::normalize_rule_constants(&mut value);
    Some(scope(&value,read))
}

pub(super) fn visible_guard(catalog:&Catalog,value:&Expr,args:&[ArgDecl],positive:bool)->Expr{match value{
    Expr::Exists{read,site} if positive=>visible_policy(catalog,read,args).map(|policy|Expr::Binary{op:"and".into(),left:Box::new(value.clone()),right:Box::new(policy),site:site.clone()}).unwrap_or_else(||value.clone()),
    Expr::Unary{op,value,site} if op=="not"=>Expr::Unary{op:op.clone(),value:Box::new(visible_guard(catalog,value,args,!positive)),site:site.clone()},
    Expr::Binary{op,left,right,site} if op=="and"||op=="or"=>Expr::Binary{op:op.clone(),left:Box::new(visible_guard(catalog,left,args,positive)),right:Box::new(visible_guard(catalog,right,args,positive)),site:site.clone()},_=>value.clone(),
}}
pub(super) fn child_policy(catalog:&Catalog,table:&str,value:&Expr,pins:&std::collections::BTreeMap<String,Expr>)->Expr{
    match value{
        Expr::Binary{op,left,right,site} if op=="and"||op=="or"=>Expr::Binary{op:op.clone(),left:Box::new(child_policy(catalog,table,left,pins)),right:Box::new(child_policy(catalog,table,right,pins)),site:site.clone()},
        Expr::Binary{op,left,right,site} if op=="="=>{
            for (field,chosen) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())]{
                let Expr::Member{base,name,..}=field else{continue;};if !matches!(base.as_ref(),Expr::Focal{..})||!matches!(chosen,Expr::Name{name,..} if name=="viewer"){continue;}
                if let Some(link)=catalog.advisory.links.iter().find(|link|link.child==table&&link.field==*name&&pins.contains_key(&link.reference)){
                    let read=ReadExpr{cursor_prefix:None,computed:Default::default(),order_keys:Vec::new(),table:link.parent.clone(),index:None,keys:vec![KeyPart{column:Some("id".into()),value:pins[&link.reference].clone(),site:site.clone()},KeyPart{column:Some(link.parent_field.clone()),value:chosen.clone(),site:site.clone()}],range:None,filter:None,matching:None,seeks:Vec::new(),site:site.clone()};
                    return Expr::Exists{read,site:site.clone()};
                }
            }value.clone()
        },_=>value.clone(),
    }
}

// A source-wide monotone stamp/stage relationship is only a reason to omit a
// review question. Unknown constructors, resets or spread writes defeat it.
pub(super) fn nonnull_excludes(catalog:&Catalog,table:&str,stamp:&str,status:&str,forbidden:&Literal)->bool{
    if !catalog.advisory.complete{return false;}
    let Some(info)=catalog.tables.get(table)else{return false;};
    let mut births=0;
    for (write,_) in &catalog.advisory.writes{
        let Expr::Write{table:target,op,fields,keys,..}=write else{continue;};if target!=table{continue;}
        if fields.iter().any(|f|f.spread){return false;}
        let assigned=|column:&str|fields.iter().find(|f|f.name==column).map(|f|f.value.clone().unwrap_or_else(||Expr::Name{name:f.name.clone(),site:f.site.clone()})).or_else(||if matches!(op,WriteOp::Insert|WriteOp::Upsert){keys.iter().find(|key|key.column.as_deref()==Some(column)).map(|key|key.value.clone())}else{None});
        let state=assigned(status);let time=assigned(stamp);
        let null=matches!(&time,Some(Expr::Literal{value:Literal::Null,..}));
        let nonnull=time.is_some()&&!null;
        let other_state=matches!(&state,Some(Expr::Literal{value,..}) if value!=forbidden);
        if matches!(op,WriteOp::Insert|WriteOp::Upsert){births+=1;if nonnull&&!other_state{return false;}if time.is_none()&&info.decl.columns.iter().find(|c|c.name==stamp).is_some_and(|c|c.default.is_some()){return false;}}
        if nonnull&&!other_state{return false;}
        if state.is_some()&&!other_state&&!null{return false;}
    }births>0
}
