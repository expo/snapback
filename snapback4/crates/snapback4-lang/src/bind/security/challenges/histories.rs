//! Short actual operation sequences; never relabel a role snapshot as a history.
// @ref LLP 3000.036.004#4-counterexamples-and-generated-tests — finite history coverage is explicit.
use super::*;
const LIMIT:usize=512;
#[derive(Clone,Debug,Serialize)]
pub struct Step {pub operation:String,pub viewer:String,pub args:BTreeMap<String,Value>,pub result:serde_json::Value}

pub(super) fn viewers(bound:&Bound)->Vec<String>{
    let mut out=BTreeSet::from([VIEWER.into(),OTHER.into(),"account:security-no-role".into(),"service:security".into()]);
    out.extend(bound.personas.iter().map(|p|if p.contains(':'){p.clone()}else{format!("dev:{p}")}));
    for t in bound.schema.tables.values(){for rule in [&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete]{
        fn collect(rule:&RuleExpr,out:&mut BTreeSet<String>){match rule{
            RuleExpr::And(xs)|RuleExpr::Or(xs)=>for r in xs{collect(r,out)},RuleExpr::Not(r)=>collect(r,out),
            r=>{if let Some(p)=r.service_grant(){out.insert(p.into());}}
        }}collect(rule,&mut out);
    }}out.into_iter().collect()
}

pub(super) fn argument_cases(args:&BTreeMap<String,ir::ArgType>,out:&mut Campaign)->Vec<BTreeMap<String,Value>>{
    fn values(name:&str,kind:&ir::ArgType)->Option<Vec<Value>>{
        Some(match kind {
            ir::ArgType::Enum{variants}=>variants.iter().map(|v|Value::String(v.clone())).collect(),
            ir::ArgType::Bool=>vec![Value::Bool(false),Value::Bool(true)],
            ir::ArgType::Principal=>vec![Value::Id(VIEWER.into()),Value::Id(OTHER.into())],
            ir::ArgType::Optional(inner)=>{
                let mut cases=vec![Value::Null];cases.extend(values(name,inner)?);cases
            },
            _=>vec![arguments(&BTreeMap::from([(name.into(),kind.clone())]),0)?.remove(name)?],
        })
    }
    let mut cases=vec![BTreeMap::new()];
    for (name,kind) in args {
        let Some(values)=values(name,kind)else{out.unsupported.insert(format!("{name}: history argument needs a typed/asset fixture"));return Vec::new();};
        let mut next=Vec::new();
        for case in &cases{for value in &values{if next.len()==LIMIT{out.unsupported.insert("enum/argument Cartesian product exceeds 512; remaining combinations not covered".into());break;}
            let mut c=case.clone();c.insert(name.clone(),value.clone());next.push(c);
        }}cases=next;
    }cases
}
fn pin_refs(args:&mut BTreeMap<String,Value>,p:&Program,rows:&BTreeMap<String,Vec<Value>>){
    for (name,kind) in &p.args {if let ir::ArgType::Ref{table}=kind&&let Some(value)=rows.get(table).and_then(|rs|rs.last()).and_then(|r|r.field("id").ok()){args.insert(name.clone(),value.clone());}}
}

