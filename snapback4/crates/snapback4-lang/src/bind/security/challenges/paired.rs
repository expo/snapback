//! Paired logical observations, replayed independently in memory.
// @ref LLP 3000.036.004#101-separate-observer-obligations — two valid worlds and repeatable observations are required.
use super::*;

#[derive(Clone,Debug,Serialize)]
pub struct Observations {
    pub present: serde_json::Value,
    pub absent: serde_json::Value,
    pub absent_rows: BTreeMap<String,Vec<Value>>,
}

fn observe(engine:&mut Engine,p:&Program,viewer:&str,args:BTreeMap<String,Value>)->Result<serde_json::Value,String>{
    let context=Context::new(viewer,args).at(NOW);
    if p.kind==ProgramKind::Query {
        match engine.query(&p.name,context) {
            Ok(q) if q.unavailable || !q.complete => Err("incomplete/metered query is outside logical payload comparison".into()),
            Ok(q)=>serde_json::to_value(&q.data).map_err(|e|e.to_string()),
            Err(e)=>Err(format!("query error is not an admitted observation: {e}")),
        }
    }else{
        match engine.mutate(&p.name,None,context).map_err(|e|e.to_string())?.state {
            snapback4_core::WriteState::Sent{result,..}=>Ok(serde_json::json!({"sent":result})),
            snapback4_core::WriteState::Failed{why,current}=>Ok(serde_json::json!({"refusal":{"code":why.code,"message":why.message},"current":current})),
        }
    }
}

pub(super) fn run(bound:&Bound,out:&mut Campaign,sites:Option<&BTreeSet<String>>){
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&sites.is_none_or(|s|s.contains(&i.site.to_string()))) {
        if inv.policy.is_none(){out.unsupported.insert(format!("{}: paired observation needs complete bound policy dependencies; unsupported policy AST is not dependency-free",inv.table));continue;}
        if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()){continue;}
        // Removing an ordinary row must not manufacture an invalid reference
        // graph. More general paired deletions need a checked closure.
        if bound.schema.tables.values().any(|t|t.columns.values().any(|k|matches!(k.required(),C::Ref{table} if table==&inv.table))) {
            out.unsupported.insert(format!("{}: paired absence needs a referentially valid world closure",inv.table));continue;
        }
        for variant in 0..8 {
            let Ok(present)=snapshot(bound,inv,variant)else{continue;};
            if present.keys().any(|name|bound.schema.tables[name].columns.values().any(C::contains_asset)) {
                out.unsupported.insert(format!("{}: paired fixture asset identities are not coupled",inv.table));continue;
            }
            let Some(row)=present.get(&inv.table).and_then(|rs|rs.first()).cloned()else{continue;};
            let mut absent=present.clone();absent.remove(&inv.table);
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
                    // Fresh generated ids and opaque viewer/work contexts are
                    // not repeatable functions of these paired inputs.
                    fn opaque(v:&serde_json::Value)->bool {match v{
                        serde_json::Value::String(s)=>s=="NewId"||s=="JobAs",
                        serde_json::Value::Object(m)=>m.keys().any(|k|matches!(k.as_str(),"Emit"|"JobAs"|"JobQuery"))||m.values().any(opaque),
                        serde_json::Value::Array(xs)=>xs.iter().any(opaque),_=>false,
                    }}
                    if opaque(&json){out.unsupported.insert(format!("{}: generated-id/opaque effects excluded from paired determinism",p.name));continue;}
                    let Some(args)=arguments(&p.args,variant)else{continue;};
                    let execute=|seeds:&BTreeMap<String,Vec<Value>>|->Result<(serde_json::Value,BTreeMap<String,Vec<Value>>),String>{
                        let mut e=engine(bound,seeds,program("$security.pair",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))]))?;
                        let actual=readback(&e)?;
                        // Judge the hypothetical protected row in each complete
                        // committed world, before any operation can change roles.
                        if policy(bound,inv,&actual,viewer,None,&row)!=Ok(false){return Err("paired policy is not definitely false in both worlds".into());}
                        observe(&mut e,p,viewer,args.clone()).map(|value|(value,actual))
                    };
                    let (Ok((a,rows)),Ok((b,absent_rows)))=(execute(&present),execute(&absent))else{continue;};
                    out.attempted+=2;*out.operations.entry(p.name.clone()).or_default()+=2;
                    if a==b {continue;}
                    // The query order is engine-defined. Recreate both worlds
                    // to decline store-scoped cursors or unstable outputs.
                    if !matches!((execute(&present),execute(&absent)),(Ok((aa,_)),Ok((bb,_))) if aa==a&&bb==b){
                        out.unsupported.insert(format!("{}: paired observation is not repeatable",p.name));continue;
                    }
                    out.violations.push(Counterexample {history:Vec::new(),invariant_site:inv.site.to_string(),args:args.clone(),viewer:viewer.into(),
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
    }
    out.unsupported.insert("paired observations exclude wire sequences/receipts, physical timing and resource/meter differences; HTTP and device histories require separate qualification".into());
}
