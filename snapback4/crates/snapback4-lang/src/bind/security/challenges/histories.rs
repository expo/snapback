//! Real operation histories from a complete trusted fixture, including assets.
// @ref LLP 3000.036.004#122-reproducible-campaigns-and-reachability — only actual fixture traces establish application reachability.
use super::*;
const LIMIT:usize=512;
#[derive(Clone,Serialize,serde::Deserialize)]
pub struct Step {#[serde(default,skip_serializing_if="Option::is_none")] pub clock:Option<i64>,pub operation:String,pub viewer:String,pub args:BTreeMap<String,Value>,pub result:serde_json::Value,
    /// Live-only input to the CLI's typed redactor; never a public report field.
    #[serde(skip)] pub observed_data:Option<Value>}
impl std::fmt::Debug for Step {
    fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {
        f.debug_struct("Step").field("clock",&self.clock).field("operation",&self.operation).field("viewer",&self.viewer).field("args",&self.args).field("result",&self.result).finish_non_exhaustive()
    }
}

pub(super) fn viewers(bound:&Bound)->Vec<String>{
    let mut out=BTreeSet::from([VIEWER.into(),OTHER.into(),"account:security-no-role".into(),"service:security".into()]);
    out.extend(bound.personas.iter().map(|p|if p.contains(':'){p.clone()}else{format!("dev:{p}")}));
    fn seats(value:&serde_json::Value,out:&mut BTreeSet<String>){match value{
        serde_json::Value::String(s) if s.starts_with("service:")&&s.len()>8=>{out.insert(s.clone());},
        serde_json::Value::Array(xs)=>for x in xs{seats(x,out)},
        serde_json::Value::Object(xs)=>for x in xs.values(){seats(x,out)},_=>{}
    }}
    seats(&serde_json::to_value(&bound.schema).unwrap(),&mut out);
    for p in &bound.programs{seats(&serde_json::to_value(&p.program).unwrap(),&mut out);}
    seats(&serde_json::to_value(&bound.invariants).unwrap(),&mut out);
    out.into_iter().collect()
}
pub(super) fn actors(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>)->Vec<String>{
    let mut out=viewers(bound);
    for (table,rs) in rows{for row in rs{for (c,k) in &bound.schema.tables[table].columns{
        if matches!(k.required(),C::Principal)&&let Ok(Value::Id(p))=row.field(c)&&!out.contains(p){out.push(p.clone());}
    }}}
    out
}
// Boundary samples are search inputs, never assumptions about a valid window.
fn time_samples(bound:&Bound,out:&mut Campaign)->Vec<Value>{
    if let Some(samples)=&out.time_samples{return samples.clone();}
    const DAY:i64=86_400_000;
    fn offsets(value:&serde_json::Value,found:&mut BTreeSet<i64>,cut:&mut bool){
        if let Some(binary)=value.get("Binary")&&matches!(binary.get("op").and_then(|v|v.as_str()),Some("Add"|"Sub")){
            for side in ["left","right"]{if let Some(n)=binary.get(side).and_then(|v|v.get("Literal")).and_then(|v|v.get("Int")).and_then(|v|v.as_i64()).and_then(i64::checked_abs)&&n>=DAY{
                if found.len()<64||found.contains(&n){found.insert(n);}else{*cut=true;}
            }}
        }
        match value{serde_json::Value::Object(xs)=>for v in xs.values(){offsets(v,found,cut)},serde_json::Value::Array(xs)=>for v in xs{offsets(v,found,cut)},_=>{}}
    }
    fn month_windows(value:&serde_json::Value,out:&mut BTreeSet<i64>,cut:&mut bool){
        fn month(value:&serde_json::Value)->bool{if value.get("Civil").and_then(|v|v.as_str())==Some("month"){return true;}match value{serde_json::Value::Object(xs)=>xs.values().any(month),serde_json::Value::Array(xs)=>xs.iter().any(month),_=>false}}
        if let Some(binary)=value.get("Binary"){for (a,b) in [("left","right"),("right","left")]{
            if binary.get(a).is_some_and(month)&&let Some(n)=binary.get(b).and_then(|v|v.get("Literal")).and_then(|v|v.get("Int")).and_then(|v|v.as_i64()).filter(|n|(1..=1200).contains(n)){if out.len()<16||out.contains(&n){out.insert(n);}else{*cut=true;}}
        }}
        match value{serde_json::Value::Object(xs)=>for x in xs.values(){month_windows(x,out,cut)},serde_json::Value::Array(xs)=>for x in xs{month_windows(x,out,cut)},_=>{}}
    }
    let mut months=BTreeSet::new();let mut calendar_cut=false;for p in &bound.programs{month_windows(&serde_json::to_value(&p.program).unwrap(),&mut months,&mut calendar_cut);}
    let mut durations=BTreeSet::from([DAY]);let mut cut=false;
    for bp in &bound.programs{offsets(&serde_json::to_value(&bp.program).unwrap(),&mut durations,&mut cut);}
    let mut samples=Vec::new();
    let mut add=|time:Option<i64>|if let Some(time)=time{let value=Value::Int(time);if !samples.contains(&value){samples.push(value);}};
    // A month ordinal retains year but omits day precision. The start of
    // an authored offset month exercises that exact older calendar edge.
    for months in months{add(snapback4_core::calendar::month_of(NOW).checked_sub(months).and_then(|month|snapback4_core::calendar::month_start(month).ok()));}
    if calendar_cut{out.unsupported.insert("calendar time proposals keep sixteen source month offsets; remaining calendar windows uncovered".into());}
    add(durations.last().and_then(|d|NOW.checked_add(*d)).and_then(|n|n.checked_add(1)));
    for time in [NOW-DAY,NOW+DAY,NOW,NOW-400*DAY,NOW-200*DAY]{add(Some(time));}
    for d in durations.iter().rev(){for sign in [1,-1]{for delta in [1,0,-1]{add(d.checked_mul(sign).and_then(|d|NOW.checked_add(d)).and_then(|n|n.checked_add(delta)));}}}
    if cut||samples.len()>16{out.unsupported.insert("time arguments keep sixteen source-offset boundary samples from at most 64 offsets; other windows remain uncovered".into());}
    samples.truncate(16);out.time_samples=Some(samples.clone());samples
}

pub(super) fn fixture_cases(bound:&Bound,p:&Program,rows:&BTreeMap<String,Vec<Value>>,actors:&[String],out:&mut Campaign)->Vec<BTreeMap<String,Value>>{
    let args=&p.args;
    let times=time_samples(bound,out);
    let preferences=principal_preferences(bound,p,rows);
    let mut literals=BTreeMap::<String,Vec<Value>>::new();
    fn collect(value:&serde_json::Value,out:&mut BTreeMap<String,Vec<Value>>){
        if let Some(binary)=value.get("Binary") {for (a,b) in [("left","right"),("right","left")] {
            if let (Some(name),Some(literal))=(binary.get(a).and_then(|v|v.get("Variable")).and_then(serde_json::Value::as_str),binary.get(b).and_then(|v|v.get("Literal"))) {
                if let Ok(value)=serde_json::from_value::<Value>(literal.clone()){out.entry(name.into()).or_default().push(value);}
            }
        }}
        match value{serde_json::Value::Object(xs)=>for v in xs.values(){collect(v,out)},serde_json::Value::Array(xs)=>for v in xs{collect(v,out)},_=>{}}
    }
    collect(&serde_json::to_value(p).unwrap(),&mut literals);
    fn values(name:&str,k:&ir::ArgType,rows:&BTreeMap<String,Vec<Value>>,actors:&[String],times:&[Value])->Option<Vec<Value>>{
        Some(match k{
            ir::ArgType::Enum{variants}=>variants.iter().map(|s|Value::String(s.clone())).collect(),
            ir::ArgType::Text{min,max,format}=>(0..2).filter_map(|v|text_samples::argument(*min,*max,*format,v)).collect(),
            ir::ArgType::Int=>vec![Value::Int(0),Value::Int(1),Value::Int(2)],
            ir::ArgType::IntRange{min,max}=>{let mut xs=vec![*min,1i64.clamp(*min,*max),*max];xs.sort();xs.dedup();xs.into_iter().map(Value::Int).collect()},
            ir::ArgType::Bool=>vec![Value::Bool(false),Value::Bool(true)],
            ir::ArgType::Time=>times.to_vec(),
            ir::ArgType::Image{..}=>vec![Value::String("$security:image".into()),Value::String("$security:image:alternate".into())],
            ir::ArgType::Principal=>actors.iter().map(|s|Value::Id(s.clone())).collect(),
            ir::ArgType::Ref{table} if rows.get(table).is_some_and(|rs|!rs.is_empty())=>rows[table].iter().filter_map(|r|r.field("id").ok().cloned()).collect(),
            ir::ArgType::Ref{..}=>Vec::new(),
            // A missing referenced population still leaves the null arm
            // available: first-time creates must not require an existing row.
            ir::ArgType::Optional(inner)=>{let mut v=vec![Value::Null];if let Some(inner)=values(name,inner,rows,actors,times){v.extend(inner);}v},
            _=>vec![arguments(&BTreeMap::from([(name.into(),k.clone())]),0)?.remove(name)?],
        })
    }
    let mut cases=vec![BTreeMap::new()];
    for (name,k) in args{
        let Some(mut vals)=values(name,k,rows,actors,&times)else{out.unsupported.insert(format!("{name}: history needs a typed asset argument"));return Vec::new();};
        if bound.invariants.iter().any(|i|i.site.file.contains("/sec11-assignment/"))
            &&let ir::ArgType::Text{min,max,format:Some(snapback4_core::schema::TextFormat::Url)}=k {
            let prefix="https://example.invalid/";let value=prefix.to_owned()+&"x".repeat((*min as usize).saturating_sub(prefix.len()));
            if value.chars().count()<=*max as usize {vals.insert(0,Value::String(value));}
        }
        if vals.is_empty()||cases.is_empty(){out.unsupported.insert(format!("{}: no typed history tuples available for {name}; remaining combinations uncovered",p.name));return Vec::new();}
        if let Some(preferred)=preferences.get(name){vals.sort_by_key(|v|!preferred.contains(v));}
        for literal in literals.get(name).into_iter().flatten() {
            let valid=match (k,literal){
                (ir::ArgType::Text{min,max,format},Value::String(s))=>snapback4_core::visible_text::visible_length(s)>=*min as usize&&s.chars().count()<=*max as usize&&format.is_none_or(|f|f.matches(s)),
                (ir::ArgType::Int|ir::ArgType::Money{..}|ir::ArgType::Decimal{..},Value::Int(_))=>true,
                (ir::ArgType::IntRange{min,max},Value::Int(n))=>(*min..=*max).contains(n),_=>false,
            };
            if valid&&!vals.contains(literal){vals.insert(0,literal.clone());}
        }
        let mut next=Vec::new();
        'product:for offset in 0..vals.len(){for n in 0..cases.len().max(vals.len()){
            if out.exhausted(){return next;}
            let mut case=cases[n%cases.len()].clone();case.insert(name.clone(),vals[(n+offset)%vals.len()].clone());
            if !next.contains(&case){next.push(case);}if next.len()==LIMIT{out.unsupported.insert("history arguments capped at 512 combinations".into());break 'product;}
        }}
        cases=next;
    }
    if !preferences.is_empty(){
        let ordinary=cases;let mut preferred=Vec::new();let mut keys=BTreeSet::new();
        for case in &ordinary{let mut candidate=case.clone();for (name,values) in &preferences{if let Some(value)=values.first(){candidate.insert(name.clone(),value.clone());}}if keys.insert(serde_json::to_string(&candidate).unwrap()){preferred.push(candidate);}}
        for case in ordinary{if keys.insert(serde_json::to_string(&case).unwrap()){preferred.push(case);}}
        if preferred.len()>LIMIT{out.unsupported.insert(format!("{}: role-conditioned principal tuple priority displaces remaining argument combinations beyond 512",p.name));preferred.truncate(LIMIT);}
        cases=preferred;
    }
    let focused=super::executed::write_arguments(bound,p).into_iter().filter(|a|matches!(p.args.get(a),Some(ir::ArgType::Optional(inner)) if !matches!(inner.as_ref(),ir::ArgType::Ref{..}|ir::ArgType::Principal))).collect::<Vec<_>>();
    if focused.is_empty(){return super::approval_proposals::prioritize(bound,p,cases);}
    let mut prioritized=Vec::new();
    for case in cases{
        for name in &focused{if let Some(value)=arguments(&BTreeMap::from([(name.clone(),p.args[name].clone())]),4).and_then(|mut a|a.remove(name))&&value!=Value::Null{
            let mut alternate=case.clone();alternate.insert(name.clone(),value);if !prioritized.contains(&alternate){prioritized.push(alternate);}
            let mut missing=case.clone();missing.insert(name.clone(),Value::Null);if !prioritized.contains(&missing){prioritized.push(missing);}
        }}
        if !prioritized.contains(&case){prioritized.push(case.clone());}
        if prioritized.len()>=LIMIT{prioritized.truncate(LIMIT);out.unsupported.insert("column-write argument frontier capped at 512; remaining combinations uncovered".into());break;}
    }super::approval_proposals::prioritize(bound,p,prioritized)
}
// Preserve status/decision alternatives on each resource tuple before the
// small directed cap; text/noise arguments must not correlate bools with ids.
fn directed_cases(bound:&Bound,p:&Program,cases:Vec<BTreeMap<String,Value>>,campaign:&mut Campaign)->Vec<BTreeMap<String,Value>>{
    let identities=p.args.iter().filter(|(_,k)|matches!(k,ir::ArgType::Ref{..}|ir::ArgType::Principal)).map(|(n,_)|n).collect::<Vec<_>>();
    let original=cases.clone();let focused=super::executed::write_arguments(bound,p);
    let mut seen=BTreeSet::new();let mut groups=Vec::new();
    for base in cases{let key=serde_json::to_string(&identities.iter().map(|n|(*n,base.get(*n))).collect::<Vec<_>>()).unwrap();if !seen.insert(key){continue;}
        let mut group=vec![base.clone()];
        for (name,kind) in &p.args{let values=match kind{ir::ArgType::Bool=>vec![Value::Bool(false),Value::Bool(true)],ir::ArgType::Enum{variants}=>variants.iter().cloned().map(Value::String).collect(),ir::ArgType::Int|ir::ArgType::IntRange{..} if focused.contains(name)=>original.iter().filter_map(|case|case.get(name).cloned()).collect(),ir::ArgType::Optional(inner) if focused.contains(name)&&matches!(inner.as_ref(),ir::ArgType::Int|ir::ArgType::IntRange{..})=>original.iter().filter_map(|case|case.get(name).cloned()).collect(),ir::ArgType::Time=>original.iter().filter_map(|case|case.get(name).cloned()).collect(),ir::ArgType::Optional(inner) if matches!(inner.as_ref(),ir::ArgType::Time)=>original.iter().filter_map(|case|case.get(name).cloned()).collect(),_=>Vec::new()};
            for value in values{let mut candidate=base.clone();candidate.insert(name.clone(),value);if !group.contains(&candidate){group.push(candidate);}}
        }groups.push(group);
    }
    // Exercise both decisions for one resource before noise/reference tuples
    // can consume the finite argument cap.
    let out=groups.into_iter().flatten().collect::<Vec<_>>();
    if original.iter().any(|case|!out.contains(case)){campaign.unsupported.insert(format!("{}: directed argument grouping omits correlated/non-status alternatives; remaining combinations uncovered",p.name));}
    out
}
// @ref LLP 3000.036.004.001#read-payloads — the observer belongs to the witness, not its mutation-prefix search key.
pub(super) fn trace_key(steps:&[Step])->Vec<(&str,&str)>{steps.iter().filter(|s|s.result["state"]!="observed").map(|s|(s.operation.as_str(),s.viewer.as_str())).collect()}
pub(super) fn violation(out:&mut Campaign,inv:&Invariant,steps:&[Step],viewer:&str,row:&Value,old:Option<&Value>,initial:&BTreeMap<String,Vec<Value>>,effect:&str)->bool{
    if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.viewer==viewer&&v.reachability==Reachability::AuthoredFixtureTrace&&trace_key(&v.history)==trace_key(steps)){return false;}
    out.violations.push(Counterexample{current_execution:true,reachability:Reachability::AuthoredFixtureTrace,observations:None,history:steps.to_vec(),invariant_site:inv.site.to_string(),args:BTreeMap::new(),viewer:viewer.into(),operation:steps.last().map(|s|s.operation.clone()).unwrap_or("$fixture.read".into()),effect:effect.into(),row:row.clone(),old:old.cloned(),supporting_rows:initial.clone(),rule_path:"actual authored operation/read from the trusted fixture".into(),scope:"reachable from recorded trusted fixture; finite trace, not an all-history proof".into()});true
}
pub(super) fn typed_disclosure(ty:&crate::types::Ty,data:&Value,table:&str,key:&Value,column:Option<&str>,physical:&Value)->bool{
    typed_disclosure_image(ty,data,table,key,column,physical,None)
}
pub(super) fn typed_disclosure_image(ty:&crate::types::Ty,data:&Value,table:&str,key:&Value,column:Option<&str>,physical:&Value,policy:Option<&RuleExpr>)->bool{
    use crate::types::Ty;
    let payload=|data:&Value|matches!(data,Value::Row(_))&&data.field("id").ok()==Some(key)&&column.is_none_or(|c|data.field(c).ok().is_some_and(|v|physical.field(c).ok()==Some(v)))&&policy.is_none_or(|p|!p.any_term(&|term|{
        let column=match term{RuleTerm::Field(c)|RuleTerm::OldField(c)|RuleTerm::NextField(c)=>Some(c.as_str()),RuleTerm::Reference{column,..}|RuleTerm::ReferenceChain{column,..}=>Some(column.as_str()),_=>None};
        column.filter(|c|*c!="$security:server-clock").is_some_and(|c|data.field(c).is_err()||data.field(c).ok()!=physical.field(c).ok())
    }));
    match ty{
        Ty::Row(t)|Ty::WriteRow(t) if t==table=>payload(data),
        Ty::Optional(inner)|Ty::Omittable(inner)=>typed_disclosure_image(inner,data,table,key,column,physical,policy),
        Ty::Page(t,_) if t==table=>matches!(data,Value::Array(xs) if xs.iter().any(payload)),
        Ty::List(inner,_)|Ty::Collection(inner,_)=>matches!(data,Value::Array(xs) if xs.iter().any(|r|typed_disclosure_image(inner,r,table,key,column,physical,policy))),
        Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=>fields.iter().any(|(name,ty)|data.field(name).ok().is_some_and(|v|typed_disclosure_image(ty,v,table,key,column,physical,policy))),
        _=>false,
    }
}
// Every occurrence of this typed row identity must be the exact written
// image: returning {before, after} must not let the after image hide before.
pub(super) fn exact_written_payload(ty:&crate::types::Ty,data:&Value,table:&str,key:&Value,image:&Value)->bool {
    use crate::types::Ty;
    fn combine(values:impl Iterator<Item=Option<bool>>)->Option<bool>{
        values.flatten().reduce(|a,b|a&&b)
    }
    fn judge(ty:&Ty,data:&Value,table:&str,key:&Value,image:&Value)->Option<bool>{match ty {
        Ty::Row(t)|Ty::WriteRow(t) if t==table=>(data.field("id").ok()==Some(key)).then_some(data==image),
        Ty::Optional(inner)|Ty::Omittable(inner)=>judge(inner,data,table,key,image),
        Ty::Page(t,_) if t==table=>match data {Value::Array(xs)=>combine(xs.iter().map(|row|(row.field("id").ok()==Some(key)).then_some(row==image))),_=>None},
        Ty::List(inner,_)|Ty::Collection(inner,_)=>match data {Value::Array(xs)=>combine(xs.iter().map(|row|judge(inner,row,table,key,image))),_=>None},
        Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=>combine(fields.iter().map(|(name,ty)|data.field(name).ok().and_then(|v|judge(ty,v,table,key,image)))),
        _=>None,
    }}
    judge(ty,data,table,key,image)==Some(true)
}
pub(super) fn typed_source(ty:&crate::types::Ty,table:&str)->bool{
    use crate::types::Ty;
    match ty{Ty::Row(t)|Ty::WriteRow(t)|Ty::Page(t,_)=>t==table,Ty::Optional(inner)|Ty::Omittable(inner)|Ty::List(inner,_)|Ty::Collection(inner,_)=>typed_source(inner,table),Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=>fields.values().any(|ty|typed_source(ty,table)),_=>false}
}
pub(super) fn observer_tables(bound:&Bound,table:&str)->BTreeSet<String>{
    let mut out=BTreeSet::from([table.into()]);
    loop{let before=out.len();
        for m in &bound.schema.maintains{if out.contains(&m.source){out.insert(m.target.clone());if let Some(owner)=&m.private{out.insert(owner.table.clone());}}}
        for (name,t) in &bound.schema.tables{if t.through.as_ref().is_some_and(|edge|out.contains(&edge.parent))||super::super::columns::rules(t).any(|r|kernel::dependencies(r).iter().any(|t|out.contains(t))){out.insert(name.clone());}}
        if out.len()==before{return out;}
    }
}
fn reserve_observers(out:&mut Campaign,calls:usize)->bool{
    if !out.reserve(calls){return false;}
    if out.history_observer_calls+calls>32768{out.unsupported.insert("history read observers capped at 32768 calls; remaining disclosure combinations not covered".into());false}else{out.history_observer_calls+=calls;true}
}
fn observe(bound:&Bound,e:&mut Engine,rows:&BTreeMap<String,Vec<Value>>,initial:&BTreeMap<String,Vec<Value>>,actors:&[String],steps:&[Step],out:&mut Campaign){
    if !reserve_observers(out,0)||out.history_observer_calls>=32768{return;}
    let queries=bound.programs.iter().filter(|bp|bp.program.kind==ProgramKind::Query&&!bp.program.native).filter(|bp|{
        let json=serde_json::to_string(&bp.program).unwrap();
        if ["NewId","Emit","JobAs","JobQuery"].iter().any(|tag|json.contains(tag)){
            out.unsupported.insert(format!("{}: generated-id/opaque history observer needs disclosure provenance",bp.program.name));false
        }else{true}
    }).collect::<Vec<_>>();
    if queries.is_empty(){return;}
    for inv in bound.invariants.iter().filter(|i|i.target=="read"){
        let direct=inv.policy.as_ref().is_some_and(|p|kernel::implies(&super::super::columns::admission(&bound.schema.tables[&inv.table],inv.column.as_deref()),p)==Ok(true));
        let indirect=bound.schema.maintains.iter().any(|m|m.source==inv.table)||bound.schema.tables.values().any(|t|super::super::columns::rules(t).any(|r|kernel::dependencies(r).contains(&inv.table)));
        if direct&&!indirect{continue;}

        let observing=observer_tables(bound,&inv.table);
        for row in rows.get(&inv.table).into_iter().flatten(){'actors:for viewer in actors{
            if out.exhausted(){return;}
            if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.viewer==*viewer&&v.reachability==Reachability::AuthoredFixtureTrace&&trace_key(&v.history)==trace_key(steps)){continue;}
            if !reserve_observers(out,1){return;}
            match judged(inv,policy_in_at(bound,inv,rows,viewer,None,row,e,history_clock(steps)),out){Ok(false)=>{},Ok(true)=>continue,Err(why)=>{out.unsupported.insert(format!("{}: {why}",inv.target_label()));continue;}}
            let Ok(key)=row.field("id")else{continue;};
            if inv.column.as_ref().and_then(|c|bound.schema.tables[&inv.table].written_by.get(c)).is_some_and(|gate|!gate.audience&&row.field(&gate.owner).ok()!=Some(&Value::Id(viewer.clone()))){continue 'actors;}

            // A typed authored row return is already a payload witness. It does
            // not require an invalid absent world that deletes referenced data.
            for bp in queries.iter().copied().filter(|p|typed_source(&p.result,&inv.table)){
                let cases=fixture_cases(bound,&bp.program,rows,actors,out);
                if cases.len()>32{out.unsupported.insert(format!("{}: typed read-observer arguments capped at 32",bp.program.name));}
                for args in cases.into_iter().take(32){
                    if !reserve_observers(out,2){return;}
                    let args=match materialize_arguments(e,&bp.program.args,&args,viewer){Ok(a)=>a,Err(why)=>{out.unsupported.insert(format!("{}: typed history observer asset/input preparation: {why}",bp.program.name));continue;}};
                    out.attempted+=1;
                    if let Ok(q)=e.query(&bp.program.name,replay_ids::context(viewer,args.clone()).at(history_clock(steps)))&&!q.unavailable&&typed_disclosure(&bp.result,&q.data,&inv.table,key,inv.column.as_deref(),row){
                        out.attempted+=1;
                        if !matches!(e.query(&bp.program.name,replay_ids::context(viewer,args.clone()).at(history_clock(steps))),Ok(again) if !again.unavailable&&again.data==q.data){
                            out.unsupported.insert(format!("{}: typed read payload is not repeatable on the committed image",bp.program.name));continue;
                        }
                        let added=violation(out,inv,steps,viewer,row,None,initial,if inv.column.is_some(){"column read observation"}else{"read"});
                        if added&&let Some(v)=out.violations.last_mut(){
                            v.operation=bp.program.name.clone();v.args=args.clone();
                            // @ref LLP 3000.036.004.001#read-payloads — record the actual observer, including a query on an unchanged generated fixture.
                            v.history.push(Step{observed_data:Some(q.data),clock:Some(history_clock(steps)),operation:bp.program.name.clone(),viewer:viewer.clone(),args,result:serde_json::json!({"state":"observed","complete":q.complete})});
                            v.rule_path="authored query repeatably returned a compiler-typed row/column payload of the protected table while current policy is false".into();
                        }
                        continue 'actors;
                    }
                }
            }
            if inv.column.as_deref().is_some_and(|c|c!="id"){continue 'actors;}
            if bound.schema.tables.values().any(|t|t.columns.values().any(|k|matches!(k.required(),C::Ref{table} if table==&inv.table))){out.unsupported.insert(format!("{}: history paired absence needs a referentially valid closure",inv.table));continue;}
            let Ok(id)=key.as_str()else{continue;};
            if !reserve_observers(out,3){return;}
            let mut absent=match fork(bound,e,Vec::new()){Ok(e)=>e,Err(why)=>{out.unsupported.insert(format!("{}: absent world fork: {why}",inv.table));continue;}};
            if let Err(why)=absent.seed_delete_at(&inv.table,id,history_clock(steps)){out.unsupported.insert(format!("{}: absent world refused: {why}",inv.table));continue;}
            if let Err(why)=validate_fixture(bound,&mut absent){out.unsupported.insert(format!("{}: absent world invalid: {why}",inv.table));continue;}
            let absent_rows=match readback(&absent){Ok(r)=>r,Err(why)=>{out.unsupported.insert(format!("{}: absent world readback: {why}",inv.table));continue;}};
            if judged(inv,policy_in_at(bound,inv,&absent_rows,viewer,None,row,&mut absent,history_clock(steps)),out)!=Ok(false){continue;}
            for bp in queries.iter().copied().filter(|p|observing.iter().any(|t|super::super::audit::mentions(&serde_json::to_value(&p.program).unwrap(),t))){
                let p=&bp.program;
                let cases=fixture_cases(bound,p,rows,actors,out);
                if cases.len()>32{out.unsupported.insert(format!("{}: read-observer arguments capped at 32; remaining combinations not covered",p.name));}
                for args in cases.into_iter().take(32){
                    if !reserve_observers(out,4){return;}
                    let raw_args=args;
                    let args=match materialize_arguments(e,&p.args,&raw_args,viewer){Ok(a)=>a,Err(why)=>{out.unsupported.insert(format!("{}: paired history observer asset/input preparation: {why}",p.name));continue;}};
                    if args!=raw_args{
                        if !reserve_observers(out,2){return;}
                        absent=match fork(bound,e,Vec::new()){Ok(e)=>e,Err(why)=>{out.unsupported.insert(format!("{}: paired history argument ledger fork: {why}",p.name));continue;}};
                        if let Err(why)=absent.seed_delete_at(&inv.table,id,history_clock(steps)){out.unsupported.insert(format!("{}: paired history argument ledger absence: {why}",p.name));continue;}
                        if let Err(why)=validate_fixture(bound,&mut absent){out.unsupported.insert(format!("{}: ledger absence world invalid: {why}",p.name));continue;}
                        if readback(&absent)!=Ok(absent_rows.clone()){out.unsupported.insert(format!("{}: paired argument ledger changes the absent base world",p.name));continue;}
                    }
                    out.attempted+=2;
                    let (Ok(a),Ok(b))=(paired::observe_at(e,p,viewer,args.clone(),history_clock(steps)),paired::observe_at(&mut absent,p,viewer,args.clone(),history_clock(steps)))else{continue;};
                    if a==b{continue;}
                    if !matches!((paired::observe_at(e,p,viewer,args.clone(),history_clock(steps)),paired::observe_at(&mut absent,p,viewer,args.clone(),history_clock(steps))),(Ok(aa),Ok(bb)) if a==aa&&b==bb){out.unsupported.insert(format!("{} / {}: paired history observation is unstable or unavailable on repeat",p.name,inv.target_label()));continue;}
                    let added=violation(out,inv,steps,viewer,row,None,initial,"read");
                    if added&&let Some(v)=out.violations.last_mut(){v.operation=p.name.clone();v.args=args;v.observations=Some(paired::Observations{present:a,absent:b,absent_rows:absent_rows.clone()});}
                    continue 'actors;
                }
            }
        }}
    }
}
fn prior_policy(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,viewer:&str,old:Option<&Value>,row:&Value,prior:&mut Option<Engine>,now:i64)->Result<bool,String>{
    match prior.as_mut(){Some(e)=>policy_in_at(bound,inv,rows,viewer,old,row,e,now),None=>policy_at(bound,inv,rows,viewer,old,row,now)}
}
pub(super) fn assertions(bound:&Bound,before:&BTreeMap<String,Vec<Value>>,after:&BTreeMap<String,Vec<Value>>,initial:&BTreeMap<String,Vec<Value>>,viewer:&str,steps:&[Step],prior:&mut Option<Engine>,current:&mut Engine,out:&mut Campaign){
    for inv in bound.invariants.iter().filter(|i|i.target=="always"){
        for row in after.get(&inv.table).into_iter().flatten(){
            let old=before.get(&inv.table).into_iter().flatten().find(|r|r.field("id").ok()==row.field("id").ok());
            if judged(inv,policy_in_at(bound,inv,after,viewer,old,row,current,history_clock(steps)),out)!=Ok(false){continue;}
            // A pre-existing seed defect is supplemental; a newly violated
            // assertion or changed image is an authored committed observation.
            if old!=Some(row)||old.is_some_and(|r|judged(inv,prior_policy(bound,inv,before,viewer,Some(r),r,prior,history_clock(steps)),out)==Ok(true)){
                violation(out,inv,steps,viewer,row,old,initial,"always");
            }
        }
    }
}
fn changed(bound:&Bound,_p:&Program,before:&BTreeMap<String,Vec<Value>>,after:&BTreeMap<String,Vec<Value>>,initial:&BTreeMap<String,Vec<Value>>,viewer:&str,steps:&[Step],prior:&mut Option<Engine>,current:&mut Engine,out:&mut Campaign){
    assertions(bound,before,after,initial,viewer,steps,prior,current,out);
    // Disappearance is coverage evidence only. Actual delete authority is
    // judged by the executed-write trace, never by a commit-end image diff.
    for inv in bound.invariants.iter().filter(|i|matches!(i.target.as_str(),"delete"|"write")){
        if bound.schema.tables[&inv.table].is_expiring()&&before.get(&inv.table).into_iter().flatten().any(|old|!after.get(&inv.table).into_iter().flatten().any(|new|new.field("id").ok()==old.field("id").ok())){
            out.unsupported.insert(format!("{}: implicit retirement is not an executed delete; delete intent requires an authored write boundary",inv.target_label()));
        }
    }
}

