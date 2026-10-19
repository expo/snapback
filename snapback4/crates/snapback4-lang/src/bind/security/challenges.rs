//! Concrete, isolated challenges; finite campaigns never establish proof.
// @ref LLP 3000.036.004#4-counterexamples-and-generated-tests — only replayed admission is a refutation.
use super::*;
use snapback4_core::{Engine,Store,Context,Value,RuntimeError};
use snapback4_core::schema::{ColumnType as C,Constraint};
use snapback4_core::engine::rules::{self,Probe};
use snapback4_core::ir::{self,Expr,Stmt,Program,ProgramKind,Read,KeyProvenance};
pub const NOW:i64=1_800_000_000_000;
const VIEWER:&str="dev:security-a";
const OTHER:&str="dev:security-b";
// Same verified 1x1 PNG header used by the existing packaged asset witnesses.
const PNG:[u8;24]=[137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1];
mod paired;
mod timed;
mod histories;
mod assets;
mod column_reads;
mod stability;
mod generated;
pub use generated::fixture as generated_fixture;
#[derive(Clone,Debug,Serialize,serde::Deserialize,PartialEq,Eq)]
#[serde(rename_all="kebab-case")]
pub enum Reachability { AuthoredFixtureTrace, GeneratedFixtureTrace, TrustedSeedOnly, SyntheticOperation }
impl Reachability {
    pub fn is_reachable(&self)->bool {matches!(self,Self::AuthoredFixtureTrace|Self::GeneratedFixtureTrace)}
}
#[derive(Clone,Debug,Serialize,serde::Deserialize)]
pub struct Counterexample {pub reachability:Reachability,pub invariant_site:String,pub args:BTreeMap<String,Value>,pub viewer:String,pub operation:String,pub effect:String,pub row:Value,pub old:Option<Value>,pub supporting_rows:BTreeMap<String,Vec<Value>>,pub rule_path:String,pub scope:String, pub observations:Option<paired::Observations>,pub history:Vec<histories::Step>}
#[derive(Clone,Debug,Default,Serialize)]
pub struct Campaign {#[serde(skip)] pub history_limit:usize,#[serde(skip)] pub generated_fixture:bool,#[serde(skip)] pub work_remaining:Option<usize>,#[serde(skip)] pub deadline:Option<std::time::Instant>,pub paired_observer_calls:usize,pub history_observer_calls:usize,pub column_observer_calls:usize,pub operations:BTreeMap<String,usize>,pub sequences:usize,pub attempted:usize,pub admitted:usize,pub refused:usize,pub violations:Vec<Counterexample>,pub boundary_failures:Vec<String>,pub unsupported:BTreeSet<String>}
impl Campaign {
    pub fn bounded(milliseconds:u64)->Self {Self{work_remaining:Some(512),deadline:Some(std::time::Instant::now()+std::time::Duration::from_millis(milliseconds)),..Self::default()}}
    pub(super) fn reserve(&mut self,cost:usize)->bool {
        if self.exhausted(){return false;}
        if let Some(remaining)=&mut self.work_remaining {
            if *remaining<cost{*remaining=0;self.unsupported.insert("check concrete exploration work budget exhausted; remaining paths unproved; run snapback4 test for the full campaign".into());return false;}
            *remaining-=cost;
        }true
    }
    pub(super) fn exhausted(&mut self)->bool {
        if self.work_remaining==Some(0){self.unsupported.insert("check concrete exploration work budget exhausted; remaining paths unproved; run snapback4 test for the full campaign".into());return true;}
        if self.deadline.is_some_and(|deadline|std::time::Instant::now()>=deadline){self.unsupported.insert("check concrete exploration time budget exhausted; remaining paths unproved; run snapback4 test for the full campaign".into());true}else{false}
    }
}
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
    for m in schema.maintains.iter().filter(|m|m.target==name){needed(schema,&m.source,out);}
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
        if bound.schema.maintain_for(&name).is_some(){continue;}
        let mut fields=BTreeMap::new();fields.insert("id".into(),id(&name));
        let mut principal_index=0usize;
        for (n,k) in &t.columns{
            if n=="id"||t.engine_field(n)||t.maintained.contains_key(n){continue;}
            let sample_variant=if let C::Enum{variants}=k.required(){let n=enum_case % variants.len();enum_case/=variants.len();n}else if matches!(k.required(),C::Principal){let n=((variant>>((if name==inv.table{0}else{3})+principal_index.min(5)))&1)|(variant&4);principal_index+=1;n}else{variant};
            let value=sample(k,sample_variant)
                .ok_or_else(||format!("{name}.{n}: asset ledger/required sample is not available"))?;
            fields.insert(n.clone(),value);
        }
        if timed || t.read_lifetime_sensitive() {for (n,k) in &t.columns {if matches!(k.required(),C::Time)&&(!k.is_optional()||variant&4!=0) {
            fields.insert(n.clone(),Value::Int(NOW+if t.expire.as_ref()==Some(n){2000}else if timed{1000}else{-1000}));
        }}}
        for constraint in &t.constraints{if let Constraint::Text{field,min,..}=constraint
            && matches!(fields.get(field),Some(Value::String(_))) {fields.insert(field.clone(),Value::String("x".repeat((*min).max(1) as usize)));}}
        // Named primary keys used by role probes must select the challenged
        // viewer; changing the enum represents a current-role change while
        // derived assignment/membership rows remain present.
        if name!=inv.table {for (i,(n,k)) in t.columns.iter().filter(|(_,k)|matches!(k,C::Principal)).enumerate(){fields.insert(n.clone(),Value::Id(if variant & (1 << (i+3)) == 0 {VIEWER}else{OTHER}.into())); let _=k;}}
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
        Ok(self.rows.get(table).into_iter().flatten().filter(|r|live(t,r)).any(|r|idx.components.iter().zip(key).all(|(c,v)|c.column().is_some_and(|n|r.field(n).ok()==Some(v)))&&equalities.iter().all(|(n,v)|r.field(n).ok()==Some(v))))
    }
    fn created(&mut self,_:&str,_:&str,_:&[Value])->bool{false}

}
fn live(t:&snapback4_core::schema::Table,row:&Value)->bool{
    !t.expired(row,NOW)&&t.not_before.as_ref().is_none_or(|c|match row.field(c){Ok(Value::Int(n))=>*n<=NOW,Ok(Value::Null)=>true,_=>false})
}
fn policy(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,viewer:&str,old:Option<&Value>,row:&Value)->Result<bool,String>{

    let Some(p)=inv.policy.as_ref() else{return inv.syntax.as_ref().and_then(|e|super::concrete::evaluate(e,row,rows,&bound.schema,viewer)).ok_or_else(||"concrete policy expression is unknown/unsupported (including clock and typed literal coercions)".into());};

    let mut image=row.clone();if super::temporal::has_clock(p)&&let Value::Row(fields)=&mut image{fields.insert("$security:server-clock".into(),Value::Int(NOW));}
    if p.has_reference(){return Err("reference intent requires authorized engine policy replay".into());}
    rules::evaluate(p,viewer,old,&image,false,&mut Snapshot{schema:&bound.schema,rows}).map_err(|e|e.to_string())
}
fn policy_in(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,viewer:&str,old:Option<&Value>,row:&Value,engine:&mut Engine)->Result<bool,String>{
    let Some(p)=&inv.policy else{return policy(bound,inv,rows,viewer,old,row);};
    if !p.has_reference(){return policy(bound,inv,rows,viewer,old,row);}
    let mut image=row.clone();if super::temporal::has_clock(p)&&let Value::Row(fields)=&mut image{fields.insert("$security:server-clock".into(),Value::Int(NOW));}
    match engine.fixture_policy(p,viewer,old,&image,NOW).map_err(|e|e.to_string())?{
        rules::Verdict::Readable=>Ok(true),rules::Verdict::Denied=>Ok(false),rules::Verdict::Unknown=>Err("policy reference/coverage judgment is unknown; never a refutation".into()),
    }
}
fn program(name:&str,kind:ProgramKind,body:Vec<Stmt>)->Program{Program{name:name.into(),kind,args:BTreeMap::new(),body,read_time_granularity_ms:None,returned_shapes:BTreeMap::new(),native:false}}
fn engine(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>,probe:Program)->Result<Engine,String>{
    engine_with(bound,rows,vec![probe])
}
fn engine_with(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>,probes:Vec<Program>)->Result<Engine,String>{
    engine_on_store(bound,rows,probes,Store::memory().map_err(|e|e.to_string())?)
}
fn hydrate(engine:&mut Engine,kind:&C,value:&Value)->Result<Value,String>{
        match (kind,value) {
            (C::Optional(inner),v) if *v!=Value::Null=>hydrate(engine,inner,v),
            (C::List{of,..}|C::ListRange{of,..},Value::Array(xs))=>xs.iter().map(|v|hydrate(engine,of,v)).collect::<Result<Vec<_>,_>>().map(Value::Array),
            (C::Image{..},Value::String(marker)) if marker=="$security:image"=>engine.store_asset(VIEWER,&PNG,NOW).map(|a|a.column_value()).map_err(|e|format!("verified image fixture: {e}")),
            (C::File{types,..},Value::String(marker)) if marker=="$security:file"=>assets::file(engine,VIEWER,types),
            _=>Ok(value.clone()),
        }
    }

