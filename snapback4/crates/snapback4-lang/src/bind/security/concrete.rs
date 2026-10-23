//! Partial typed row-policy interpreter, never used to establish a proof.
// @ref LLP 3000.036.004#81-exact-conservative-boundary-review-clarification — unknown/unsupported is not false.
use super::*;
use crate::ast::{Expr,Literal};
use snapback4_core::Value;
type Rows=BTreeMap<String,Vec<Value>>;
fn boolean(v:Option<Value>)->Option<bool>{match v{Some(Value::Bool(v))=>Some(v),_=>None}}
pub(super) fn evaluate(expr:&Expr,row:&Value,rows:&Rows,schema:&Schema,viewer:&str,table:&str,now:i64)->Option<bool>{boolean(value(expr,row,rows,schema,viewer,table,now))}
fn value(e:&Expr,row:&Value,rows:&Rows,schema:&Schema,viewer:&str,table:&str,now:i64)->Option<Value>{Some(match e{
    Expr::Name{name,..} if name=="now"=>Value::Int(now),
    Expr::Name{name,..} if name=="viewer"=>Value::Id(viewer.into()),
    Expr::Literal{value,..}=>match value{Literal::Str(s)=>Value::String(s.clone()),Literal::Bool(v)=>Value::Bool(*v),Literal::Null=>Value::Null,Literal::Number(_)=>Value::Int(super::creation_advice::duration_number(e)?)},
    Expr::Focal{..}=>row.clone(),
    Expr::Member{base,name,..} if matches!(base.as_ref(),Expr::Focal{..})=>row.field(name).ok()?.clone(),
    Expr::Member{base,name,..}=>{
        let Value::Id(id)=value(base,row,rows,schema,viewer,table,now)? else{return None;};
        let target=reference_table(base,schema,table)?;
        let parent=rows.get(target)?.iter().find(|r|r.field("id").ok()==Some(&Value::Id(id.clone())))?;
        if !logical_live(schema,rows,target,parent,now,0)?{return None;}
        parent.field(name).ok()?.clone()
    },
    Expr::Unary{op,value:x,..} if op=="not"=>Value::Bool(!boolean(value(x,row,rows,schema,viewer,table,now))?),
    Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{
        let a=boolean(value(left,row,rows,schema,viewer,table,now));let b=boolean(value(right,row,rows,schema,viewer,table,now));
        let and=op=="and";let decisive=!and;
        Value::Bool(if a==Some(decisive)||b==Some(decisive){decisive}else if a.is_some()&&b.is_some(){and}else{return None;})
    },
    Expr::Binary{op,left,right,..}=>{
        let a=value(left,row,rows,schema,viewer,table,now)?;let b=value(right,row,rows,schema,viewer,table,now)?;
        if matches!(op.as_str(),"+"|"-"|"*") {
            let (Value::Int(a),Value::Int(b))=(a,b)else{return None;};
            let n=match op.as_str(){"+"=>i128::from(a)+i128::from(b),"-"=>i128::from(a)-i128::from(b),_=>i128::from(a)*i128::from(b)};
            return Value::int(n).ok();
        }
        // The binder contextually types principal/id literals. This partial
        // evaluator refuses that coercion rather than using host strings.
        if !matches!((&a,&b),(Value::Id(_),Value::Id(_))|(Value::String(_),Value::String(_))|(Value::Int(_),Value::Int(_))|(Value::Bool(_),Value::Bool(_))|(Value::Null,_)|(_,Value::Null)){return None;}
        Value::Bool(match op.as_str(){"="=>a==b,"!="=>a!=b,"<"|"<="|">"|">="=>if let (Value::Int(a),Value::Int(b))=(a,b){match op.as_str(){"<"=>a<b,"<="=>a<=b,">"=>a>b,_=>a>=b}}else{return None;},_=>return None})
    },
    Expr::Call{name,args,..} if (name=="count"||name=="len")&&args.len()==1 => {
        let Value::Array(values)=value(&args[0],row,rows,schema,viewer,table,now)?else{return None;};
        Value::Int(values.len().try_into().ok()?)
    },
    Expr::Call{name,args,..} if name=="sum"&&args.len()==2 => {
        let Value::Array(values)=value(&args[0],row,rows,schema,viewer,table,now)?else{return None;};
        let Expr::Read(population)=&args[0]else{return None;};
        let sum=values.iter().try_fold(0i128,|sum,r|match value(&args[1],r,rows,schema,viewer,&population.table,now)? {Value::Int(n)=>sum.checked_add(i128::from(n)),_=>None})?;
        Value::int(sum).ok()?
    },
    Expr::Array{items,..}=>Value::Array(items.iter().map(|e|value(e,row,rows,schema,viewer,table,now)).collect::<Option<_>>()?),
    Expr::Read(read)|Expr::Exists{read,..}=>{
        let t=schema.table(&read.table)?;
        if schema.maintain_for(&read.table).is_some()||read.filter.is_some()||read.range.is_some()||!read.seeks.is_empty()||read.matching.is_some(){return None;}
        let mut pins=Vec::new();
        for key in &read.keys{let column=key.column.as_ref()?;let val=value(&key.value,row,rows,schema,viewer,table,now)?;
            let kind=t.columns.get(column)?;
            use snapback4_core::schema::ColumnType as C;
            let typed=match (kind.required(),&val) {
                (_,Value::Null)=>kind.is_optional(),
                (C::Id|C::Principal|C::Ref{..},Value::Id(_))=>true,
                (C::Text{..},Value::String(_))=>true,
                (C::Enum{variants},Value::String(v))=>variants.contains(v),
                (C::Int|C::IntRange{..}|C::Time,Value::Int(_))=>true,
                (C::Bool,Value::Bool(_))=>true,_=>false,
            };
            if !typed{return None;}pins.push((column,val));}
        // Integrity assertions quantify over the complete raw snapshot, not
        // a caller-filtered program population. Temporal/captured populations
        // above remain unsupported. No solver proof uses these samples.
        let mut selected=Vec::new();
        for r in rows.get(&read.table).into_iter().flatten() {
            if pins.iter().all(|(c,v)|r.field(c).ok()==Some(v)) && logical_live(schema,rows,&read.table,r,now,0)? {selected.push(r.clone());}
        }
        if matches!(e,Expr::Exists{..}) {Value::Bool(!selected.is_empty())}else{Value::Array(selected)}
    },
    _=>return None,
})}