fn role_candidates<'a>(bound:&Bound,p:&'a Program,initial:&BTreeMap<String,Vec<Value>>,actors:&[String],cases:&[BTreeMap<String,Value>],fixture:&Engine,campaign:&mut Campaign)->Vec<(&'a Program,String,BTreeMap<String,Value>)>{
    let mut out=Vec::new();let mut groups=Vec::new();
    let json=serde_json::to_string(p).unwrap();
    if !ir::write_tables(p).iter().any(|(table,_)|!super::super::privilege::role_columns(bound,table).is_empty()){return out;}
    if !campaign.reserve(1){return Vec::new();}
    let Ok(mut judge)=fork(bound,fixture,Vec::new())else{return Vec::new();};
    for (table,_) in ir::write_tables(p){
        let columns=super::super::privilege::role_columns(bound,&table);
        if !columns.iter().any(|c|json.contains(&format!("\"{c}\":"))){continue;}
        let t=&bound.schema.tables[&table];
        for row in initial.get(&table).into_iter().flatten(){
            let principal=t.columns.iter().find_map(|(c,k)|matches!(k.required(),C::Principal).then(||row.field(c).ok()).flatten());
            let Some(principal)=principal else{continue;};
            let mut targets=Vec::new();
            for case in cases{
                let mut args=case.clone();
                for (name,kind) in &p.args{match kind{
                    ir::ArgType::Principal=>{args.insert(name.clone(),principal.clone());},
                    ir::ArgType::Ref{table:target} if target==&table=>{if let Ok(id)=row.field("id"){args.insert(name.clone(),id.clone());}},_=>{}
                }}
                if columns.iter().any(|c|args.get(c).is_some_and(|v|row.field(c).ok()==Some(v))){continue;}
                if !targets.contains(&args){targets.push(args);}
            }
            let mut row_cases=Vec::new();
            for actor in actors{
                let owner=columns.iter().filter_map(|c|t.written_by.get(c)).any(|a|row.field(&a.owner).ok()==Some(&Value::Id(actor.clone())));
                if !campaign.reserve(1){return out;}
                let gate=judge.fixture_policy(&t.update_rule_judged(),actor,Some(row),row,NOW).ok();
                if !owner&&gate!=Some(rules::Verdict::Readable){continue;}
                for args in &targets{row_cases.push((p,actor.clone(),args.clone()));}
            }
            groups.push(row_cases);
        }
    }
    for n in 0..groups.iter().map(Vec::len).max().unwrap_or(0){for g in &groups{if let Some(case)=g.get(n){out.push(case.clone());}}}
    out
}
// Prioritize actually admitted relationship changes rather than filling the
// history cap with cross-products rejected by a recipient-role require.
fn relationship_candidates<'a>(bound:&Bound,p:&'a Program,initial:&BTreeMap<String,Vec<Value>>,actors:&[String],cases:&[BTreeMap<String,Value>],fixture:&Engine,out:&mut Campaign)->Vec<(&'a Program,String,BTreeMap<String,Value>)>{
    let writes=ir::write_tables(p);
    if !p.args.values().any(|k|matches!(k,ir::ArgType::Principal))||!writes.iter().any(|(t,_)|super::super::privilege::role_columns(bound,t).is_empty()&&bound.schema.tables[t].columns.values().any(|k|matches!(k.required(),C::Principal))){return Vec::new();}
    let mut candidates=Vec::new();let mut attempts=0;
    let Ok(mut judge)=fixture.fork_fixture()else{return candidates;};
    for actor in actors{
        let allowed=writes.iter().any(|(t,kind)|super::super::privilege::role_columns(bound,t).is_empty()&&initial.get(t).into_iter().flatten().any(|row|{
            let table=&bound.schema.tables[t];let gates=if *kind=="insert"{vec![&table.rules.insert]}else{vec![&table.rules.insert,&table.rules.update]};
            gates.into_iter().any(|gate|matches!(judge.fixture_policy(gate,actor,Some(row),row,NOW),Ok(rules::Verdict::Readable)))
        }));
        if !allowed{continue;}
        for args in cases{
            if attempts>=128||candidates.len()>=16||!out.reserve(1){return candidates;}attempts+=1;
            let Ok(mut e)=fixture.fork_fixture()else{continue;};
            let Ok(materialized)=materialize_arguments(&mut e,&p.args,args,actor)else{continue;};
            if !matches!(e.mutate(&p.name,None,replay_ids::context(actor,materialized).at(NOW)),Ok(r) if matches!(r.state,snapback4_core::WriteState::Sent{..})){continue;}
            let Ok(after)=readback(&e)else{continue;};
            if writes.iter().any(|(t,_)|initial.get(t).into_iter().flatten().any(|old|after.get(t).into_iter().flatten().find(|r|r.field("id").ok()==old.field("id").ok()).is_some_and(|new|bound.schema.tables[t].columns.iter().any(|(c,k)|matches!(k.required(),C::Principal)&&old.field(c).ok()!=new.field(c).ok())))){
                candidates.push((p,actor.clone(),args.clone()));
            }
        }
    }candidates
}
pub(super) fn initial_observers(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    if bound.invariants.is_empty()||out.exhausted(){return;}
    let Ok(initial)=readback(fixture)else{return;};
    let actors=actors(bound,&initial);
    if !out.reserve(1){return;}
    let Ok(mut engine)=fork(bound,fixture,Vec::new())else{return;};
    observe(bound,&mut engine,&initial,&initial,&actors,&[],out);
}
// Prefer real lifecycle successors before the general diagonal history matrix.
// @ref LLP 3000.036.004#163-directed-finite-histories — pruning orders finite replay, never proves safety.
pub(super) fn lifecycle_observers(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    lifecycle_observers_to(bound,fixture,out,out.directed_base.saturating_add(4096))
}
pub(super) fn lifecycle_observers_to(bound:&Bound,fixture:&Engine,out:&mut Campaign,limit:usize){
    if bound.invariants.is_empty()||out.exhausted()||bound.invariants.iter().all(|i|out.violations.iter().any(|v|v.invariant_site==i.site.to_string()&&v.reachability.is_reachable())){return;}
    let interesting=bound.invariants.iter().filter(|i|{
        if out.violations.iter().any(|v|v.invariant_site==i.site.to_string()&&v.reachability.is_reachable()){return false;}
        let t=&bound.schema.tables[&i.table];let gate=match i.target.as_str(){"read"=>super::super::columns::admission(t,i.column.as_deref()),"insert"=>t.rules.insert.clone(),"update"=>t.update_rule_judged().into_owned(),_=>RuleExpr::Allow};
        i.policy.as_ref().is_none_or(|policy|kernel::implies(&gate,policy)!=Ok(true))
    }).collect::<Vec<_>>();
    if interesting.is_empty(){return;}
    let selected_sites=interesting.iter().map(|i|i.site.to_string()).collect::<BTreeSet<_>>();
    let mut relevant=interesting.iter().flat_map(|i|std::iter::once(i.table.clone()).chain(i.policy.iter().flat_map(kernel::dependencies))).collect::<BTreeSet<_>>();
    for inv in &interesting{
        if let Some(mut syntax)=inv.syntax.clone(){crate::bind::intent_walk::expression(&mut syntax,&mut |e|if let ast::Expr::Read(read)|ast::Expr::Exists{read,..}=e{relevant.insert(read.table.clone());});}
        if let Some(contract)=bound.security_conservation.get(&inv.site.to_string()){relevant.insert(contract.ledger.clone());relevant.extend(contract.refund_ledger.iter().cloned());}
    }
    for _ in 0..bound.schema.tables.len(){let old=relevant.clone();for name in &old{for kind in bound.schema.tables[name].columns.values(){if let C::Ref{table}=kind.required(){relevant.insert(table.clone());}}}if old==relevant{break;}}
    let has_lifecycle=relevant.iter().any(|name|bound.schema.tables[name].columns.values().any(|k|matches!(k.required(),C::Enum{..}|C::Bool|C::Principal|C::Ref{..})));
    if !has_lifecycle{return;}
    let mut transitions=bound.programs.iter().filter(|bp|bp.program.kind==ProgramKind::Mutation&&!bp.program.native&&!bound.schema.operations.get(&bp.program.name).is_some_and(|f|f.ephemeral)).filter(|bp|{
        ir::write_tables(&bp.program).iter().any(|(name,kind)|relevant.contains(name)&&(*kind!="insert"||bound.invariants.iter().any(|i|&i.table==name)))
    }).collect::<Vec<_>>();
    let focused=interesting.iter().filter(|i|i.policy.as_ref().is_none_or(|policy|kernel::implies(&RuleExpr::And(i.requirements.clone()),policy)!=Ok(true))).filter_map(|i|i.operation.as_ref()).collect::<BTreeSet<_>>();
    if !bound.invariants.is_empty()&&bound.invariants.iter().all(super::super::derived::is_derived){
        transitions.retain(|bp|ir::write_tables(&bp.program).iter().any(|(t,_)|super::super::privilege::role_columns(bound,t).is_empty()||bound.invariants.iter().any(|i|i.table==*t)));
        out.unsupported.insert("focused derived workflows defer unrelated roster mutations to the general campaign".into());
    }
    if !bound.invariants.is_empty()&&bound.invariants.iter().all(super::super::derived::is_derived){
        // @ref LLP 3000.036.004.000#11-wave-27-precision-and-workflow-conservation — deferred payloads remain general coverage.
        // A generic category setter must not displace lifecycle preparation
        // when its payload is absent from every program read, policy and
        // candidate. Unknown patches and structural effects remain eligible;
        // the ordinary campaign retains these deferred payload combinations.
        fn fields(value:&serde_json::Value,out:&mut BTreeSet<String>){
            match value{serde_json::Value::Object(xs)=>{for (tag,value) in xs{
                if matches!(tag.as_str(),"Field"|"OldField"|"NextField"|"field"|"column"|"expire"|"notBefore"){
                    if let Some(name)=value.as_str().or_else(||value.get("name").and_then(|v|v.as_str())){out.insert(name.into());}
                }
                if tag=="WordPrefixes"&&let Some(columns)=value.get("fields").and_then(|v|v.as_array()){out.extend(columns.iter().filter_map(|v|v.as_str().map(str::to_owned)));}
                fields(value,out);
            }},serde_json::Value::Array(xs)=>for value in xs{fields(value,out)},_=>{}}
        }
        fn patches(value:&serde_json::Value,out:&mut BTreeSet<String>,unknown:&mut bool){
            match value{serde_json::Value::Object(xs)=>{for (tag,value) in xs{
                if matches!(tag.as_str(),"Update"|"WriteTarget"){
                    if let Some(object)=value.get("patch").and_then(|v|v.get("Object")).and_then(|v|v.as_object()){out.extend(object.keys().cloned());}else{*unknown=true;}
                }
                patches(value,out,unknown);
            }},serde_json::Value::Array(xs)=>for value in xs{patches(value,out,unknown)},_=>{}}
        }
        let mut dependencies=BTreeSet::new();
        fields(&serde_json::to_value(&bound.schema).unwrap(),&mut dependencies);
        fields(&serde_json::to_value(&bound.invariants).unwrap(),&mut dependencies);
        for inv in &bound.invariants{dependencies.extend(inv.column.iter().cloned());if let Some(mut syntax)=inv.syntax.clone(){crate::bind::intent_walk::expression(&mut syntax,&mut |e|if let ast::Expr::Member{name,..}=e{dependencies.insert(name.clone());});}}
        for bp in &bound.programs{
            fields(&serde_json::to_value(&bp.program).unwrap(),&mut dependencies);
            for read in ir::read_sites(&bp.program){if let Some(index)=bound.schema.tables[&read.table].index(&read.index){dependencies.extend(index.columns());dependencies.extend(bound.schema.tables[&read.table].columns.keys().filter(|column|index.uses_column(column)).cloned());}}
        }
        transitions.retain(|bp|{
            if ir::write_tables(&bp.program).iter().any(|(_,kind)|*kind!="update"){return true;}
            let mut columns=BTreeSet::new();let mut unknown=false;patches(&serde_json::to_value(&bp.program).unwrap(),&mut columns,&mut unknown);
            let keep=unknown||columns.is_empty()||!columns.is_disjoint(&dependencies);
            if !keep{out.unsupported.insert(format!("{}: focused derived replay defers unreferenced payload-only updates; their combinations remain in general replay",bp.program.name));}keep
        });
    }
    // Relevant evidence writers and approval recorders precede unrelated
    // lifecycle preparation; this orders real replay, never fabricates a state.
    let derived_only=!bound.invariants.is_empty()&&bound.invariants.iter().all(super::super::derived::is_derived);
    transitions.sort_by_key(|bp|{
        let program=serde_json::to_string(&bp.program).unwrap();let writes=ir::write_tables(&bp.program);
        let evidence=derived_only&&interesting.iter().any(|inv|writes.iter().any(|(table,_)|table==&inv.table)&&bound.schema.tables[&inv.table].columns.keys().any(|column|(inv.column.as_ref()==Some(column)||inv.policy.as_ref().is_some_and(|policy|policy.any_term(&|term|matches!(term,RuleTerm::Field(name)|RuleTerm::OldField(name)|RuleTerm::NextField(name) if name==column))))&&program.contains(&format!("\"{column}\":"))));
        (!focused.contains(&bp.program.name),!evidence,writes.iter().all(|(t,_)|!super::super::privilege::role_columns(bound,t).is_empty()))
    });
    if transitions.is_empty(){return;}
    let Ok(initial)=readback(fixture)else{return;};
    if !relevant.iter().any(|name|super::super::privilege::role_columns(bound,name).is_empty()&&initial.get(name).is_some_and(|rs|!rs.is_empty())){
        out.unsupported.insert("directed lifecycle needs a populated resource root; generated initialization and breadth retain bootstraps, longer empty-start histories remain uncovered".into());return;
    }
    let actors=actors(bound,&initial);
    let identity_policies=serde_json::to_string(&bound.invariants).unwrap();
    let named_actors=actors.iter().filter(|actor|identity_policies.contains(&serde_json::to_string(actor).unwrap())).cloned().collect::<BTreeSet<_>>();
    if !out.reserve(1){return;}
    let Ok(root)=fixture.fork_fixture()else{return;};
    let mut frontier=vec![(root,Vec::<Step>::new())];
    let signature_fields=bound.security_approval_inputs.iter().flat_map(|((table,_),columns)|columns.iter().map(move |column|(table.clone(),column.clone()))).chain(interesting.iter().filter_map(|inv|inv.column.as_ref().map(|column|(inv.table.clone(),column.clone())))).collect::<BTreeSet<_>>();
    fn signature(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>,preserved:&BTreeSet<(String,String)>)->String{
        // Equality of this projection is only an exploration heuristic. Missing
        // worlds are explicitly uncovered; it never discharges an obligation.
        let projected=rows.iter().map(|(name,rs)|{let t=&bound.schema.tables[name];let mut images=rs.iter().map(|r|t.columns.iter().filter(|(c,k)|c.as_str()!="id"&&(preserved.contains(&(name.clone(),(*c).clone()))||k.is_optional()||matches!(k.required(),C::Enum{..}|C::Bool|C::Principal|C::Ref{..}|C::Time))).filter_map(|(c,k)|r.field(c).ok().map(|v|(c.clone(),if k.is_optional()&&!preserved.contains(&(name.clone(),c.clone()))&&!matches!(k.required(),C::Enum{..}|C::Bool|C::Principal|C::Ref{..}|C::Time){Value::Bool(*v!=Value::Null)}else{v.clone()}))).collect::<BTreeMap<_,_>>()).collect::<Vec<_>>();images.sort_by_key(|r|serde_json::to_string(r).unwrap());(name.clone(),images)}).collect::<BTreeMap<_,_>>();serde_json::to_string(&projected).unwrap()
    }
    let mut seen=BTreeSet::from([signature(bound,&initial,&signature_fields)]);
    for _ in 0..12{
        let mut next=Vec::new();let frontier_count=frontier.len();
        for (base,steps) in frontier{
            let Ok(before)=readback(&base)else{continue;};
            for bp in &transitions{
                let p=&bp.program;
                let targets=ir::write_tables(p);

                if targets.iter().all(|(t,kind)|*kind=="insert"&&before.get(t).is_some_and(|rs|rs.len()>=if p.args.values().any(|k|matches!(k,ir::ArgType::Ref{table} if table==t))&&bound.invariants.iter().any(|i|super::super::derived::is_derived(i)&&i.target=="insert"&&i.table==*t){4}else{2})){out.unsupported.insert("directed lifecycle omits further insert-only expansion of populated tables; additional populations uncovered".into());continue;}
                let ordinary=fixture_cases(bound,p,&before,&actors,out);
                let mut cases=role_candidates(bound,p,&before,&actors,&ordinary,&base,out).into_iter().map(|(_,_,args)|args).collect::<Vec<_>>();
                cases.extend(ordinary);let mut argument_keys=BTreeSet::new();cases.retain(|args|argument_keys.insert(serde_json::to_string(args).unwrap()));
                let cases=directed_cases(bound,p,cases,out);
                if cases.len()>8{out.unsupported.insert(format!("{}: directed lifecycle arguments capped at 8",p.name));}
                let mut successors=Vec::<(Engine,Vec<Step>,usize,String)>::new();
                let program_json=serde_json::to_string(p).unwrap();
                for args in cases.into_iter().take(8){
                    let mut ordered=actors.iter().map(|actor|{
                        let mut score=0;let mut class=BTreeSet::new();
                        for (table,rs) in &before{let roles=super::super::privilege::role_columns(bound,table);for row in rs{
                            if !bound.schema.tables[table].columns.iter().any(|(c,k)|matches!(k.required(),C::Principal)&&row.field(c).ok()==Some(&Value::Id(actor.clone()))){continue;}
                            for c in &roles{if let Ok(value)=row.field(c){class.insert(format!("{table}.{c}={value:?}"));}}
                            if !roles.is_empty()&&roles.iter().any(|c|row.field(c).is_ok_and(|v|matches!(v,Value::String(role) if program_json.contains(&format!("\"String\":\"{role}\""))))){score+=4;}
                            if p.args.iter().any(|(name,k)|matches!(k,ir::ArgType::Ref{table:t} if t==table)&&args.get(name)==row.field("id").ok()){score+=2;class.insert(format!("owns target {table}"));}
                        }}
                        // Keep the best owner within a role, then leave a slot
                        // for another role admitted by an argument-conditioned
                        // branch. Ownership must not split one global role into
                        // both of the two retained actor classes.
                        if class.iter().any(|label|!label.starts_with("owns target ")){class.retain(|label|!label.starts_with("owns target "));}
                        if named_actors.contains(actor){class.insert(format!("named policy principal {actor}"));}
                        if program_json.contains(&format!("\"{}\"",actor)){score+=8;}
                        (actor,score,class)
                    }).collect::<Vec<_>>();ordered.sort_by_key(|(_,score,_)|std::cmp::Reverse(*score));
                    // Two principals of one privileged role must not consume
                    // both slots and hide a different admitted role's witness.
                    let actor_count=ordered.len();let mut actor_classes=BTreeSet::new();ordered.retain(|(_,_,class)|actor_classes.insert(class.clone()));
                    if ordered.len()<actor_count{out.unsupported.insert(format!("{}: directed role-class deduplication omits actors with matching role/target projections; actor-specific histories uncovered",p.name));}
                    if ordered.len()>2{out.unsupported.insert(format!("{}: directed actor ordering keeps two candidates per argument tuple; other actors remain in breadth campaign",p.name));}
                    for (viewer,_,_) in ordered.into_iter().take(2){
                    for clock in clock_candidates(bound,p,&before,&steps,out){
                    if out.directed_attempts>=limit||!out.reserve(1){out.unsupported.insert("directed lifecycle successors reached their shared attempt limit; remaining histories uncovered".into());return;}out.directed_attempts+=1;
                    let Ok(mut engine)=base.fork_fixture()else{continue;};
                    let Ok(args)=materialize_arguments(&mut engine,&p.args,&args,viewer)else{continue;};
                    let mut prior=None;
                    if bound.invariants.iter().any(|i|i.target!="read"&&i.policy.as_ref().is_some_and(RuleExpr::has_reference)){if !out.reserve(1){return;}prior=base.fork_fixture().ok();}
                    out.attempted+=1;*out.operations.entry(p.name.clone()).or_default()+=1;
                    let trace=super::executed::trace(bound,p,&engine);
                    let Ok(result)=engine.mutate(&p.name,None,replay_ids::context(viewer,args.clone()).at(clock).with_fixture_trace(trace.clone()))else{continue;};
                    if !matches!(result.state,snapback4_core::WriteState::Sent{..}){out.refused+=1;continue;}
                    let Ok(after)=readback(&engine)else{continue;};

                    let mut history=steps.clone();history.push(Step{observed_data:None,clock:Some(clock),operation:p.name.clone(),viewer:viewer.clone(),args:args.clone(),result:serde_json::to_value(&result.state).unwrap()});
                    super::executed::record(bound,p,&trace,&result.state,&after,&initial,viewer,&history,&mut engine,out);
                    changed(bound,p,&before,&after,&initial,viewer,&history,&mut prior,&mut engine,out);
                    let changed_tables=after.iter().filter(|(t,rs)|before.get(*t)!=Some(*rs)).map(|(t,_)|t.clone()).collect();
                    super::workflow::run(bound,&engine,&initial,&history,&changed_tables,out);
                    if selected_sites.iter().all(|site|out.violations.iter().any(|v|&v.invariant_site==site&&v.reachability.is_reachable())){
                        out.unsupported.insert("directed lifecycle stopped after every selected independent intent had a replayed violation; additional histories uncovered".into());return;
                    }
                    if before==after{continue;}
                    out.sequences+=1;
                    if !seen.insert(signature(bound,&after,&signature_fields)){out.unsupported.insert("directed lifecycle signature merges worlds differing in unselected payload; remaining worlds uncovered".into());continue;}
                    observe(bound,&mut engine,&after,&initial,&actors,&history,out);
                    column_reads::after_history(bound,&engine,&initial,&history,out);
                    if selected_sites.iter().all(|site|out.violations.iter().any(|v|&v.invariant_site==site&&v.reachability.is_reachable())){
                        out.unsupported.insert("directed lifecycle stopped after every selected independent intent had a replayed violation; additional histories uncovered".into());return;
                    }
                    let progress=after.iter().filter(|(name,_)|relevant.contains(*name)).map(|(name,rs)|{let t=&bound.schema.tables[name];rs.iter().map(|r|t.columns.iter().map(|(c,k)|match k.required(){C::Enum{..} if !super::super::privilege::role_columns(bound,name).contains(c)=>before.get(name).into_iter().flatten().find(|old|old.field("id").ok()==r.field("id").ok()).is_some_and(|old|old.field(c).ok()!=r.field(c).ok()) as usize*4,C::Bool=>matches!(r.field(c),Ok(Value::Bool(true))) as usize,C::Time=>before.get(name).into_iter().flatten().find(|old|old.field("id").ok()==r.field("id").ok()).is_some_and(|old|old.field(c).ok()!=r.field(c).ok()) as usize*3,_ if k.is_optional()=>before.get(name).into_iter().flatten().find(|old|old.field("id").ok()==r.field("id").ok()).is_some_and(|old|(old.field(c).ok()==Some(&Value::Null))!=(r.field(c).ok()==Some(&Value::Null))) as usize*3,_=>0}).sum::<usize>()).sum::<usize>()}).sum::<usize>();
                    let progress=progress+after.iter().filter(|(t,_)|relevant.contains(*t)&&super::super::privilege::role_columns(bound,t).is_empty()).map(|(t,rs)|rs.len().saturating_sub(initial.get(t).map_or(0,Vec::len))*2).sum::<usize>();
                    // Preparing checked evidence, then actually recording its
                    // approval, must not lose the beam to unrelated stage hops.
                    let approval_progress=if derived_only{interesting.iter().filter_map(|inv|{
                        let column=inv.column.as_ref()?;let policy=inv.policy.as_ref()?;
                        Some(bound.security_approval_inputs.iter().filter(|((table,stamp),columns)|table==&inv.table&&columns.contains(column)&&policy.any_term(&|term|matches!(term,RuleTerm::OldField(name)|RuleTerm::NextField(name) if name==stamp))).map(|((table,stamp),_)|after.get(table).into_iter().flatten().map(|row|{
                            if matches!(row.field(stamp),Ok(Value::Bool(true)|Value::Int(_))){64}else{initial.get(table).into_iter().flatten().find(|old|old.field("id").ok()==row.field("id").ok()).is_some_and(|old|old.field(column).ok()!=row.field(column).ok()) as usize*8}
                        }).sum::<usize>()).sum::<usize>())
                    }).sum::<usize>()}else{0};
                    let progress=progress+approval_progress;
                    let goal_tables=interesting.iter().filter(|i|super::super::derived::is_derived(i)&&i.target=="insert").map(|i|i.table.clone()).collect::<BTreeSet<_>>();
                    let mut goal_tables=goal_tables;
                    for _ in 0..4{
                        let dependencies=bound.programs.iter().map(|b|&b.program).filter(|p|ir::write_tables(p).iter().any(|(t,k)|goal_tables.contains(t)&&matches!(*k,"insert"|"upsert"))).flat_map(|p|p.args.values().filter_map(|kind|if let ir::ArgType::Ref{table}=kind{Some(table.clone())}else{None})).collect::<BTreeSet<_>>();
                        let old=goal_tables.len();goal_tables.extend(dependencies);if old==goal_tables.len(){break;}
                    }
                    let goal_creators=bound.programs.iter().map(|b|&b.program).filter(|p|ir::write_tables(p).iter().any(|(t,k)|goal_tables.contains(t)&&matches!(*k,"insert"|"upsert"))).collect::<Vec<_>>();
                    let mut progress=progress;
                    for goal in goal_creators {
                        for kind in goal.args.values(){if let ir::ArgType::Ref{table}=kind{progress+=after.get(table).map_or(0,Vec::len).min(2)*20;}}
                        let preferred=principal_preferences(bound,goal,&after);
                        progress+=preferred.iter().filter(|(name,_)|matches!(goal.args.get(*name),Some(ir::ArgType::Ref{..}))).map(|(_,ids)|ids.len().min(2)*40).sum::<usize>();
                    }
                    let state_key=signature(bound,&after.iter().filter(|(name,_)|relevant.contains(*name)).map(|(name,rs)|(name.clone(),rs.clone())).collect(),&signature_fields);
                    if successors.iter().any(|(_,_,_,key)|key==&state_key){out.unsupported.insert("directed successor diversity merges audit-only attribution variants; additional histories uncovered".into());continue;}
                    successors.push((engine,history,progress,state_key));
                    out.directed_peak_worlds=out.directed_peak_worlds.max(frontier_count+next.len()+successors.len()+1);
                    successors.sort_by_key(|(_,_,priority,_)|std::cmp::Reverse(*priority));
                    if successors.len()>3{successors.truncate(3);out.unsupported.insert(format!("{}: directed successor selection keeps three priority resource states per operation/world; other states uncovered",p.name));}
                }}}
                for (engine,history,priority,_) in successors{
                    next.push((engine,history,priority));
                    out.directed_peak_worlds=out.directed_peak_worlds.max(frontier_count+next.len()+1);
                    next.sort_by_key(|(_,_,priority)|std::cmp::Reverse(*priority));
                    if next.len()>5{next.truncate(5);out.unsupported.insert("directed lifecycle beam keeps five priority worlds; displaced worlds dropped immediately and remain uncovered".into());}
                }
            }
        }
        if next.is_empty(){return;}
        frontier=next.into_iter().map(|(e,h,_)|(e,h)).collect();
    }
    out.unsupported.insert("directed lifecycle traces bounded to twelve authored mutations; longer traces uncovered".into());
}
pub(super) fn run(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    if bound.invariants.is_empty()||out.exhausted(){return;}
    let initial=match readback(fixture){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);return;}};
    if initial.values().map(Vec::len).sum::<usize>()>1000{out.unsupported.insert("history fixture exceeds 1000 rows".into());return;}
    let actors=actors(bound,&initial);
    let probes=Vec::new();
    let mut groups=Vec::new();
    for bp in bound.programs.iter().filter(|p|p.program.kind==ProgramKind::Mutation&&!p.program.native&&!bound.schema.operations.get(&p.program.name).is_some_and(|f|f.ephemeral)){
        let mut cases=fixture_cases(bound,&bp.program,&initial,&actors,out);
        // @ref LLP 3000.036.004#178-past-time-breadth-controls — preserve the old past-deadline control before compact trace deduplication.
        let time_args=bp.program.args.iter().filter(|(_,kind)|match kind{ir::ArgType::Time=>true,ir::ArgType::Optional(inner)=>matches!(inner.as_ref(),ir::ArgType::Time),_=>false}).map(|(name,_)|name).collect::<Vec<_>>();
        cases.sort_by_key(|args|!time_args.iter().any(|name|matches!(args.get(*name),Some(Value::Int(n)) if *n<NOW)));

        let mut group=relationship_candidates(bound,&bp.program,&initial,&actors,&cases,fixture,out);
        group.extend(role_candidates(bound,&bp.program,&initial,&actors,&cases,fixture,out));
        // Diagonal order gives both actors and argument values an early turn.
        let mut seen=group.iter().map(|(_,viewer,args)|serde_json::to_string(&(viewer,args)).unwrap()).collect::<BTreeSet<_>>();
        // Give every actor the same first argument tuple before diagonal
        // variation; a referee must not see only the overturned bout by chance.
        if let Some(args)=cases.first(){for actor in &actors{
            if group.len()>=LIMIT||out.exhausted(){break;}
            if seen.insert(serde_json::to_string(&(actor,args)).unwrap()){group.push((&bp.program,actor.clone(),args.clone()));}
        }}
        'diagonal:for shift in 0..actors.len(){for n in 0..cases.len().max(actors.len()){
            if cases.is_empty()||out.exhausted(){break 'diagonal;}
            if group.len()>=LIMIT{out.unsupported.insert(format!("{}: history candidate actors/arguments capped at 512",bp.program.name));break 'diagonal;}
            let actor=&actors[(n+shift)%actors.len()];let args=&cases[n%cases.len()];
            if seen.insert(serde_json::to_string(&(actor,args)).unwrap()){group.push((&bp.program,actor.clone(),args.clone()));}
        }}
        if !group.is_empty(){groups.push(group);}
    }
    let mut candidates=Vec::new();let mut candidate_keys=BTreeSet::new();
    // Front-load a small fair frontier of role and relationship changes so
    // ordinary no-op/rejected mutations cannot consume all observer work first.
    for group in &groups {
        let p=group[0].0;
        let priority=ir::write_tables(p).iter().any(|(t,kind)|*kind!="insert"&&(!super::super::privilege::role_columns(bound,t).is_empty()||p.args.values().any(|k|matches!(k,ir::ArgType::Principal))));
        if priority{for c in group.iter().take(8){if candidate_keys.insert(serde_json::to_string(&(&c.0.name,&c.1,&c.2)).unwrap()){candidates.push(c.clone());if candidates.len()>=LIMIT/4{break;}}}}
        if candidates.len()>=LIMIT/4{break;}
    }
    'candidates:for n in 0..groups.iter().map(Vec::len).max().unwrap_or(0){for g in &groups{if let Some(c)=g.get(n){if candidate_keys.insert(serde_json::to_string(&(&c.0.name,&c.1,&c.2)).unwrap()){candidates.push(c.clone());}if candidates.len()==LIMIT{break 'candidates;}}}}
    if !out.reserve(1){return;}
    let mut base=match fork(bound,fixture,probes.clone()){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);return;}};
    for inv in bound.invariants.iter().filter(|i|i.target=="always"){
        for row in initial.get(&inv.table).into_iter().flatten(){for viewer in &actors{
            if !out.reserve(1){return;}
            if judged(inv,policy_in(bound,inv,&initial,viewer,None,row,&mut base),out)!=Ok(false){continue;}
            let mut witness=Campaign::default();violation(&mut witness,inv,&[],viewer,row,None,&initial,"always");
            if let Some(mut v)=witness.violations.pop(){v.reachability=Reachability::AuthoredFixtureTrace;v.operation="$fixture.assertion".into();v.rule_path="initial trusted fixture assertion; no authored mutation".into();v.scope="definite violation in authored fixture; initialization trusted, no authored transition claimed".into();out.violations.push(v);}break;
        }}
    }
    observe(bound,&mut base,&initial,&initial,&actors,&[],out);
    // Spend half the pair budget on grant changes followed by an operation
    // as the affected principal; interleave first steps and successor names.
    let mut role_groups=Vec::new();
    for (i,(p,_,args)) in candidates.iter().enumerate().take(LIMIT){
        let json=serde_json::to_string(p).unwrap();
        let rosters=ir::write_tables(p).into_iter().filter_map(|(t,_)|{
            let roles=super::super::privilege::role_columns(bound,&t);
            roles.iter().any(|c|json.contains(&format!("\"{c}\":"))).then_some(t)
        }).collect::<BTreeSet<_>>();
        if rosters.is_empty(){continue;}
        let mut recipients=BTreeSet::new();
        for (name,kind) in &p.args {if let Some(value)=args.get(name){match kind {
            ir::ArgType::Principal=>{if let Value::Id(actor)=value{recipients.insert(actor.clone());}},
            ir::ArgType::Ref{table} if rosters.contains(table)=>{
                if let Some(row)=initial.get(table).into_iter().flatten().find(|r|r.field("id").ok()==Some(value)){
                    for (column,kind) in &bound.schema.tables[table].columns{if matches!(kind.required(),C::Principal)&&let Ok(Value::Id(actor))=row.field(column){recipients.insert(actor.clone());}}
                }
            },_=>{}
        }}}
        let mut seen=BTreeSet::new();
        let successors=candidates.iter().enumerate().filter_map(|(j,(next,actor,_))|(next.name!=p.name&&recipients.contains(actor)&&seen.insert((next.name.clone(),actor.clone()))).then_some((i,j))).collect::<Vec<_>>();
        if !successors.is_empty(){role_groups.push(successors);}
    }
    let mut role_pairs=Vec::new();
    'pairs:for n in 0..role_groups.iter().map(Vec::len).max().unwrap_or(0){for group in &role_groups{if let Some(pair)=group.get(n){role_pairs.push(*pair);if role_pairs.len()==LIMIT/2{break 'pairs;}}}}
    // Breadth first, then targeted and diagonal pairs: no first step owns the cap.
    let history_limit=if out.history_limit==0{LIMIT}else{out.history_limit.min(LIMIT)};
    let singles=candidates.len().min(history_limit);
    let mut setups=Vec::new();let mut role_changes=Vec::new();let mut committed=Vec::new();
    let mut setup_seen=BTreeSet::new();let mut role_seen=BTreeSet::new();let mut pair_plan=Vec::new();
    for n in 0..singles+history_limit {
        if !out.reserve(1){break;}
        if n==singles&&!candidates.is_empty(){
            let disclosures=super::executed::pairs(bound,&candidates,&committed);
            let mut seen=BTreeSet::new();
            for pair in disclosures.into_iter().take(LIMIT/2){if seen.insert(pair){pair_plan.push(pair);}}
            'setup:for &second in &role_changes{for &first in &setups{if seen.insert((first,second)){pair_plan.push((first,second));if pair_plan.len()==LIMIT/2{break 'setup;}}}}
            for &(first,second) in &role_pairs{if pair_plan.len()==LIMIT{break;}if seen.insert((first,second)){pair_plan.push((first,second));}}
            let mut k=0;
            while pair_plan.len()<LIMIT{pair_plan.push((k%candidates.len(),(k/candidates.len()+k+1)%candidates.len()));k+=1;}
        }
        let indices=if n<singles{vec![n]}else if candidates.is_empty(){break;}else{let (first,second)=pair_plan[n-singles];vec![first,second]};
        let mut engine=match fork(bound,fixture,probes.clone()){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);break;}};
        out.sequences+=1;let mut steps=Vec::new();
        for i in indices{
            if !out.reserve(1){break;}
            let (p,viewer,args)=&candidates[i];let before=match readback(&engine){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);break;}};
            let args=match materialize_arguments(&mut engine,&p.args,args,viewer){Ok(a)=>a,Err(why)=>{out.unsupported.insert(format!("{}: history asset arguments: {why}",p.name));break;}};
            let mut prior=if bound.invariants.iter().any(|i|i.target!="read"&&i.policy.as_ref().is_some_and(RuleExpr::has_reference)){if !out.reserve(1){break;}match fork(bound,&engine,Vec::new()){Ok(e)=>Some(e),Err(why)=>{out.unsupported.insert(why);None}}}else{None};
            out.attempted+=1;*out.operations.entry(p.name.clone()).or_default()+=1;
            let trace=super::executed::trace(bound,p,&engine);
            match engine.mutate(&p.name,None,replay_ids::context(viewer,args.clone()).at(NOW).with_fixture_trace(trace.clone())){
                Ok(result)=>{
                    let sent=matches!(result.state,snapback4_core::WriteState::Sent{..});
                    steps.push(Step{observed_data:None,clock:None,operation:p.name.clone(),viewer:viewer.clone(),args:args.clone(),result:serde_json::to_value(&result.state).unwrap()});
                    let after=match readback(&engine){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);break;}};
                    if sent&&n<singles{
                        if before!=after{
                            let transition=bound.schema.tables.iter().any(|(name,t)|before.get(name).into_iter().flatten().any(|old|after.get(name).into_iter().flatten().find(|r|r.field("id").ok()==old.field("id").ok()).is_some_and(|new|t.columns.iter().any(|(c,k)|matches!(k.required(),C::Enum{..})&&old.field(c).ok()!=new.field(c).ok()))));
                            if transition{committed.insert(0,i);}else{committed.push(i);}
                        }
                        let signature=serde_json::to_string(&(&p.name,viewer,&candidates[i].2)).unwrap();
                        let new_media=bound.invariants.iter().filter(|inv|inv.target=="read"&&initial.get(&inv.table).is_none_or(Vec::is_empty)).any(|inv|{
                            let table=&bound.schema.tables[&inv.table];
                            after.get(&inv.table).into_iter().flatten().any(|row|table.columns.iter().any(|(column,kind)|kind.contains_asset()&&row.field(column).is_ok_and(|v|*v!=Value::Null&&!matches!(v,Value::Array(xs) if xs.is_empty()))))
                        });
                        if new_media&&setup_seen.insert(signature.clone()){setups.push(i);}
                        let changed_role=bound.schema.tables.iter().any(|(table,_)|{
                            let columns=super::super::privilege::role_columns(bound,table);
                            !columns.is_empty()&&before.get(table).into_iter().flatten().any(|old|after.get(table).into_iter().flatten().find(|r|r.field("id").ok()==old.field("id").ok()).is_some_and(|new|columns.iter().any(|c|old.field(c).ok()!=new.field(c).ok())))
                        });
                        if changed_role&&role_seen.insert(signature){role_changes.push(i);}
                    }
                    if sent{super::executed::record(bound,p,&trace,&result.state,&after,&initial,viewer,&steps,&mut engine,out);changed(bound,p,&before,&after,&initial,viewer,&steps,&mut prior,&mut engine,out);}else{out.refused+=1;}
                    if sent&&before!=after{observe(bound,&mut engine,&after,&initial,&actors,&steps,out);column_reads::after_history(bound,&engine,&initial,&steps,out);}
                },Err(e)=>{out.unsupported.insert(format!("{}: history engine error {e}",p.name));break;}
            }
        }
    }
    out.unsupported.insert("history breadth/pairs bounded to 512; unvisited and longer traces remain uncovered".into());
}