fn engine_on_store(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>,probes:Vec<Program>,store:Store)->Result<Engine,String>{
    let mut programs=bound.programs.iter().map(|p|p.program.clone()).collect::<Vec<_>>();programs.extend(probes);
    let mut engine=Engine::new_at(store,bound.schema.clone(),programs,NOW).map_err(|e|e.to_string())?;
    let mut seeded=rows.iter().filter(|(name,_)|bound.schema.maintain_for(name).is_none()).map(|(name,rs)|{
        let t=&bound.schema.tables[name];
        let clean=rs.iter().map(|r|if let Value::Row(fields)=r {Value::Row(fields.iter().filter(|(c,_)|!t.engine_field(c)&&!t.recorded.contains_key(*c)&&!t.maintained.contains_key(*c)).map(|(c,v)|(c.clone(),v.clone())).collect())}else{r.clone()}).collect();
        (name.clone(),clean)
    }).collect::<BTreeMap<String,Vec<Value>>>();
    for (table,values) in &mut seeded {for row in values {for (column,kind) in &bound.schema.tables[table].columns {
        if let Ok(v)=row.field(column) {
            let value=hydrate(&mut engine,kind,v)?;
            if let Value::Row(fields)=row {fields.insert(column.clone(),value);}
        }
    }}}
    engine.seed_at(seeded.iter().flat_map(|(t,rs)|rs.iter().map(move|r|(t.clone(),r.clone()))).collect::<Vec<_>>(),NOW).map_err(|e|format!("generated snapshot rejected by schema: {e}"))?;
    validate_fixture(bound,&mut engine)?;
    Ok(engine)
}
fn validate_fixture(bound:&Bound,engine:&mut Engine)->Result<(),String>{
    let actual=readback(engine)?;
    for (name,values) in &actual {for row in values {
        snapback4_core::engine::validate::validate_row(&bound.schema,name,row).map_err(|e|e.to_string())?;
        for c in &bound.schema.tables[name].constraints {if let Constraint::FinalExistsOnInsert{table,index,key}=c {
            let rule=RuleExpr::Exists{table:table.clone(),index:index.clone(),key:key.clone(),provenance:KeyProvenance::Computed,equalities:Vec::new()};
            if engine.fixture_policy(&rule,snapback4_core::SYSTEM_PRINCIPAL,None,row,NOW).map_err(|e|e.to_string())?!=rules::Verdict::Readable {return Err(format!("{name}: trusted seed did not establish final-exists constraint"));}
        }}
    }}
    Ok(())
}

