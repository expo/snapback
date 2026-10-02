//! Lifetime topology is generated independently of the source's lifetime.
use super::*;
use crate::{ir::Program, partition};

#[derive(Clone, Copy, Debug)]
enum Lifetime { Direct, Inherited, Through }
#[derive(Clone, Copy, Debug)]
struct Config { lifetime: Lifetime, source_expiry: bool, member_expiry: bool, default_mark: i64, tombstones: bool }
fn backend(c: Config) -> (Schema, Vec<Program>) {
    let member_life = match c.lifetime {
        Lifetime::Direct => "read <- allow",
        Lifetime::Inherited => "read through .conversationId\n  immutable conversationId",
        Lifetime::Through => "lease: leases\n  immutable lease\n  read through .lease",
    };
    let text = format!(r#"
table conversations:
  until: time ?
  {parent_expiry}
  immutable until
  public
  sync public
table leases:
  room: conversations
  immutable room
  read through .room
  insert <- allow
  sync
table members:
  conversationId: conversations
  principal: principal
  mark: int default {mark}
  until: time ?
  cap 100 by conversationId
  {member_life}
  {member_expiry}
  insert <- allow
  update <- allow
  delete <- allow
  sync
table messages:
  conversationId: conversations
  ordinal: int
  senderId: principal
  tombstone: bool default false
  until: time ?
  {expiry}
  insert <- allow
  update <- allow
  delete <- allow
  public
  sync public
view unread: count messages by members m
  where .conversationId = m.conversationId and .ordinal > m.mark
    and .senderId != m.principal {predicate}
query pair(member: members, room: conversations):
  return {{ value: unread[member], sources: messages where .conversationId = room first 100 }}
mutation remove(message: messages):
  delete messages[message]
mutation extend(member: members, until: time):
  update members[member] {{ until }}
"#, mark=c.default_mark,
        parent_expiry=if c.member_expiry {"expire at .until"} else {""},
        member_expiry=if c.member_expiry && !matches!(c.lifetime,Lifetime::Inherited) {"expire at .until"} else {""},
        expiry=if c.source_expiry { "expire at .until" } else { "" },
        predicate=if c.tombstones { "and not .tombstone" } else { "" });
    let b = snapback4_lang::compile(&[("lifetimes.q".into(), text)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    (crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap(),
     crate::json_codec::from_text(&crate::json_codec::to_text(&b.programs.into_iter().map(|p|p.program).collect::<Vec<_>>()).unwrap()).unwrap())
}
fn put_field(row: Value, key: &str, value: Value) -> Value {
    let mut fields = row.as_object().unwrap().clone(); fields.insert(key.into(), value); Value::Row(fields.into())
}
fn recipient(c: Config, n: usize, group: usize, until: Option<i64>, mark: Option<i64>) -> Value {
    let mut row = object([("id", id(&format!("u{n}"))), ("conversationId", id(&format!("r{group}"))),
        ("principal", id(&format!("p{n}"))), ("until", until.map(Value::Int).unwrap_or(Value::Null))]);
    if let Some(mark) = mark { row = put_field(row, "mark", Value::Int(mark)); }
    if matches!(c.lifetime, Lifetime::Through) { row = put_field(row, "lease", id(&format!("l{group}"))); }
    row
}
fn source(n: usize, group: usize, ordinal: i64, until: Option<i64>) -> Value {
    put_field(message(n, ordinal, 99, false, until), "conversationId", id(&format!("r{group}")))
}
fn seed_parents(e: &mut Engine) {
    e.seed_at((0..2).flat_map(|n| [
        ("conversations".into(), object([("id", id(&format!("r{n}"))), ("until", Value::Int(2000 + n * 2000))])),
        ("leases".into(), object([("id", id(&format!("l{n}"))), ("room", id(&format!("r{n}")))]))]), 1).unwrap();
}
fn config(lifetime: Lifetime) -> Config { Config { lifetime, source_expiry: false, member_expiry: true, default_mark: 0, tombstones: true } }

// Independent raw fact model: no engine expiry selector, row-key predicate,
// evidence, stored count or scalar/acquisition dispatch decides these answers.
fn member_live(c: Config, u: &Value, now: i64) -> bool {
    if !c.member_expiry { return true; }
    let group = u.field("conversationId").unwrap().as_str().unwrap();
    match c.lifetime {
        Lifetime::Direct => live(u, now),
        Lifetime::Inherited => now < if group == "r0" { 2000 } else { 4000 },
        Lifetime::Through => live(u, now) && now < if u.field("lease").unwrap() == &id("l0") { 2000 } else { 4000 },
    }
}
fn expected(c: Config, u: &Value, messages: &BTreeMap<usize, Value>, now: i64) -> Option<i64> {
    member_live(c, u, now).then(|| messages.values().filter(|m|
        (!c.source_expiry || live(m, now))
        && m.field("conversationId").unwrap() == u.field("conversationId").unwrap()
        && field(m, "ordinal") > u.field("mark").ok().and_then(|v|v.as_int().ok()).unwrap_or(c.default_mark)
        && m.field("senderId").unwrap() != u.field("principal").unwrap()
        && (!c.tombstones || m.field("tombstone").unwrap() == &Value::Bool(false))).count() as i64)
}
fn check_rows(tx: &crate::store::Tx<'_>, schema: &Schema, c: Config, members: &BTreeMap<usize, Value>, messages: &BTreeMap<usize, Value>, now: i64, label: &str) -> usize {
    let views: Vec<_> = tx.scan("unread", "byId", &[], &Bounds::default(), Dir::Asc, 256).unwrap().into_iter().map(|(v,_)|v).collect();
    assert_eq!(views.len(), members.len(), "{label} materialized member count");
    let runner = || Runner::new(tx, schema, Context::new("reader", Default::default()).at(now), Meter::new(Ceilings::unbounded(), Cut::Cap), 0);
    let mut stream = runner(); let mut cold = runner(); let mut scalar = runner();
    let batches = stream.live_aggregate_batch("unread", &views).unwrap();
    let acquisition = cold.live_acquisition_batch("unread", &views).unwrap();
    let mut comparisons = 0;
    for ((view, batch), acquired) in views.iter().zip(batches).zip(acquisition) {
        let name = view.field("id").unwrap().as_str().unwrap();
        let n: usize = name[1..].parse().unwrap();
        let want = expected(c, &members[&n], messages, now);
        // Every path compares separately with facts, so two dispatches agreeing
        // on the same stale cache cannot satisfy the acquisition comparison.
        for (path, image) in [("scalar", scalar.live_aggregate("unread", view.clone()).unwrap()), ("batch", batch), ("acquisition", acquired)] {
            assert_eq!(image.as_ref().map(|v|field(v,"value")), want, "{label} {path} member={name} clock={now} config={c:?}");
            if let Some(image) = image { assert!(!pending(&image), "{label} {path} incomplete"); }
            comparisons += 1;
        }
    }
    // The actual transport entry points must also cross the dispatch guard.
    let snapshot = partition::snapshot_page(tx, schema, "reader", None, 10000, now).unwrap();
    assert!(snapshot.next.is_none());
    let stream = partition::stream(tx, schema, "reader", 0, 10000, now).unwrap();
    assert!(!stream.more);
    let snapshot: Vec<_> = snapshot.events.into_iter().filter(|e| e.table == "unread" && e.kind == partition::EventKind::Put).map(|e|(e.id,e.data)).collect();
    let stream: Vec<_> = stream.events.into_iter().filter(|e| e.table == "unread" && e.kind == "put").map(|e|(e.id,e.data)).collect();
    for (path, events) in [("snapshot", snapshot), ("stream", stream)] {
        let mut delivered = std::collections::BTreeSet::new();
        for (id, data) in events {
            let n: usize = id[1..].parse().unwrap();
            let want = members.get(&n).and_then(|u|expected(c,u,messages,now));
            assert_eq!(data.as_ref().map(|v|field(v,"value")), want, "{label} transport {path} id={n}");
            assert!(!pending(data.as_ref().unwrap()));
            delivered.insert(n); comparisons += 1;
        }
        for (&n, u) in members { if expected(c,u,messages,now).is_some() { assert!(delivered.contains(&n), "{label} {path} omitted u{n}"); } }
    }
    comparisons
}

fn reproduction(lifetime: Lifetime) {
    let c = config(lifetime); let (schema, programs) = backend(c);
    let mut e = Engine::memory(schema, programs).unwrap(); seed_parents(&mut e);
    let insertion = matches!(lifetime, Lifetime::Direct);
    let u = recipient(c, 0, 0, Some(10), Some(0));
    let m = source(0, 0, 1, None);
    e.seed_at([("members".into(), u.clone())], if insertion {1} else {1000}).unwrap();
    e.seed_at([("messages".into(), m.clone())], if insertion {11} else {1000}).unwrap();
    if !insertion {
        e.mutate("lifetimes.remove", None, Context::new("reader", BTreeMap::from([("message".into(),id("m0"))])).at(2500)).unwrap();
    }
    let now = if insertion {9} else {1500};
    let result = e.query("lifetimes.pair", Context::new("reader", BTreeMap::from([("member".into(),id("u0")),("room".into(),id("r0"))])).at(now)).unwrap();
    let want = i64::from(insertion);
    assert!(result.complete);
    let sources = result.data.field("sources").unwrap().as_array().unwrap().len() as i64;
    eprintln!("BG round3 literal {lifetime:?}: value={:?} authorized_sources={sources} complete={}", result.data.field("value"), result.complete);
    assert_eq!(result.data.field("value"), Ok(&Value::Int(sources)), "literal {lifetime:?} same-query authorized sources");
    assert_eq!(sources, want);
    let schema = e.schema().clone(); let tx = e.store_mut().transaction().unwrap();
    check_rows(&tx,&schema,c,&BTreeMap::from([(0,u)]),&if insertion {BTreeMap::from([(0,m)])} else {BTreeMap::new()},now,"literal");
}
#[test] fn nonexpiring_source_direct_member_rollback() { reproduction(Lifetime::Direct); }
#[test] fn nonexpiring_source_inherited_member_rollback() { reproduction(Lifetime::Inherited); }

#[test]
fn generated_direct_lifetimes() { generated_lifetimes(0); }
#[test] fn generated_inherited_lifetimes() { generated_lifetimes(1); }
#[test] fn generated_through_lifetimes() { generated_lifetimes(2); }
fn generated_lifetimes(topology: usize) {
    let mut comparisons = 0; let mut overlapping = 0; let mut ops = [0usize; 10];
    for (case, seed) in [7u64, 20261002, 0xdeadbeef, 0x5eed, 28, 0x12345678].into_iter().enumerate().filter(|(case,_)|case % 3 == topology) {
        let mut c = config([Lifetime::Direct,Lifetime::Inherited,Lifetime::Through][case % 3]);
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target").join(format!("bg-lifetime-{}-{seed}.sqlite",std::process::id()));
        let _=std::fs::remove_file(&path);
        let (schema,programs) = backend(c); let mut e=Engine::new(Store::open(&path).unwrap(),schema,programs).unwrap(); seed_parents(&mut e);
        let mut members=BTreeMap::<usize,Value>::new(); let mut messages=BTreeMap::<usize,Value>::new(); let mut state=seed; let mut now=1;
        // Generated prefixes include each review failure before random mutations.
        let initial=recipient(c,0,0,if topology==0 {Some(10)} else {None},Some(0));
        e.seed_at([("members".into(),initial.clone())],1).unwrap(); members.insert(0,initial);
        let initial=source(0,0,1,None);
        e.seed_at([("messages".into(),initial.clone())],if topology==0 {11} else {1000}).unwrap(); messages.insert(0,initial);
        if topology!=0 {remove(&mut e,"messages","m0",2500); messages.remove(&0);}
        let schema=e.schema().clone();
        {let tx=e.store_mut().transaction().unwrap();comparisons+=check_rows(&tx,&schema,c,&members,&messages,if topology==0 {9} else {1500},"generated review prefix");}
        for step in 0..180 {
            let n=(random(&mut state)%32) as usize; let u=(random(&mut state)%6) as usize;
            let group=(random(&mut state)%2) as usize;
            let op=if step<10 {step} else {(random(&mut state)%10) as usize}; ops[op]+=1;
            match op {
                0 => { // Members with mutable group keys also exercise parent moves.
                    let mut row=recipient(c,u,group,Some(now+200),(random(&mut state)%2==0).then(||(random(&mut state)%10) as i64));
                    if let Some(old)=members.get(&u) {
                        if matches!(c.lifetime,Lifetime::Inherited) { row=put_field(row,"conversationId",old.field("conversationId").unwrap().clone()); }
                        if matches!(c.lifetime,Lifetime::Through) { row=put_field(row,"lease",old.field("lease").unwrap().clone()); }
                    }
                    // Read-through activation requires a live parent. Insert at
                    // an earlier supplied clock; the read clock stays independent.
                    e.seed_at([("members".into(),row.clone())],1).unwrap();
                    if row.field("mark").is_err() {
                        // Legal legacy representation: absent defaulted field.
                        // Current meaning is unchanged; adoption must evaluate it
                        // under the new default and rebuild the numerical basis.
                        let schema=e.schema().clone(); let tx=e.store_mut().transaction().unwrap();
                        let stored=tx.get("members", &format!("u{u}")).unwrap().unwrap();
                        let mut legacy=stored.as_object().unwrap().clone(); legacy.remove("mark");
                        tx.put("members",&schema.tables["members"],&Value::Row(legacy.into()),Some(&stored)).unwrap(); tx.commit().unwrap();
                    }
                    members.insert(u,row);
                }
                1 | 2 => { // Source parent moves, tombstones, deadlines and edits.
                    let mut row=source(n,group,(random(&mut state)%30) as i64, (random(&mut state)%2==0).then_some(1800));
                    row=put_field(row,"tombstone",Value::Bool(random(&mut state)%3==0));
                    e.seed_at([("messages".into(),row.clone())],now).unwrap();
                    if !c.source_expiry || live(&row,now) {messages.insert(n,row);} else {messages.remove(&n);}
                }
                3 => { remove(&mut e,"messages",&format!("m{n}"),now); if messages.get(&n).is_some_and(|m|!c.source_expiry||live(m,now)){messages.remove(&n);} }
                4 => { now=[9,1500,1900,2500,3900,4500][random(&mut state) as usize%6]; }
                5 => {
                    e.sweep_expired(now,1000).unwrap();
                    messages.retain(|_,m|!c.source_expiry||live(m,now));
                    members.retain(|_,m|member_live(c,m,now));
                    // Parent sweep can remove parents after their children.
                    // Restore identical immutable roots before the next generated insertion.
                    seed_parents(&mut e);
                }
                6 => {
                    if random(&mut state)%2==0 {c.source_expiry=!c.source_expiry;} else {c.member_expiry=!c.member_expiry;}
                    c.tombstones=!c.tombstones;
                    c.default_mark=if c.default_mark==0 {5} else {0};
                    let (schema,programs)=backend(c); e.adopt_at(schema,programs,1).unwrap();
                }
                7 => { e.run_view_chunk(now).unwrap(); }
                8 => { let schema=e.schema().clone(); let programs=backend(c).1; drop(e); e=Engine::new_at(Store::open(&path).unwrap(),schema,programs,now).unwrap(); }
                _ => {
                    let schema=e.schema().clone(); let mut reader=e.store().reader().unwrap();
                    let old=reader.read_transaction().unwrap(); let old_messages=messages.clone();
                    // Keep the old snapshot and old clock open across a writer,
                    // then open a second snapshot with a different pinned clock.
                    comparisons+=check_rows(&old,&schema,c,&members,&old_messages,1500,"overlap before");
                    let row=source(1000+step,group,20,None);
                    e.seed_at([("messages".into(),row.clone())],2500).unwrap(); messages.insert(1000+step,row);
                    let mut second=e.store().reader().unwrap(); let newer=second.read_transaction().unwrap();
                    comparisons+=check_rows(&newer,&schema,c,&members,&messages,2500,"overlap newer");
                    comparisons+=check_rows(&old,&schema,c,&members,&old_messages,1500,"overlap retained"); overlapping+=1;
                }
            }
            let schema=e.schema().clone(); let tx=e.store_mut().transaction().unwrap();
            comparisons+=check_rows(&tx,&schema,c,&members,&messages,now,&format!("seed={seed} step={step}"));
        }
        eprintln!("BG round3 topology seed={seed} lifetime={:?} steps=180",c.lifetime);
        drop(e); std::fs::remove_file(path).unwrap();
    }
    eprintln!("BG round3 topology={topology}: 2 seeds x 180 steps + 2 review prefixes comparisons={comparisons} overlapping={overlapping} operations={ops:?}");
}

struct DeviceRows { rows: crate::rows::MemoryRows, covered: bool }
impl crate::rows::Rows for DeviceRows {
    fn current_row(&self, _: &str, _: &Value) -> Result<bool, RuntimeError> { Ok(true) }
    fn current_group(&self, t: &str, _: &str, _: &[Value]) -> Result<bool, RuntimeError> { Ok(t != "messages" || self.covered) }
    fn acquired_boundary(&self, _: &str, _: &str, _: &[Value]) -> Result<Option<crate::rows::AcquiredBoundary>, RuntimeError> { Ok(self.covered.then_some(crate::rows::AcquiredBoundary::Whole)) }
    fn get(&self,t:&str,id:&str)->Result<Option<Value>,RuntimeError>{self.rows.get(t,id)}
    fn lookup(&self,t:&str,n:&str,i:&crate::schema::Index,k:&[Value])->Result<Option<Value>,RuntimeError>{self.rows.lookup(t,n,i,k)}
    fn scan(&self,t:&str,i:&str,p:&[Value],b:&Bounds,d:Dir,n:usize)->Result<Vec<(Value,Vec<u8>)>,RuntimeError>{self.rows.scan(t,i,p,b,d,n)}
    fn index_head(&self,t:&str,i:&str,p:&[Value],b:&Bounds,d:Dir)->Result<Option<Vec<Value>>,RuntimeError>{self.rows.index_head(t,i,p,b,d)}
    fn count_prefix(&self,t:&str,i:&str,p:&[Value],n:u64)->Result<u64,RuntimeError>{self.rows.count_prefix(t,i,p,n)}
    fn scan_metered(&self,t:&str,i:&str,p:&[Value],b:&Bounds,d:Dir,n:usize,s:&crate::engine::Authorization,m:&mut crate::engine::InternalMeter<'_>)->Result<Vec<(Value,Vec<u8>)>,RuntimeError>{self.rows.scan_metered(t,i,p,b,d,n,s,m)}
    fn put(&self,t:&str,s:&crate::schema::Table,r:&Value,o:Option<&Value>)->Result<u64,RuntimeError>{self.rows.put(t,s,r,o)}
    fn delete(&self,t:&str,s:&crate::schema::Table,r:&Value)->Result<u64,RuntimeError>{self.rows.delete(t,s,r)}
}
#[test]
fn device_never_reuses_a_missed_member_delta() {
    use crate::rows::Rows;
    for lifetime in [Lifetime::Direct,Lifetime::Inherited,Lifetime::Through] {
        let c=config(lifetime); let (schema,programs)=backend(c);
        let mut e=Engine::memory(schema,programs).unwrap();seed_parents(&mut e);
        e.seed_at([("members".into(),recipient(c,0,0,None,Some(0))), ("messages".into(),source(0,0,1,None))],1).unwrap();
        let mut schema=e.schema().clone();
        // Exercise the device's whole acquisition boundary, then the same
        // physical rows with that proof absent. Public key floors cannot
        // certify a parent suffix; a missing Whole must remain pending.
        let mut source=schema.tables["messages"].clone();
        source.sync.as_mut().unwrap().horizon=Some(crate::schema::Horizon { last: 500, by: "byId".into() });
        schema.tables.insert("messages".into(),source);
        for covered in [true,false] {
            let rows=DeviceRows{rows:crate::rows::MemoryRows::new(),covered};
            for (name,table) in &schema.tables { for row in e.store().rows(name).unwrap() {rows.put(name,table,&row,None).unwrap();} }
            let old=rows.get("unread","u0").unwrap().unwrap();
            let poisoned=put_field(old.clone(),"value",Value::Int(999));
            rows.put("unread",&schema.tables["unread"],&poisoned,Some(&old)).unwrap();
            let mut r=Runner::new(&rows,&schema,Context::new("reader",Default::default()).at(1500),Meter::new(Ceilings::unbounded(),Cut::Cap),0);
            r.device=true;
            let actual=r.live_aggregate("unread",poisoned).unwrap().unwrap();
            assert_eq!(pending(&actual),!covered,"{lifetime:?} coverage={covered}");
            assert!(field(&actual,"value")<=1,"device exposed stored poison");
            if covered {assert_eq!(field(&actual,"value"),1);} else {assert!(r.timeline_pending);}
            // Writer-side no-change member refresh also must not carry poison.
            if covered {
                let member=rows.get("members","u0").unwrap().unwrap();
                r.row_view_member(schema.maintains.iter().find(|m|m.target=="unread").unwrap(),Some(&member),Some(&member)).unwrap();
                assert_eq!(field(&rows.get("unread","u0").unwrap().unwrap(),"value"),1);
            }
        }
    }
}

#[test]
fn forward_only_lapsed_member_extension_recounts() {
    for lifetime in [Lifetime::Direct,Lifetime::Through] {
        let c=config(lifetime);let (schema,programs)=backend(c);
        let mut e=Engine::memory(schema,programs).unwrap();seed_parents(&mut e);
        e.seed_at([("members".into(),recipient(c,0,0,Some(10),Some(0)))],1).unwrap();
        e.seed_at([("messages".into(),source(0,0,1,None))],11).unwrap();
        let outcome=e.mutate("lifetimes.extend",None,Context::new("reader",BTreeMap::from([("member".into(),id("u0")),("until".into(),Value::Int(20))])).at(12)).unwrap();
        // An ordinary update cannot address an already-expired member.
        assert!(matches!(outcome.state,crate::engine::WriteState::Failed{ref why,..} if why.code=="NOT_FOUND"),"{outcome:?}");
        // The supported seed/import restoration uses ordinary contribution
        // maintenance and can extend the existing row without rewinding time.
        e.seed_at([("members".into(),recipient(c,0,0,Some(20),Some(0)))],12).unwrap();
        let result=e.query("lifetimes.pair",Context::new("reader",BTreeMap::from([("member".into(),id("u0")),("room".into(),id("r0"))])).at(12)).unwrap();
        eprintln!("BG round3 forward extension {lifetime:?}: value={:?} complete={}",result.data.field("value"),result.complete);
        assert!(result.complete);
        assert_eq!(result.data.field("sources").unwrap().as_array().unwrap().len(),1);
        assert_eq!(result.data.field("value"),Ok(&Value::Int(1)),"forward extension at 1,11,12");
        assert_eq!(field(&e.store().rows("unread").unwrap()[0],"value"),1,"extension refreshes the stored count too");
    }
}

#[test]
fn fanout_overflow_rolls_back_every_contribution() {
    let c=config(Lifetime::Direct);let (schema,programs)=backend(c);
    let mut e=Engine::memory(schema,programs).unwrap();seed_parents(&mut e);
    e.seed_at((0..100).map(|n|("members".into(),recipient(c,n,0,None,Some(0)))),1).unwrap();
    let before=e.store().rows("unread").unwrap();
    let result=e.seed_at([("messages".into(),source(0,0,1,None)),("members".into(),recipient(c,100,0,None,Some(0)))],11);
    assert!(result.is_err(),"cap overflow must fail the transaction");
    assert_eq!(e.store().rows("unread").unwrap(),before);
    assert!(e.store().rows("messages").unwrap().is_empty());
    let schema=e.schema().clone();let tx=e.store_mut().transaction().unwrap();
    check_rows(&tx,&schema,c,&(0..100).map(|n|(n,recipient(c,n,0,None,Some(0)))).collect(),&BTreeMap::new(),11,"fanout rollback");
}

#[test]
fn forward_only_member_maintenance_refresh_recounts() {
    let c=config(Lifetime::Direct);let (schema,programs)=backend(c);
    let mut e=Engine::memory(schema,programs).unwrap();seed_parents(&mut e);
    let old=recipient(c,0,0,Some(10),Some(0));let new=recipient(c,0,0,Some(20),Some(0));
    e.seed_at([("members".into(),old.clone())],1).unwrap();
    e.seed_at([("messages".into(),source(0,0,1,None))],11).unwrap();
    let schema=e.schema().clone();let tx=e.store_mut().transaction().unwrap();
    tx.put("members",&schema.tables["members"],&new,Some(&old)).unwrap();
    let mut r=Runner::new(&tx,&schema,Context::new("reader",Default::default()).at(12),Meter::new(Ceilings::unbounded(),Cut::Abort),0);
    r.row_view_member(schema.maintains.iter().find(|m|m.target=="unread").unwrap(),Some(&old),Some(&new)).unwrap();
    // This isolates the maintenance contract Grok read. Ordinary expired-row
    // mutations refuse and imports replace the predecessor (tested above);
    // neither is misreported as a public mutation reproduction of this seam.
    assert_eq!(field(&tx.get("unread","u0").unwrap().unwrap(),"value"),1,"forward extension at 1,11,12 maintenance seam");
}


#[test]
fn source_delete_after_member_rollback_never_subtracts_a_stale_cache() {
    for lifetime in [Lifetime::Direct,Lifetime::Inherited,Lifetime::Through] {
        for source_expiry in [false,true] {
            let mut c=config(lifetime);c.source_expiry=source_expiry;
            let (schema,programs)=backend(c);let mut e=Engine::memory(schema,programs).unwrap();seed_parents(&mut e);
            e.seed_at([("members".into(),recipient(c,0,0,Some(10),Some(0)))],1).unwrap();
            e.seed_at([("messages".into(),source(0,0,1,None))],2500).unwrap();
            let now=if matches!(lifetime,Lifetime::Inherited) {1500} else {9};
            let result=e.mutate("lifetimes.remove",None,Context::new("reader",BTreeMap::from([("message".into(),id("m0"))])).at(now)).unwrap();
            assert!(matches!(result.state,crate::engine::WriteState::Sent{..}),"stale cache must not refuse deletion: {lifetime:?} source_expiry={source_expiry} {result:?}");
            let schema=e.schema().clone();
            {let tx=e.store_mut().transaction().unwrap();
             check_rows(&tx,&schema,c,&BTreeMap::from([(0,recipient(c,0,0,Some(10),Some(0)))]),&BTreeMap::new(),now,"delete after rollback");}
            while e.run_view_chunk(now).unwrap().is_some() {}
            assert_eq!(field(&e.store().rows("unread").unwrap()[0],"value"),0);
        }
    }
}