#[cfg(test)] mod directed_pruning_tests{use super::*;
#[test] fn correlated_boolean_arguments_are_explicitly_uncovered(){
 let bound=crate::compile(&[("schema.q".into(),"table docs:\n  x: bool\n  read <- allow\n  insert <- allow\n  online only\nmutation add(a: bool,b: bool):\n  return insert docs {x:a and b}\n".into())]);
 assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);let p=&bound.programs[0].program;
 let cases=[(false,false),(false,true),(true,false),(true,true)].into_iter().map(|(a,b)|BTreeMap::from([("a".into(),Value::Bool(a)),("b".into(),Value::Bool(b))])).collect();
 let mut out=Campaign::default();let selected=directed_cases(&bound,p,cases,&mut out);assert_eq!(selected.len(),3);assert!(out.unsupported.iter().any(|s|s.contains("argument grouping")));
}}

pub(super) fn history_clock(steps:&[Step])->i64{steps.iter().rev().find_map(|s|s.clock).unwrap_or(NOW)}
fn clock_candidates(bound:&Bound,p:&Program,rows:&BTreeMap<String,Vec<Value>>,steps:&[Step],out:&mut Campaign)->Vec<i64>{
    let current=history_clock(steps);
    if !bound.invariants.is_empty()&&bound.invariants.iter().all(super::super::derived::is_derived){
        out.unsupported.insert("focused derived workflows keep the current clock; temporal boundary combinations remain in the general campaign".into());return vec![current];
    }
    fn walk(value:&serde_json::Value,f:&mut impl FnMut(&serde_json::Value)){f(value);match value{serde_json::Value::Array(xs)=>for x in xs{walk(x,f)},serde_json::Value::Object(xs)=>for x in xs.values(){walk(x,f)},_=>{}}}
    let json=serde_json::to_value(p).unwrap();let mut bindings=BTreeMap::new();
    walk(&json,&mut |v|{for tag in ["Let","Const"]{if let Some(b)=v.get(tag)&&let(Some(name),Some(value))=(b.get("name").and_then(|v|v.as_str()),b.get("value")){bindings.insert(name.to_owned(),value.clone());}}});
    fn clock(value:&serde_json::Value,bindings:&BTreeMap<String,serde_json::Value>,depth:usize)->bool{
        if depth>32{return true;}
        if matches!(value.get("Input").and_then(|v|v.as_str()),Some("Now"|"ReadTime")){return true;}
        if let Some(name)=value.get("Variable").and_then(|v|v.as_str())&&let Some(value)=bindings.get(name)&&clock(value,bindings,depth+1){return true;}
        match value{serde_json::Value::Array(xs)=>xs.iter().any(|v|clock(v,bindings,depth+1)),serde_json::Value::Object(xs)=>xs.values().any(|v|clock(v,bindings,depth+1)),_=>false}
    }
    let mut advances=bound.invariants.iter().filter_map(|i|i.syntax.as_ref()).any(|e|{
        let mut e=e.clone();let mut found=false;super::super::super::intent_walk::expression(&mut e,&mut |e|if matches!(e,ast::Expr::Name{name,..} if name=="now"){found=true;});found
    });
    walk(&json,&mut |v|{for tag in ["Require","Check"]{if let Some(condition)=v.get(tag).and_then(|v|v.get("condition")){advances|=clock(condition,&bindings,0);}}});
    if !advances{out.unsupported.insert(format!("{}: clock advance proposals prioritize clock-dependent guards or intent; temporal payload-only histories remain uncovered",p.name));return vec![current];}
    let mut times=BTreeSet::new();let mut bases=Vec::new();
    for (table,rs) in rows {for row in rs {for (c,k) in &bound.schema.tables[table].columns {
        if matches!(k.required(),C::Time)&&let Ok(Value::Int(n))=row.field(c) {
            bases.push(*n);if *n>=current {times.insert(*n);if let Some(next)=n.checked_add(1){times.insert(next);}}
        }
    }}}
    let offsets=time_samples(bound,out).into_iter().filter_map(|v|if let Value::Int(n)=v{n.checked_sub(NOW).and_then(i64::checked_abs)}else{None}).filter(|n|*n>=86_400_000).collect::<BTreeSet<_>>();
    let far=bases.iter().flat_map(|base|offsets.iter().filter_map(move |d|base.checked_add(*d).and_then(|n|n.checked_add(1)))).filter(|n|*n>current).max();
    let mut clocks=vec![current];
    if let Some(far)=far{clocks.push(far);}
    for time in times.into_iter().filter(|n|*n>current){if !clocks.contains(&time){clocks.push(time);}if clocks.len()==4{break;}}
    clocks
}

