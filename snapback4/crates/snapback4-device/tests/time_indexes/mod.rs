use super::*;
use serde_json::json;
use snapback4_device::device::Backend;
#[path = "../../../snapback4-sim/tests/time_indexes/fixture.rs"]
mod fixture;
use fixture::{SOURCE, TIMES};
fn ids(value: &Value) -> Vec<String> { value.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()).collect() }

#[test]
fn w13c2_time_keys_page_update_and_adopt_on_both_stores() {
    fn scenario<H: Host>(host: &mut H) {
        let base = SOURCE.split("query buckets").next().unwrap().lines().filter(|line| !line.contains("by byBucket:")).collect::<Vec<_>>().join("\n") + "\n";
        let (mut engine, backend) = compile(&base);
        engine.seed(fixture::seed()).unwrap();
        let mut device = host.open("time-keys",Some(backend)).unwrap();
        for (i,page) in snapshot_pages(&mut engine,"dev:alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
        let (_, next) = compile(SOURCE);
        engine.adopt(next.schema.clone(),next.programs.clone()).unwrap();
        device.adopt(Backend { generation:engine.generation(),..next }).unwrap();
        // Activation fences reads until this generation's acquisition completes.
        for (i,page) in snapshot_pages(&mut engine,"dev:alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
        // First read after activation uses the rebuilt index over held images.
        let mut cursor = serde_json::Value::Null;
        let mut found = Vec::new();
        for _ in 0..10 {
            let result = device.query("buckets","dev:alice",&json!({"start":-1,"end":2,"c":cursor}),0).unwrap();
            assert!(result.complete); found.extend(ids(&result.data));
            match result.next { Some(next) => cursor=json!(next),None=>break }
        }
        assert_eq!(found,fixture::oracle(-1,2));
        let ordinal = device.query("ordinalMerge","dev:alice",&json!({}),0).unwrap();
        assert_eq!(ids(&ordinal.data),(0..TIMES.len()).map(|n|format!("e{n}")).collect::<Vec<_>>());
        let queued = device.admit(Queued { id:"move".into(),seq:1,op:"move".into(),args:json!({"eventId":"e1","at":1_800_001}),new_ids:vec![],predicted:vec![],viewer:"dev:alice".into(),now:0,predictable:true,sent_seq: None, receipt_store: None,observed_seq:None, dispatch: None }).unwrap();
        assert!(queued.predictable);
        assert_eq!(ids(&device.query("hourPage","dev:alice",&json!({"h":-1}),0).unwrap().data),["e2","e3"]);
        assert_eq!(ids(&device.query("hourPage","dev:alice",&json!({"h":0}),0).unwrap().data),["e4","e1"]);
        host.close("time-keys",device);
    }
    scenario(&mut Sqlite::new("time-keys")); scenario(&mut Memory::new());
}

#[test]
fn w13c2_daily_unique_predicts_on_both_stores_under_the_clock() {
    fn scenario<H: Host>(host: &mut H) {
        let (mut engine,backend)=compile(SOURCE);
        let mut device=host.open("daily",Some(backend)).unwrap();
        for (i,page) in snapshot_pages(&mut engine,"dev:alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
        for (seq,now,allowed) in [(1,86_399_999,true),(2,86_399_999,false),(3,86_400_000,true)] {
            let result=device.admit(Queued { id:format!("daily{seq}"),seq,op:"checkin".into(),args:json!({}),new_ids:vec![format!("checkin{seq}")],predicted:vec![],viewer:"dev:alice".into(),now,predictable:true,sent_seq: None, receipt_store: None,observed_seq:None, dispatch: None });
            if allowed { assert!(result.unwrap().predictable); }
            else { let why=result.unwrap_err(); assert_eq!(why.code(),"ALREADY_HERE"); assert_eq!(why.refusal().message,"Already checked in."); }
        }
        host.close("daily",device);
    }
    scenario(&mut Sqlite::new("daily-keys")); scenario(&mut Memory::new());
}
