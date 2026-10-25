//! Workflow discriminators are identified by guarded transitions, not spelling.
// @ref LLP 3000.036.004.000#12-wave-28-inference-and-visible-evidence — preserve data checks while omitting lifecycle admission.
use super::*;
// A guard can force a literal assignment to be a no-op, including negated
// comparisons and Boolean alternatives. Project only this selected field;
// unrelated role/argument checks stay unknown rather than becoming grants.
fn projects(e:&ast::Expr,old:Option<&str>,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,column:&str)->Option<bool>{
    match e{
        ast::Expr::Literal{value:ast::Literal::Bool(value),..}=>Some(*value),
        ast::Expr::Unary{op,value,..} if op=="not"=>projects(value,old,table,keys,p,column).map(|v|!v),
        ast::Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{let a=projects(left,old,table,keys,p,column);let b=projects(right,old,table,keys,p,column);let decisive=op=="or";if a==Some(decisive)||b==Some(decisive){Some(decisive)}else if a.is_some()&&b.is_some(){Some(!decisive)}else{None}},
        ast::Expr::Binary{op,left,right,..} if op=="="||op=="!="=>{if let (ast::Expr::Literal{value:ast::Literal::Str(a),..},ast::Expr::Literal{value:ast::Literal::Str(b),..})=(left.as_ref(),right.as_ref()){return Some((a==b)==(op=="="));}if let (Some(a),Some(b))=(projects(left,old,table,keys,p,column),projects(right,old,table,keys,p,column)){return Some((a==b)==(op=="="));}[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].into_iter().find_map(|(field,value)|if let ast::Expr::Member{base,name,..}=field&&name==column&&same_resource(base,table,keys,p)&&let ast::Expr::Literal{value:ast::Literal::Str(value),..}=value{Some((old==Some(value.as_str()))==(op=="="))}else{None})},_=>None,
    }
}
// Project selected-field atoms before asking whether independent conditions
// may admit an old value. Residual selected-field predicates stay opaque.
fn feasible(condition:&ast::Expr,old:Option<&str>,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,column:&str)->bool{
    if let Some(value)=projects(condition,old,table,keys,p,column){return value;}
    let mut expression=condition.clone();super::super::super::intent_walk::expression(&mut expression,&mut |e|if let Some(value)=projects(e,old,table,keys,p,column){*e=ast::Expr::Literal{value:ast::Literal::Bool(value),site:e.site().clone()};});
    expression=super::super::creation_advice::simplify_boolean(&expression);
    if matches!(expression,ast::Expr::Literal{value:ast::Literal::Bool(false),..}){return false;}
    let mut related=false;super::super::super::intent_walk::expression(&mut expression,&mut |e|if let ast::Expr::Member{base,name,..}=e&&name==column&&same_resource(base,table,keys,p){related=true;});!related
}
// Source witnesses for a changing consumer. Resolve conditional/local stage
// destinations; for an enum argument, project that chosen value into guards.
pub(super) fn changing_consumer(value:&ast::Expr,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,context:&ast::ProgramDecl,column:&str,bound:&Bound)->bool{
    fn destinations(e:&ast::Expr,old:Option<&str>,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,context:&ast::ProgramDecl,column:&str,depth:usize)->Vec<(String,Option<String>)>{
        if depth>16{return Vec::new();}
        match e{
            ast::Expr::Literal{value:ast::Literal::Str(value),..}=>vec![(value.clone(),None)],
            ast::Expr::Name{name,..}=>{
                if let Some(arg)=p.args.iter().find(|arg|arg.name==*name){return if let ast::TypeKind::Enum{variants}=&arg.type_.kind{variants.iter().map(|value|(value.clone(),Some(name.clone()))).collect()}else{Vec::new()};}
                context.prelude.iter().chain(&context.body).chain(&p.prelude).chain(&p.body).find_map(|stmt|if let ast::Stmt::Bind{names,value,..}=stmt&&names.as_slice()==[name.clone()]{Some(destinations(value,old,table,keys,p,context,column,depth+1))}else{None}).unwrap_or_default()
            },
            ast::Expr::If{condition,then,otherwise,..}=>match projects(condition,old,table,keys,p,column){Some(true)=>destinations(then,old,table,keys,p,context,column,depth+1),Some(false)=>destinations(otherwise,old,table,keys,p,context,column,depth+1),None=>Vec::new()},_=>Vec::new(),
        }
    }
    let mut known=BTreeSet::new();for stmt in &context.body{if let ast::Stmt::Require{condition,..}=stmt{let mut e=condition.clone();super::super::super::intent_walk::expression(&mut e,&mut |e|if let ast::Expr::Literal{value:ast::Literal::Str(value),..}=e{known.insert(value.clone());});}}
    let olds=match bound.schema.tables[table].columns[column].required(){snapback4_core::schema::ColumnType::Enum{variants}=>variants.iter().map(|value|Some(value.as_str())).collect::<Vec<_>>(),_=>known.iter().map(|value|Some(value.as_str())).chain([None]).collect()};
    olds.into_iter().any(|old|destinations(value,old,table,keys,p,context,column,0).into_iter().any(|(destination,arg)|old!=Some(destination.as_str())&&context.body.iter().all(|stmt|{
        let ast::Stmt::Require{condition,..}=stmt else{return true;};let mut condition=condition.clone();if let Some(arg)=&arg{super::super::super::intent_walk::expression(&mut condition,&mut |e|if matches!(e,ast::Expr::Name{name,..} if name==arg){*e=ast::Expr::Literal{value:ast::Literal::Str(destination.clone()),site:e.site().clone()};});}feasible(&condition,old,table,keys,p,column)
    })))
}
pub(super) fn collect(catalog:&Catalog,bound:&Bound)->BTreeSet<(String,String)>{
    let mut observations=BTreeMap::<(String,String),BTreeSet<String>>::new();
    for p in catalog.documents.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ast::ProgramKind::Mutation){
        for (write,context) in authority_walk::writes(catalog,p){
            let ast::Expr::Write{op:ast::WriteOp::Update|ast::WriteOp::Upsert,table,keys,fields,..}=write else{continue;};
            let Some(definition)=bound.schema.table(&table)else{continue;};
            for field in fields.iter().filter(|field|matches!(definition.columns.get(&field.name).map(snapback4_core::schema::ColumnType::required),Some(snapback4_core::schema::ColumnType::Enum{..}|snapback4_core::schema::ColumnType::Text{..}))){
                if field.value.as_ref().is_none_or(|value|row_input_copy(value,&table,&keys,p,&field.name)){continue;}
                let mut guarded=false;let mut states=BTreeSet::new();
                for stmt in &context.body{if let ast::Stmt::Require{condition,..}=stmt{
                    let mut condition=condition.clone();super::super::super::intent_walk::expression(&mut condition,&mut |e|{
                        if let ast::Expr::Binary{op,left,right,..}=e&&matches!(op.as_str(),"="|"!=")&&[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().any(|(a,b)|matches!(a,ast::Expr::Member{base,name,..} if name==&field.name&&same_resource(base,&table,&keys,p))&&matches!(b,ast::Expr::Literal{value:ast::Literal::Str(value),..} if !value.is_empty())){guarded=true;for value in [left.as_ref(),right.as_ref()]{if let ast::Expr::Literal{value:ast::Literal::Str(value),..}=value{states.insert(value.clone());}}}
                    });
                }}
                // Only a witnessed literal destination establishes a transition. An
                // opaque condition involving this field is not evidence of a
                // possible change; role/other-field conditions stay independent.
                if guarded&&let Some(ast::Expr::Literal{value:ast::Literal::Str(value),..})=&field.value&&!value.is_empty(){
                    let possible=match definition.columns[&field.name].required(){snapback4_core::schema::ColumnType::Enum{variants}=>variants.iter().map(|value|Some(value.as_str())).collect::<Vec<_>>(),_=>states.iter().map(|value|Some(value.as_str())).chain([None]).collect()};
                    let changes=possible.into_iter().any(|old|old!=Some(value.as_str())&&context.body.iter().all(|stmt|match stmt{ast::Stmt::Require{condition,..}=>feasible(condition,old,&table,&keys,p,&field.name),_=>true}));
                    if !changes{continue;}states.insert(value.clone());
                }else{continue;}
                if guarded{observations.entry((table.clone(),field.name.clone())).or_default().extend(states);}
            }
        }
    }observations.into_iter().filter(|(_,states)|states.len()>1).map(|(column,_)|column).collect()
}