// Typed equality reads propose role/relationship-compatible principal arguments.
// Ordinary guards still decide admission; disjunctions/negation only influence
// ordering and cannot establish a policy fact or exclude the remaining values.
pub(super) fn principal_preferences(bound:&Bound,p:&Program,rows:&BTreeMap<String,Vec<Value>>)->BTreeMap<String,Vec<Value>>{
    fn walk(json:&serde_json::Value,f:&mut impl FnMut(&serde_json::Value)){
        f(json);match json{serde_json::Value::Array(xs)=>for x in xs{walk(x,f)},serde_json::Value::Object(xs)=>for x in xs.values(){walk(x,f)},_=>{}}
    }
    let json=serde_json::to_value(p).unwrap();
    let mut probes=BTreeMap::new();
    walk(&json,&mut |value|{if let Some(binding)=value.get("Let")&&let Some(name)=binding.get("name").and_then(|v|v.as_str()){
        if let Some(site)=binding.pointer("/value/Get/site").and_then(|v|v.as_str()){probes.insert(name.to_owned(),site.to_owned());}
        else if let Some(alias)=binding.pointer("/value/Variable").and_then(|v|v.as_str())&&let Some(site)=probes.get(alias).cloned(){probes.insert(name.to_owned(),site);}
    }});
    let mut filters=BTreeMap::<String,Vec<(String,Value)>>::new();
    walk(&json,&mut |value|{if let Some(eq)=value.get("Binary")&&eq.get("op").and_then(|v|v.as_str())==Some("Eq") {for (a,b) in [("left","right"),("right","left")] {
        if let (Some(field),Some(literal))=(eq.get(a).and_then(|v|v.get("Field")),eq.get(b).and_then(|v|v.get("Literal")))&&let (Some(probe),Some(column),Ok(literal))=(field.pointer("/base/Variable").and_then(|v|v.as_str()),field.get("name").and_then(|v|v.as_str()),serde_json::from_value::<Value>(literal.clone()))&&let Some(site)=probes.get(probe){filters.entry(site.clone()).or_default().push((column.into(),literal));}
    }}});
    let mut out=BTreeMap::<String,Vec<Value>>::new();
    walk(&json,&mut |value|{for tag in ["Exists","Get","Scan"] {
        let Some(read)=value.get(tag)else{continue;};
        let (Some(table),Some(index))=(read.get("table").and_then(|v|v.as_str()),read.get("index").and_then(|v|v.as_str()))else{continue;};
        let Some(definition)=bound.schema.table(table).and_then(|t|t.index(index))else{continue;};
        let Some(keys)=read.get("key").or_else(||read.get("prefix")).and_then(|v|v.as_array())else{continue;};
        let columns=definition.columns();let pairs=columns.iter().zip(keys).map(|(c,k)|(c,k.get("Scalar").unwrap_or(k))).collect::<Vec<_>>();
        let mut pins=pairs.iter().filter_map(|(c,k)|k.get("Literal").and_then(|v|serde_json::from_value::<Value>(v.clone()).ok()).map(|v|((*c).clone(),v))).collect::<Vec<_>>();
        if let Some(site)=read.get("site").and_then(|v|v.as_str())&&let Some(extra)=filters.get(site){pins.extend(extra.clone());}
        if pins.is_empty(){continue;}
        for (column,key) in &pairs {
            let Some(arg)=key.get("Variable").and_then(|v|v.as_str())else{continue;};
            if !matches!(p.args.get(arg),Some(ir::ArgType::Principal|ir::ArgType::Ref{..})){continue;}
            for row in rows.get(table).into_iter().flatten().filter(|r|pins.iter().all(|(c,v)|r.field(c).ok()==Some(v))){
                if let Ok(value@Value::Id(_))=row.field(column){let values=out.entry(arg.into()).or_default();if !values.contains(value){values.push(value.clone());}}
            }
        }
    }});out
}

