//! Missing approval images are uncertainty, including transaction-local births.
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — historical populations retain their focal bindings.
use super::*;
type Rows=BTreeMap<String,Vec<Value>>;
#[derive(Default)]pub(super) struct History{snapshots:Vec<Rows>,overflow:bool,deleted:bool}
impl History{pub(super) fn record(&mut self,rows:&Rows,deleted:bool){self.deleted|=deleted;if self.snapshots.len()<64{self.snapshots.push(rows.clone());}else{self.overflow=true;}}}
pub(super) fn uncertain(predicate:&ast::Expr,row:&Value,effective:&Value,rows:&Rows,entry:&Rows,schema:&Schema,viewer:&str,table:&str,now:i64,history:&History)->bool{
    fn deleted(e:&ast::Expr,focal:&Value,prior:&Rows,schema:&Schema,viewer:&str,root:&str,now:i64,present:&impl Fn(&str,&Value)->bool)->bool{
        for read in super::super::derived::approval_populations(e){
            let Some(Value::Array(selected))=super::super::concrete::value(&ast::Expr::Read(read.clone()),focal,prior,schema,viewer,root,now)else{continue;};
            if super::super::derived::local_population_approval(&read,schema)&&selected.iter().any(|old|old.field("id").ok().is_some_and(|id|!present(&read.table,id))){return true;}
            if let Some(filter)=&read.filter&&selected.iter().any(|old|deleted(filter,old,prior,schema,viewer,&read.table,now,present)){return true;}
        }false
    }
    let present=|owner:&str,id:&Value|owner==table&&effective.field("id").ok()==Some(id)||rows.get(owner).into_iter().flatten().any(|row|row.field("id").ok()==Some(id));
    for prior in std::iter::once(entry).chain(history.snapshots.iter()){
        if super::super::concrete::evaluate(predicate,row,prior,schema,viewer,table,now)==Some(true)&&deleted(predicate,row,prior,schema,viewer,table,now,&present){return true;}
    }
    // This deterministic private evidence cut is never a replayed FIX.
    history.overflow&&history.deleted&&!super::super::derived::approval_populations(predicate).is_empty()
}
