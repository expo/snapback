//! Fallible diagnostic rendering: never erase a predicate to manufacture a repair.
use super::*;
use crate::{schema::Schema, Value};
use std::collections::BTreeMap;
pub(super) type Names = BTreeMap<String,String>;

pub(super) fn expr(schema: &Schema, e: &Expr, names: &Names) -> Option<String> {
    let sub = |e: &Expr| expr(schema,e,names);
    Some(match e {
        Expr::Literal(Value::String(s) | Value::Id(s)) if !s.contains('\r') => format!("'{}'",s.replace('\\',"\\\\").replace('\'',"\\'").replace('\n',"\\n").replace('\t',"\\t")),
        Expr::Literal(v @ (Value::Null | Value::Bool(_) | Value::Int(_))) => crate::wire::to_json(v).to_string(),
        Expr::Variable(s) => match names.get(s) {
            Some(value)=>value.clone(), None if !s.starts_with('$')=>s.clone(), _=>return None,
        },
        Expr::Input(input) => match input { Input::Viewer=>"viewer", Input::Now=>"now", Input::NewId=>"new", Input::ReadTime=>"read time" }.into(),
        Expr::Field { base, name } => format!("{}.{name}",sub(base)?),
        Expr::Unary { op,value } => format!("{}({})",if *op==UnaryOp::Not {"not "}else{"-"},sub(value)?),
        Expr::Binary { op,left,right } => format!("({} {} {})",sub(left)?,match op {
            BinaryOp::Eq|BinaryOp::SameValueZero=>"=", BinaryOp::Ne=>"!=", BinaryOp::Lt=>"<", BinaryOp::Lte=>"<=", BinaryOp::Gt=>">", BinaryOp::Gte=>">=",
            BinaryOp::Add=>"+", BinaryOp::Sub=>"-", BinaryOp::Mul=>"*", BinaryOp::And=>"and", BinaryOp::Or=>"or",
        },sub(right)?),
        Expr::Get(r)|Expr::Exists(r) => {
            let index=schema.tables.get(&r.table)?.index(&r.index)?;
            let keys=index.components.iter().zip(&r.key).map(|(c,e)|Some(format!("{} = {}",c.column()?,sub(e)?))).collect::<Option<Vec<_>>>()?;
            format!("{}{}[{}]",if matches!(e,Expr::Exists(_)) {"exists "}else{""},r.table,keys.join(", "))
        }
        Expr::Builtin { builtin,args } => {
            if *builtin == Builtin::Concat {
                let [left,right] = args.as_slice() else { return None };
                return Some(format!("({} + {})",sub(left)?,sub(right)?));
            }
            if let Builtin::Calendar { millis } = builtin {
                let (value,offset) = match args.as_slice() {
                    [value] => (value,0),
                    [value,Expr::Literal(Value::Int(offset))] => (value,*offset),
                    _ => return None,
                };
                if *millis <= 0 || offset < 0 || offset >= *millis { return None; }
                let mut call = match millis {
                    3_600_000 => format!("hour({}",sub(value)?),
                    86_400_000 => format!("day({}",sub(value)?),
                    _ => format!("bucket({}, {millis}ms",sub(value)?),
                };
                if offset != 0 { call.push_str(&format!(", {offset}ms")); }
                return Some(format!("{call})"));
            }
            let name=match builtin {
                Builtin::Len=>"count",Builtin::Lower=>"lower",Builtin::Trim=>"trim",Builtin::Slice=>"slice",
                // Other IR builtins have no renderer here: withhold a repair
                // rather than emit an internal name or discard its predicate.
                _=>return None,
            };
            format!("{name}({})",args.iter().map(sub).collect::<Option<Vec<_>>>()?.join(", "))
        }
        Expr::Array(items)=>format!("[{}]",items.iter().map(sub).collect::<Option<Vec<_>>>()?.join(", ")),
        Expr::Block { body,value }=>{
            let mut names=names.clone(); statements(schema,body,&mut names)?; expr(schema,value,&names)?
        }
        Expr::Scan(s)=>format!("({})",scan(schema,s,names,None,true)?),
        _=>return None,
    })
}

