use super::*;
use snapback4_core::{Context, Value, WriteState};

#[test]
fn paired_hidden_versus_absent_owned_identity_is_unobservable() {
    let source = format!("use personas a, b\n{}{}\nmutation register():\n  insert profiles {{ principal: viewer }}\nmutation follow(authorId: principal):\n  insert follows {{ followerId: viewer, followedId: authorId }}\nmutation publish(postId: id):\n  insert posts {{ id: postId, authorId: viewer, at: 7 }}\n",
        include_str!("../timeline/app.q"), include_str!("../timeline/declaration.q"));
    let initial = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &source);
    let (images, hidden_id) = {
        let mut e = lock(&initial.shared.engine);
        for (n, (op, who, args)) in [("register", "a", json!({})), ("register", "b", json!({})),
            ("follow", "b", json!({"authorId":"a"})), ("publish", "a", json!({"postId":"old"}))].into_iter().enumerate() {
            let args = args.as_object().unwrap().iter().map(|(k,v)| (k.clone(), Value::Id(if k == "authorId" {persona_principal(v.as_str().unwrap())} else {v.as_str().unwrap().into()}))).collect();
            let out = e.mutate(op, None, Context::new(persona_principal(who), args).at(n as i64).with_ids((0..5).map(|i| format!("setup-{n}-{i}")))).unwrap();
            assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        }
        let images: Vec<_> = e.schema().tables.keys().flat_map(|table| e.store().rows(table).unwrap().into_iter().map(|row| (table.clone(), row))).collect();
        let hidden_id = images.iter().find(|(table,row)| table == "feedFeed" && row.field("readerId").unwrap() == &Value::Id(persona_principal("b"))).unwrap().1.field("id").unwrap().as_str().unwrap().to_string();
        (images, hidden_id)
    };
    drop(initial);
    let mut observed = Vec::new();
    for hidden in [false, true] {
        let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &source);
        lock(&host.shared.engine).load_trusted(images.iter().filter(|(t,r)| hidden || t != "feedFeed" || r.field("id").unwrap().as_str().unwrap() != hidden_id).cloned()).unwrap();
        let since = lock(&host.shared.engine).seq().unwrap();
        let request = json!({"id":"probe", "args":{"postId":"new"}, "newIds":[hidden_id, "spare"]}).to_string();
        let response = host.request("POST", "/m/publish", "x-snapback-persona: a\r\n", &request);
        assert_eq!(status(&response),200,"{response}");
        let receipt = lock(&host.shared.engine).store().applied_outcome(&persona_principal("a"), "probe").unwrap().unwrap_or_else(||panic!("no receipt: {response}"));
        let retry = host.request("POST", "/m/publish", "x-snapback-persona: a\r\n", &request);
        let changes = host.request("GET", &format!("/changes?since={since}&wait=0"), "x-snapback-persona: a\r\n", "");
        // HTTP intentionally withholds operator meters. Execute the identical
        // probe in an independent engine to compare every metered field too.
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        let mut e = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        e.load_trusted(images.iter().filter(|(t,r)| hidden || t != "feedFeed" || r.field("id").unwrap().as_str().unwrap() != hidden_id).cloned()).unwrap();
        let out = e.mutate("publish", Some("probe"), Context::new(persona_principal("a"), [("postId".into(),Value::Id("new".into()))].into()).at(7).with_ids([hidden_id.clone(),"spare".into()])).unwrap();
        let replay = e.mutate("publish", Some("probe"), Context::new(persona_principal("a"), [("postId".into(),Value::Id("new".into()))].into()).at(8).with_ids([hidden_id.clone(),"spare".into()])).unwrap();
        observed.push((status(&response), body(&response), receipt, body(&retry), (body(&changes)["seq"].clone(),body(&changes)["tables"].clone()), out.metered, replay.metered));
    }
    assert_eq!(observed[0], observed[1], "hidden private row changed an author-visible outcome");
    assert_eq!(observed[0].1["state"], "sent");
    assert_eq!(observed[0].3["replayed"], true);
    assert_eq!(observed[0].4.1, json!(["feedFeed", "feedPosts", "posts"]));
}