fn replay(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,viewer:&str,word:&str,row:&Value)->Result<(bool,Value),String>{
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
    if word=="read"{return engine.query(name,Context::new(viewer,BTreeMap::new()).at(NOW)).map(|q|(q.data!=Value::Null,row.clone())).map_err(|e|e.to_string());}
    let outcome=engine.mutate(name,None,Context::new(viewer,BTreeMap::new()).at(NOW)).map_err(|e|e.to_string())?;
    if !matches!(outcome.state,snapback4_core::WriteState::Sent{..}){return Ok((false,row.clone()));}
    let next=engine.store().rows(&inv.table).map_err(|e|e.to_string())?.into_iter().find(|r|r.field("id").ok()==row.field("id").ok());
    if word=="delete"{return if next.is_none(){Ok((true,row.clone()))}else{Err("delete returned sent without removing the target".into())};}
    let next=next.ok_or("sent write has no committed target image")?;
    if word=="update" {
        let table=&bound.schema.tables[&inv.table];
        let changed=table.columns.keys().filter(|c|!table.engine_field(c)&&!table.maintained.contains_key(*c))
            .any(|c|row.field(c).ok()!=next.field(c).ok()&&inv.column.as_ref().is_none_or(|column|column==c));
        if !changed{return Err("sent no-op/implicit-only update has no changed declared target column".into());}
    }
    Ok((true,next))
}
fn readback(engine:&Engine)->Result<BTreeMap<String,Vec<Value>>,String>{engine.schema().tables.keys().map(|t|engine.store().rows(t).map(|rs|(t.clone(),rs)).map_err(|e|e.to_string())).collect()}