#[cfg(test)] mod sec9_role_order_tests { use super::*;
#[test] fn role_conditioned_principal_arguments_reach_the_first_creator_tuple(){
 let source="table roles:\n  principal: principal\n  role: enum('client','inspector')\n  unique principal\n  read <- allow\n  insert <- allow\n  online only\nmutation book(client: principal, inspector: principal):\n  require exists roles[principal = client, role = 'client'] else BAD_CLIENT\n  require exists roles[principal = inspector, role = 'inspector'] else BAD_INSPECTOR\n  return null\n";
 let b=crate::compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let rows=BTreeMap::from([("roles".into(),vec![Value::Row(BTreeMap::from([("id".into(),Value::Id("a".into())),("principal".into(),Value::Id("account:client".into())),("role".into(),Value::String("client".into()))]).into()),Value::Row(BTreeMap::from([("id".into(),Value::Id("b".into())),("principal".into(),Value::Id("account:inspector".into())),("role".into(),Value::String("inspector".into()))]).into())])]);
 let prefs=principal_preferences(&b,&b.programs[0].program,&rows);
 assert_eq!(prefs.get("client"),Some(&vec![Value::Id("account:client".into())]),"{}",serde_json::to_string(&b.programs[0].program).unwrap());
 assert_eq!(prefs.get("inspector"),Some(&vec![Value::Id("account:inspector".into())]));
}
}

