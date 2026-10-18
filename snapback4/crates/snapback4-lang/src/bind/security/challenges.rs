//! Concrete, isolated challenges; finite campaigns never establish proof.
// @ref LLP 3000.036.004#4-counterexamples-and-generated-tests — only replayed admission is a refutation.
use super::*;
use snapback4_core::{Engine,Store,Context,Value,RuntimeError};
use snapback4_core::schema::{ColumnType as C,Constraint};
use snapback4_core::engine::rules::{self,Probe};
use snapback4_core::ir::{self,Expr,Stmt,Program,ProgramKind,Read,KeyProvenance};
const NOW:i64=1_800_000_000_000;
const VIEWER:&str="dev:security-a";
const OTHER:&str="dev:security-b";
// Same verified 1x1 PNG header used by the existing packaged asset witnesses.
const PNG:[u8;24]=[137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1];
mod paired;
mod timed;
mod histories;
mod assets;
#[derive(Clone,Debug,Serialize)]
pub struct Counterexample {pub invariant_site:String,pub args:BTreeMap<String,Value>,pub viewer:String,pub operation:String,pub effect:String,pub row:Value,pub old:Option<Value>,pub supporting_rows:BTreeMap<String,Vec<Value>>,pub rule_path:String,pub scope:String, pub observations:Option<paired::Observations>,pub history:Vec<histories::Step>}
#[derive(Clone,Debug,Default,Serialize)]
pub struct Campaign {pub operations:BTreeMap<String,usize>,pub sequences:usize,pub attempted:usize,pub admitted:usize,pub refused:usize,pub violations:Vec<Counterexample>,pub boundary_failures:Vec<String>,pub unsupported:BTreeSet<String>}
fn id(table:&str)->Value {Value::Id(format!("security-{table}"))}
fn sample(kind:&C,variant:usize)->Option<Value>{Some(match kind{
    C::Optional(inner)=>if variant&4!=0{sample(inner,variant).unwrap_or(Value::Null)}else{Value::Null},C::Id|C::Principal=>Value::Id(if variant&1==0{VIEWER}else{OTHER}.into()),
    C::Ref{table}=>id(table),C::Text{max}=>Value::String("x".repeat((*max).min(20) as usize)),
    C::Enum{variants}=>Value::String(variants.get(variant%variants.len())?.clone()),
    C::Int|C::Decimal{..}|C::Money{..}=>Value::Int(1),C::IntRange{min,max}=>Value::Int(1i64.clamp(*min,*max)),
    C::Bool=>Value::Bool((variant>>2)&1==0),C::Time=>Value::Int(NOW-1000),C::Json{..}=>Value::Null,C::Bytes{..}=>Value::Bytes(Vec::new()),
    C::List{..}=>Value::Array(Vec::new()),C::ListRange{of,min,..}=>Value::Array((0..*min).map(|_|sample(of,variant)).collect::<Option<_>>()?),
    C::Image{..}=>Value::String("$security:image".into()),C::File{..}=>Value::String("$security:file".into()),C::Video{..}=>return None,
})}
fn needed(schema:&Schema,name:&str,out:&mut BTreeSet<String>){
    if !out.insert(name.into()){return;}let Some(t)=schema.table(name)else{return};
    for k in t.columns.values(){if let C::Ref{table}=k.required(){needed(schema,table,out);}}
    for r in [&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete]{for dep in kernel::dependencies(r){needed(schema,&dep,out);}}
}
fn snapshot(bound:&Bound,inv:&Invariant,variant:usize)->Result<BTreeMap<String,Vec<Value>>,String>{
    snapshot_mode(bound,inv,variant,false)
}
fn snapshot_mode(bound:&Bound,inv:&Invariant,variant:usize,timed:bool)->Result<BTreeMap<String,Vec<Value>>,String>{
    let mut names=BTreeSet::new();needed(&bound.schema,&inv.table,&mut names);
    if let Some(policy)=&inv.policy{for dep in kernel::dependencies(policy){needed(&bound.schema,&dep,&mut names);}}
    if let Some(mut syntax)=inv.syntax.clone(){super::super::intent_walk::expression(&mut syntax,&mut |e| {
        if let ast::Expr::Read(r)|ast::Expr::Exists{read:r,..}=e {needed(&bound.schema,&r.table,&mut names);}
    });}
    if let Some(op)=&inv.operation && let Some(p)=bound.programs.iter().find(|p|&p.program.name==op){for kind in p.program.args.values(){if let ir::ArgType::Ref{table}=kind{needed(&bound.schema,table,&mut names);}}}
    let mut out=BTreeMap::new();
    let mut enum_case=variant;
    for name in names {
        let t=&bound.schema.tables[&name];
        if (!timed && t.read_lifetime_sensitive())||t.through.is_some()||bound.schema.maintain_for(&name).is_some(){return Err(format!("{name}: concrete lifetime/capture/derived reduction is unsupported"));}
        let mut fields=BTreeMap::new();fields.insert("id".into(),id(&name));
        for (n,k) in &t.columns{
            if n=="id"||t.engine_field(n)||t.maintained.contains_key(n){continue;}
            let sample_variant=if let C::Enum{variants}=k.required(){let n=enum_case % variants.len();enum_case/=variants.len();n}else if matches!(k,C::Principal){variant>>3}else{variant};
            let value=sample(k,sample_variant)
                .ok_or_else(||format!("{name}.{n}: asset ledger/required sample is not available"))?;
            fields.insert(n.clone(),value);
        }
        if timed {for (n,k) in &t.columns {if matches!(k.required(),C::Time)&&(!k.is_optional()||variant&4!=0) {
            fields.insert(n.clone(),Value::Int(NOW+if t.expire.as_ref()==Some(n){2000}else{1000}));
        }}}
        for constraint in &t.constraints{if let Constraint::Text{field,min,..}=constraint
            && matches!(fields.get(field),Some(Value::String(_))) {fields.insert(field.clone(),Value::String("x".repeat((*min).max(1) as usize)));}}
        // Named primary keys used by role probes must select the challenged
        // viewer; changing the enum represents a current-role change while
        // derived assignment/membership rows remain present.
        if name!=inv.table {for (n,k) in &t.columns {if matches!(k,C::Principal){fields.insert(n.clone(),Value::Id(VIEWER.into()));}}}
        out.insert(name,vec![Value::Row(fields.into())]);
    }
    Ok(out)
}
struct Snapshot<'a>{schema:&'a Schema,rows:&'a BTreeMap<String,Vec<Value>>}
impl Probe for Snapshot<'_>{
    fn exists(&mut self,table:&str,index:&str,key:&[Value],equalities:&[(String,Value)])->Result<bool,RuntimeError>{
        let t=&self.schema.tables[table];let Some(idx)=t.index(index)else{return Ok(false)};
        if idx.components.len()!=key.len(){return Ok(false);}
        if idx.unique&&idx.components.iter().any(|c|c.column().is_some_and(|n|t.columns.get(n).is_some_and(C::is_optional)))&&key.contains(&Value::Null){return Ok(false);}
        Ok(self.rows.get(table).into_iter().flatten().any(|r|idx.components.iter().zip(key).all(|(c,v)|c.column().is_some_and(|n|r.field(n).ok()==Some(v)))&&equalities.iter().all(|(n,v)|r.field(n).ok()==Some(v))))
    }
    fn created(&mut self,_:&str,_:&str,_:&[Value])->bool{false}
    // Reference-hop policies require authorized live hop semantics. Rather
    // than emulate that security boundary, decline these concrete challenges.
}
fn policy(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,viewer:&str,old:Option<&Value>,row:&Value)->Result<bool,String>{
    if inv.policy.as_ref().is_some_and(super::temporal::has_clock){return Err("server-clock policy needs temporal engine replay".into());}
    let Some(p)=inv.policy.as_ref() else{return inv.syntax.as_ref().and_then(|e|super::concrete::evaluate(e,row,rows,&bound.schema,viewer)).ok_or_else(||"concrete policy expression is unknown/unsupported (including clock and typed literal coercions)".into());};
    if p.has_reference(){return Err("live reference policy challenge requires authorized-hop replay".into());}
    rules::evaluate(p,viewer,old,row,false,&mut Snapshot{schema:&bound.schema,rows}).map_err(|e|e.to_string())
}
fn program(name:&str,kind:ProgramKind,body:Vec<Stmt>)->Program{Program{name:name.into(),kind,args:BTreeMap::new(),body,read_time_granularity_ms:None,returned_shapes:BTreeMap::new(),native:false}}
fn engine(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>,probe:Program)->Result<Engine,String>{
    engine_with(bound,rows,vec![probe])
}
fn engine_with(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>,probes:Vec<Program>)->Result<Engine,String>{
    let store=Store::memory().map_err(|e|e.to_string())?;
    let mut programs=bound.programs.iter().map(|p|p.program.clone()).collect::<Vec<_>>();programs.extend(probes);
    let mut engine=Engine::new_at(store,bound.schema.clone(),programs,NOW).map_err(|e|e.to_string())?;
    fn hydrate(engine:&mut Engine,kind:&C,value:&Value)->Result<Value,String>{
        match (kind,value) {
            (C::Optional(inner),v) if *v!=Value::Null=>hydrate(engine,inner,v),
            (C::List{of,..}|C::ListRange{of,..},Value::Array(xs))=>xs.iter().map(|v|hydrate(engine,of,v)).collect::<Result<Vec<_>,_>>().map(Value::Array),
            (C::Image{..},Value::String(marker)) if marker=="$security:image"=>engine.store_asset(VIEWER,&PNG,NOW).map(|a|a.column_value()).map_err(|e|format!("verified image fixture: {e}")),
            (C::File{types,..},Value::String(marker)) if marker=="$security:file"=>assets::file(engine,VIEWER,types),
            _=>Ok(value.clone()),
        }
    }
    let mut seeded=rows.clone();
    for (table,values) in &mut seeded {for row in values {for (column,kind) in &bound.schema.tables[table].columns {
        if let Ok(v)=row.field(column) {
            let value=hydrate(&mut engine,kind,v)?;
            if let Value::Row(fields)=row {fields.insert(column.clone(),value);}
        }
    }}}
    engine.seed_at(seeded.iter().flat_map(|(t,rs)|rs.iter().map(move|r|(t.clone(),r.clone()))).collect::<Vec<_>>(),NOW).map_err(|e|format!("generated snapshot rejected by schema: {e}"))?;
    let actual=readback(&engine)?;
    for (name,values) in &actual {for row in values {
        snapback4_core::engine::validate::validate_row(&bound.schema,name,row).map_err(|e|e.to_string())?;
        for c in &bound.schema.tables[name].constraints {if let Constraint::FinalExistsOnInsert{table,index,key}=c {
            let rule=RuleExpr::Exists{table:table.clone(),index:index.clone(),key:key.clone(),provenance:KeyProvenance::Computed,equalities:Vec::new()};
            if !rules::evaluate(&rule,VIEWER,None,row,false,&mut Snapshot{schema:&bound.schema,rows:&actual}).map_err(|e|e.to_string())? {return Err(format!("{name}: trusted seed did not establish final-exists constraint"));}
        }}
    }}
    Ok(engine)
}
fn replay(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,viewer:&str,word:&str,row:&Value)->Result<bool,String>{
    let name="$security.probe";let table=inv.table.clone();let key=id(&table);
    let read=Read{site:"security challenge".into(),table:table.clone(),index:"byId".into(),key:vec![Expr::Literal(key.clone())],provenance:KeyProvenance::Computed};
    let mut seeds=rows.clone();
    let probe=match word{
        "read"=>program(name,ProgramKind::Query,vec![Stmt::Return(Expr::Get(read))]),
        "insert"=>{seeds.remove(&table);program(name,ProgramKind::Mutation,vec![Stmt::Insert{table,row:Expr::Literal(row.clone())},Stmt::Return(Expr::Literal(Value::Null))])},
        "delete"=>program(name,ProgramKind::Mutation,vec![Stmt::Delete{table,key:Expr::Literal(key)},Stmt::Return(Expr::Literal(Value::Null))]),
        "update"=>{
            let definition=&bound.schema.tables[&table];
            let changed=definition.columns.iter().filter(|(n,_)|n.as_str()!="id"&&!definition.engine_field(n))
                .filter(|(n,_)|inv.column.as_ref().is_none_or(|c|c==*n))
                .filter(|(n,_)|!definition.constraints.iter().any(|c|matches!(c,Constraint::Immutable{fields} if fields.contains(n))))
                .find_map(|(n,k)| {let old=row.field(n).ok()?;let next=match (k.required(),old){
                    (C::Bool,Value::Bool(v))=>Value::Bool(!v),
                    (C::Enum{variants},_)=>Value::String(variants.iter().find(|v|Some(Value::String((*v).clone()))!=Some(old.clone()))?.clone()),
                    (C::Text{max},Value::String(v)) if v.chars().count()<*max as usize=>Value::String(format!("{v}x")),
                    (C::Int|C::Time,Value::Int(v))=>Value::Int(v+1),_=>return None};
                    Some((n.clone(),next))});
            let Some((column,value))=changed else{return Err("no valid changed mutable-column sample".into());};
            program(name,ProgramKind::Mutation,vec![Stmt::Update{table,key:Expr::Literal(key),patch:Expr::Literal(Value::Map([(column,value)].into_iter().collect()))},Stmt::Return(Expr::Literal(Value::Null))])
        },_=>return Err("row integrity/transition challenge is not an operation admission test".into()),
    };
    let mut engine=engine(bound,&seeds,probe)?;
    if word=="read"{match engine.query(name,Context::new(viewer,BTreeMap::new()).at(NOW)){Ok(q)=>Ok(q.data!=Value::Null),Err(e)=>Err(e.to_string())}}
    else{Ok(matches!(engine.mutate(name,None,Context::new(viewer,BTreeMap::new()).at(NOW)),Ok(snapback4_core::MutationOutcome{state:snapback4_core::WriteState::Sent{..},..})))}
}
fn readback(engine:&Engine)->Result<BTreeMap<String,Vec<Value>>,String>{engine.schema().tables.keys().map(|t|engine.store().rows(t).map(|rs|(t.clone(),rs)).map_err(|e|e.to_string())).collect()}

