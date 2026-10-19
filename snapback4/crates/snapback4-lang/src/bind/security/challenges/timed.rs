//! Exercise actual logical lifetime reads between deadlines and cleanup ticks.
// @ref LLP 3000.036.004#102-temporal-intent — no snapshot-only clock refutation.
use super::*;

pub(super) fn run(bound:&Bound,out:&mut Campaign,sites:Option<&BTreeSet<String>>){
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&i.column.is_none()&&i.policy.as_ref().is_some_and(super::super::temporal::has_clock)
        && sites.is_none_or(|s|s.contains(&i.site.to_string()))) {
        let policy=inv.policy.as_ref().unwrap();
        if policy.has_reference(){out.unsupported.insert(format!("{}: temporal reference policy needs authorized per-tick engine replay",inv.table));continue;}
        if !kernel::dependencies(policy).is_empty(){out.unsupported.insert(format!("{}: clock policy with raw-probe dependencies needs a live-snapshot evaluator",inv.table));continue;}
        let name="$security.temporal";
        let probe=program(name,ProgramKind::Query,vec![Stmt::Return(Expr::Get(Read{site:"temporal security".into(),table:inv.table.clone(),index:"byId".into(),
            key:vec![Expr::Literal(id(&inv.table))],provenance:KeyProvenance::Computed}))]);
        for variant in [0,4] {
            if !out.reserve(1){return;}
            let rows=match snapshot_mode(bound,inv,variant,true){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);continue;}};
            for now in [NOW,NOW+999,NOW+1000,NOW+1001,NOW+1999,NOW+2000,NOW+2001] {
                // Recreate the store for each boundary; never sweep before the
                // read. Unswept expiry remains a logical absence by contract.
                let mut engine=match engine(bound,&rows,probe.clone()){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);continue;}};
                let actual=match readback(&engine){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);continue;}};
                let Some(row)=actual.get(&inv.table).and_then(|rs|rs.first())else{continue;};
                for viewer in [VIEWER,OTHER] {
                    out.attempted+=1;
                    let Ok(q)=engine.query(name,Context::new(viewer,BTreeMap::new()).at(now))else{continue;};
                    if q.unavailable||!q.complete||q.data==Value::Null{continue;}
                    // Scalar clock atoms are evaluated only after a real
                    // engine read returned this committed row. This extra
                    // field is proof-private and never enters the store.
                    let mut image=row.clone();
                    if let Value::Row(fields)=&mut image {fields.insert("$security:server-clock".into(),Value::Int(now));}
                    if matches!(rules::evaluate(policy,viewer,None,&image,false,&mut Snapshot{schema:&bound.schema,rows:&actual}),Ok(false)) {
                        out.admitted+=1;
                        out.violations.push(Counterexample {reachability:Reachability::SyntheticOperation,history:Vec::new(),observations:None,invariant_site:inv.site.to_string(),args:BTreeMap::new(),viewer:viewer.into(),operation:name.into(),
                            effect:"read".into(),row:row.clone(),old:None,supporting_rows:actual.clone(),rule_path:format!("server read at {now}, before any physical sweep; clock policy false"),
                            scope:"actual engine read over schema-valid committed seed ingress at the recorded server clock; schedules are not assumed to have run".into()});
                        break;
                    }
                }
            }
        }
    }
}