#[cfg(test)]mod sec9_clock_priority_tests{use super::*;
#[test]fn timestamp_payloads_preserve_depth_but_aliased_clock_guards_advance(){
 for guarded in [false,true]{
  let source=format!("table docs:\n  at: time\n  seenAt: time ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation touch(doc: docs):\n  row = docs[doc] ! else MISSING\n{}  update docs[doc] {{seenAt:now}}\n",if guarded{"  clock = now\n  require clock >= row.at else EARLY\n"}else{""});
  let b=crate::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  let rows=BTreeMap::from([("docs".into(),vec![snapback4_core::value::object([("id",Value::Id("d".into())),("at",Value::Int(NOW+86400000))])])]);let mut campaign=Campaign::default();
  let clocks=clock_candidates(&b,&b.programs[0].program,&rows,&[],&mut campaign);
  assert_eq!(clocks.iter().any(|time|*time>NOW),guarded);
  assert_eq!(clocks[0],NOW);
 }
}
}

#[cfg(test)]mod sec10_payload_tests{use super::*;
#[test]fn lifecycle_replays_changed_optional_numeric_payloads(){
    let sources=vec![("schema.q".into(),"table docs:\n  status: enum('draft','done') default 'draft'\n  weight: int 1..100\n  read <- allow\n  update <- allow\n  online only\nmutation edit(doc: docs,weight: int 1..100 ?):\n  d = docs[doc] ! else MISSING\n  update docs[doc] {weight:weight ?? d.weight}\ninvariant docs.weight update only .status = 'draft'\n".into())];let bound=crate::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);let mut engine=Engine::memory(bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&bound.schema.tables["docs"],&serde_json::json!({"id":"d","status":"done","weight":1})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();let mut campaign=Campaign::work_bounded(1024);lifecycle_observers(&bound,&engine,&mut campaign);assert!(campaign.violations.iter().any(|v|v.operation=="edit"&&v.reachability.is_reachable()),"{:?}",campaign.unsupported);
}
}