/// Syntactic capabilities of this partial evaluator, independent of fixture
/// reachability. Unknown is never silently counted as an evaluated invariant.
pub(super) fn limitations(expr:&Expr,schema:&Schema,table:&str)->BTreeSet<String>{
    let mut out=BTreeSet::new();let mut expr=expr.clone();
    super::super::intent_walk::expression(&mut expr,&mut |e|match e{
        Expr::Name{name,..} if name=="viewer"||name=="now"=>{},
        Expr::Name{name,..}=>{out.insert(if name=="now"{"clock expression is outside the concrete invariant evaluator".into()}else{format!("unbound concrete name {name}")});},
        Expr::Literal{value:Literal::Number(_),..} if super::creation_advice::duration_number(e).is_none()=>{out.insert("typed duration/decimal literal is outside the concrete invariant evaluator".into());},
        Expr::Literal{..}|Expr::Focal{..}|Expr::Array{..}=>{},
        Expr::Member{base,..} if matches!(base.as_ref(),Expr::Focal{..})=>{},
        Expr::Member{base,..} if reference_table(base,schema,table).is_some()=>{},
        Expr::Member{..}=>{out.insert("member is not a typed table reference".into());},
        Expr::Unary{op,..} if op=="not"=>{},
        Expr::Binary{left,right,..} if [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().any(|(a,b)|matches!(b,Expr::Literal{value:Literal::Str(_),..})&&matches!(a,Expr::Member{base,name,..} if matches!(base.as_ref(),Expr::Focal{..})&&schema.tables.get(table).and_then(|t|t.columns.get(name)).is_some_and(|k|matches!(k.required(),snapback4_core::schema::ColumnType::Id|snapback4_core::schema::ColumnType::Principal|snapback4_core::schema::ColumnType::Ref{..}))))=>{out.insert("contextual principal/id string coercion is outside the concrete invariant evaluator".into());},
        Expr::Binary{op,..} if ["and","or","+","-","*","=","!=","<","<=",">",">="].contains(&op.as_str())=>{},
        Expr::Call{name,args,..} if ((name=="count"||name=="len")&&args.len()==1)||(name=="sum"&&args.len()==2)=>{},
        Expr::Read(read)|Expr::Exists{read,..}=>{
            if schema.maintain_for(&read.table).is_some(){out.insert(format!("{}: read-through/temporal/maintained population is outside the raw concrete evaluator",read.table));}
            if read.keys.iter().any(|k|k.column.is_none())||read.filter.is_some()||read.range.is_some()||!read.seeks.is_empty()||read.matching.is_some(){out.insert(format!("{}: concrete population needs named equality keys without filter/range/search",read.table));}
        },_=>{out.insert("expression form is outside the concrete invariant evaluator".into());}
    });out
}

fn reference_table<'a>(expr:&Expr,schema:&'a Schema,table:&'a str)->Option<&'a str>{
    match expr {
        Expr::Focal{..}=>Some(table),
        Expr::Member{base,name,..}=>{
            let owner=reference_table(base,schema,table)?;
            match schema.tables.get(owner)?.columns.get(name)?.required(){snapback4_core::schema::ColumnType::Ref{table}=>Some(table),_=>None}
        },_=>None
    }
}
fn logical_live(schema:&Schema,rows:&Rows,table:&str,row:&Value,now:i64,depth:usize)->Option<bool>{
    if depth>32{return None;}
    let t=schema.table(table)?;
    if t.expired(row,now){return Some(false);}
    if let Some(c)=&t.not_before {match row.field(c).ok()? {Value::Int(n) if *n>now=>return Some(false),Value::Int(_)|Value::Null=>{},_=>return None}}
    if let Some(through)=&t.through {
        let id=row.field(&through.reference).ok()?;
        let parent=rows.get(&through.parent)?.iter().find(|r|r.field("id").ok()==Some(id));
        let Some(parent)=parent else{return Some(false);};
        return logical_live(schema,rows,&through.parent,parent,now,depth+1);
    }
    Some(true)
}

#[cfg(test)]mod tests{
    use super::*;
    use snapback4_core::value::object;
    #[test]fn sum_reference_hops_use_the_population_element_type(){
        let source="table projectOwners:\n  limit: int\n  read <- allow\n  online only\ntable itemOwners:\n  limit: int\n  read <- allow\n  online only\ntable projects:\n  owner: projectOwners\n  read <- allow\n  online only\ntable items:\n  project: projects\n  owner: itemOwners\n  read <- allow\n  online only\ninvariant projects always sum(items[project = .id], .owner.limit) = 7\n";
        let b=crate::compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let project=object([("id",Value::Id("p".into())),("owner",Value::Id("same-id".into()))]);
        let rows=BTreeMap::from([
            ("projects".into(),vec![project.clone()]),
            ("projectOwners".into(),vec![object([("id",Value::Id("same-id".into())),("limit",Value::Int(0))])]),
            ("itemOwners".into(),vec![object([("id",Value::Id("same-id".into())),("limit",Value::Int(7))])]),
            ("items".into(),vec![object([("id",Value::Id("item".into())),("project",Value::Id("p".into())),("owner",Value::Id("same-id".into()))])]),
        ]);
        assert_eq!(evaluate(b.invariants[0].syntax.as_ref().unwrap(),&project,&rows,&b.schema,"viewer","projects",super::super::challenges::NOW),Some(true));
    }
}