/// Schema-only engine challenges. Successful synthetic operations refute the
/// declared table-authority contract, not application-operation reachability.
pub fn run(bound:&Bound)->Campaign{run_selected(bound,None)}
/// `check` searches unproved direct obligations; unsearched blockers remain
/// explicitly unproved. Default `test` passes None and runs the whole set.
pub fn run_selected(bound:&Bound,sites:Option<&BTreeSet<String>>)->Campaign{
    let mut out=Campaign::default();
    // A direct component theorem needs no repeated concrete search for that
    // same component. Indirect observers, temporal reads and actual authored
    // operations below still run; the whole declaration remains unproved.
    let discharged=super::analyze(bound).invariants.into_iter()
        .filter(|v|v.direct_rule==Status::Proved&&matches!(v.invariant.target.as_str(),"read"|"always"))
        .map(|v|v.invariant.site.to_string()).collect::<BTreeSet<_>>();
    let mut assertions=bound.invariants.clone();
    for inv in &bound.invariants {
        if inv.operation.is_some()||matches!(inv.target.as_str(),"read"|"always"){continue;}
        for p in &bound.programs {if p.program.kind!=ProgramKind::Mutation{continue;}
            let relevant=ir::write_tables(&p.program).iter().any(|(table,kind)|table==&inv.table&&(inv.target=="write"||inv.target==*kind||*kind=="upsert"));
            if relevant{let mut op=inv.clone();op.operation=Some(p.program.name.clone());assertions.push(op);}
        }
    }
    for inv in &assertions{
        if sites.is_some_and(|sites|!sites.contains(&inv.site.to_string())){continue;}
        if discharged.contains(&inv.site.to_string())&&matches!(inv.target.as_str(),"read"|"always"){continue;}
        let mut found=false;
        let combinations=bound.schema.tables.values().flat_map(|t|t.columns.values()).filter_map(|k|if let C::Enum{variants}=k.required(){Some(variants.len())}else{None}).fold(1usize,usize::saturating_mul).max(24);
        if combinations>512{out.unsupported.insert("schema enum Cartesian matrix exceeds 512 samples; remaining tuples are not covered".into());}
        for variant in 0..combinations.min(512) {
            let rows=match snapshot(bound,inv,variant){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);break;}};
            let mut seeded=match engine(bound,&rows,program("$security.seed",ProgramKind::Query,vec![Stmt::Return(Expr::Get(Read{site:"security read".into(),table:inv.table.clone(),index:"byId".into(),key:vec![Expr::Literal(id(&inv.table))],provenance:KeyProvenance::Computed}))])){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);continue;}};
            let rows=match readback(&seeded){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);continue;}};
            let Some(row)=rows.get(&inv.table).and_then(|r|r.first())else{out.unsupported.insert(format!("{}: no generated ordinary row",inv.table));break;};
            for viewer in [VIEWER,OTHER,"account:security-no-role","service:security"]{
                if inv.target=="always" {
                    match policy(bound,inv,&rows,viewer,None,row){
                        Ok(false)=>{out.attempted+=1;out.admitted+=1;out.violations.push(Counterexample{history:Vec::new(),observations:None,invariant_site:inv.site.to_string(),args:BTreeMap::new(),viewer:viewer.into(),operation:"$security.seed_at".into(),effect:"always".into(),row:row.clone(),old:None,supporting_rows:rows.clone(),rule_path:"trusted seed ingress; all typed and final-exists constraints rechecked".into(),scope:"actual seed_at commit/read-back; ordinary application reachability is not claimed".into()});found=true;},
                        Ok(true)=>{out.attempted+=1;},Err(e)=>{out.unsupported.insert(e);}
                    }if found{break;}continue;
                }
                if let Some(operation)=&inv.operation {
                    let Some(p)=bound.programs.iter().find(|p|&p.program.name==operation)else{continue;};
                    if !super::census::body(&p.program.body){out.unsupported.insert(format!("{operation}: opaque/loop/scan path requires write-boundary tracing"));continue;}
                    let Some(policy_rule)=&inv.policy else{out.unsupported.insert("operation policy outside rule fragment".into());continue;};
                    if policy_rule.any_term(&|t| !matches!(t,snapback4_core::schema::RuleTerm::Viewer|snapback4_core::schema::RuleTerm::Literal(_))) {out.unsupported.insert("operation policy requires write-boundary row-image tracing".into());continue;}
                    let writes=ir::write_tables(&p.program);
                    if writes.iter().filter(|(table,_)|table==&inv.table).count()>1 {
                        out.unsupported.insert(format!("{operation}: multiple target writes need executed-effect tracing; net images do not identify delete/reinsert"));continue;
                    }
                    let deps=kernel::dependencies(policy_rule);
                    let unstable=deps.iter().any(|dep|{
                        let hits=writes.iter().filter(|(t,_)|t==dep).collect::<Vec<_>>();
                        // A single insertion of the grant row is judged just
                        // before that insert; earlier unrelated writes cannot
                        // establish the very authority being bootstrapped.
                        !hits.is_empty() && !(dep==&inv.table&&hits.len()==1&&hits[0].1=="insert")
                    });
                    if unstable || !bound.schema.maintains.is_empty() || bound.schema.tables.values().any(|t|!t.sequences.is_empty()||!t.maintained.is_empty()||t.on_delete.values().any(|a|a.writes())) {
                        out.unsupported.insert("operation policy dependency may change before/after its write boundary; snapshot correspondence unproved".into());continue;
                    }
                    let permitted=policy(bound,inv,&rows,viewer,None,row);
                    let Some(args)=arguments(&p.program.args,variant)else{out.unsupported.insert(format!("{operation}: arguments need fixture assets or unsupported samples"));continue;};
                    out.attempted+=1;
                    let mut seeded=match engine(bound,&rows,program("$security.seed",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))])){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);continue;}};
                    match seeded.mutate(operation,None,Context::new(viewer,args.clone()).at(NOW)) {
                        Ok(result) if matches!(result.state,snapback4_core::WriteState::Sent{..})=>{
                            let current=readback(&seeded).unwrap_or_default();
                            let changed=current.get(&inv.table).into_iter().flatten().filter(|r|!rows.get(&inv.table).is_some_and(|old|old.contains(r))).collect::<Vec<_>>();
                            for next in changed {
                                let old=rows.get(&inv.table).into_iter().flatten().find(|old|old.field("id").ok()==next.field("id").ok());
                                // An upsert must be attributed to its executed arm;
                                // a column contract cannot be refuted by editing a sibling.
                                if inv.target=="update"&&old.is_none() || inv.target=="insert"&&old.is_some() || inv.target=="delete" {continue;}
                                if let Some(column)=&inv.column && old.is_some_and(|old|old.field(column).ok()==next.field(column).ok()){continue;}
                                if permitted==Ok(false){out.admitted+=1;out.violations.push(Counterexample{history:Vec::new(),observations:None,invariant_site:inv.site.to_string(),args:args.clone(),viewer:viewer.into(),operation:operation.clone(),effect:if old.is_some(){"update"}else{"insert"}.into(),row:next.clone(),old:old.cloned(),supporting_rows:rows.clone(),rule_path:format!("authored operation {operation}"),scope:"actual authored mutation committed a changed image from a schema-valid seeded snapshot".into()});found=true;break;}
                            }
                        },_=>out.refused+=1,
                    }
                    if found{break;}continue;
                }
                for word in super::effects(inv){
                    let mut admission_rows=rows.clone();if word=="insert"{admission_rows.remove(&inv.table);}
                    let allowed=match policy(bound,inv,&admission_rows,viewer,(word!="insert").then_some(row),row){Ok(v)=>v,Err(e)=>{out.unsupported.insert(e);continue;}};
                    if allowed{continue;}out.attempted+=1;
                    let replayed=if word=="read" {seeded.query("$security.seed",Context::new(viewer,BTreeMap::new()).at(NOW)).map(|q|q.data!=Value::Null).map_err(|e|e.to_string())}else{replay(bound,inv,&rows,viewer,word,row)};
                    match replayed{
                        Ok(false)=>out.refused+=1,
                        Ok(true)=>{out.admitted+=1;out.violations.push(Counterexample{history:Vec::new(),observations:None,invariant_site:inv.site.to_string(),args:BTreeMap::new(),viewer:viewer.into(),operation:format!("$security.{}.{}",inv.table,word),effect:word.into(),row:row.clone(),old:(word=="update"||word=="delete").then(||row.clone()),supporting_rows:admission_rows.clone(),rule_path:bound.schema.tables[&inv.table].rules.for_effect(super::effect(word)).quarry(),scope:"schema-valid seeded snapshot; synthetic engine table operation; application reachability is not claimed".into()});found=true;break;},
                        Err(e)=>{out.unsupported.insert(format!("{}.{}: {e}",inv.table,word));},
                    }
                }
                if found{break;}
            }
            if found{break;}
        }
    }
    paired::run(bound,&mut out,sites);
    timed::run(bound,&mut out,sites);
    out.unsupported.insert("unauthenticated HTTP attempts require a live server; engine principals are authenticated contexts".into());
    out.unsupported.insert("offline/revoked-device access and retained history require device boundary qualification".into());out
}
pub fn apply(report:&mut Report,campaign:&Campaign){for c in &campaign.violations{for v in &mut report.invariants{if v.invariant.site.to_string()==c.invariant_site{
    v.status=Status::Refuted;v.counterexample=Some(c.clone());v.reasons.push("concrete policy-false snapshot admitted by the actual engine; finite test evidence, not a reachability theorem".into());
}}}}

