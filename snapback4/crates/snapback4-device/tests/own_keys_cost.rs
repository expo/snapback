//! @ref LLP 3000.028#6 — opt-in actual SQLite/stream costs, not an extrapolated sparse-viewer saving.
//! Run with OWNER_KEY_COST_DIR inside the worktree; this never opens the evidence store.
use snapback4_core::{Engine, Store, Context, Value, WriteState, value::object};
use snapback4_device::device::{Backend, Device, StreamPage};
use serde_json::json;
use rusqlite::{Connection, trace::{TraceEvent, TraceEventCodes}};
use std::{cell::RefCell, path::{Path, PathBuf}, time::Instant};

const SOURCE: &str = r#"
table likes:
  post: id
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at
mutation add(post: id):
  insert likes {post, principal: viewer, at: now}
mutation remove(post: id):
  delete likes[post, viewer]
query own(post: id):
  return exists likes[post, viewer]
"#;

fn bound(mode: &str) -> snapback4_lang::Bound {
    let source=match mode {
        "keys"=>SOURCE.replace("by .at\n","by .at with own keys .principal\n"),
        "summaries"=>format!("{SOURCE}\nview ownLikes: count likes by .principal, .post\n"),
        "public"=>SOURCE.replace(" last 2000 by .at", ""),
        "own_rows"=> {
            let private=SOURCE.split("mutation add").next().unwrap().replace("table likes:","table ownRows:")
                .replace("public 'public likes'","read <- .principal = viewer").replace("sync public last 2000 by .at","sync to .principal");
            let writes=SOURCE.replace("  insert likes {post, principal: viewer, at: now}","  insert likes {post, principal: viewer, at: now}\n  insert ownRows {post, principal: viewer, at: now}")
                .replace("  delete likes[post, viewer]","  delete likes[post, viewer]\n  delete ownRows[post, viewer]");
            format!("{private}\n{writes}")
        },
        _=>SOURCE.into(),
    };
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
fn raw(n: usize, owner: &str) -> Value {
    object([("id",Value::Id(format!("l{owner}{n:010}"))),("post",Value::Id(format!("p{n:010}"))),
        ("principal",Value::Id(owner.into())),("at",Value::Int(n as i64))])
}
fn stats(c: &Connection) -> serde_json::Value {
    let one=|sql:&str|c.query_row(sql,[],|r|r.get::<_,i64>(0)).unwrap();
    json!({"rows":one("select count(*) from r"),"rowBytes":one("select coalesce(sum(length(cast(data as blob))),0) from r"),
        "indexEntries":one("select count(*) from i"),"indexBytes":one("select coalesce(sum(length(k)+length(cast(id as blob))),0) from i"),
        "logEntries":one("select count(*) from _log"),"logBytes":one("select coalesce(sum(length(partition)+length(t)+length(kind)+length(id)+coalesce(length(cast(data as blob)),0)),0) from _log"),
        "pages":one("pragma page_count"),"pageSize":one("pragma page_size")})
}
fn rss() -> String { std::fs::read_to_string("/proc/self/status").unwrap().lines().filter(|l|l.starts_with("VmHWM:")).collect::<Vec<_>>().join("") }
thread_local! { static LOCK: RefCell<(Option<Instant>,Vec<f64>)> = RefCell::new((None,vec![])); }
fn trace(e: TraceEvent<'_>) {
    match e {
        TraceEvent::Stmt(_,sql) if sql.starts_with("BEGIN") => LOCK.with_borrow_mut(|x| x.0=Some(Instant::now())),
        TraceEvent::Profile(stmt,_) if stmt.sql()=="COMMIT" => LOCK.with_borrow_mut(|x|if let Some(t)=x.0.take(){x.1.push(t.elapsed().as_secs_f64()*1000.0);}),
        _=>{}
    }
}
fn pct(mut times:Vec<f64>) -> serde_json::Value { times.sort_by(f64::total_cmp);json!({"n":times.len(),"p50ms":times[times.len()/2],"p95ms":times[times.len()*95/100]}) }
fn replica(e:&mut Engine,b:&Backend,path:&Path,viewer:&str) -> serde_json::Value {
    let t=Instant::now();let mut d=Device::open(path,Some(b.clone())).unwrap();
    let mut after=None;let mut count=0;let mut wire=0;let mut decoded=0;
    loop {
        let p=e.snapshot_acquisition_page_at(viewer,after.as_deref(),10000,snapback4_core::now_ms()).unwrap();
        let next=p.next.map(|c|c.encode());
        let j=json!({"snapshot":true,"after":after,"held":p.held,"acquisitions":p.acquisitions,
            "events":p.events.iter().map(|e|json!({"table":e.table,"id":e.id,"kind":e.kind.word(),"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
            "watermark":p.watermark,"next":next,"more":next.is_some(),"generation":e.generation(),"stage_snapshot":true});
        wire+=serde_json::to_vec(&j).unwrap().len();decoded+=p.events.len();
        let p:StreamPage=serde_json::from_value(j).unwrap();d.apply(&p,count==0).unwrap();count+=1;
        if next.is_none(){break;}after=next;
    }
    let p:StreamPage=serde_json::from_value(json!({"snapshot":false,"events":[],"watermark":e.seq().unwrap(),"more":false,"snapshot_catchup":true,"generation":e.generation()})).unwrap();
    d.apply(&p,false).unwrap();assert!(d.sync_state().unwrap().acquired);
    let elapsed=t.elapsed().as_secs_f64()*1000.0;
    let physical=stats(d.store().conn());
    // Persist the exact wire fixture so the browser measures real IDB allocation on identical data.
    json!({"viewer":viewer,"createThroughPublicationMs":elapsed,"snapshotPages":count,"catchupPages":1,"wireBytes":wire+serde_json::to_vec(&p).unwrap().len(),"decodedRows":decoded,"sqlite":physical,"peakRss":rss()})
}

#[test]
#[ignore = "explicit read-only builder-store copy comparison"]
fn fixture_costs() {
    use snapback4_core::schema::{Audience, Sync, Rules, RuleExpr, RuleTerm, Index};
    let root=PathBuf::from(std::env::var("OWNER_KEY_COST_DIR").expect("worktree-local directory"));std::fs::create_dir_all(&root).unwrap();
    let supplied=PathBuf::from(std::env::var("OWNER_KEY_FIXTURE_COPY").expect("owned byte copy, never original evidence"));
    assert!(supplied.to_string_lossy().contains("lane-ok/"));
    let original=include_str!("../../../experiments/p19-one-query/builder.q");
    let raw=original.replace("view ownLikes: count likes by .principal, .post\n", "").replace("view ownReposts: count reposts by .actor, .post\n", "")
        .replace("ownLikes[viewer, .id] > 0","exists likes[.id, viewer]").replace("ownReposts[viewer, .id] > 0","exists reposts[viewer, .id]")
        .replace("ownLikes[viewer, post] > 0","exists likes[post, viewer]").replace("ownReposts[viewer, post] > 0","exists reposts[viewer, post]");
    for mode in ["summaries","public","own_rows","keys"] {
        if std::env::var("OWNER_KEY_COST_MODES").is_ok_and(|modes|!modes.split(',').any(|m|m==mode)) {continue;}
        let dir=root.join(format!("fixture-{mode}"));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("server.sqlite");
        std::fs::copy(supplied.join("store.sqlite"),&path).unwrap();std::fs::copy(supplied.join("store.sqlite-wal"),dir.join("server.sqlite-wal")).unwrap();
        let source=match mode {
            "summaries"=>original.to_owned(),
            "keys"=>raw.replace("sync public last 2000 by .at","sync public last 2000 by .at with own keys .principal")
                .replace("sync public last 1000 by .at\n\ntable follows","sync public last 1000 by .at with own keys .actor\n\ntable follows"),
            "public"=>raw.replace("sync public last 2000 by .at","sync public")
                .replace("sync public last 1000 by .at\n\ntable follows","sync public\n\ntable follows"),
            _=>raw.clone(),
        };
        let mut b=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        if mode=="own_rows" {for (name,owner) in [("likes","principal"),("reposts","actor")] {
            let mut t=b.schema.tables[name].clone();t.rules=Rules::deny();t.rules.read=RuleExpr::Eq(RuleTerm::Field(owner.into()),RuleTerm::Viewer);
            // The cost control copies public row fields as ordinary data; it does not replay engine capture or feed slots.
            t.recorded.clear();t.maintained.clear();t.columns.retain(|f,_|!f.starts_with('$'));
            t.indexes.retain(|_,i|i.columns().iter().all(|f|!f.starts_with('$')));
            t.sync=Some(Sync {audience:Audience::Column(owner.into()),horizon:None,also:Vec::new()});t.indexes.insert("byOwner".into(),Index::of(&[owner,"id"],false));
            b.schema.tables.insert(format!("ownRows_{name}"),t);
        }}
        let mut e=Engine::open_at(Store::open(&path).unwrap(),snapback4_core::now_ms()).unwrap();let before=stats(e.store().conn());let t=Instant::now();
        e.adopt(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
        if mode=="own_rows" {for name in ["likes","reposts"] {
            let rows=e.store().conn().prepare("select r.data from r join _catalog c on c.num=r.t where c.name=?1").unwrap().query_map([name],|r|r.get::<_,String>(0)).unwrap().map(|s|{
                let mut row=serde_json::from_str::<Value>(&s.unwrap()).unwrap();if let Value::Row(fields)=&mut row {fields.retain(|f,_|!f.starts_with('$'));}row
            }).collect::<Vec<_>>();
            for chunk in rows.chunks(1000) {e.seed(chunk.iter().cloned().map(|r|(format!("ownRows_{name}"),r))).unwrap();}
        }}
        let adoption=t.elapsed().as_secs_f64()*1000.0;let after=stats(e.store().conn());
        let profiles=e.store().conn().prepare("select r.data from r join _catalog c on c.num=r.t where c.name='profiles'").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().map(|s|serde_json::from_str::<Value>(&s.unwrap()).unwrap()).collect::<Vec<_>>();
        let backend=Backend {generation:e.generation(),schema:b.schema,programs:b.programs.into_iter().map(|p|p.program).collect()};
        std::fs::write(dir.join("backend.json"),serde_json::to_vec(&backend).unwrap()).unwrap();
        let mut replicas=vec![];
        for handle in ["empty","u0500","u0001"] {
            let viewer=profiles.iter().find(|p|p.field("handle").unwrap().as_str().unwrap()==handle).map(|p|p.field("principal").unwrap().as_str().unwrap()).unwrap_or("dev:okempty");
            let mut r=replica(&mut e,&backend,&dir.join(format!("{handle}.sqlite")),viewer);r["handle"]=json!(handle);replicas.push(r);
        }
        let result=json!({"fixture":"calibration24","mode":mode,"adoptionMs":adoption,"sourceBackfill":e.store().adoption_report.views.iter().map(|v|json!({"name":v.name,"rows":v.rows,"ms":v.elapsed.as_secs_f64()*1000.0})).collect::<Vec<_>>(),"serverBefore":before,"serverAfter":after,"replicas":replicas,"peakRss":rss()});
        println!("OWNER_KEY_FIXTURE {result}");std::fs::write(dir.join("cost.json"),serde_json::to_vec_pretty(&result).unwrap()).unwrap();
    }
}

#[test]
#[ignore = "explicit million-key storage/adoption measurement"]
fn costs() {
    let root=PathBuf::from(std::env::var("OWNER_KEY_COST_DIR").expect("use a worktree-local directory"));std::fs::create_dir_all(&root).unwrap();
    let sizes=std::env::var("OWNER_KEY_COST_SIZES").unwrap_or("1000,100000,1000000".into());
    for n in sizes.split(',').map(|s|s.parse::<usize>().unwrap()) {
        let baseline=root.join(format!("base-{n}.sqlite"));
        if !baseline.exists() {
            let b=bound("baseline");let mut e=Engine::new_at(Store::open(&baseline).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program),0).unwrap();
            for (owner,amount) in [("prolific",n),("unrelated",6000)] {
                for first in (0..amount).step_by(1000) {e.seed_at((first..(first+1000).min(amount)).map(|i|("likes".into(),raw(i,owner))),2_000_000).unwrap();}
            }
            e.store().conn().execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
        }
        for mode in ["baseline","summaries","public","own_rows","keys"] {
            if std::env::var("OWNER_KEY_COST_MODES").is_ok_and(|modes|!modes.split(',').any(|m|m==mode)) {continue;}
            let dir=root.join(format!("{n}-{mode}"));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("server.sqlite");
            std::fs::copy(&baseline,&path).unwrap();let mut e=Engine::open_at(Store::open(&path).unwrap(),2_000_000).unwrap();let before=stats(e.store().conn());
            let b=bound(mode);let t=Instant::now();e.adopt_at(b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),2_000_000).unwrap();
            if mode=="own_rows" {for (owner,amount) in [("prolific",n),("unrelated",6000)] {for first in (0..amount).step_by(1000){e.seed_at((first..(first+1000).min(amount)).map(|i|("ownRows".into(),raw(i,owner))),2_000_000).unwrap();}}}
            let adoption=t.elapsed().as_secs_f64()*1000.0;let after=stats(e.store().conn());
            let backend=Backend {generation:e.generation(),schema:b.schema,programs:b.programs.into_iter().map(|p|p.program).collect()};
            std::fs::write(dir.join("backend.json"),serde_json::to_vec(&backend).unwrap()).unwrap();
            let mut replicas=vec![];
            for viewer in ["empty","prolific"] {replicas.push(replica(&mut e,&backend,&dir.join(format!("{viewer}.sqlite")),viewer));}
            let mut times=vec![];let mut meters=vec![];let before_writes=stats(e.store().conn());let seq=e.seq().unwrap();
            LOCK.with_borrow_mut(|x|{x.0=None;x.1.clear();});e.store().conn().trace_v2(TraceEventCodes::SQLITE_TRACE_STMT|TraceEventCodes::SQLITE_TRACE_PROFILE,Some(trace));
            for i in 0..100 {for op in ["add","remove"] {
                let t=Instant::now();let out=e.mutate(op,None,Context::new("prolific",[("post".into(),Value::Id(format!("bench{i}")))].into()).at(3_000_000)).unwrap();times.push(t.elapsed().as_secs_f64()*1000.0);
                assert!(matches!(out.state,WriteState::Sent {..}),"{out:?}");meters.push(serde_json::to_value(&out.metered).unwrap());
            }}
            e.store().conn().trace_v2(TraceEventCodes::empty(),None);let locks=LOCK.with_borrow_mut(|x|std::mem::take(&mut x.1));
            let after_writes=stats(e.store().conn());
            let partitions:i64=e.store().conn().query_row("select count(distinct partition) from _log where seq>?1",[seq as i64],|r|r.get(0)).unwrap();
            let result=json!({"keys":n,"mode":mode,"adoptionMs":adoption,"sourceBackfill":e.store().adoption_report.views.iter().map(|v|json!({"name":v.name,"rows":v.rows,"ms":v.elapsed.as_secs_f64()*1000.0})).collect::<Vec<_>>(),
                "serverBefore":before,"serverAfter":after,"replicas":replicas,"writeLatency":pct(times),"lockHold":pct(locks),"sampleMeters":&meters[..2],"serverBeforeWrites":before_writes,"serverAfterWrites":after_writes,"recipientPartitions":partitions,"peakRss":rss()});
            println!("OWNER_KEY_COST {result}");std::fs::write(dir.join("cost.json"),serde_json::to_vec_pretty(&result).unwrap()).unwrap();
        }
    }
}
