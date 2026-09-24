use super::*;
use snapback4_core::{Context, Value, WriteState, schema::timeline::owned_id};
#[path = "../timeline/identity.rs"]
mod identity;

#[test]
fn paired_tombstoned_repost_identity_is_unobservable() {
    let source = format!("use personas a, b, c\n{}{}\nmutation register():\n  insert profiles {{ principal: viewer }}\nmutation follow(authorId: principal):\n  insert follows {{ followerId: viewer, followedId: authorId }}\nmutation publish(postId: id):\n  insert posts {{ id: postId, authorId: viewer, at: 7 }}\nmutation remove(postId: posts):\n  update posts[id = postId] {{ removed: true }}\nmutation repost(postId: posts):\n  insert reposts {{ actorId: viewer, postId, at: 8 }}\n",
        include_str!("../timeline/app.q"), include_str!("../timeline/declaration.q"));
    let initial = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &source);
    let mut supplied = Vec::new();
    let images = {
        let mut e = lock(&initial.shared.engine);
        for (n, (op, who, args)) in [("register", "a", json!({})), ("register", "b", json!({})), ("register", "c", json!({})),
            ("follow", "c", json!({"authorId":"a"})), ("follow", "c", json!({"authorId":"b"})),
            ("publish", "a", json!({"postId":"removed"})), ("publish", "b", json!({"postId":"live"})),
            ("remove", "a", json!({"postId":"removed"}))].into_iter().enumerate() {
            let args = args.as_object().unwrap().iter().map(|(k,v)| (k.clone(), Value::Id(if k == "authorId" {persona_principal(v.as_str().unwrap())} else {v.as_str().unwrap().into()}))).collect();
            let ids = (0..5).map(|i| format!("setup-{n}-{i}")).collect::<Vec<_>>();
            supplied.extend(ids.clone());
            if op == "remove" { while e.run_timeline_chunk(7).unwrap().is_some() {} }
            let out = e.mutate(op, None, Context::new(persona_principal(who), args).at(n as i64).with_ids(ids)).unwrap();
            assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        }
        identity::assert_placement(&e, &supplied);
        e.schema().tables.keys().flat_map(|table| e.store().rows(table).unwrap().into_iter().map(|row| (table.clone(), row))).collect::<Vec<_>>()
    };
    drop(initial);
    // The new repost would deliver exactly this (C, removed) natural key.
    let epoch = images.iter().find(|(t,r)|t=="feedEdges" && r.field("actorId").unwrap()==&Value::Id(persona_principal("a"))).unwrap().1.field("epoch").unwrap().clone();
    let hidden_id = owned_id("feed", "Feed", &[Value::Id(persona_principal("c")), Value::Id("removed".into()), epoch]);
    assert!(images.iter().any(|(t,r)| t == "feedFeed" && r.field("id").unwrap() == &Value::Id(hidden_id.clone())));
    let ids = ["new-repost", "removed", "spare"].map(String::from);
    supplied.extend(ids.clone());
    let mut observed = Vec::new();
    for hidden in [false, true] {
        // A pending removal permits either private copy state; its public
        // tombstone is identical. No totals derive from inbox membership.
        let images = images.iter().filter(|(t,r)| hidden || t != "feedFeed" || r.field("id").unwrap().as_str().unwrap() != hidden_id).cloned().collect::<Vec<_>>();
        let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &source);
        lock(&host.shared.engine).load_trusted(images.clone()).unwrap();
        let since = lock(&host.shared.engine).seq().unwrap();
        let request = json!({"id":"probe", "args":{"postId":"live"}, "newIds":ids}).to_string();
        let response = host.request("POST", "/m/repost", "x-snapback-persona: b\r\n", &request);
        let receipt = lock(&host.shared.engine).store().applied_outcome(&persona_principal("b"), "probe").unwrap().unwrap();
        let retry = host.request("POST", "/m/repost", "x-snapback-persona: b\r\n", &request);
        let changes = host.request("GET", &format!("/changes?since={since}&wait=0"), "x-snapback-persona: b\r\n", "");
        {
            let e = lock(&host.shared.engine);
            identity::assert_placement(&e, &supplied);
            for table in e.schema().tables.keys() {
                assert_eq!(e.store().rows(table).unwrap(), images.iter().filter(|(t,_)|t==table).map(|(_,r)|r.clone()).collect::<Vec<_>>());
            }
        }
        // HTTP withholds operator meters; compare the identical engine attempt.
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        let mut e = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        e.load_trusted(images).unwrap();
        let out = e.mutate("repost", Some("probe"), Context::new(persona_principal("b"), [("postId".into(),Value::Id("live".into()))].into()).at(8).with_ids(ids.clone())).unwrap();
        let replay = e.mutate("repost", Some("probe"), Context::new(persona_principal("b"), [("postId".into(),Value::Id("live".into()))].into()).at(9).with_ids(ids.clone())).unwrap();
        assert!(matches!(&out.state, WriteState::Failed { why, .. } if why.code == "FEED_EVENT_REMOVED"), "{out:?}");
        assert!(out.tables.is_empty()); assert_eq!(out.events, 0);
        assert_eq!(out.metered.rows_written, 1, "refuse before attempting the public event insert");
        identity::assert_placement(&e, &supplied);
        let mut changes = body(&changes);
        // Different in-memory stores have independently random identities;
        // compare every field after removing only that fixture identity.
        let mut answer = body(&response);
        let mut repeated = body(&retry);
        let identity = changes.as_object_mut().unwrap().remove("store_id").unwrap();
        assert_eq!(answer.as_object_mut().unwrap().remove("store_id"), Some(identity.clone()));
        assert_eq!(repeated.as_object_mut().unwrap().remove("store_id"), Some(identity));
        assert_eq!(changes["tables"],json!([]));
        observed.push((status(&response), answer, receipt, status(&retry), repeated, changes, out.state, replay.state, out.metered, replay.metered, out.tables));
    }
    assert_eq!(observed[0], observed[1], "pending private copy changed the actor-visible outcome");
    assert_eq!(observed[0].1["state"], "failed");
    assert_eq!(observed[0].4["replayed"], true);
}