fn arguments(args:&BTreeMap<String,ir::ArgType>,variant:usize)->Option<BTreeMap<String,Value>>{
    use ir::ArgType as A;
    fn one(k:&A,v:usize)->Option<Value>{Some(match k{
        A::Ref{table}=>id(table),A::Principal=>Value::Id(if v&1==0{OTHER}else{VIEWER}.into()),A::Id=>Value::Id("security-argument".into()),A::Cursor|A::Optional(_)=>Value::Null,
        A::Text{min,max,..}=>Value::String("z".repeat((*min).max(1).min(*max) as usize)),A::Enum{variants}=>Value::String(variants.get(v%variants.len())?.clone()),A::Int|A::Decimal{..}|A::Money{..}=>Value::Int(1),A::IntRange{min,max}=>Value::Int(1i64.clamp(*min,*max)),A::Time=>Value::Int(NOW+86_400_000),A::Bool=>Value::Bool(v&2==0),A::List{..}=>Value::Array(Vec::new()),A::Json{..}=>Value::Null,A::Bytes{..}=>Value::Bytes(Vec::new()),A::Image{..}|A::File{..}=>Value::Null,_=>return None,
    })}
    args.iter().map(|(n,k)|one(k,variant).map(|v|(n.clone(),v))).collect()
}

