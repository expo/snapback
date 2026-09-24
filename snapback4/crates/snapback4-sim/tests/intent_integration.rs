//! The supervisor's Clique target, composed across planner, derived and work lanes.
use serde_json::{Value as Json, json};
use snapback4_core::{Ceilings, Context, Engine, JobState, Store, Value, WriteState, ir, wire};
use std::collections::BTreeMap;

const SOURCE: &str = include_str!("fixtures/intent-clique.q");
fn compiled(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn load(engine: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows: Vec<(String, Value)> = rows.into_iter().map(|(table, row)|
        (table.into(), wire::row_from_json(engine.schema().table(table).unwrap(), &row).unwrap())).collect();
    engine.load(rows).unwrap();
}
fn profile(id: &str, principal: &str) -> Json {
    json!({"id":id,"principal":principal,"handle":format!("user{id}"),"displayName":principal,
        "bio":"","location":"","link":null,"avatar":null,"createdAt":1})
}
fn args(values: &[(&str, Value)]) -> BTreeMap<String, Value> {
    values.iter().map(|(k,v)| (k.to_string(),v.clone())).collect()
}
fn text(s: &str) -> Value { Value::Id(s.into()) }
fn page(engine: &mut Engine, name: &str, values: &[(&str, Value)]) -> Vec<Value> {
    let result = engine.query(name, Context::new("alice", args(values)).at(200_000)).unwrap();
    assert!(result.complete, "{name}: {result:?}");
    result.data.as_array().unwrap().to_vec()
}
fn mutate(engine: &mut Engine, name: &str, who: &str, values: &[(&str, Value)], at: i64) {
    let result = engine.mutate(name, None, Context::new(who, args(values)).at(at)).unwrap();
    assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
}

#[test]
fn target_queries_and_nine_derived_views_run_together() {
    let legacy = "\nquery peopleLegacy(q: text <=100, c: cursor ?):\n  if q = '':\n    return profiles last 20 by .createdAt after c\n  return profiles matching q last 20 by .createdAt after c\nquery profileLegacy(handle: text 3..20 format handle):\n  p = profiles[handle = handle] ! else NOT_FOUND\n  return p { *, followers: followerCount[.principal], following: exists follows[viewer, .principal] }\n";
    let b = compiled(&format!("{SOURCE}{legacy}\nmutation fixtureRepost(id: id, postId: posts):\n  return insert reposts {{ id, postId, actorId: viewer }}\n"));
    for name in ["replyCount", "followerCount", "followingCount", "receivedLikes", "dailyLikes",
        "receivedReplies", "receivedReposts", "originalPosts", "dailyPosts"] {
        assert!(matches!(b.schema.tables[name].rules.read, snapback4_core::schema::RuleExpr::Allow), "{name}");
    }
    assert_eq!(b.programs.iter().filter(|p| p.program.kind == ir::ProgramKind::Job).count(), 1);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    load(&mut engine, vec![("profiles", profile("a", "alice")), ("profiles", profile("b", "bob"))]);
    for (id, parent, who, at) in [("post", Value::Null, "alice", 100), ("reply", text("post"), "bob", 101)] {
        mutate(&mut engine, "createPost", who, &[("postId", text(id)), ("parentId", parent), ("body", Value::String("hello".into()))], at);
    }
    mutate(&mut engine, "setLike", "bob", &[("postId", text("post")), ("set", Value::Bool(true))], 102);
    mutate(&mut engine, "setFollow", "bob", &[("owner", text("alice")), ("set", Value::Bool(true))], 103);
    // Equal source ids in two tables must survive the projected merge.
    mutate(&mut engine, "fixtureRepost", "bob", &[("id", text("post")), ("postId", text("post"))], 104);
    let following = engine.query("home", Context::new("bob", args(&[("c", Value::Null)])).at(105)).unwrap();
    assert_eq!(following.data.as_array().unwrap().len(), 2);
    let repost_card = &following.data.as_array().unwrap()[0];
    assert_eq!(repost_card.field("actor").unwrap().field("principal").unwrap(), &text("bob"));
    assert_eq!(repost_card.field("post").unwrap().field("author").unwrap().field("principal").unwrap(), &text("alice"));
    assert_ne!(following.data.as_array().unwrap()[0].field("id").unwrap(), following.data.as_array().unwrap()[1].field("id").unwrap());
    let global = page(&mut engine, "global", &[("c", Value::Null)]);
    assert_eq!(global.len(), 2);
    assert_eq!(global[0].field("repost").unwrap(), &Value::Bool(true));
    assert_eq!(global[1].field("repost").unwrap(), &Value::Bool(false));
    for row in &global {
        let post = row.field("post").unwrap();
        assert_eq!(post.field("id").unwrap(), &text("post"));
        assert_eq!(post.field("likeCount").unwrap(), &Value::Int(1));
        assert_eq!(post.field("repostCount").unwrap(), &Value::Int(1));
        assert_eq!(post.field("replyCount").unwrap(), &Value::Int(1));
    }
    assert_eq!(page(&mut engine, "trending", &[]).len(), 1);
    assert_eq!(page(&mut engine, "userPosts", &[("owner", text("alice")), ("c", Value::Null)]).len(), 1);
    assert_eq!(page(&mut engine, "thread", &[("postId", text("post")), ("c", Value::Null)])[0].field("id").unwrap(), &text("reply"));
    assert_eq!(page(&mut engine, "people", &[("q", Value::String("ali".into())), ("c", Value::Null)]).len(), 1);
    for q in ["", "ali"] {
        let inputs = [("q", Value::String(q.into())), ("c", Value::Null)];
        assert_eq!(page(&mut engine, "people", &inputs), page(&mut engine, "peopleLegacy", &inputs));
    }
    let profile_args = args(&[("handle", Value::String("usera".into()))]);
    let spread = engine.query("socialProfile", Context::new("bob", profile_args.clone())).unwrap();
    let shaped = engine.query("profileLegacy", Context::new("bob", profile_args)).unwrap();
    assert_eq!(spread.data, shaped.data);
    assert_eq!(spread.data.field("followers").unwrap(), &Value::Int(1));
    assert_eq!(spread.data.field("following").unwrap(), &Value::Bool(true));
    let insights = engine.query("insights", Context::new("alice", BTreeMap::new()).at(200_000)).unwrap();
    assert!(insights.complete);
    for field in ["posts", "likesReceived", "repliesReceived", "repostsReceived", "followers"] {
        assert_eq!(insights.data.field(field).unwrap(), &Value::Int(1), "{field}");
    }
    assert_eq!(insights.data.field("following").unwrap(), &Value::Int(0));
    let days = insights.data.field("days").unwrap().as_array().unwrap();
    assert_eq!(days.len(), 7);
    assert_eq!(days[6].field("posts").unwrap(), &Value::Int(1));
    assert_eq!(days[6].field("likes").unwrap(), &Value::Int(1));
}

const TOTALS: &str = "\nquery periodCount(c: id, s: time, e: time):\n  return count(messages where .conversationId = c and .at >= s and .at < e and not .tombstone)\n";
fn period() -> BTreeMap<String, Value> {
    args(&[("periodStart", Value::Int(0)), ("periodEnd", Value::Int(120_000))])
}
#[test]
fn predicate_stream_and_target_digest_sweep_preserve_authority_restart_and_once() {
    let b = compiled(&format!("{SOURCE}{TOTALS}"));
    for name in ["periodCount", "daily"] {
        let p = &b.programs.iter().find(|p| p.program.name == name).unwrap().program;
        let scans = ir::scans(p);
        let messages = scans.iter().filter(|s| s.table == "messages").collect::<Vec<_>>();
        assert_eq!(messages.len(), 1, "{name}: one streaming input");
        let scan = messages[0];
        assert_eq!(scan.take, ir::Bound::Meter);
        assert_eq!(b.schema.tables["messages"].indexes[&scan.index].columns(),
            ["conversationId", "tombstone", "at", "id"]);
        assert_eq!(scan.prefix.len(), 2);
        let range = scan.range.as_ref().expect("unpaged aggregate must seek its time range without by");
        assert!(range.gte.is_some() && range.lt.is_some(), "{name}: {range:?}");
        assert!(range.gt.is_none() && range.lte.is_none(), "{name}: exact written endpoints");
    }
    let directory = std::env::temp_dir().join(format!("sb4-intent-target-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("store.sqlite");
    let mut engine = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let mut rows = vec![("profiles", profile("a", "alice")), ("profiles", profile("b", "bob"))];
    for n in 0..65 { rows.push(("profiles", profile(&format!("z{n:03}"), &format!("inactive{n}")))); }
    for (id, principal, room) in [("a", "alice", "room"), ("b", "bob", "room"), ("h", "carol", "hidden")] {
        rows.push(("members", json!({"id":id,"principal":principal,"conversationId":room,"role":"member","readOrdinal":0})));
    }
    for n in 0..5000 {
        rows.push(("messages", json!({"id":format!("m{n:05}"),"conversationId":"room",
            "senderId":if n % 50 == 0 {"alice"} else {"carol"}, "body":"hello busy chat", "ordinal":n+1,
            "at":15_000,"expiresAt":if n == 1 {json!(50_000)} else {Json::Null},"tombstone":n % 100 == 0})));
    }
    for (id, room, at) in [("future", "room", 120_000), ("before", "room", -1), ("hidden", "hidden", 15_000)] {
        rows.push(("messages", json!({"id":id,"conversationId":room,"senderId":"carol","body":"hello outside",
            "ordinal":6000,"at":at,"expiresAt":null,"tombstone":false})));
    }
    load(&mut engine, rows);
    let count_args = args(&[("c", text("room")), ("s", Value::Int(0)), ("e", Value::Int(120_000))]);
    let count = engine.query("periodCount", Context::new("alice", count_args.clone()).at(200_000)).unwrap();
    assert_eq!(count.data, Value::Int(4949));
    assert!(count.complete);
    assert!(count.metered.heap_bytes < Ceilings::default().heap_bytes);
    let hidden = engine.query("periodCount", Context::new("carol", count_args.clone()).at(200_000)).unwrap();
    assert_eq!(hidden.data, Value::Int(0));
    let search = page(&mut engine, "searchAll", &[("q", Value::String("outside".into())), ("c", Value::Null)]);
    assert_eq!(search.len(), 2);
    assert!(search.iter().all(|r| r.field("conversationId").unwrap() == &text("room")));
    let history = engine.query("history", Context::new("alice", args(&[("conversationId", text("room")), ("c", Value::Null)])).at(200_000)).unwrap();
    assert_eq!(history.data.as_array().unwrap().len(), 50);
    assert!(history.next.is_some());
    engine.set_ceilings(Ceilings { examined: 20, ..Default::default() });
    let empty_window = engine.query("periodCount", Context::new("alice", args(&[
        ("c", text("room")), ("s", Value::Int(15_001)), ("e", Value::Int(120_000)),
    ])).at(200_000)).unwrap();
    assert!(empty_window.complete, "the seek must skip 5000 out-of-window rows: {empty_window:?}");
    assert_eq!(empty_window.data, Value::Int(0));
    let cut = engine.query("periodCount", Context::new("alice", count_args).at(200_000)).unwrap();
    assert!(!cut.complete && cut.data == Value::Null && cut.next.is_none());
    engine.set_ceilings(Ceilings::default());
    let id = engine.enqueue_job("daily", period(), 200_000).unwrap();
    let first = engine.run_job_chunk(200_000).unwrap().unwrap();
    assert_eq!(first.state, JobState::Running, "{first:?}");
    drop(engine);
    let mut engine = Engine::open(Store::open(&path).unwrap()).unwrap();
    while engine.run_job_chunk(200_000).unwrap().is_some() {}
    let job = engine.job(&id).unwrap().unwrap();
    assert_eq!(job.state, JobState::Done, "{job:?}");
    assert!(job.chunks >= 2);
    let effects = engine.effects(None, 100).unwrap();
    assert_eq!(effects.len(), 2);
    for effect in effects {
        let recipient = effect.payload.field("targetUserId").unwrap().as_str().unwrap();
        assert_eq!(effect.payload.field("unreadMessages").unwrap(), &Value::Int(if recipient == "alice" { 4899 } else { assert_eq!(recipient, "bob"); 4949 }));
        assert_eq!(effect.payload.field("unreadChats").unwrap(), &Value::Int(1));
    }
    let rerun = engine.run_job("daily", period(), 200_001).unwrap();
    assert_eq!(rerun.state, JobState::Done);
    assert_eq!(rerun.rows_written, 0);
    assert_eq!(engine.effects(None, 100).unwrap().len(), 2);
    println!("Clique target: 67 profiles, 5000 period rows, chunks={}, K={}, retries={}, heap_peak={}, count_heap={}", job.chunks, job.chunk_size, job.retries, job.heap_peak, count.metered.heap_bytes);
    drop(engine);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn full_target_following_shapes_delivery_and_lifecycle() {
    let source=format!("{SOURCE}\nmutation repost(postId: posts):\n  return insert reposts {{ postId, actorId: viewer }} if absent\nmutation remove(postId: posts):\n  update posts[postId] {{ removed: true }}\nmutation unrepost(postId: posts):\n  delete reposts[viewer, postId]\nquery followingRaw(c: cursor ?):\n  return following last 20 by .at after c\n");
    let b=compiled(&source);
    assert_eq!(b.schema.timelines.len(),1);
    assert!(b.view_types.contains_key("following"));
    let emitted=snapback4_lang::emit::typescript(&b);
    assert!(emitted.contains("following:"));
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    load(&mut e,vec![("profiles",profile("a","alice")),("profiles",profile("b","bob"))]);
    mutate(&mut e,"setFollow","alice",&[("owner",text("bob")),("set",Value::Bool(true))],1);
    for n in 0..65 {
        mutate(&mut e,"createPost","bob",&[("postId",text(&format!("p{n:03}"))),("parentId",Value::Null),("body",Value::String(format!("post {n}")))],n+2);
    }
    mutate(&mut e,"createPost","bob",&[("postId",text("reply")),("parentId",text("p000")),("body",Value::String("reply".into()))],100);
    assert!(page(&mut e,"home",&[("c",Value::Null)]).is_empty(),"foreign fan-out has not run");
    while e.run_timeline_chunk(200).unwrap().is_some(){}
    let mut cursor=Value::Null;let mut events=Vec::new();
    loop{
        let result=e.query("home",Context::new("alice",args(&[("c",cursor)])).at(200)).unwrap();
        assert!(result.complete);
        for row in result.data.as_array().unwrap(){
            assert_eq!(row.field("actor").unwrap().field("principal").unwrap(),&text("bob"));
            assert_eq!(row.field("post").unwrap().field("author").unwrap().field("principal").unwrap(),&text("bob"));
            events.push(row.field("id").unwrap().as_str().unwrap().to_string());
        }
        let Some(next)=result.next else{break;};cursor=Value::String(next);
    }
    assert_eq!(events,(0..65).rev().map(|n|format!("p{n:03}")).collect::<Vec<_>>());
    mutate(&mut e,"repost","alice",&[("postId",text("p000"))],300);
    let own=page(&mut e,"followingRaw",&[("c",Value::Null)])[0].clone();
    assert_eq!(own.field("repost").unwrap(),&Value::Bool(true));
    assert_ne!(own.field("id").unwrap(),own.field("post").unwrap());
    mutate(&mut e,"remove","bob",&[("postId",text("p064"))],301);
    assert_eq!(page(&mut e,"followingRaw",&[("c",Value::Null)])[1].field("id").unwrap(),&text("p063"));
    mutate(&mut e,"setFollow","alice",&[("owner",text("bob")),("set",Value::Bool(false))],302);
    assert_eq!(page(&mut e,"home",&[("c",Value::Null)]).len(),1);
    mutate(&mut e,"setFollow","alice",&[("owner",text("bob")),("set",Value::Bool(true))],303);
    let preview=e.query("home",Context::new("alice",args(&[("c",Value::Null)])).at(304)).unwrap();
    assert!(!preview.complete);assert_eq!(preview.data.as_array().unwrap().len(),20);
    while e.run_timeline_chunk(400).unwrap().is_some(){}
    mutate(&mut e,"unrepost","alice",&[("postId",text("p000"))],401);
    assert_eq!(page(&mut e,"followingRaw",&[("c",Value::Null)])[0].field("id").unwrap(),&text("p063"));
}