pub(super) fn run(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    if bound.invariants.is_empty(){return;}
    let initial=match readback(fixture){Ok(rows)=>rows,Err(e)=>{out.unsupported.insert(e);return;}};
    if initial.values().all(Vec::is_empty){out.unsupported.insert("operation histories need initial fixture rows; schema-only snapshots are tested separately".into());return;}
    if initial.values().map(Vec::len).sum::<usize>()>1000 {out.unsupported.insert("history fixture exceeds 1000 rows; supply a focused fixture".into());return;}
    if bound.schema.tables.values().any(|t|t.read_lifetime_sensitive()||t.through.is_some()||t.columns.values().any(C::contains_asset))||!bound.schema.maintains.is_empty(){
        out.unsupported.insert("history replay needs complete temporal/capture/maintenance/asset-ledger fixture support for this schema".into());return;
    }
    let actors=viewers(bound);
    let mut candidates=Vec::new();
    for p in bound.programs.iter().filter(|p|p.program.kind==ProgramKind::Mutation&&!p.program.native){
        for args in argument_cases(&p.program.args,out){for viewer in &actors{candidates.push((&p.program,viewer.clone(),args.clone()));}}
    }
    let probes=bound.invariants.iter().filter(|i|i.target=="read").map(|inv|{
        let mut p=program(&format!("$security.history.read.{}",inv.table),ProgramKind::Query,vec![Stmt::Return(Expr::Get(Read{site:"history read".into(),table:inv.table.clone(),index:"byId".into(),key:vec![Expr::Variable("$security:row".into())],provenance:KeyProvenance::Computed}))]);
        p.args.insert("$security:row".into(),ir::ArgType::Id);p
    }).collect::<Vec<_>>();
    let mut count=0;
    'cases:for first in &candidates{for second in &candidates{
        if count==LIMIT {out.unsupported.insert("short operation sequences capped at 512; unvisited ordered pairs/longer histories not covered".into());break 'cases;}
        count+=1;
        let mut engine=match engine_with(bound,&initial,probes.clone()){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);break 'cases;}};
        out.sequences+=1;
        let mut steps=Vec::new();
        for (p,viewer,args) in [first,second]{
            let before=match readback(&engine){Ok(r)=>r,Err(_)=>break};let mut args=args.clone();pin_refs(&mut args,p,&before);
            out.attempted+=1;*out.operations.entry(p.name.clone()).or_default()+=1;
            match engine.mutate(&p.name,None,Context::new(viewer,args.clone()).at(NOW)){
                Ok(result)=>{steps.push(Step{operation:p.name.clone(),viewer:viewer.clone(),args,result:serde_json::to_value(&result.state).unwrap()});if matches!(result.state,snapback4_core::WriteState::Failed{..}){out.refused+=1;}},
                Err(e)=>{out.unsupported.insert(format!("{}: history engine error {e}",p.name));break;},
            }
            let Ok(rows)=readback(&engine)else{break;};
            for inv in &bound.invariants{
                if inv.target!="always"||out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&!v.history.is_empty()&&v.history.iter().map(|s|&s.operation).eq(steps.iter().map(|s|&s.operation))){continue;}
                for row in rows.get(&inv.table).into_iter().flatten(){
                    if before.get(&inv.table).is_some_and(|rs|rs.contains(row)){continue;}
                    if policy(bound,inv,&rows,viewer,None,row)==Ok(false){
                        out.violations.push(Counterexample{observations:None,history:steps.clone(),invariant_site:inv.site.to_string(),args:BTreeMap::new(),viewer:viewer.clone(),operation:p.name.clone(),effect:"always".into(),row:row.clone(),old:None,
                            supporting_rows:initial.clone(),rule_path:"committed row after actual authored operation sequence".into(),scope:"ordinary operation trace from the recorded schema-valid fixture; finite campaign, not all-history proof".into()});
                    }
                }
            }
        }
        // Observe actual post-history rule admission; do not infer read access
        // from mutation success or from the fixture's role snapshot.
        let Ok(rows)=readback(&engine)else{continue;};
        for inv in bound.invariants.iter().filter(|i|i.target=="read"){if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&!v.history.is_empty()&&v.history.iter().map(|s|&s.operation).eq(steps.iter().map(|s|&s.operation))){continue;}for row in rows.get(&inv.table).into_iter().flatten(){for viewer in &actors{
            if policy(bound,inv,&rows,viewer,None,row)!=Ok(false){continue;}
            let Some(key)=row.field("id").ok()else{continue;};
            out.attempted+=1;
            if let Ok(q)=engine.query(&format!("$security.history.read.{}",inv.table),Context::new(viewer,BTreeMap::from([("$security:row".into(),key.clone())])).at(NOW))&&q.complete&&!q.unavailable&&q.data!=Value::Null{
                out.violations.push(Counterexample{observations:None,history:steps.clone(),invariant_site:inv.site.to_string(),args:BTreeMap::new(),viewer:viewer.clone(),operation:"$security.history.read".into(),effect:"read".into(),row:row.clone(),old:None,supporting_rows:initial.clone(),
                    rule_path:"actual read after two authored operations; current policy false".into(),scope:"ordinary operation trace from the recorded fixture; disconnected-device freshness is separate".into()});
            }
        }}}
    }}
}