fn operation_preflight(bound:&Bound,inv:&Invariant)->Result<(),String>{
    let Some(name)=&inv.operation else{return Ok(());};
    let p=&bound.programs.iter().find(|p|&p.program.name==name).ok_or("operation did not bind")?.program;
    if !super::census::body(&p.body){return Err(format!("{name}: opaque/loop/scan path requires write-boundary tracing"));}
    let rule=inv.policy.as_ref().ok_or("operation policy outside rule fragment")?;
    if rule.any_term(&|t|!matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))){return Err("operation policy requires write-boundary row-image tracing".into());}
    let writes=ir::write_tables(p);
    if writes.iter().filter(|(t,_)|t==&inv.table).count()>1{return Err(format!("{name}: multiple target writes need executed-effect tracing; net images do not identify delete/reinsert"));}
    let unstable=kernel::dependencies(rule).iter().any(|dep|{
        let hits=writes.iter().filter(|(t,_)|t==dep).collect::<Vec<_>>();
        !hits.is_empty()&&!(dep==&inv.table&&hits.len()==1&&hits[0].1=="insert")
    });
    if unstable||!bound.schema.maintains.is_empty()||bound.schema.tables.values().any(|t|!t.sequences.is_empty()||!t.maintained.is_empty()||t.on_delete.values().any(|a|a.writes())){
        return Err("operation policy dependency may change before/after its write boundary; snapshot correspondence unproved".into());
    }Ok(())
}

