//! Paired logical observations, replayed independently in memory.
// @ref LLP 3000.036.004#101-separate-observer-obligations — two valid worlds and repeatable observations are required.
use super::*;

#[derive(Clone,Debug,Serialize,serde::Deserialize)]
pub struct Observations {
    pub present: serde_json::Value,
    pub absent: serde_json::Value,
    pub absent_rows: BTreeMap<String,Vec<Value>>,
}

pub(super) fn observe(engine:&mut Engine,p:&Program,viewer:&str,args:BTreeMap<String,Value>)->Result<serde_json::Value,String>{
    let context=Context::new(viewer,args).at(NOW);
    if p.kind==ProgramKind::Query {
        match engine.query(&p.name,context) {
            Ok(q) if q.unavailable || !q.complete => Err("incomplete/metered query is outside logical payload comparison".into()),
            Ok(q)=>Ok(serde_json::json!({"data":q.data})),
            Err(e) if e.rule.is_some() && matches!(e.family.as_str(),"rule"|"constraint") => Ok(serde_json::json!({"refusal":{"code":e.code,"message":e.message}})),
            Err(e)=>Err(format!("query error is not an admitted observation: {e}")),
        }
    }else{
        match engine.mutate(&p.name,None,context).map_err(|e|e.to_string())?.state {
            snapback4_core::WriteState::Sent{result,..}=>Ok(serde_json::json!({"sent":result})),
            snapback4_core::WriteState::Failed{why,current}=>{
                // E_RULE can also mask authorization-budget exhaustion. Only
                // an authored require/constraint carries this rule marker;
                // bound/storage/schema/ambiguous engine refusals cannot be a
                // logical counterexample in our resource-excluding contract.
                if why.rule.is_none()||!matches!(why.family.as_str(),"rule"|"constraint") {
                    return Err(format!("resource/engine or ambiguous mutation refusal {} is outside paired logical comparison",why.code));
                }
                Ok(serde_json::json!({"refusal":{"code":why.code,"message":why.message},"current":current}))
            },
        }
    }
}

