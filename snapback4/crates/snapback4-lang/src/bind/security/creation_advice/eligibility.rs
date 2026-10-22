//! Eligibility suppression binds every checked column to the same created entity.
// @ref LLP 3000.036.004#169-day-two-precision-and-destructive-evidence-questions — checking the inspector is not checking the applicant.
use super::*;
pub(super) type Indexes=BTreeMap<(String,String),BTreeSet<String>>;
pub(super) fn indexes(bound:&Bound)->Indexes{
    let mut out=Indexes::new();for p in &bound.programs{for r in snapback4_core::ir::read_sites(&p.program){let site=p.sources.get(&r.site).map(|(site,_)|site.to_string()).unwrap_or(r.site);out.entry((r.table,site)).or_default().insert(r.index);}}out
}
fn primary(bound:&Bound,indexes:&Indexes,table:&str,site:&Site,keys:&[ast::KeyPart])->bool{
    if keys.len()!=1||keys[0].column.as_ref().is_some_and(|c|c!="id"){return false;}
    if keys[0].column.as_deref()==Some("id"){return true;}
    indexes.get(&(table.into(),site.to_string())).is_some_and(|names|names.len()==1&&names.iter().all(|name|bound.schema.tables[table].index(name).is_some_and(|i|i.columns()==["id"])))
}
fn read(e:&Expr)->Option<&ast::ReadExpr>{match e{Expr::Read(r)=>Some(r),Expr::Assert{value,..}=>read(value),_=>None}}
fn id_value(bound:&Bound,indexes:&Indexes,e:&Expr,p:&ast::ProgramDecl,table:&str)->Option<String>{
    match e{
        Expr::Name{name,..} if p.args.iter().any(|a|a.name==*name&&matches!(&a.type_.kind,TypeKind::Ref{table:t} if t==table))=>Some(name.clone()),
        Expr::Member{base,name,..} if name=="id"=>{let r=read(base)?;if r.table!=table||!primary(bound,indexes,table,&r.site,&r.keys){return None;}
            if r.keys[0].column.as_deref()==Some("id"){named_id(bound,indexes,&r.keys[0].value,p,table)}else{id_value(bound,indexes,&r.keys[0].value,p,table)}},
        Expr::Assert{value,..}=>id_value(bound,indexes,value,p,table),_=>None,
    }
}
fn row_id(bound:&Bound,indexes:&Indexes,r:&ast::ReadExpr,p:&ast::ProgramDecl)->Option<String>{
    if !primary(bound,indexes,&r.table,&r.site,&r.keys){return None;}if r.keys[0].column.as_deref()==Some("id"){named_id(bound,indexes,&r.keys[0].value,p,&r.table)}else{id_value(bound,indexes,&r.keys[0].value,p,&r.table)}
}
fn named_id(bound:&Bound,indexes:&Indexes,e:&Expr,p:&ast::ProgramDecl,table:&str)->Option<String>{
    match e{Expr::Literal{value:ast::Literal::Str(_),..}=>Some(crate::print::expression(e)),_=>id_value(bound,indexes,e,p,table)}
}
fn stable_field(bound:&Bound,creator:&Write<'_>,value:&Expr)->Option<String>{
    if !matches!(value,Expr::Literal{..})&&!matches!(value,Expr::Name{name,..} if name=="viewer"||creator.p.args.iter().any(|a|a.name==*name)){return None;}
    creator.fields.iter().filter(|f|bound.schema.tables[&creator.table].immutable_fields().any(|c|c==f.name)).find(|f|field_value(f).is_some_and(|e|crate::print::expression(e)==crate::print::expression(value))).map(|f|f.name.clone())
}
fn normalize(bound:&Bound,indexes:&Indexes,creator:&Write<'_>,current:&Write<'_>,e:&Expr,creation:bool)->Option<String>{
    let mut e=e.clone();let origins=if current.table==creator.table&&current.op==WriteOp::Update{
        current.keys.first().filter(|_|primary(bound,indexes,&current.table,&current.site,&current.keys)).and_then(|k|if k.column.as_deref()==Some("id"){named_id(bound,indexes,&k.value,current.p,&creator.table)}else{id_value(bound,indexes,&k.value,current.p,&creator.table)}).into_iter().collect::<BTreeSet<_>>()
    }else{
        current.fields.iter().filter(|f|matches!(bound.schema.tables[&current.table].columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==&creator.table)).map(|f|id_value(bound,indexes,field_value(f)?,current.p,&creator.table)).collect::<Option<BTreeSet<_>>>()?
    };
    if !creation&&origins.len()!=1{return None;}
    super::super::super::intent_walk::expression(&mut e,&mut |e|{
        let field=if creation{stable_field(bound,creator,e)}else if let Expr::Member{base,name,..}=e{
            read(base).filter(|_|bound.schema.tables[&creator.table].immutable_fields().any(|c|c==name)).filter(|r|r.table==creator.table&&row_id(bound,indexes,r,current.p).is_some_and(|id|origins.contains(&id))).and_then(|_|creator.fields.iter().find(|f|f.name==*name)).and_then(field_value).and_then(|v|stable_field(bound,creator,v))
        }else{None};
        if let Some(field)=field{*e=Expr::Name{name:format!("$created_{field}"),site:e.site().clone()};}
    });
    fn known(e:&Expr)->bool{match e{Expr::Literal{..}=>true,Expr::Name{name,..}=>name.starts_with("$created_"),Expr::Assert{value,..}=>known(value),_=>false}}
    known(&e).then(||crate::print::expression(&e))
}
fn identity(bound:&Bound,indexes:&Indexes,creator:&Write<'_>,current:&Write<'_>,r:&ast::ReadExpr,creation:bool)->Option<String>{
    let t=bound.schema.tables.get(&r.table)?;
    let names=indexes.get(&(r.table.clone(),r.site.to_string()))?;if names.len()!=1{return None;}
    let index=t.index(names.first()?)?;if !index.unique||!index.is_plain(){return None;}let columns=index.columns();
    let mut pins=BTreeMap::new();
    for (position,k) in r.keys.iter().enumerate(){let column=k.column.clone().or_else(||columns.get(position).cloned())?;pins.insert(column,normalize(bound,indexes,creator,current,&k.value,creation)?);}
    Some(serde_json::to_string(&columns.iter().map(|c|Some((c,pins.get(c)?))).collect::<Option<Vec<_>>>()?).unwrap())
}
pub(super) fn checks(bound:&Bound,indexes:&Indexes,creator:&Write<'_>,current:&Write<'_>,writes:&[Write<'_>],creation:bool)->BTreeMap<String,BTreeSet<(String,String)>>{
    let mut out=BTreeMap::<String,BTreeSet<(String,String)>>::new();
    if !creation&&writes.iter().any(|w|std::ptr::eq(w.p,current.p)&&w.table==creator.table&&matches!(w.op,WriteOp::Insert|WriteOp::Upsert|WriteOp::Delete)){return out;}

    let mutable=|table:&str,column:&str|bound.schema.tables.get(table).is_some_and(|t|t.columns.contains_key(column)&&!t.immutable_fields().any(|c|c==column))&&writes.iter().any(|o|o.table==table&&(o.op==WriteOp::Delete||matches!(o.op,WriteOp::Update|WriteOp::Upsert)&&o.fields.iter().any(|f|f.name==column)));
    for condition in conditions(&current.context){walk(condition,|e|{
        let (r,columns)=match e{
            Expr::Member{base,name,..}=>{let Some(r)=read(base)else{return;};(r,vec![name.clone()])},
            Expr::Exists{read:r,..}=>{let mut cols=r.keys.iter().filter_map(|k|k.column.clone()).collect::<Vec<_>>();if writes.iter().any(|o|o.table==r.table&&o.op==WriteOp::Delete){cols.push("existence".into());}(r,cols)},_=>return,
        };
        if r.table==creator.table||!super::super::privilege::role_columns(bound,&r.table).is_empty(){return;}
        let entity=match identity(bound,indexes,creator,current,r,creation){Some(entity)=>entity,None if creation=>format!("$unknown:{}",crate::print::expression(&Expr::Read(r.clone()))),None=>return};
        for column in columns{if column=="existence"||mutable(&r.table,&column){out.entry(r.table.clone()).or_default().insert((column,entity.clone()));}}
    });}out
}