/// Schema-only engine challenges. Successful synthetic operations refute the
/// declared table-authority contract, not application-operation reachability.
pub fn run(bound:&Bound)->Campaign{run_selected(bound,None)}
/// `check` searches unproved direct obligations; unsearched blockers remain
/// explicitly unproved. Default `test` passes None and runs the whole set.
pub fn run_selected(bound:&Bound,sites:Option<&BTreeSet<String>>)->Campaign{run_selected_after(bound,sites,Campaign::default())}
/// Continue after trusted observations, preserving one set of work budgets.
pub fn run_selected_after(bound:&Bound,sites:Option<&BTreeSet<String>>,mut out:Campaign)->Campaign{
    // A direct component theorem needs no repeated concrete search for that
    // same component. Indirect observers, temporal reads and actual authored
    // operations below still run; the whole declaration remains unproved.
    let discharged=super::analyze(bound).invariants.into_iter()
        .filter(|v|v.direct_rule==Status::Proved&&v.invariant.operation.is_none()
            && (matches!(v.invariant.target.as_str(),"read"|"always"|"insert"|"delete")
                || matches!(v.invariant.target.as_str(),"update"|"write")&&bound.schema.tables[&v.invariant.table].written_by.is_empty()))
        .map(|v|v.invariant.site.to_string()).collect::<BTreeSet<_>>();
    let mut assertions=bound.invariants.clone();
    for inv in &bound.invariants {
        if inv.target=="read"&&inv.column.as_deref().is_some_and(|c|c!="id"){continue;}
        if inv.operation.is_some()||matches!(inv.target.as_str(),"read"|"always"){continue;}
        for p in &bound.programs {if p.program.kind!=ProgramKind::Mutation{continue;}
            let relevant=ir::write_tables(&p.program).iter().any(|(table,kind)|table==&inv.table&&(inv.target=="write"||inv.target==*kind||*kind=="upsert"));
            if relevant{let mut op=inv.clone();op.operation=Some(p.program.name.clone());assertions.push(op);}
        }
    }
    for inv in &assertions{
        if out.exhausted(){break;}
        if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.reachability.is_reachable()){continue;}
        if inv.target=="read"&&inv.column.as_deref().is_some_and(|c|c!="id"){continue;}
        if sites.is_some_and(|sites|!sites.contains(&inv.site.to_string())){continue;}
        if inv.operation.is_none()&&discharged.contains(&inv.site.to_string()){continue;}
        if let Err(why)=operation_preflight(bound,inv){out.unsupported.insert(why);continue;}
        let mut found=false;let mut seen=BTreeSet::new();
        let combinations=bound.schema.tables.values().flat_map(|t|t.columns.values()).filter_map(|k|if let C::Enum{variants}=k.required(){Some(variants.len())}else{None}).fold(1usize,usize::saturating_mul).max(24);
        if combinations>512{out.unsupported.insert("schema enum Cartesian matrix exceeds 512 samples; remaining tuples are not covered".into());}
        for sample in 0..=combinations.min(512) {
            if !out.reserve(1){break;}
            let variant=sample.saturating_sub(1);
            let mut rows=match snapshot(bound,inv,variant){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);break;}};
            // Try explicit policy field literals before the unchanged enum
            // matrix. A value such as status='cancelled' need not wait behind
            // hundreds of unrelated enum tuples. This is only a candidate;
            // ordinary validation and engine replay still decide refutation.
            if sample==0 {
                fn pin(rule:&RuleExpr,row:&mut Value)->bool{match rule{
                    RuleExpr::Eq(RuleTerm::Field(f),RuleTerm::Literal(v))|RuleExpr::Ne(RuleTerm::Field(f),RuleTerm::Literal(v))|
                    RuleExpr::Eq(RuleTerm::Literal(v),RuleTerm::Field(f))|RuleExpr::Ne(RuleTerm::Literal(v),RuleTerm::Field(f))=>{
                        if let Value::Row(fields)=row&&fields.contains_key(f){fields.insert(f.clone(),v.clone());true}else{false}
                    },
                    RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().fold(false,|any,r|pin(r,row)||any),
                    RuleExpr::Not(r)=>pin(r,row),_=>false,
                }}
                if !inv.policy.as_ref().zip(rows.get_mut(&inv.table).and_then(|rs|rs.first_mut())).is_some_and(|(p,row)|pin(p,row)){continue;}
            }
            let candidate_args=inv.operation.as_ref().and_then(|op|bound.programs.iter().find(|p|&p.program.name==op)).and_then(|p|arguments(&p.program.args,variant));
            // Pruned dependencies can repeat after unrelated schema enum digits.
            // Identical seed/typed-argument candidates are one search input.
            if !seen.insert(serde_json::to_string(&(&rows,&candidate_args)).unwrap()){continue;}
            let mut seeded=match engine(bound,&rows,program("$security.seed",ProgramKind::Query,vec![Stmt::Return(Expr::Get(Read{site:"security read".into(),table:inv.table.clone(),index:"byId".into(),key:vec![Expr::Literal(id(&inv.table))],provenance:KeyProvenance::Computed}))])){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);continue;}};
            let rows=match readback(&seeded){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);continue;}};
            let Some(row)=rows.get(&inv.table).and_then(|r|r.first())else{out.unsupported.insert(format!("{}: no generated ordinary row",inv.table));break;};
            for viewer in [VIEWER,OTHER,"account:security-no-role","service:security"]{
                if !out.reserve(1){break;}
                if inv.target=="always" {
                    match policy(bound,inv,&rows,viewer,None,row){
                        Ok(false)=>{out.attempted+=1;out.admitted+=1;out.violations.push(Counterexample{reachability:Reachability::TrustedSeedOnly,history:Vec::new(),observations:None,invariant_site:inv.site.to_string(),args:BTreeMap::new(),viewer:viewer.into(),operation:"$security.seed_at".into(),effect:"always".into(),row:row.clone(),old:None,supporting_rows:rows.clone(),rule_path:"trusted seed ingress; all typed and final-exists constraints rechecked".into(),scope:"actual seed_at commit/read-back; ordinary application reachability is not claimed".into()});found=true;},
                        Ok(true)=>{out.attempted+=1;},Err(e)=>{out.unsupported.insert(e);}
                    }if found{break;}continue;
                }
                if let Some(operation)=&inv.operation {
                    let Some(p)=bound.programs.iter().find(|p|&p.program.name==operation)else{continue;};
                    let permitted=match policy(bound,inv,&rows,viewer,None,row){Ok(p)=>p,Err(why)=>{out.unsupported.insert(format!("{operation}: operation intent not judged: {why}"));continue;}};
                    let Some(args)=arguments(&p.program.args,variant)else{out.unsupported.insert(format!("{operation}: arguments need fixture assets or unsupported samples"));continue;};
                    if !out.reserve(1){break;}
                    out.attempted+=1;
                    let mut seeded=match engine(bound,&rows,program("$security.seed",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))])){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);continue;}};
                    let args=match materialize_arguments(&mut seeded,&p.program.args,&args,viewer){Ok(a)=>a,Err(why)=>{out.unsupported.insert(format!("{operation}: argument ledger unavailable: {why}"));continue;}};
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
                                if !permitted{out.admitted+=1;out.violations.push(Counterexample{reachability:Reachability::SyntheticOperation,history:Vec::new(),observations:None,invariant_site:inv.site.to_string(),args:args.clone(),viewer:viewer.into(),operation:operation.clone(),effect:if old.is_some(){"update"}else{"insert"}.into(),row:next.clone(),old:old.cloned(),supporting_rows:rows.clone(),rule_path:format!("authored operation {operation}"),scope:"actual authored mutation committed a changed image from a schema-valid seeded snapshot".into()});found=true;break;}
                            }
                        },_=>out.refused+=1,
                    }
                    if found{break;}continue;
                }
                for word in super::effects(inv){
                    let mut admission_rows=rows.clone();if word=="insert"{admission_rows.remove(&inv.table);}
                    let judged=if word=="read"{policy_in(bound,inv,&admission_rows,viewer,Some(row),row,&mut seeded)}else{policy(bound,inv,&admission_rows,viewer,(word!="insert").then_some(row),row)};
                    let allowed=match judged{Ok(v)=>v,Err(e)=>{out.unsupported.insert(e);continue;}};
                    if allowed{continue;}
                    if !out.reserve(1){break;}
                    out.attempted+=1;
                    let replayed=if word=="read" {seeded.query("$security.seed",Context::new(viewer,BTreeMap::new()).at(NOW)).map(|q|(q.data!=Value::Null,row.clone())).map_err(|e|e.to_string())}else{replay(bound,inv,&rows,viewer,word,row)};
                    match replayed{
                        Ok((false,_))=>out.refused+=1,
                        Ok((true,next))=>{
                            let mut args=BTreeMap::new();
                            if word=="update"{let changes=bound.schema.tables[&inv.table].columns.keys().filter(|c|row.field(c).ok()!=next.field(c).ok()).filter_map(|c|next.field(c).ok().map(|v|(c.clone(),v.clone()))).collect();args.insert("$syntheticPatch".into(),Value::Map(changes));}
                            out.admitted+=1;out.violations.push(Counterexample{reachability:Reachability::SyntheticOperation,history:Vec::new(),observations:None,invariant_site:inv.site.to_string(),args,viewer:viewer.into(),operation:format!("$security.{}.{}",inv.table,word),effect:word.into(),row:next,old:(word=="update"||word=="delete").then(||row.clone()),supporting_rows:admission_rows.clone(),rule_path:bound.schema.tables[&inv.table].rules.for_effect(super::effect(word)).quarry(),scope:if word=="update"{"schema-valid seeded snapshot; old-image policy false at an actual changed update; committed next image and patch shown; application reachability is not claimed".into()}else{"schema-valid seeded snapshot; synthetic engine table operation; application reachability is not claimed".into()}});found=true;break;},
                        Err(e)=>{out.unsupported.insert(format!("{}.{}: {e}",inv.table,word));},
                    }
                }
                if found{break;}
            }
            if found{break;}
        }
    }
    column_reads::generated(bound,&mut out,sites);
    paired::run(bound,&mut out,sites);
    timed::run(bound,&mut out,sites);
    out.unsupported.insert("unauthenticated HTTP attempts require a live server; engine principals are authenticated contexts".into());
    out.unsupported.insert("offline/revoked-device access and retained history require device boundary qualification".into());out
}
pub fn apply(report:&mut Report,campaign:&Campaign){
    report.campaign_coverage.extend(campaign.unsupported.iter().cloned());
    let rank=|c:&Counterexample|match c.reachability{Reachability::AuthoredFixtureTrace=>0,Reachability::GeneratedFixtureTrace=>1,_=>2};
    let committed=|c:&Counterexample|c.history.iter().filter(|s|s.result.get("state").and_then(serde_json::Value::as_str)==Some("sent")).count();
    for c in &campaign.violations {for v in &mut report.invariants {if v.invariant.site.to_string()!=c.invariant_site{continue;}
        if v.counterexample.as_ref().is_some_and(|old|rank(old)<rank(c)||rank(old)==rank(c)&&committed(old)<=committed(c)){continue;}
        v.status=Status::Refuted;v.counterexample=Some(c.clone());
        v.reasons.push("concrete policy-false snapshot admitted by the actual engine; fixture origin is explicit, not an empty-state reachability theorem".into());
    }}
}

