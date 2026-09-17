use super::*;
use serde_json::json;
#[path = "../../../snapback4-sim/tests/lane_domains/fixture.rs"]
mod fixture;
use fixture::{SOURCE, NOW};

#[test]
fn w13c2_range_list_and_meter_on_both_device_stores() {
    fn scenario<H: Host>(host: &mut H) {
        let (mut engine, backend) = compile(SOURCE);
        engine.seed(fixture::seed(30, 40, true)).unwrap();
        let mut device = host.open("lane-domains", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut engine, "dev:alice", 1000).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let typed = device.query("typedRanking", "dev:alice", &json!({}), NOW).unwrap();
        let range = device.query("ranking", "dev:alice", &json!({}), NOW).unwrap();
        assert_eq!(range.data, typed.data);
        assert_eq!(range.next, typed.next);
        assert!(range.complete && range.next.is_some());
        assert!(range.metered.examined.abs_diff(typed.metered.examined) <= 3);
        assert_eq!(range.data.as_array().unwrap().iter().map(|row| row.field("postId").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>(), fixture::oracle(30,40));
        println!("{} ranking: typed={} range={}", host.label(), typed.metered.examined, range.metered.examined);
        let list = device.query("byAuthors", "dev:alice", &json!({"authors":["dev:alice","dev:bob","dev:alice"]}), NOW).unwrap();
        let literal = device.query("literalAuthors", "dev:alice", &json!({}), NOW).unwrap();
        assert_eq!(list.data, literal.data); assert_eq!(list.next, literal.next);
        assert_eq!(device.query("listExpression", "dev:alice", &json!({}), NOW).unwrap().data, device.query("alice", "dev:alice", &json!({}), NOW).unwrap().data);
        for (op, input) in [("byAuthors",json!({"authors":[]})), ("ranged",json!({"start":3,"end":3})), ("ranged",json!({"start":4,"end":3}))] {
            let empty = device.query(op, "dev:alice", &input, NOW).unwrap();
            assert!(empty.data.as_array().unwrap().is_empty() && empty.complete && empty.next.is_none());
        }
        let expected = device.query("ranged", "dev:alice", &json!({"start":5,"end":30}), NOW).unwrap();
        for (op, input) in [("inline",json!({"at":NOW})), ("bound",json!({"at":NOW})), ("clockRange",json!({"delta":24}))] {
            let result = device.query(op,"dev:alice",&input,NOW).unwrap();
            assert_eq!(result.data,expected.data,"{op}"); assert!(result.complete);
        }
        host.close("lane-domains", device);
        let (mut engine, backend) = compile(SOURCE);
        engine.seed(fixture::seed(5000, 4, false)).unwrap();
        let mut device = host.open("lane-meter", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut engine, "dev:alice", 1000).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let cut = device.query("ranged", "dev:alice", &json!({"start":0,"end":5000}), NOW).unwrap();
        assert!(!cut.complete && cut.next.is_none());
        assert_eq!(cut.cut, Some(snapback4_core::engine::ReadCut::Meter));
        println!("{} 5000 lanes: examined={} heap_bytes={} steps={}", host.label(), cut.metered.examined, cut.metered.heap_bytes, cut.metered.steps);
        host.close("lane-meter", device);
    }
    scenario(&mut Sqlite::new("lane-domains")); scenario(&mut Memory::new());
}

#[test]
fn w13c2_nonuniform_paired_worlds_match_on_both_stores() {
    fn scenario<H: Host>(host: &mut H) {
        let source = SOURCE.replace("  public 'posts'\n  sync public", "  read <- .author = viewer\n  sync");
        let mut worlds = Vec::new();
        for hidden in [false,true] {
            let (mut engine, backend) = compile(&source);
            engine.seed(fixture::seed(25,4,false).into_iter().filter(|(_,row)| hidden || row.field("author").unwrap() == &id("dev:alice"))).unwrap();
            let name = if hidden { "hidden-present" } else { "hidden-absent" };
            let mut device = host.open(name, Some(backend)).unwrap();
            for (i,page) in snapshot_pages(&mut engine,"dev:alice",1000).iter().enumerate() { device.apply(page,i==0).unwrap(); }
            let result = device.query("ranged","dev:alice",&json!({"start":0,"end":25}),NOW).unwrap();
            worlds.push(serde_json::to_vec(&(result.data,result.complete,result.cut,result.next,result.metered)).unwrap());
            host.close(name,device);
        }
        assert_eq!(worlds[0],worlds[1]);
    }
    scenario(&mut Sqlite::new("lane-worlds")); scenario(&mut Memory::new());
}
