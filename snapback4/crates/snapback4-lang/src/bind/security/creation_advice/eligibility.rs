//! Eligibility suppression binds every checked column to the same created entity.
// @ref LLP 3000.036.004#169-day-two-precision-and-destructive-evidence-questions — checking the inspector is not checking the applicant.
use super::*;
fn read(e:&Expr)->Option<&ast::ReadExpr>{match e{Expr::Read(r)=>Some(r),Expr::Assert{value,..}=>read(value),_=>None}}
fn id_value(e:&Expr,p:&ast::ProgramDecl,table:&str)->Option<String>{
    match e{
        Expr::Name{name,..} if p.args.iter().any(|a|a.name==*name&&matches!(&a.type_.kind,TypeKind::Ref{table:t} if t==table))=>Some(name.clone()),
        Expr::Member{base,name,..} if name=="id"=>{let r=read(base)?;if r.table!=table||r.keys.len()!=1{return None;}
            if r.keys[0].column.as_deref()==Some("id"){Some(crate::print::expression(&r.keys[0].value))}else{id_value(&r.keys[0].value,p,table)}},
        Expr::Assert{value,..}=>id_value(value,p,table),_=>None,
    }
}
fn row_id(r:&ast::ReadExpr,p:&ast::ProgramDecl)->Option<String>{
    if r.keys.len()!=1{return None;}if r.keys[0].column.as_deref()==Some("id"){Some(crate::print::expression(&r.keys[0].value))}else{id_value(&r.keys[0].value,p,&r.table)}
}
fn stable_field(bound:&Bound,creator:&Write<'_>,value:&Expr)->Option<String>{
    creator.fields.iter().filter(|f|bound.schema.tables[&creator.table].immutable_fields().any(|c|c==f.name)).find(|f|field_value(f).is_some_and(|e|crate::print::expression(e)==crate::print::expression(value))).map(|f|f.name.clone())
}
fn normalize(bound:&Bound,creator:&Write<'_>,current:&Write<'_>,e:&Expr,creation:bool)->String{
    let mut e=e.clone();let origins=if current.table==creator.table&&current.op==WriteOp::Update{
        current.keys.first().filter(|_|current.keys.len()==1).and_then(|k|id_value(&k.value,current.p,&creator.table).or_else(||(k.column.as_deref()==Some("id")).then(||crate::print::expression(&k.value)))).into_iter().collect::<BTreeSet<_>>()
    }else{
        current.fields.iter().filter(|f|matches!(bound.schema.tables[&current.table].columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==&creator.table)).filter_map(field_value).filter_map(|e|id_value(e,current.p,&creator.table)).collect()
    };
    super::super::super::intent_walk::expression(&mut e,&mut |e|{
        let field=if creation{stable_field(bound,creator,e)}else if let Expr::Member{base,name,..}=e{
            read(base).filter(|r|r.table==creator.table&&row_id(r,current.p).is_some_and(|id|origins.contains(&id))).and_then(|_|creator.fields.iter().find(|f|f.name==*name)).and_then(field_value).and_then(|v|stable_field(bound,creator,v))
        }else{None};
        if let Some(field)=field{*e=Expr::Name{name:format!("$created_{field}"),site:e.site().clone()};}
    });crate::print::expression(&e)
}
fn identity(bound:&Bound,creator:&Write<'_>,current:&Write<'_>,r:&ast::ReadExpr,creation:bool)->Option<String>{
    let t=bound.schema.tables.get(&r.table)?;let positional=r.keys.iter().filter(|k|k.column.is_none()).collect::<Vec<_>>();let mut pins=BTreeMap::new();
    let columns=if positional.is_empty(){Vec::new()}else if positional.len()==1&&id_value(&positional[0].value,current.p,&r.table).is_some(){vec!["id".into()]}else{
        let candidates=t.indexes.values().filter(|i|i.unique&&i.is_plain()&&i.columns().len()==positional.len()&&!i.columns().iter().any(|c|c=="id")).collect::<Vec<_>>();
        let [index]=candidates.as_slice()else{return None;};index.columns()
    };
    let mut offset=0;for k in &r.keys{let column=if let Some(c)=&k.column{c.clone()}else{let c=columns.get(offset)?.clone();offset+=1;c};pins.insert(column,normalize(bound,creator,current,&k.value,creation));}
    let mut indexes=t.indexes.values().filter(|i|i.unique&&i.is_plain()&&i.columns().iter().all(|c|pins.contains_key(c))).map(|i|i.columns()).collect::<Vec<_>>();indexes.sort_by_key(|cols|(cols.len(),cols.clone()));let columns=indexes.first()?;
    Some(serde_json::to_string(&columns.iter().map(|c|(c,&pins[c])).collect::<Vec<_>>()).unwrap())
}
pub(super) fn checks(bound:&Bound,creator:&Write<'_>,current:&Write<'_>,writes:&[Write<'_>],creation:bool)->BTreeMap<String,BTreeSet<(String,String)>>{
    let mut out=BTreeMap::<String,BTreeSet<(String,String)>>::new();
    let mutable=|table:&str,column:&str|bound.schema.tables.get(table).is_some_and(|t|t.columns.contains_key(column)&&!t.immutable_fields().any(|c|c==column))&&writes.iter().any(|o|o.table==table&&(o.op==WriteOp::Delete||matches!(o.op,WriteOp::Update|WriteOp::Upsert)&&o.fields.iter().any(|f|f.name==column)));
    for condition in conditions(&current.context){walk(condition,|e|{
        let (r,columns)=match e{
            Expr::Member{base,name,..}=>{let Some(r)=read(base)else{return;};(r,vec![name.clone()])},
            Expr::Exists{read:r,..}=>{let mut cols=r.keys.iter().filter_map(|k|k.column.clone()).collect::<Vec<_>>();if writes.iter().any(|o|o.table==r.table&&o.op==WriteOp::Delete){cols.push("existence".into());}(r,cols)},_=>return,
        };
        if r.table==creator.table||!super::super::privilege::role_columns(bound,&r.table).is_empty(){return;}
        let entity=match identity(bound,creator,current,r,creation){Some(entity)=>entity,None if creation=>format!("$unknown:{}",crate::print::expression(&Expr::Read(r.clone()))),None=>return};
        for column in columns{if column=="existence"||mutable(&r.table,&column){out.entry(r.table.clone()).or_default().insert((column,entity.clone()));}}
    });}out
}