fn arguments(args:&BTreeMap<String,ir::ArgType>,variant:usize)->Option<BTreeMap<String,Value>>{
    use ir::ArgType as A;
    fn one(k:&A,v:usize)->Option<Value>{Some(match k{
        A::Ref{table}=>id(table),A::Principal=>Value::Id(if v&1==0{OTHER}else{VIEWER}.into()),A::Id=>Value::Id("security-argument".into()),A::Cursor|A::Optional(_)=>Value::Null,
        A::Text{min,max,..}=>Value::String("z".repeat((*min).max(1).min(*max) as usize)),A::Enum{variants}=>Value::String(variants.get(v%variants.len())?.clone()),A::Int|A::Decimal{..}|A::Money{..}=>Value::Int(1),A::IntRange{min,max}=>Value::Int(1i64.clamp(*min,*max)),A::Time=>Value::Int(NOW+86_400_000),A::Bool=>Value::Bool(v&2==0),A::List{of:Some(inner),..}=>Value::Array(vec![one(inner,v)?]),A::ListRange{of:Some(inner),min,..}=>Value::Array((0..*min).map(|_|one(inner,v)).collect::<Option<_>>()?),A::List{..}=>Value::Array(Vec::new()),A::Json{..}=>Value::Null,A::Bytes{..}=>Value::Bytes(Vec::new()),A::Image{..}=>Value::String("$security:image".into()),A::File{..}=>Value::String("$security:file".into()),_=>return None,
    })}
    args.iter().map(|(n,k)|one(k,variant).map(|v|(n.clone(),v))).collect()
}

