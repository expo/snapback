//! Unchanged calibration apps at their declared member cap. The same cases run
//! against the server, both native devices and the wasm corpus.
#[path = "../../snapback4-device/tests/common/mod.rs"] mod common;
use common::*;
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_core::value::object;
use snapback4_device::device::{Backend,Queued};
use serde_json::json;
const NOW:i64=4_000_000_000_000;
fn text(s:&str)->Value {Value::String(s.into())}
fn root()->std::path::PathBuf {std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/rp-calibrations")}
fn build(version:&str)->(Engine,Backend) {
    let files=["schema.q","windows.q","config.q","schedule.q"].into_iter().filter_map(|name|std::fs::read_to_string(root().join(version).join(name)).ok().map(|s|(name.into(),s))).collect::<Vec<_>>();
    let b=snapback4_lang::compile(&files);assert!(b.diagnostics.is_empty(),"{version}: {:?}",b.diagnostics);
    let e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
    let wire=json!({"generation":e.generation(),"schema":b.schema.public_projection(),"programs":snapback4_lang::emit::backend_programs(&b)});
    let b:Backend=snapback4_core::json_codec::from_text(&wire.to_string()).unwrap();(e,b)
}
fn seed(e:&mut Engine,version:&str) {
    let mut rows=vec![];
    for n in 0..50 {
        let principal=if n==0 {"alice".into()}else{format!("peer{n:02}")};
        rows.push(("profiles".into(),object([("id",id(&format!("p{n:02}"))),("principal",id(&principal)),
            ("displayName",text(&format!("Member {n:02}"))),("handle",text(&principal)),
            ("bio",text("Coffee, hiking and catching up with friends.")),("location",text("Berlin")),
            ("link",text("https://example.org/profile"))])));
    }
    let mut chat=object([("id",id("c")),("title",text("Weekend plans")),("description",text("Our group")),("creatorId",id("alice"))]);
    if let Value::Row(ref mut fields)=chat {fields.insert(if version=="0411"{"kind"}else{"isGroup"}.into(),if version=="0411"{text("group")}else{Value::Bool(true)});}
    rows.push(("conversations".into(),chat));
    for n in 0..50 {
        let principal=if n==0 {"alice".into()}else{format!("peer{n:02}")};
        rows.push(("members".into(),object([("id",id(&format!("u{n:02}"))),("conversation",id("c")),("principal",id(&principal)),("role",text("admin")),("joinedOrdinal",Value::Int(0))])));
    }
    e.seed_at(rows,NOW-1000).unwrap();
}
fn run<H:Host>(host:&mut H, version:&str, message:&str, kind:&str)->serde_json::Value {
    let (mut e,b)=build(version);seed(&mut e,version);
    let pages=snapshot_pages(&mut e,"alice",1000);
    let mut d=host.open(&format!("{version}-{kind}"),Some(b.clone())).unwrap();
    for(i,page)in pages.iter().enumerate(){d.apply(page,i==0).unwrap();}
    let wire=json!({"id":"m","conversation":"c","text":message,"quote":null});
    let q:Queued=serde_json::from_value(json!({"id":"send","seq":1,"op":"send","args":wire,"viewer":"alice","now":NOW,"new_ids":[],"predictable":true,"predicted":[],"predicted_ids":[]})).unwrap();
    let admission=d.admit(q);let predicted=admission.as_ref().is_ok_and(|q|q.predictable);
    let out=e.mutate("send",None,Context::new("alice",args(&[("id",id("m")),("conversation",id("c")),("text",text(message)),("quote",Value::Null)])).at(NOW)).unwrap();
    let committed=matches!(out.state,WriteState::Sent{..});
    println!("RP APP {version}-{kind} {} predicted={predicted} committed={committed} meter={:?} state={:?}",host.label(),out.metered,out.state);
    {
        assert!(committed,"{version}-{kind}: {out:?}");
        // These unchanged apps accept a caller-supplied id for an expiring
        // message which has reference children. The device cannot see a
        // hidden expired same-id predecessor, so the server keeps custody.
        assert!(!predicted,"{version}-{kind}: {admission:?}");
        assert!(admission.as_ref().unwrap().predicted.is_empty(),"{version}-{kind}: {admission:?}");
        let history=d.query("history","alice",&json!({"conversation":"c","c":null}),NOW).unwrap();
        assert!(!history.data.as_array().unwrap().iter().any(|r|r.field("pending").ok()==Some(&Value::Bool(true))));
        let baseline:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(root().join("base-meters.json")).unwrap()).unwrap();
        let meter=serde_json::to_value(out.metered).unwrap();
        for (name, used) in meter.as_object().unwrap() {
            assert!(used.as_u64().unwrap()<=baseline[format!("{version}-{kind}")][name].as_u64().unwrap(),"{version}-{kind}: {name}: {used} > {}",baseline[format!("{version}-{kind}")][name]);
        }
    }
    fixture(&format!("{version}/schema.json"),&json!(b.schema));
    fixture(&format!("{version}/programs.json"),&json!(b.programs));
    fixture(&format!("{version}/pages.json"),&json!({"generation":b.generation,"pages":pages}));
    json!({"now":NOW,"args":wire,"serverCommitted":committed,"predicted":predicted,"meter":out.metered,"label":format!("{version}-{kind}")})
}
fn fixture(name:&str,actual:&serde_json::Value) {
    let path=root().join(name);
    if std::env::var_os("UPDATE_RP_APP_CASES").is_some() {
        std::fs::write(&path,serde_json::to_string(actual).unwrap()+"\n").unwrap();
    }
    let expected:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(actual,&expected,"{name}");
}
fn differential<H:Host>(host:&mut H) {
    for version in ["0411","0412"] {for (kind,message) in [("hello","hello".into()),("realistic","Shall we meet at the park on Saturday? I'll bring coffee and something for lunch.".into()),("near-max","x".repeat(1999))] {
        let case=run(host,version,&message,kind);
        fixture(&format!("{version}-{kind}.json"),&case);
    }}
    println!("RP APP DIFFERENTIAL cases=6 predicted=0 conservative=6 server_refused=0");
}
#[test] fn calibration_headroom_memory(){differential(&mut Memory::new());}
#[test] fn calibration_headroom_sqlite(){differential(&mut Sqlite::new("rp-r5-apps"));}

#[path = "reservation_app_headroom/profile_upgrade.rs"]
mod profile_upgrade;
