//! Partial typed row-policy interpreter, never used to establish a proof.
// @ref LLP 3000.036.004#81-exact-conservative-boundary-review-clarification — unknown/unsupported is not false.
use super::*;
use crate::ast::{Expr,Literal};
use snapback4_core::Value;
type Rows=BTreeMap<String,Vec<Value>>;
fn boolean(v:Option<Value>)->Option<bool>{match v{Some(Value::Bool(v))=>Some(v),_=>None}}
pub(super) fn evaluate(expr:&Expr,row:&Value,rows:&Rows,schema:&Schema,viewer:&str)->Option<bool>{boolean(value(expr,row,rows,schema,viewer))}
fn value(e:&Expr,row:&Value,rows:&Rows,schema:&Schema,viewer:&str)->Option<Value>{Some(match e{
    Expr::Name{name,..} if name=="viewer"=>Value::Id(viewer.into()),
    Expr::Literal{value,..}=>match value{Literal::Str(s)=>Value::String(s.clone()),Literal::Bool(v)=>Value::Bool(*v),Literal::Null=>Value::Null,Literal::Number(s)=>Value::Int(s.parse().ok()?)},
    Expr::Focal{..}=>row.clone(),
    Expr::Member{base,name,..} if matches!(base.as_ref(),Expr::Focal{..})=>row.field(name).ok()?.clone(),
    Expr::Unary{op,value:x,..} if op=="not"=>Value::Bool(!boolean(value(x,row,rows,schema,viewer))?),
    Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{
        let a=boolean(value(left,row,rows,schema,viewer));let b=boolean(value(right,row,rows,schema,viewer));
        let and=op=="and";let decisive=!and;
        Value::Bool(if a==Some(decisive)||b==Some(decisive){decisive}else if a.is_some()&&b.is_some(){and}else{return None;})
    },
    Expr::Binary{op,left,right,..}=>{
        let a=value(left,row,rows,schema,viewer)?;let b=value(right,row,rows,schema,viewer)?;
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
        let Value::Array(values)=value(&args[0],row,rows,schema,viewer)?else{return None;};
        Value::Int(values.len().try_into().ok()?)
    },
    Expr::Call{name,args,..} if name=="sum"&&args.len()==2 => {
        let Value::Array(values)=value(&args[0],row,rows,schema,viewer)?else{return None;};
        let sum=values.iter().try_fold(0i128,|sum,r|match value(&args[1],r,rows,schema,viewer)? {Value::Int(n)=>sum.checked_add(i128::from(n)),_=>None})?;
        Value::int(sum).ok()?
    },
    Expr::Array{items,..}=>Value::Array(items.iter().map(|e|value(e,row,rows,schema,viewer)).collect::<Option<_>>()?),
    Expr::Read(read)|Expr::Exists{read,..}=>{
        let t=schema.table(&read.table)?;
        if t.is_expiring()||t.not_before.is_some()||t.through.is_some()||schema.maintain_for(&read.table).is_some()||read.filter.is_some()||read.range.is_some()||!read.seeks.is_empty()||read.matching.is_some(){return None;}
        let mut pins=Vec::new();
        for key in &read.keys{let column=key.column.as_ref()?;let val=value(&key.value,row,rows,schema,viewer)?;
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
        let selected=rows.get(&read.table).into_iter().flatten().filter(|r|pins.iter().all(|(c,v)|r.field(c).ok()==Some(v))).cloned().collect::<Vec<_>>();
        if matches!(e,Expr::Exists{..}) {Value::Bool(!selected.is_empty())}else{Value::Array(selected)}
    },
    _=>return None,
})}
