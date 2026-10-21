//! Conservative transitive write closure for pre-write policy snapshots.
// @ref LLP 3000.036.004#127-stable-judgments-and-direct-payload-witnesses — implicit writes cannot establish pre-write intent.
use super::*;
pub(super) fn implicit(bound:&Bound,p:&Program)->BTreeSet<String>{
    let mut affected=ir::write_tables(p).into_iter().map(|(t,_)|t).collect::<BTreeSet<_>>();
    // A plain update cannot trigger an on-delete cascade. Maintains, live
    // read-through retirement and expiring tables can still remove rows.
    let mut removed=ir::write_tables(p).into_iter().filter(|(t,e)|*e=="delete"||bound.schema.tables.get(t).is_some_and(|t|t.is_expiring())).map(|(t,_)|t).collect::<BTreeSet<_>>();
    let mut implicit=BTreeSet::new();
    loop{
        let before=(affected.len(),removed.len());
        for m in &bound.schema.maintains{if affected.contains(&m.source)||m.row_key.as_ref().is_some_and(|r|affected.contains(&r.table)){
            if bound.schema.table(&m.target).is_some(){implicit.insert(m.target.clone());affected.insert(m.target.clone());removed.insert(m.target.clone());}
            if let Some(owner)=&m.private{implicit.insert(owner.table.clone());affected.insert(owner.table.clone());removed.insert(owner.table.clone());}
        }}
        for (name,t) in &bound.schema.tables{
            if t.through.as_ref().is_some_and(|edge|edge.live.is_some()&&affected.contains(&edge.parent)){implicit.insert(name.clone());affected.insert(name.clone());removed.insert(name.clone());}
            for (column,action) in &t.on_delete{
            if action.writes()&&let Some(C::Ref{table})=t.columns.get(column).map(C::required)&&removed.contains(table){implicit.insert(name.clone());affected.insert(name.clone());if matches!(action,snapback4_core::schema::references::OnDelete::Cascade)||t.is_expiring(){removed.insert(name.clone());}}
        }}
        if before==(affected.len(),removed.len()){break;}
    }implicit
}

pub(super) fn dependencies(bound:&Bound,rule:&RuleExpr)->BTreeSet<String>{
    let mut deps=kernel::dependencies(rule);
    loop{let before=deps.len();for name in deps.clone(){if let Some(t)=bound.schema.table(&name){deps.extend(kernel::dependencies(&t.rules.read));if let Some(edge)=&t.through{deps.insert(edge.parent.clone());}}}if before==deps.len(){return deps;}}
}