pub(super) fn run(bound:&Bound,out:&mut Campaign,sites:Option<&BTreeSet<String>>){
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&i.column.as_deref().is_none_or(|c|c=="id")&&sites.is_none_or(|s|s.contains(&i.site.to_string()))) {
        if inv.policy.is_none(){out.unsupported.insert(format!("{}: paired observation needs complete bound policy dependencies; unsupported policy AST is not dependency-free",inv.table));continue;}
        if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()){continue;}
        // Closed transitive observer set: include maintained targets, inherited
        // readers and every table whose rule probes an affected population.
        // An operation mentioning none of them has no logical input changed
        // by this pair. This prunes experiments, never proves an obligation.
        let mut observers=BTreeSet::from([inv.table.clone()]);
        loop {
            let before=observers.len();
            for m in &bound.schema.maintains {if observers.contains(&m.source){
                observers.insert(m.target.clone());
                if let Some(owner)=&m.private{observers.insert(owner.table.clone());}
            }}
            for (name,t) in &bound.schema.tables {
                if t.through.as_ref().is_some_and(|p|observers.contains(&p.parent))
                    || [&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete].iter().any(|r|kernel::dependencies(r).iter().any(|d|observers.contains(d))) {
                    observers.insert(name.clone());
                }
            }
            if observers.len()==before{break;}
        }
        // Removing an ordinary row must not manufacture an invalid reference
        // graph. More general paired deletions need a checked closure.
        if bound.schema.tables.values().any(|t|t.columns.values().any(|k|matches!(k.required(),C::Ref{table} if table==&inv.table))) {
            out.unsupported.insert(format!("{}: paired absence needs a referentially valid world closure",inv.table));continue;
        }
        for variant in 0..8 {
            if !out.reserve(1){return;}
            let Ok(present)=snapshot(bound,inv,variant)else{continue;};
            if present.keys().any(|name|bound.schema.tables[name].columns.values().any(C::contains_asset)) {
                out.unsupported.insert(format!("{}: paired fixture asset identities are not coupled",inv.table));continue;
            }
            let Some(row)=present.get(&inv.table).and_then(|rs|rs.first()).cloned()else{continue;};
            let prepared=(||->Result<Value,String>{
                let e=engine(bound,&present,program("$security.pair.image",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))]))?;
                let actual=readback(&e)?;
                actual.get(&inv.table).into_iter().flatten().find(|r|r.field("id").ok()==row.field("id").ok()).cloned().ok_or_else(||"protected paired row is absent after validation".into())
            })();
            let row=prepared.as_ref().unwrap_or(&row);
            let mut absent=present.clone();absent.remove(&inv.table);
            // Final-exists validation is a pure judgment of this fixed seeded
            // world, before operation/viewer admission. Retain its rejection
            // across observers, never cache execution/resource/policy results.
            let invalid=std::cell::RefCell::new([None::<String>,None]);
            for viewer in [VIEWER,OTHER,"account:security-no-role","service:security"] {
                for bp in &bound.programs {
                    let p=&bp.program;
                    if !matches!(p.kind,ProgramKind::Query|ProgramKind::Mutation)||p.native {continue;}
                    let writes=ir::write_tables(p);
                    let deps=inv.policy.as_ref().map(kernel::dependencies).unwrap_or_default();
                    if writes.iter().any(|(table,kind)|table==&inv.table||deps.contains(table)||*kind!="update")
                        || !writes.is_empty() && (!bound.schema.maintains.is_empty() || bound.schema.tables.values().any(|t|!t.sequences.is_empty()||!t.on_delete.is_empty())) {
                        out.unsupported.insert(format!("{}: paired mutation lacks stable policy/implicit-write and deterministic-id reduction",p.name));continue;
                    }
                    let json=serde_json::to_value(p).unwrap();
                    if !observers.iter().any(|table|super::super::audit::mentions(&json,table)){continue;}
                    // Fresh generated ids and opaque viewer/work contexts are
                    // not repeatable functions of these paired inputs.
                    fn opaque(v:&serde_json::Value)->bool {match v{
                        serde_json::Value::String(s)=>s=="NewId"||s=="JobAs",
                        serde_json::Value::Object(m)=>m.keys().any(|k|matches!(k.as_str(),"Emit"|"JobAs"|"JobQuery"))||m.values().any(opaque),
                        serde_json::Value::Array(xs)=>xs.iter().any(opaque),_=>false,
                    }}
                    if opaque(&json){out.unsupported.insert(format!("{}: generated-id/opaque effects excluded from paired determinism",p.name));continue;}
                    let cases=histories::fixture_cases(p,&present,&[VIEWER.into(),OTHER.into()],out);
                    if cases.len()>32{out.unsupported.insert(format!("{}: paired observer arguments capped at 32; remaining combinations not covered",p.name));}
                    for args in cases.into_iter().take(32){
                    if !out.reserve(12){return;}
                        if out.paired_observer_calls+4>8192{out.unsupported.insert("paired observers capped at 8192 call reservations; remaining worlds not covered".into());return;}
                    out.paired_observer_calls+=4;
                    let execute=|seeds:&BTreeMap<String,Vec<Value>>|->Result<(serde_json::Value,BTreeMap<String,Vec<Value>>),String>{
                        if let Err(why)=&prepared{return Err(why.clone());}

                        let slot=usize::from(std::ptr::eq(seeds,&absent));
                        if let Some(why)=&invalid.borrow()[slot]{return Err(why.clone());}
                        let mut e=match engine(bound,seeds,program("$security.pair",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))])){
                            Ok(e)=>e,Err(why)=>{
                                if why.ends_with(": trusted seed did not establish final-exists constraint"){invalid.borrow_mut()[slot]=Some(why.clone());}
                                return Err(why);
                            },
                        };
                        let actual=readback(&e)?;
                        // Judge the hypothetical protected row in each complete
                        // committed world, before any operation can change roles.
                        let focal=actual.get(&inv.table).into_iter().flatten().find(|r|r.field("id").ok()==row.field("id").ok()).cloned().unwrap_or_else(||row.clone());
                        if policy_in(bound,inv,&actual,viewer,None,&focal,&mut e)!=Ok(false){return Err("paired policy is not definitely false in both worlds".into());}
                        observe(&mut e,p,viewer,args.clone()).map(|value|(value,actual))
                    };
                    let ((a,rows),(b,absent_rows))=match (execute(&present),execute(&absent)) {
                        (Ok(a),Ok(b))=>(a,b),
                        (Err(e),_)|(_,Err(e))=>{
                            if !e.starts_with("paired policy is not definitely false") {out.unsupported.insert(format!("{}: {e}",p.name));}
                            continue;
                        },
                    };
                    out.attempted+=2;*out.operations.entry(p.name.clone()).or_default()+=2;
                    if a==b {continue;}
                    // The query order is engine-defined. Recreate both worlds
                    // to decline store-scoped cursors or unstable outputs.
                    if !matches!((execute(&present),execute(&absent)),(Ok((aa,_)),Ok((bb,_))) if aa==a&&bb==b){
                        out.unsupported.insert(format!("{}: paired observation is not repeatable",p.name));continue;
                    }
                    out.violations.push(Counterexample {reachability:Reachability::SyntheticOperation,history:Vec::new(),invariant_site:inv.site.to_string(),args:args.clone(),viewer:viewer.into(),
                        operation:p.name.clone(),effect:"read observation".into(),row:row.clone(),old:None,supporting_rows:rows,
                        rule_path:"paired present/absent engine executions differ while the declared privacy policy is false in both".into(),
                        scope:"schema-valid seed-ingress paired worlds; authenticated logical data/refusal only; no application reachability claim".into(),
                        observations:Some(Observations{present:a,absent:b,absent_rows})});
                    break;
                    }
                    if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.observations.is_some()){break;}
                }
                if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.observations.is_some()){break;}
            }
            if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.observations.is_some()){break;}
        }
    }
    out.unsupported.insert("paired observations exclude wire sequences/receipts, physical timing and resource/meter differences; HTTP and device histories require separate qualification".into());
}
