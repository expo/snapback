//! Conservative identity flow for rollback result projections, never object-id guessing.
// @ref LLP 3000.000.000.003#2-frozen-result-fields — shapes may preserve a proven authorized parent identity.
use snapback4_core::{ir::{Expr,Stmt,LoopDomain,Program},Value};
use std::collections::BTreeMap;
#[derive(Clone,PartialEq,Eq)]
enum Origin { Unknown, Empty, Null, Row(String), Rows(String) }
impl Origin {
    fn join(self,other:Self)->Self {
        if self==other{return self;}
        match (self,other) {
            (Self::Null,value)|(value,Self::Null)=>value,
            (Self::Empty,value@Self::Rows(_))|(value@Self::Rows(_),Self::Empty)=>value,
            _=>Self::Unknown,
        }
    }
}
type Env=BTreeMap<String,Origin>;
fn expr(value:&Expr,env:&Env)->Origin {
    match value {
        Expr::Get(read)=>Origin::Row(read.table.clone()),
        Expr::Scan(scan)=>Origin::Rows(scan.table.clone()),
        Expr::Variable(name)=>env.get(name).cloned().unwrap_or(Origin::Unknown),
        Expr::Literal(Value::Null)=>Origin::Null,
        Expr::Array(values)if values.is_empty()=>Origin::Empty,
        Expr::Shape{base,fields}=> {
            // The returned id must be the exact base's id, not an id borrowed
            // from another object/row (even one of the same table).
            if fields.get("id")!=Some(&Expr::Field{base:base.clone(),name:"id".into()}){return Origin::Unknown;}
            match expr(base,env){origin@Origin::Row(_)=>origin,_=>Origin::Unknown}
        }
        Expr::Block{body,value}=>{let mut local=env.clone();let mut returns=Vec::new();walk(body,&mut local,&mut returns);if returns.is_empty(){expr(value,&local)}else{Origin::Unknown}},
        _=>Origin::Unknown,
    }
}
fn walk(body:&[Stmt],env:&mut Env,returns:&mut Vec<Origin>) {
    for stmt in body {
        match stmt {
            Stmt::Let{name,value}|Stmt::Const{name,value}|Stmt::Assign{name,value}=>{env.insert(name.clone(),expr(value,env));},
            Stmt::Push{target,value}=>{
                let value=match expr(value,env){Origin::Row(table)=>Origin::Rows(table),_=>Origin::Unknown};
                let prior=env.get(target).cloned().unwrap_or(Origin::Unknown);env.insert(target.clone(),prior.join(value));
            }
            Stmt::If{then_body,else_body,..}=>{
                let mut left=env.clone();let mut right=env.clone();walk(then_body,&mut left,returns);walk(else_body,&mut right,returns);
                for (name,value)in env.iter_mut(){*value=left.get(name).cloned().unwrap_or(Origin::Unknown).join(right.get(name).cloned().unwrap_or(Origin::Unknown));}
            }
            Stmt::For{binding,domain,body}=>{
                let rows=match domain{LoopDomain::Page(scan)=>Origin::Rows(scan.table.clone()),LoopDomain::DerivedArray{value,..}=>expr(value,env),_=>Origin::Unknown};
                let item=match rows{Origin::Rows(table)=>Origin::Row(table),_=>Origin::Unknown};
                let mut local=env.clone();local.insert(binding.clone(),item);walk(body,&mut local,returns);
                for(name,value)in env.iter_mut(){*value=value.clone().join(local.get(name).cloned().unwrap_or(Origin::Unknown));}
            }
            Stmt::Return(value)=>returns.push(expr(value,env)),
            // A write result is not inferred here; typed ordinary row results
            // already carry their table. Unsupported producers fail closed.
            Stmt::InsertIfAbsent{result,..}|Stmt::WriteTarget{result:Some(result),..}=>{env.insert(result.clone(),Origin::Unknown);},
            _=>()
        }
    }
}
pub(super) fn table(program:&Program)->Option<String> {
    let mut returns=Vec::new();walk(&program.body,&mut Env::new(),&mut returns);
    let origin=returns.into_iter().reduce(Origin::join)?;
    match origin{Origin::Row(table)|Origin::Rows(table)=>Some(table),_=>None}
}