fn materialize_arguments(engine:&mut Engine,args:&BTreeMap<String,ir::ArgType>,values:&BTreeMap<String,Value>,viewer:&str)->Result<BTreeMap<String,Value>,String>{
    fn one(e:&mut Engine,k:&ir::ArgType,v:&Value,viewer:&str)->Result<Value,String>{Ok(match (k,v){
        (ir::ArgType::Optional(inner),v) if *v!=Value::Null=>one(e,inner,v,viewer)?,
        (ir::ArgType::List{of:Some(inner),..}|ir::ArgType::ListRange{of:Some(inner),..},Value::Array(xs))=>Value::Array(xs.iter().map(|v|one(e,inner,v,viewer)).collect::<Result<_,_>>()?),
        (ir::ArgType::Image{..},Value::String(marker)) if marker=="$security:image"=>e.store_asset(viewer,&PNG,NOW).map_err(|e|e.to_string())?.column_value(),
        (ir::ArgType::File{types,..},Value::String(marker)) if marker=="$security:file"=>assets::file(e,viewer,types)?,
        _=>v.clone(),
    })}
    values.iter().map(|(n,v)|one(engine,&args[n],v,viewer).map(|v|(n.clone(),v))).collect()
}

/// Fixture-free campaigns retain empty-start bootstraps and populated role worlds.
/// The two initial states share the existing 512-single/512-pair work envelope.
pub fn generated_campaign(bound:&Bound,campaign:&mut Campaign,matrix:bool){
    campaign.history_limit=64;campaign.generated_fixture=false;
    if !campaign.reserve(1){return;}
    match engine_with(bound,&BTreeMap::new(),Vec::new()){
        Ok(empty)=>fixture_observers(bound,&empty,campaign),
        Err(why)=>{campaign.unsupported.insert(format!("empty initial campaign unavailable: {why}"));}
    }
    campaign.history_limit=448;campaign.generated_fixture=true;
    match generated_fixture(bound,campaign){
        Ok(fixture)=>if matrix{operations(bound,&fixture,campaign)}else{fixture_observers(bound,&fixture,campaign)},
        Err(why)=>{campaign.unsupported.insert(format!("generated fixture campaign unavailable: {why}"));}
    }
    campaign.history_limit=0;campaign.generated_fixture=false;
}
/// Exercise every authored query/mutation with cross-principal candidates.
/// This is conformance exploration, not a guessed spec oracle: only declared
/// policies and replayed violations can fail security acceptance.
pub fn fixture_observers(bound:&Bound,fixture:&Engine,campaign:&mut Campaign){
    let first=campaign.violations.len();
    histories::initial_observers(bound,fixture,campaign);
    column_reads::fixture(bound,fixture,campaign);
    if !campaign.generated_fixture {trusted_reads(bound,fixture,campaign);}
    histories::run(bound,fixture,campaign);
    if campaign.generated_fixture {for witness in &mut campaign.violations[first..] {
        if witness.reachability==Reachability::AuthoredFixtureTrace {witness.reachability=Reachability::GeneratedFixtureTrace;witness.scope="actual authored observation from a validated generated initial fixture; fixture initialization is not claimed application-reachable".into();}
    }}
}
pub fn operations(bound:&Bound,fixture:&Engine,campaign:&mut Campaign){
    fixture_observers(bound,fixture,campaign);
    assets::run(bound,fixture,campaign);
    let fixtures=match readback(fixture){Ok(r)=>r,Err(e)=>{campaign.unsupported.insert(e);return;}};
    let has_fixture=fixtures.values().any(|r|!r.is_empty());
    if fixtures.values().map(Vec::len).sum::<usize>()>1000{campaign.unsupported.insert("operation fixture matrix exceeds 1000 rows; provide a focused security fixture".into());return;}
    let mut viewers=histories::viewers(bound);
    for (table,rows) in &fixtures{for row in rows{for (c,k) in &bound.schema.tables[table].columns{if matches!(k.required(),C::Principal)&&let Ok(Value::Id(p))=row.field(c)&&!viewers.contains(p){viewers.push(p.clone());}}}}
    let eligible=bound.programs.iter().filter(|p|matches!(p.program.kind,ProgramKind::Query|ProgramKind::Mutation)&&!p.program.native).count();
    let quota=(8192/eligible.max(1)).clamp(1,512);let mut remaining=8192usize;
    for p in &bound.programs{
        if !matches!(p.program.kind,ProgramKind::Query|ProgramKind::Mutation)||p.program.native{campaign.unsupported.insert(format!("{}: trusted/system/opaque operation",p.program.name));continue;}
        let target=bound.schema.visible_tables().find(|(t,_)|super::audit::mentions(&serde_json::to_value(&p.program).unwrap(),t)).or_else(||bound.schema.visible_tables().next()).map(|(t,_)|t.clone());
        let Some(target)=target else{campaign.unsupported.insert(format!("{}: no table population for generated arguments",p.program.name));continue;};
        let dummy=Invariant{table:target,target:"read".into(),column:None,predicate:"allow".into(),site:crate::Site::default(),policy:Some(RuleExpr::Allow),operation:Some(p.program.name.clone()),requirements:Vec::new(),syntax:None,unsupported:None};
        let cases=histories::fixture_cases(&p.program,&fixtures,&viewers,campaign);
        let mut exercised=0;
        'cases:for (variant,mut args) in cases.into_iter().enumerate(){
            let rows=if has_fixture{fixtures.clone()}else{match snapshot(bound,&dummy,variant){Ok(r)=>r,Err(e)=>{campaign.unsupported.insert(format!("{}: {e}",p.program.name));break;}}};
            if !has_fixture{for (arg,kind) in &p.program.args {if let ir::ArgType::Ref{table}=kind&&let Some(row)=rows.get(table).and_then(|rs|rs.first())&&let Ok(id)=row.field("id"){args.insert(arg.clone(),id.clone());}}}
            for viewer in &viewers{
                if exercised==quota||remaining==0{campaign.unsupported.insert(format!("{}: operation matrix capped at {quota} calls to share the 8192-call budget across every operation; remaining arguments/viewers not covered",p.program.name));break 'cases;}
                exercised+=1;remaining-=1;
                let mut engine=match if has_fixture {fork(bound,fixture,Vec::new())}else{engine(bound,&rows,program("$security.matrix",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))]))}{Ok(e)=>e,Err(e)=>{campaign.unsupported.insert(format!("{}: {e}",p.program.name));continue;}};
                let args=match materialize_arguments(&mut engine,&p.program.args,&args,viewer){Ok(a)=>a,Err(why)=>{campaign.unsupported.insert(format!("{}: argument ledger unavailable: {why}",p.program.name));continue;}};
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

fn fork(_bound:&Bound,fixture:&Engine,probes:Vec<Program>)->Result<Engine,String>{
    if !probes.is_empty(){return Err("fixture probes must be authored operations".into());}
    fixture.fork_fixture().map_err(|e|e.to_string())
}

// Authored seed/fixture data is an explicit trusted initial assumption. A raw
// row-read admission witness is failing; column privacy still needs an actual
// authored observer and synthetic mutations remain supplemental.
fn trusted_reads(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    let Ok(rows)=readback(fixture)else{return;};
    let Ok(mut judge)=fixture.fork_fixture()else{return;};
    let actors=histories::actors(bound,&rows);
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&i.column.is_none()){
        if inv.policy.as_ref().is_some_and(|policy|kernel::implies(&bound.schema.tables[&inv.table].rules.read,policy)==Ok(true)){continue;}
        if rows.get(&inv.table).is_some_and(|rs|rs.len()>1000){out.unsupported.insert(format!("{}: raw authored fixture admission samples the first 1000 rows; remaining rows uncovered",inv.target_label()));}
        'rows:for row in rows.get(&inv.table).into_iter().flatten().take(1000){for viewer in &actors{
            if !out.reserve(1){return;}
            if !live(&bound.schema.tables[&inv.table],row)||!matches!(judge.fixture_policy(&bound.schema.tables[&inv.table].rules.read,viewer,None,row,NOW),Ok(rules::Verdict::Readable))||policy_in(bound,inv,&rows,viewer,None,row,&mut judge)!=Ok(false){continue;}
            out.violations.push(Counterexample{reachability:Reachability::AuthoredFixtureTrace,invariant_site:inv.site.to_string(),args:BTreeMap::new(),viewer:viewer.clone(),operation:"$fixture.read-admission".into(),effect:"read".into(),row:row.clone(),old:None,supporting_rows:rows.clone(),rule_path:"ordinary row-read gate admits authored fixture data contrary to declared intent".into(),scope:"authored fixture initialization is trusted; raw row admission, no initialization history claimed".into(),observations:None,history:Vec::new()});
            break 'rows;
        }}
    }
}
