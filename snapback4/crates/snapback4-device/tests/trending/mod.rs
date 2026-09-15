use super::common::*;
use serde_json::json;
use snapback4_core::{Context, Value, WriteState};
use snapback4_device::device::Queued;

fn run<H: Host>(host: &mut H) {
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).into_iter()
        .find(|source| source.contains("job scoreTrending():")).expect("the feeds card needs the scheduled Trending recipe");
    let (mut server, backend) = compile(&source);
    let now = snapback4_core::now_ms();
    let post = server.mutate("create", Some("alice-post"), Context::new("alice", args(&[("body", Value::String("hello".into()))])).at(now).with_ids(["p".into()])).unwrap();
    assert!(matches!(post.state, WriteState::Sent { .. }));
    server.run_job("scoreTrending", args(&[]), now).unwrap();
    let mut device = host.open("trending", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let from = server.seq().unwrap();
    let rank = |device: &mut snapback4_device::device::Device<H::Store>, at| device.query("trending", "bob", &json!({"c":null}), at).unwrap().data;
    let original = rank(&mut device, now);
    assert_eq!(original.as_array().unwrap()[0].field("score").unwrap(), &Value::Int(0));
    for (seq, op) in [(1, "like"), (2, "like"), (3, "unlike"), (4, "like")] {
        let entry = device.admit(Queued { id:format!("q{seq}"), seq, op:op.into(), args:json!({"postId":"p"}), viewer:"bob".into(), now:now + seq as i64,
            new_ids:vec![format!("l{seq}")], predicted:vec![], predictable:true, sent_seq:None, observed_seq:None }).unwrap();
        assert!(entry.predictable, "{}: {entry:?}", host.label());
        assert!(entry.predicted.iter().all(|key| key.starts_with("likes/")), "{entry:?}");
        assert_eq!(device.query("myLike", "bob", &json!({"postId":"p"}), now + seq as i64).unwrap().data, Value::Bool(op != "unlike"));
        assert_eq!(rank(&mut device, now + seq as i64), original, "the prediction does not write the ranking");
        let write = server.mutate(op, Some(&format!("q{seq}")), Context::new("bob", args(&[("postId", id("p"))])).at(now + seq as i64).with_ids([format!("l{seq}")])).unwrap();
        assert!(matches!(write.state, WriteState::Sent { .. }), "{write:?}");
        device.settle(&format!("q{seq}"), Some(server.seq().unwrap())).unwrap();
    }
    let create = device.admit(Queued { id:"create".into(), seq:5, op:"create".into(), args:json!({"body":"local"}), viewer:"bob".into(), now:now+5,
        new_ids:vec!["local-post".into()], predicted:vec![], predictable:true, sent_seq:None, observed_seq:None }).unwrap();
    assert!(create.predictable, "{create:?}");
    assert!(create.predicted.iter().any(|key| key == "posts/local-post"));
    assert!(!create.predicted.iter().any(|key| key.starts_with("ranked/")));
    let write = server.mutate("create", Some("create"), Context::new("bob", args(&[("body", Value::String("local".into()))])).at(now+5).with_ids(["local-post".into()])).unwrap();
    assert!(matches!(write.state, WriteState::Sent { .. }));
    device.settle("create", Some(server.seq().unwrap())).unwrap();
    server.run_job("scoreTrending", args(&[]), now + 60_000).unwrap();
    device.apply(&stream_page(&mut server, "bob", from), false).unwrap();
    assert!(device.queued().unwrap().is_empty(), "predictions settle after authoritative delivery");
    assert_eq!(device.query("myLike", "bob", &json!({"postId":"p"}), now + 60_000).unwrap().data, Value::Bool(true));
    assert_eq!(rank(&mut device, now + 60_000).as_array().unwrap()[0].field("score").unwrap(), &Value::Int(1));
    assert_eq!(rank(&mut device, now + 86_400_000).as_array().unwrap().len(), 1, "the first candidate expires locally before any sweep");
    assert!(rank(&mut device, now + 86_400_005).as_array().unwrap().is_empty());
    println!("Trending {}: 4/4 like-state predictions; 1/1 create prediction; ranked overlay writes=0; scheduled score=1", host.label());
    host.close("trending", device);
}

#[test] fn trending_recipe_predicts_on_sqlite() { run(&mut Sqlite::new("trending")); }
#[test] fn trending_recipe_predicts_on_memory() { run(&mut Memory::new()); }