#[cfg(test)]mod focused_read_dependencies_tests{use super::*;
#[test]fn opening_visibility_and_word_fields_remain_focused_dependencies(){
 let source="table docs:\n  flag: bool default false\n  label: text <=30 default 'no'\n  body: text <=80 default 'alpha'\n  opensAt: time default now\n  category: enum('a','b') default 'a'\n  by byWords: words(body), id\n  not before .opensAt\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nbackfill docs label(flag: bool):\n  {label:'yes' if flag else 'no'}\nmutation enable(doc: docs):\n  update docs[doc] {flag:true}\nmutation setLabel(doc: docs,label: text <=30):\n  require docs[doc].flag = true else NOT_ENABLED\n  update docs[doc] {label}\nmutation setBody(doc: docs,body: text <=80):\n  update docs[doc] {body}\nmutation setOpening(doc: docs,opensAt: time):\n  update docs[doc] {opensAt}\nmutation setUnused(doc: docs,category: enum('a','b')):\n  update docs[doc] {category}\nquery search(q: text <=30):\n  return docs matching q first 10 by byWords\n";
 let sources=vec![("schema.q".into(),source.into())];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let mut b=super::super::super::derived::augmented(&sources,&b);
 // Backfill equations remain advice in production; opt this search-focus test
 // into that question without promoting a migration formula into enforcement.
 assert!(b.invariants.is_empty());
 b.invariants=super::super::super::derived::invariants(&sources,&b).into_iter().filter(|i|i.site.file.contains("/label-consistency/")).collect();assert_eq!(b.invariants.len(),1);
 let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"doc","flag":false,"label":"no","body":"alpha","opensAt":NOW,"category":"a"})).unwrap();e.seed_at([("docs".into(),row)],NOW).unwrap();
 let mut out=Campaign::work_bounded(1024);lifecycle_observers_to(&b,&e,&mut out,512);
 let deferred=|name:&str|out.unsupported.iter().any(|why|why.starts_with(name)&&why.contains("unreferenced payload-only"));
 assert!(deferred("setUnused"),"{:?}",out.unsupported);assert!(!deferred("setBody"));assert!(!deferred("setOpening"));
}
}