fn statements(schema: &Schema, body: &[Stmt], names: &mut Names) -> Option<()> {
    for stmt in body {
        match stmt {
            Stmt::Let {name,value}|Stmt::Const {name,value}|Stmt::Assign {name,value}=>{names.insert(name.clone(),expr(schema,value,names)?);}
            Stmt::If {condition,then_body,else_body}=>{
                let condition=expr(schema,condition,names)?;
                let mut yes=names.clone();let mut no=names.clone();
                statements(schema,then_body,&mut yes)?;statements(schema,else_body,&mut no)?;
                for (key,a) in &yes {
                    let b=no.get(key)?;
                    let v=if a==b {a.clone()} else if b==&condition {format!("({b} and {a})")}
                        else if a==&condition {format!("({a} or {b})")} else {format!("({a} if {condition} else {b})")};
                    names.insert(key.clone(),v);
                }
            }
            _=>return None,
        }
    }
    Some(())
}

pub(super) fn scan(schema: &Schema, s: &Scan, names: &Names, take: Option<&Bound>, cursors: bool) -> Option<String> {
    scan_mode(schema,s,names,take,cursors,false,None)
}

pub(super) fn scan_mode(schema: &Schema, s: &Scan, names: &Names, take: Option<&Bound>, cursors: bool, predicate_pins: bool, skip_pin: Option<usize>) -> Option<String> {
    let index=schema.tables.get(&s.table)?.index(&s.index)?;
    let mut keys=Vec::new();let mut matching=None;
    for (position,(part,key)) in index.components.iter().zip(&s.prefix).enumerate() {
        if skip_pin == Some(position) {continue;}
        match key {
            IndexKeyExpr::Scalar(e)=>keys.push(format!("{} = {}",part.column()?,expr(schema,e,names)?)),
            IndexKeyExpr::WordPrefix(e)=>matching=Some(expr(schema,e,names)?),
        }
    }
    if let Some(range)=&s.range {
        let column=index.components.get(s.prefix.len())?.column()?;
        for (op,value) in [(">",&range.gt),(">=",&range.gte),("<",&range.lt),("<=",&range.lte)] {
            if let Some(value)=value {keys.push(format!("{column} {op} {}",expr(schema,value,names)?));}
        }
    }
    let mut out=if predicate_pins {s.table.clone()} else {format!("{}[{}]",s.table,keys.join(", "))};
    if let Some(matching)=matching {out.push_str(&format!(" matching {matching}"));}
    if cursors {
        if let Some(after)=&s.after {out.push_str(&format!(" after {}",expr(schema,after,names)?));}
        // `before` is a physical/internal lowering without a Quarry cursor spelling.
        if s.before.is_some() {return None;}
    }
    match take.unwrap_or(&s.take) {
        Bound::Meter=>{},
        Bound::Literal(n)=>out.push_str(&format!(" {} {n}",if s.order==Order::Desc {"last"}else{"first"})),
        Bound::Arg {name,..}=>out.push_str(&format!(" {} {name}",if s.order==Order::Desc {"last"}else{"first"})),
    }
    // Keep the actual index's suffix, including non-at and compound order keys.
    let columns=index.components.iter().skip(s.prefix.len()).map(|c|Some(format!(".{}",c.column()?))).collect::<Option<Vec<_>>>()?;
    if !columns.is_empty() {out.push_str(&format!(" by {}",columns.join(", ")));}
    let mut predicates=if predicate_pins {keys.into_iter().map(|p|format!(".{p}")).collect::<Vec<_>>()} else {Vec::new()};
    if let Some(filter)=&s.filter {predicates.push(expr(schema,filter,names)?);}
    if !predicates.is_empty() {out.push_str(&format!(" where {}",predicates.join(" and ")));}
    Some(out)
}
