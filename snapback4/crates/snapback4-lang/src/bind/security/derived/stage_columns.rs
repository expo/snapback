//! Workflow discriminators are identified by guarded transitions, not spelling.
// @ref LLP 3000.036.004.000#12-wave-28-inference-and-visible-evidence — preserve data checks while omitting lifecycle admission.
use super::*;
pub(super) fn collect(catalog:&Catalog,bound:&Bound)->BTreeSet<(String,String)>{
    let mut observations=BTreeMap::<(String,String),BTreeSet<String>>::new();
    for p in catalog.documents.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ast::ProgramKind::Mutation){
        for (write,context) in authority_walk::writes(catalog,p){
            let ast::Expr::Write{op:ast::WriteOp::Update|ast::WriteOp::Upsert,table,keys,fields,..}=write else{continue;};
            let Some(definition)=bound.schema.table(&table)else{continue;};
            for field in fields.iter().filter(|field|matches!(definition.columns.get(&field.name).map(snapback4_core::schema::ColumnType::required),Some(snapback4_core::schema::ColumnType::Enum{..}|snapback4_core::schema::ColumnType::Text{..}))){
                if field.value.as_ref().is_none_or(|value|row_input_copy(value,&table,&keys,p,&field.name)){continue;}
                for stmt in &context.body{if let ast::Stmt::Require{condition,..}=stmt{
                    let mut condition=condition.clone();super::super::super::intent_walk::expression(&mut condition,&mut |e|{
                        if let ast::Expr::Binary{op,left,right,..}=e&&matches!(op.as_str(),"="|"!=")&&[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().any(|(a,b)|matches!(a,ast::Expr::Member{base,name,..} if name==&field.name&&same_resource(base,&table,&keys,p))&&matches!(b,ast::Expr::Literal{value:ast::Literal::Str(value),..} if !value.is_empty())){for value in [left.as_ref(),right.as_ref()]{if let ast::Expr::Literal{value:ast::Literal::Str(value),..}=value{observations.entry((table.clone(),field.name.clone())).or_default().insert(value.clone());}}}
                    });
                }}
            }
        }
    }observations.into_iter().filter(|(_,states)|states.len()>1).map(|(column,_)|column).collect()
}

/// Scope omission to a discriminator's multi-state admission check in this
/// selected-row invocation. A staged column's unrelated single-value data
/// inspection remains evidence even when other mutations transition it.
pub(super) fn admissions(stages:&BTreeSet<(String,String)>,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,context:&ast::ProgramDecl,fields:&[ast::ObjectField],bound:&Bound)->BTreeSet<String>{
    let subjects=fields.iter().filter(|field|bound.schema.tables[table].columns.get(&field.name).is_some_and(|kind|named_approval(&field.name,kind)&&fresh_recording(kind,field.value.as_ref()))).map(|field|subject::stem(&field.name)).filter(|stem|!stem.is_empty()&&bound.schema.tables[table].columns.keys().any(|column|!column.to_lowercase().contains("approv")&&subject::same(stem,column))).collect::<BTreeSet<_>>();
    let mut values=BTreeMap::<String,BTreeSet<String>>::new();
    for stmt in &context.body{if let ast::Stmt::Require{condition,..}=stmt{
        let mut condition=condition.clone();super::super::super::intent_walk::expression(&mut condition,&mut |e|if let ast::Expr::Binary{op,left,right,..}=e&&matches!(op.as_str(),"="|"!="){
            for (field,value) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())]{if let ast::Expr::Member{base,name,..}=field&&same_resource(base,table,keys,p)&&stages.contains(&(table.into(),name.clone()))&&let ast::Expr::Literal{value:ast::Literal::Str(value),..}=value&&!value.is_empty(){values.entry(name.clone()).or_default().insert(value.clone());}}
        });
    }}values.into_iter().filter(|(column,values)|!subjects.iter().any(|stem|subject::same(stem,column))&&(values.len()>1||!subjects.is_empty())).map(|(name,_)|name).collect()
}