#[cfg(test)]mod sec11_observer_tests {
    use super::*;
    #[test]fn live_observations_never_enter_serialized_or_debug_reports(){
        let step=Step{observed_data:Some(Value::String("live-observation-secret-sentinel".into())),clock:Some(NOW),operation:"read".into(),viewer:VIEWER.into(),args:BTreeMap::new(),result:serde_json::json!({"state":"observed","complete":true})};
        let public=serde_json::to_value(&step).unwrap();assert!(!public.to_string().contains("secret-sentinel"));assert!(!format!("{step:?}").contains("secret-sentinel"));
        let restored:Step=serde_json::from_value(public).unwrap();assert!(restored.observed_data.is_none());
    }
    #[test]fn the_observer_does_not_change_the_mutation_prefix_dedup_key(){
        let write=Step{observed_data:None,clock:Some(NOW),operation:"create".into(),viewer:VIEWER.into(),args:BTreeMap::new(),result:serde_json::json!({"state":"sent"})};
        let read=Step{observed_data:None,clock:Some(NOW),operation:"read".into(),viewer:VIEWER.into(),args:BTreeMap::new(),result:serde_json::json!({"state":"observed"})};
        assert_eq!(trace_key(&[write.clone()]),trace_key(&[write.clone(),read]));
        assert_ne!(trace_key(&[write.clone()]),trace_key(&[write.clone(),write]));
    }
}