/// Scope omission to a discriminator's multi-state admission check in this
/// selected-row invocation. A staged column's unrelated single-value data
/// inspection remains evidence even when other mutations transition it.
pub(super) fn admissions(catalog:&Catalog,stages:&BTreeSet<(String,String)>,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,context:&ast::ProgramDecl,fields:&[ast::ObjectField],bound:&Bound)->BTreeSet<String>{
    let subjects=fields.iter().filter(|field|bound.schema.tables[table].columns.get(&field.name).is_some_and(|kind|named_approval(&field.name,kind)&&fresh_recording(kind,field.value.as_ref()))).map(|field|subject::stem(&field.name)).filter(|stem|!stem.is_empty()&&bound.schema.tables[table].columns.keys().any(|column|!["approv","authoriz"].iter().any(|part|column.to_lowercase().contains(part))&&subject::same(stem,column))).collect::<BTreeSet<_>>();
    let mut values=BTreeMap::<String,BTreeSet<String>>::new();
    for stmt in &context.body{if let ast::Stmt::Require{condition,..}=stmt{
        let mut condition=condition.clone();super::super::super::intent_walk::expression(&mut condition,&mut |e|if let ast::Expr::Binary{op,left,right,..}=e&&matches!(op.as_str(),"="|"!="){
            for (field,value) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())]{if let ast::Expr::Member{base,name,..}=field&&same_resource(base,table,keys,p)&&stages.contains(&(table.into(),name.clone()))&&let ast::Expr::Literal{value:ast::Literal::Str(value),..}=value&&!value.is_empty(){values.entry(name.clone()).or_default().insert(value.clone());}}
        });
    }}values.into_iter().filter(|(column,values)|!subjects.iter().any(|stem|subject::same(stem,column))&&(values.len()>1||!subjects.is_empty()||{
        let recordings=fields.iter().filter(|field|bound.schema.tables[table].columns.get(&field.name).is_some_and(|kind|named_approval(&field.name,kind)&&fresh_recording(kind,field.value.as_ref()))).map(|field|subject::stem(&field.name)).collect::<BTreeSet<_>>();
        let stamps=fields.iter().filter(|field|bound.schema.tables[table].columns.get(&field.name).is_some_and(|kind|stamps::evidence(&field.name,kind)&&recordings.contains(&subject::stem(&field.name))&&(fresh_recording(kind,field.value.as_ref())||(matches!(kind.required(),snapback4_core::schema::ColumnType::Principal)&&field.value.as_ref().is_some_and(|value|matches!(value,ast::Expr::Name{name,..} if name=="viewer")))))).map(|field|field.name.as_str()).collect::<BTreeSet<_>>();
        !stamps.is_empty()&&catalog.documents.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ast::ProgramKind::Mutation).any(|p|authority_walk::writes(catalog,p).iter().any(|(write,context)|{
            let ast::Expr::Write{op:ast::WriteOp::Update,table:target,keys,fields,..}=write else{return false;};
            target==table&&fields.iter().any(|field|field.name==*column&&field.value.as_ref().is_some_and(|value|!row_input_copy(value,table,keys,p,column)&&changing_consumer(value,table,keys,p,context,column,bound)))&&context.body.iter().any(|stmt|{
                let ast::Stmt::Require{condition,..}=stmt else{return false;};workflow::approval_receipts(condition).iter().any(|receipt|{let mut receipt=receipt.clone();let mut found=false;super::super::super::intent_walk::expression(&mut receipt,&mut |e|if let ast::Expr::Member{base,name,..}=e&&stamps.contains(name.as_str())&&same_resource(base,table,keys,p){found=true;});found})
            })
        }))
    })).map(|(name,_)|name).collect()
}
