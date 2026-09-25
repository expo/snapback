//! Lane Q: backlog costs, portable indexes, and device design counterexamples.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Ceilings, Context, Engine, Value, WriteState, value::object};
use snapback4_device::device::{Device, StreamPage};
use snapback4_device::store::DeviceStore;
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/expiring-counts.q");
fn row(n: usize, until: Value) -> (String, Value) {
    ("receipts".into(), object([("id", id(&format!("r{n:05}"))), ("chat",id("chat")), ("principal",id("alice")), ("state",Value::Int(0)), ("visible",Value::Bool(true)), ("weight",Value::Int((n % 9) as i64 - 4)), ("at",Value::Int(0)), ("expiresAt",until)]))
}
fn snapshot<S: DeviceStore>(server: &mut Engine, device: &mut Device<S>, now: i64) {
    let mut after = None;
    loop {
        let page = server.snapshot_acquisition_page_at("alice", after.as_deref(), 500, now).unwrap();
        let next = page.next.map(|c| c.encode());
        let wire: StreamPage = serde_json::from_value(json!({"snapshot":true,"after":after,"held":page.held,"acquisitions":page.acquisitions,"events":page.events.iter().map(|e|json!({"table":e.table,"kind":e.kind,"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":page.watermark,"more":next.is_some(),"next":next,"generation":server.generation()})).unwrap();
        device.apply(&wire, after.is_none()).unwrap();
        if next.is_none() { break; }
        after = next;
    }
}
fn read(server: &mut Engine, now: i64) -> snapback4_core::engine::QueryOutcome {
    server.query("unread", Context::new("alice",args(&[])).at(now)).unwrap()
}

#[test]
fn server_cost_is_constant_plus_backlog_and_cuts_never_return_a_number() {
    for live in [100, 10_000] {
        for backlog in [0,500] {
            let (mut server,_) = compile(SOURCE);
            server.seed((0..live+backlog).map(|n|row(n, if n < backlog { Value::Int(100) } else if n % 2 == 0 { Value::Null } else { Value::Int(2000) }))).unwrap();
            let answer = read(&mut server,100);
            assert!(answer.complete, "{answer:?}");
            assert_eq!(answer.data, Value::Int(live as i64));
            assert_eq!(answer.metered.examined, backlog as u64 + 2);
            println!("live={live} backlog={backlog} examined={}",answer.metered.examined);
            if backlog > 0 {
                server.set_ceilings(Ceilings {examined: 100, ..Ceilings::default()});
                let cut = read(&mut server,100);
                assert!(!cut.complete && cut.data == Value::Null, "{cut:?}");
                server.set_ceilings(Ceilings::default());
            }
        }
    }
}

#[test]
fn backlog_subtraction_stays_in_its_group_and_pages_each_live_group_once() {
    let (mut server,_) = compile(&(SOURCE.to_owned()+"query at(chat: id):\n  return unreadCounts[chat, viewer]\n"));
    let mut expected = std::collections::BTreeMap::new();
    let mut rows = Vec::new();
    for group in 0..25 {
        let chat = format!("chat{group:02}");
        for (principal,live,expired) in [("alice",group,group%4+1),("bob",100,2)] {
            for n in 0..live+expired {
                let (_,mut receipt)=row(rows.len(),if n<expired {Value::Int(100)} else if n%2==0 {Value::Null} else {Value::Int(200)});
                if let Value::Row(fields)=&mut receipt { fields.insert("chat".into(),id(&chat)); fields.insert("principal".into(),id(principal)); }
                rows.push(("receipts".into(),receipt));
            }
        }
        if group>0 {expected.insert(chat,group as i64);}
    }
    server.seed(rows).unwrap();
    for group in 0..25 {
        for (principal,expected) in [("alice",group),("bob",100)] {
            let out=server.query("at",Context::new(principal,args(&[("chat",id(&format!("chat{group:02}")))])).at(100)).unwrap();
            assert!(out.complete,"{out:?}");
            assert_eq!(out.data,Value::Int(expected));
        }
    }
    let (mut after,mut seen,mut pages)=(Value::Null,std::collections::BTreeMap::new(),0);
    loop {
        let out=server.query("groups",Context::new("alice",args(&[("c",after)])).at(100)).unwrap();
        assert!(out.capped_at.is_none(),"{out:?}");
        let Value::Array(rows)=out.data else {panic!("expected a group page")};
        for row in rows {
            assert_eq!(row.field("principal").unwrap(),&id("alice"));
            assert!(seen.insert(row.field("chat").unwrap().as_str().unwrap().to_owned(),row.field("value").unwrap().as_int().unwrap()).is_none(),"no repeated group");
        }
        pages+=1;
        match out.next {Some(next)=>after=Value::String(next),None=>{assert!(out.complete);break;}}
        assert!(pages<3,"pagination must advance");
    }
    assert_eq!(pages,2);
    assert_eq!(seen,expected);
}

fn scale<H: Host>(host: &mut H) {
    for n in [100,10_000] {
        let (mut server,backend) = compile(SOURCE);
        let expiring = n.min(300);
        server.seed((0..n).map(|i|row(i, if i<expiring {Value::Int(1000)} else {Value::Null}))).unwrap();
        let name = format!("scale-{n}");
        let mut device = host.open(&name,Some(backend)).unwrap();
        snapshot(&mut server,&mut device,500);
        let before = device.query("unread","alice",&json!({}),500).unwrap();
        if n==100 {
            assert!(before.complete); assert_eq!(before.data,Value::Int(n as i64));
            assert_eq!(before.metered.examined,101); assert_eq!(before.next_expiry,Some(1000));
        } else {assert!(!before.complete && before.data==Value::Null);}
        let after = device.query("unread","alice",&json!({}),1000).unwrap();
        let online = read(&mut server,1000);
        assert_eq!(online.data,Value::Int((n-expiring) as i64));
        if n == 100 { assert!(after.complete); assert_eq!(after.data,online.data); }
        else {
            // Design blocker: §6 requires recomputation; §tests requires an exact
            // 10,000-row answer under the unchanged 8,192-row examination meter.
            assert!(!after.complete && after.data == Value::Null,"{after:?}");
            println!("{} device after 300 expiries: complete={} examined={} data={:?}",host.label(),after.complete,after.metered.examined,after.data);
        }
        let started = std::time::Instant::now();
        let mut passes = 0;
        let mut removed = 0;
        while removed < expiring as u64 {
            removed += server.sweep_expired_for(1000,2000,std::time::Duration::from_millis(2)).unwrap();
            passes += 1;
        }
        println!("{} size={n} sweep rows={removed} passes={passes} elapsed_us={} simulated_tick_lag_ms={}",host.label(),started.elapsed().as_micros(),passes*1000);
        snapshot(&mut server,&mut device,1000);
        let settled = device.query("unread","alice",&json!({}),1000).unwrap();
        if n==100 {assert!(settled.complete); assert_eq!(settled.data,online.data);}
        else {assert!(!settled.complete && settled.data==Value::Null);}
        assert_eq!(read(&mut server,1000).metered.examined,if n==100 {1}else{2});
        if n>expiring { assert_eq!(server.store().rows("unreadCounts").unwrap()[0].field("value").unwrap(),&Value::Int((n-expiring) as i64)); }
        host.close(&name,device);
        let mut device = host.open(&name,None).unwrap();
        assert_eq!(device.query("unread","alice",&json!({}),1000).unwrap().data,settled.data);
        host.close(&name,device);
    }
}
#[test] fn scale_memory() {scale(&mut Memory::new());}
#[test] fn scale_sqlite() {scale(&mut Sqlite::new("expiry-scale"));}

#[test]
fn physical_delivery_would_disclose_an_expired_contribution_to_a_new_device() {
    let (mut empty,_)=compile(SOURCE);
    let (mut expired,_)=compile(SOURCE);
    expired.seed([row(0,Value::Int(100))]).unwrap();
    assert_eq!(read(&mut empty,100).data,Value::Int(0));
    assert_eq!(read(&mut expired,100).data,Value::Int(0));
    assert!(empty.snapshot_at("alice",100).unwrap().0.is_empty());
    assert!(expired.snapshot_at("alice",100).unwrap().0.is_empty());
    // Proposed physical delivery distinguishes these same-live-data worlds.
    assert!(empty.store().rows("unreadCounts").unwrap().is_empty());
    let stored=expired.store().rows("unreadCounts").unwrap();
    assert_eq!(stored[0].field("value").unwrap(),&Value::Int(1));
}

#[test]
fn seeded_changes_match_the_old_live_recomputation() {
    // Count observed transitions, not merely attempted mutations. Each seed
    // must exercise selection, expiry and computed-key changes successfully.
    for seed in 1..=4 {
        let (mut server,_) = compile(SOURCE);
        let mut state = seed as u64;
        let mut now = 10;
        let mut transitions = [0usize; 9];
        for turn in 0..180 {
            state ^= state << 13; state ^= state >> 7; state ^= state << 17;
            let n = (state % 32) as usize;
            let name = format!("r{n:05}");
            let expiry = if state % 3 == 0 {Value::Null} else {Value::Int(now + (state % 30) as i64)};
            let old = server.store().rows("receipts").unwrap().into_iter().find(|r|r.field("id")==Ok(&id(&name)));
            let live = old.as_ref().is_some_and(|r|!server.schema().tables["receipts"].expired(r,now));
            let (op,input) = if old.is_none() {("add",args(&[("id",id(&name)),("expiresAt",expiry),("weight",Value::Int((state%21) as i64-10))]))}
            else if state%5==0 {("remove",args(&[("id",id(&name))]))}
            else {("change",args(&[("id",id(&name)),("expiresAt",expiry),("state",Value::Int((state%3) as i64)),("visible",Value::Bool(state%7!=0)),("weight",Value::Int((state%21) as i64-10)),("at",Value::Int((state%2) as i64*86_400_000))]))};
            let out=server.mutate(op,None,Context::new("alice",input.clone()).at(now)).unwrap();
            let actual = server.store().rows("receipts").unwrap().into_iter().find(|r|r.field("id")==Ok(&id(&name)));
            if old.is_some() && !live {
                // Only targets already expired before the mutation may refuse.
                assert!(matches!(out.state,WriteState::Failed{..}),"seed={seed} turn={turn} expired {op}: {out:?}");
                assert_eq!(actual,old,"a refused expired-target write changes nothing");
            } else {
                assert!(matches!(out.state,WriteState::Sent{..}),"seed={seed} turn={turn} valid {op}: {out:?}");
                if op == "remove" {
                    assert!(actual.is_none()); transitions[1]+=1;
                } else {
                    let mut expected = old.clone().unwrap_or_else(||row(n,Value::Null).1);
                    if let Value::Row(fields) = &mut expected {
                        for (field,value) in &input { fields.insert(field.clone(),value.clone()); }
                    }
                    if let Some(actual) = actual {
                        assert_eq!(actual,expected,"seed={seed} turn={turn} applied {op}");
                    } else {
                        // An insert born expired is retired at commit. The
                        // sent outcome still proves the valid write executed.
                        assert_eq!(op,"add");
                        assert!(server.schema().tables["receipts"].expired(&expected,now));
                    }
                    if let Some(old) = old {
                        let selected = |r: &Value|r.field("state").unwrap().as_int().unwrap()<2 && r.field("visible")==Ok(&Value::Bool(true));
                        transitions[2]+=usize::from(expected.field("state")==Ok(&Value::Int(1)));
                        transitions[3]+=usize::from(!selected(&old) && selected(&expected));
                        transitions[4]+=usize::from(selected(&old) && !selected(&expected));
                        let before=old.field("expiresAt").unwrap();
                        let after=expected.field("expiresAt").unwrap();
                        transitions[5]+=usize::from(before!=after && after==&Value::Null);
                        transitions[6]+=usize::from(matches!((before,after),(Value::Int(a),Value::Int(b)) if b<a));
                        transitions[7]+=usize::from(matches!((before,after),(Value::Null,Value::Int(_))) || matches!((before,after),(Value::Int(a),Value::Int(b)) if b>a));
                        transitions[8]+=usize::from(old.field("at")!=expected.field("at"));
                    } else { transitions[0]+=1; }
                }
            }
            if turn%3==0 {now+=7;}
            if turn%11==0 {server.sweep_expired(now,7).unwrap();}
            let rows=server.store().rows("receipts").unwrap();
            for (query,day,sum) in [("unread",None,false),("weight",None,true),("dayCount",Some(0),false),("dayCount",Some(1),false),("dayWeight",Some(0),true),("dayWeight",Some(1),true)] {
                let expected: i64=rows.iter().filter(|r|r.field("state").unwrap().as_int().unwrap()<2 && r.field("visible")==Ok(&Value::Bool(true)) && !server.schema().tables["receipts"].expired(r,now) && day.is_none_or(|d|r.field("at").unwrap().as_int().unwrap().div_euclid(86_400_000)==d)).map(|r|if sum {r.field("weight").unwrap().as_int().unwrap()}else{1}).sum();
                let answer=server.query(query,Context::new("alice",day.map_or_else(Default::default,|d|args(&[("day",Value::Int(d))]))).at(now)).unwrap();
                assert!(answer.complete,"seed={seed} turn={turn} {answer:?}");
                assert_eq!(answer.data,Value::Int(expected),"seed={seed} turn={turn} query={query} day={day:?}");
            }
        }
        for (name,count) in ["insert","delete","state=1","filter on","filter off","expiry to null","earlier expiry","later expiry","day move"].into_iter().zip(transitions) {
            assert!(count>0,"seed={seed}: no observed {name} transition");
            println!("DIFFERENTIAL seed={seed} transition={name} count={count}");
        }
    }
}

#[test]
fn sqlite_041_store_rebuilds_expiry_index_at_open() {
    use snapback4_core::{Store, rows::{Dir, Bounds}};
    fn assert_no_cap_counters(store: &Store) {
        assert!(store.meta("cap_counts_schema").unwrap().is_none());
        let present: bool = store.conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = '_cap_counts')", [], |row| row.get(0)).unwrap();
        assert!(!present, "expiry index adoption must not introduce unused cap counters");
    }
    let b=snapback4_lang::compile(&[("schema.q".into(),SOURCE.into())]);
    assert!(b.diagnostics.is_empty());
    let path=std::env::temp_dir().join(format!("sb4-q-upgrade-{}-{}.sqlite",std::process::id(),snapback4_core::now_ms()));
    std::fs::create_dir_all(&path).unwrap();
    let directory=path;
    let path=directory.join("store.sqlite");
    let mut server=Engine::new_at(Store::open(&path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),0).unwrap();
    assert_no_cap_counters(server.store());
    server.seed([row(0,Value::Int(100)),row(1,Value::Int(1000)),row(2,Value::Null)]).unwrap();
    let generation=server.generation();
    let mut legacy=server.schema().clone();
    for table in legacy.tables.values_mut() {for index in table.indexes.values_mut() {
        if matches!(index.components.first(),Some(snapback4_core::schema::IndexComponent::Contribution(_))) {index.components.truncate(1);}
    }}
    let tx=server.store_mut().transaction().unwrap();
    for m in &legacy.maintains {
        let name=m.contribution_index();
        let full=format!("{}.{}",m.source,name);
        let num:i64=tx.conn().query_row("SELECT num FROM _catalog WHERE name=?1",[&full],|r|r.get(0)).unwrap();
        tx.conn().execute("DELETE FROM i WHERE ti=?1",[num]).unwrap();
        for (source,_) in tx.scan(&m.source,"byId",&[],&Bounds::default(),Dir::Asc,100).unwrap() {
            let source_id=source.field("id").unwrap().as_str().unwrap();
            for key in snapback4_core::rows::index_keys(&legacy.tables[&m.source].indexes[&name],&source,source_id) {
                tx.conn().execute("INSERT INTO i(ti,k,id) VALUES(?1,?2,?3)",rusqlite::params![num,key,source_id]).unwrap();
            }
        }

    }
    let text=serde_json::to_string(&legacy).unwrap();
    tx.conn().execute("UPDATE _generations SET schema=?1 WHERE generation=?2",rusqlite::params![text,generation as i64]).unwrap();
    for key in ["schema_hash","cap_counts_schema"] {tx.conn().execute("UPDATE _meta SET value=?1 WHERE key=?2",[legacy.hash(),key.into()]).unwrap();}
    tx.commit().unwrap(); drop(server);
    let mut server=Engine::open_at(Store::open(&path).unwrap(),100).unwrap();
    assert_eq!(server.generation(),generation+1);
    assert_no_cap_counters(server.store());
    let schema_hash = server.schema().hash();
    assert_eq!(server.store().meta("schema_hash").unwrap().as_deref(), Some(schema_hash.as_str()));
    for maintain in &server.schema().maintains {
        assert_eq!(server.schema().tables[&maintain.source].indexes[&maintain.contribution_index()].components.len(), 2);
    }
    assert_eq!(read(&mut server,100).data,Value::Int(2));
    assert_eq!(read(&mut server,100).metered.examined,3);
    let row=server.store().rows("unreadCounts").unwrap().remove(0);
    assert_eq!(row.field("value").unwrap(),&Value::Int(3));
    drop(server);
    let server=Engine::open_at(Store::open(&path).unwrap(),200).unwrap();
    assert_eq!(server.generation(),generation+1,"unchanged reopen does not rebuild");
    assert_no_cap_counters(server.store());
    drop(server); std::fs::remove_dir_all(directory).unwrap();
}

fn predicted_expiry_changes<H: Host>(host: &mut H) {
    use snapback4_device::device::Queued;
    let (mut server,backend)=compile(SOURCE);
    server.seed([row(0,Value::Int(1000)),row(1,Value::Null)]).unwrap();
    let mut device=host.open("prediction",Some(backend)).unwrap();
    snapshot(&mut server,&mut device,500);
    let writes=[
        ("add",json!({"id":"p","expiresAt":900,"weight":1}),600),
        ("change",json!({"id":"r00001","expiresAt":700,"state":0,"visible":true,"weight":5,"at":86400000}),610),
        ("remove",json!({"id":"r00000"}),620),
    ];
    for (n,(op,input,now)) in writes.into_iter().enumerate() {
        let entry=device.admit(Queued{id:format!("q{n}"),seq:n as u64+1,op:op.into(),args:input.clone(),viewer:"alice".into(),now,new_ids:vec![],predicted:vec![],predictable:true,sent_seq:None,receipt_store:None,observed_seq:None}).unwrap();
        assert!(entry.predictable,"{entry:?}");
        let program=server.program(op).unwrap();
        let args=program.args.iter().map(|(name,ty)|(name.clone(),snapback4_core::wire::from_json(ty,&input[name]).unwrap())).collect();
        let result=server.mutate(op,None,Context::new("alice",args).at(now)).unwrap();
        assert!(matches!(result.state,WriteState::Sent{..}),"{result:?}");
        let local=device.query("unread","alice",&json!({}),now).unwrap();
        let online=read(&mut server,now);
        assert!(local.complete && online.complete);
        assert_eq!(local.data,online.data); assert_eq!(local.next_expiry,online.next_expiry);
    }
    for now in [699,700,899,900,1000] {
        let local=device.query("unread","alice",&json!({}),now).unwrap();
        let online=read(&mut server,now);
        assert!(local.complete && online.complete); assert_eq!(local.data,online.data);
    }
    host.close("prediction",device);
}
#[test] fn predicted_expiry_changes_memory() {predicted_expiry_changes(&mut Memory::new());}
#[test] fn predicted_expiry_changes_sqlite() {predicted_expiry_changes(&mut Sqlite::new("expiry-prediction"));}

#[test]
#[ignore = "wall-clock sweep lag measurement at the production one-second cadence"]
fn sweep_lag_at_one_second_ticks() {
    let source=SOURCE.split("view unreadWeight:").next().unwrap().to_owned()
        + "query unread():\n  return unreadCounts['chat', viewer]\nquery groups(c: cursor ?):\n  return unreadCounts where .principal = viewer first 20 after c\n";
    let (mut server,_)=compile(&source);
    server.seed((0..10_000).map(|n|row(n,if n<300 {Value::Int(1000)}else{Value::Null}))).unwrap();
    assert_eq!(read(&mut server,1000).data,Value::Int(9700));
    let start=std::time::Instant::now();
    let mut removed=0;
    let mut passes=0;
    while removed<300 {
        passes+=1;
        let scheduled=std::time::Duration::from_secs(passes);
        if let Some(wait)=scheduled.checked_sub(start.elapsed()) {std::thread::sleep(wait);}
        removed+=server.sweep_expired_for(1000+start.elapsed().as_millis() as i64,2000,std::time::Duration::from_millis(2)).unwrap();
    }
    println!("SWEEP_LAG live_before=10000 expired=300 views=1 rows_per_pass=2000 budget_us=2000 tick_ms=1000 passes={passes} lag_ms={} final_examined={}",start.elapsed().as_millis(),read(&mut server,1000).metered.examined);
    assert_eq!(server.store().rows("unreadCounts").unwrap()[0].field("value").unwrap(),&Value::Int(9700));
}