/// Exercise every authored query/mutation with cross-principal candidates.
/// This is conformance exploration, not a guessed spec oracle: only declared
/// policies and replayed violations can fail security acceptance.
pub fn operations(bound:&Bound,fixture:&Engine,campaign:&mut Campaign){
    histories::run(bound,fixture,campaign);
    assets::run(bound,fixture,campaign);
    let fixtures=match readback(fixture){Ok(r)=>r,Err(e)=>{campaign.unsupported.insert(e);return;}};
    let has_fixture=fixtures.values().any(|r|!r.is_empty());
    if fixtures.values().map(Vec::len).sum::<usize>()>1000{campaign.unsupported.insert("operation fixture matrix exceeds 1000 rows; provide a focused security fixture".into());return;}
    let mut viewers=histories::viewers(bound);
    for (table,rows) in &fixtures{for row in rows{for (c,k) in &bound.schema.tables[table].columns{if matches!(k.required(),C::Principal)&&let Ok(Value::Id(p))=row.field(c)&&!viewers.contains(p){viewers.push(p.clone());}}}}
    for p in &bound.programs{
        if !matches!(p.program.kind,ProgramKind::Query|ProgramKind::Mutation)||p.program.native{campaign.unsupported.insert(format!("{}: trusted/system/opaque operation",p.program.name));continue;}
        let target=bound.schema.visible_tables().find(|(t,_)|super::audit::mentions(&serde_json::to_value(&p.program).unwrap(),t)).or_else(||bound.schema.visible_tables().next()).map(|(t,_)|t.clone());
        let Some(target)=target else{campaign.unsupported.insert(format!("{}: no table population for generated arguments",p.program.name));continue;};
        let dummy=Invariant{table:target,target:"read".into(),column:None,predicate:"allow".into(),site:crate::Site::default(),policy:Some(RuleExpr::Allow),operation:Some(p.program.name.clone()),requirements:Vec::new(),syntax:None,unsupported:None};
        let cases=histories::argument_cases(&p.program.args,campaign);
        for (variant,mut args) in cases.into_iter().enumerate(){
            let rows=if has_fixture{fixtures.clone()}else{match snapshot(bound,&dummy,variant){Ok(r)=>r,Err(e)=>{campaign.unsupported.insert(format!("{}: {e}",p.program.name));break;}}};
            for (arg,kind) in &p.program.args {if let ir::ArgType::Ref{table}=kind&&let Some(row)=rows.get(table).and_then(|rs|rs.first())&&let Ok(id)=row.field("id"){args.insert(arg.clone(),id.clone());}}
            for viewer in &viewers{
                let mut engine=match engine(bound,&rows,program("$security.matrix",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))])){Ok(e)=>e,Err(e)=>{campaign.unsupported.insert(format!("{}: {e}",p.program.name));continue;}};
                campaign.attempted+=1;*campaign.operations.entry(p.program.name.clone()).or_default()+=1;
                if p.program.kind==ProgramKind::Query{
                    match engine.query(&p.program.name,Context::new(viewer,args.clone()).at(NOW)){Ok(_)=>{},Err(e) if e.code=="E_INPUT"=>{campaign.unsupported.insert(format!("{}: generated arguments rejected as E_INPUT",p.program.name));},Err(_)=>campaign.refused+=1,}
                }else{
                    match engine.mutate(&p.program.name,None,Context::new(viewer,args.clone()).at(NOW)){Ok(result) if matches!(result.state,snapback4_core::WriteState::Failed{..})=>campaign.refused+=1,Err(e)=>{campaign.unsupported.insert(format!("{}: matrix engine error {e}",p.program.name));},_=>{},}
                }
            }
        }
    }
}
