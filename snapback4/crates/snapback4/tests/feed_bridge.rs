//! @ref LLP 3000.011.002.000#5 — generated public bridges keep the manual recipe's behavior and meters.
use serde_json::json;
use snapback4_core::{Context, Engine, MutationOutcome, Value, WriteState, wire};
use snapback4_lang::recipe::{self, bridge::Mapping};
use std::collections::BTreeMap;

const MAPPINGS: [&str; 4] = ["profiles:principal", "posts:authorId:at", "follows:followerId:followedId", "reposts:actorId:postId:at"];
const WRITES: &str = r#"
mutation saveProfile(name: text <=100):
  upsert profiles[principal = viewer] { principal: viewer, name }
  profile = profiles[principal = viewer] ! else FEED_APP_NOT_FOUND
  feedAppRegister(profile.id)
mutation register():
  profile = profiles[principal = viewer] ! else FEED_APP_NOT_FOUND
  feedAppRegister(profile.id)
mutation follow(authorId: principal):
  return feedAppFollow(authorId)
mutation unfollow(authorId: principal):
  return feedAppUnfollow(authorId)
mutation createPost(postId: id, body: text <=4000, media: image <=1000000 ?):
  p = insert posts { id: postId, authorId: viewer, body, media, at: now }
  feedAppPublish(p.id)
  return p postCard
mutation repost(postId: posts):
  if exists reposts[viewer, postId]:
    return null
  r = insert reposts { actorId: viewer, postId, at: now }
  feedAppRepost(r.id)
  return { id: r.id }
mutation deletePost(postId: posts):
  return feedAppRemove(postId)
mutation unrepost(postId: posts):
  r = reposts[viewer, postId]
  if r != null:
    feedAppUnrepost(r.id)
  return null
mutation publishExisting(postId: posts):
  return feedAppPublish(postId)
mutation repostExisting(repostId: reposts):
  return feedAppRepost(repostId)
"#;
fn manual() -> String {
    snapback4_lang::guide::quarry(include_str!("../../snapback4-lang/src/recipe/ADOPTION.md")).into_iter()
        .find(|s| s.starts_with("-- Existing installed feed module; not a new application starter\n")).unwrap()
}
fn tables() -> String { manual().split_once("mutation saveProfile").unwrap().0.to_owned() }
fn mapping() -> Mapping { Mapping::parse(MAPPINGS[0], MAPPINGS[1], MAPPINGS[2], MAPPINGS[3]).unwrap() }
fn bridge() -> String {
    let app = snapback4_lang::compile(&[("app.q".into(), tables())]);
    assert!(app.diagnostics.is_empty(), "{:?}", app.diagnostics);
    mapping().render(&app.schema, "feed").unwrap()
}
fn built(generated: bool) -> snapback4_lang::Bound {
    let mut sources = vec![("feed.q".into(), recipe::following("feed", "feed").unwrap())];
    let app = if generated {
        sources.push(("feed_bridge.q".into(), bridge()));
        format!("{}{}\nquery following{}", tables(), WRITES, manual().split_once("query following").unwrap().1)
    } else { manual() };
    sources.push(("social.q".into(), app));
    let b = snapback4_lang::compile(&sources);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(b.schema.operations["social.following"].runs.as_deref(), Some("device"));
    b
}
fn engine(generated: bool) -> Engine {
    let b = built(generated);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
#[test]
fn existing_public_bridge_keeps_helpers_out_of_the_client_api() {
    let bound = built(true);
    assert_no_helpers_in_api(&bound);
}

fn assert_no_helpers_in_api(bound: &snapback4_lang::Bound) {
    let api = snapback4_lang::emit::typescript(bound);
    assert!(api.contains("export const api: Ops"));
    let api_names: std::collections::BTreeSet<_> = api.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').collect();
    let (recipe, errors) = snapback4_lang::parse_document("feed.q", &recipe::following("feed", "feed").unwrap());
    assert!(errors.is_empty(), "{errors:?}");
    let (bridge, errors) = snapback4_lang::parse_document("bridge.q", &bridge());
    assert!(errors.is_empty(), "{errors:?}");
    for helper in recipe.functions.iter().chain(&bridge.functions).map(|f| &f.name) {
        assert!(bound.schema.operations.keys().all(|name| name.rsplit('.').next() != Some(helper.as_str())), "operation leaks {helper}");
        assert!(!api_names.contains(helper.as_str()), "generated api.ts leaks {helper}");
    }
    for program in recipe.programs.iter().filter(|p| p.kind == snapback4_lang::ast::ProgramKind::Job) {
        assert!(!api_names.contains(program.name.as_str()), "generated api.ts leaks {}", program.name);
    }
}

#[test]
fn declaration_expansion_binds_cleanly_and_emits_no_recipe_or_bridge_helpers() {
    let source = snapback4_lang::guide::quarry(include_str!("../../snapback4-lang/tests/fixtures/legacy-feed-recipes.md")).remove(1);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.notes.len(), 1, "{:?}", bound.notes);
    assert_eq!(bound.notes[0].code, "N_MAINTAINED_COLUMN_STREAM");
    assert!(bound.notes[0].message.starts_with("posts: each contributing commit logs and streams the whole parent image"));
    assert_eq!(bound.schema.timelines.len(), 1);
    assert!(bound.schema.tables.contains_key("feedPosts"), "the declaration expanded");
    assert!(bound.schema.operations.contains_key("following"), "the application bound");
    assert_no_helpers_in_api(&bound);
}

#[test]
fn public_bridge_library_refuses_private_ambiguous_and_unsafe_mappings() {
    let cases = [
        ("public 'app post cards are public'", "read <- .authorId = viewer", "explicitly public"),
        ("  sync public", "", "fully `sync public`"),
        ("  at: time", "  at: principal", "required Time"),
        ("  postId: posts", "  postId: profiles", "required Ref"),
        ("  immutable principal\n", "", "immutable"),
        ("  insert <- .authorId = viewer", "  insert <- allow", "insert must require"),
        ("  insert <- .authorId = viewer", "  insert <- .authorId = viewer\n  delete <- .authorId = viewer", "deny deletion"),
        ("  unique byPair: followerId, followedId", "  unique byPair: followerId, followedId\n  unique secondPair: followerId, followedId", "exactly one total unique"),
        ("table follows:", "table follows:\n  reason: text <=100", "needs an application value"),
    ];
    for (from, to, expected) in cases {
        let mut source = tables().replacen(from, to, 1);
        if expected == "explicitly public" {
            source = source.replacen("  sync public", "  sync to .authorId", 1)
                .replacen("  cap 60000", "  by byAuthor: authorId, id\n  cap 60000", 1);
        }
        let app = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(app.diagnostics.is_empty(), "{:?}", app.diagnostics);
        let error = mapping().render(&app.schema, "feed").unwrap_err();
        assert!(error.contains(expected), "{expected}: {error}");
    }
    for selector in ["posts:authorId", "posts:authorId:authorId", "posts:authorId:at:extra", "posts:authorId:at;bad"] {
        assert!(Mapping::parse("profiles:principal", selector, MAPPINGS[2], MAPPINGS[3]).is_err());
    }
}

#[test]
fn public_bridge_refuses_delete_denied_follow_and_repost_mappings() {
    for (table, owner, helper) in [("follows", "followerId", "feedAppUnfollow"), ("reposts", "actorId", "feedAppUnrepost")] {
        for denied_rule in ["", "  delete <- deny\n"] {
                let source = tables().replace(&format!("  delete <- .{owner} = viewer\n"), denied_rule);
            let app = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
            assert!(app.diagnostics.is_empty(), "the refusal fixture must be a valid app: {:?}", app.diagnostics);
            assert_eq!(app.schema.tables[table].rules.delete, snapback4_core::schema::RuleExpr::Deny);
            let error = mapping().render(&app.schema, "feed").unwrap_err();
            assert!(error.contains(&format!("{table} delete must require .{owner} = viewer")) && error.contains(helper), "{error}");
        }
    }
}

#[test]
fn retained_bridge_refuses_a_same_namespace_helper_collision() {
    let bound = snapback4_lang::compile(&[
        ("feed.q".into(), recipe::following("feed", "feed").unwrap()),
        ("bridge.q".into(), format!("{}\nfn feedAppPublish(postId: posts):\n  return null\n", bridge())),
        ("social.q".into(), format!("{}{}", tables(), WRITES)),
    ]);
    assert!(bound.diagnostics.iter().any(|d| d.message.contains("feedAppPublish")), "{:?}", bound.diagnostics);
}

fn id(value: &str) -> Value { Value::Id(value.into()) }
fn context(viewer: &str, args: &[(&str, Value)], at: i64) -> Context {
    Context::new(viewer, args.iter().map(|(key, value)| ((*key).into(), value.clone())).collect()).at(at)
}
fn mutate(e: &mut Engine, op: &str, viewer: &str, args: &[(&str, Value)], at: i64) -> MutationOutcome {
    let out = e.mutate(&format!("social.{op}"), None, context(viewer, args, at)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{op}: {out:?}"); out
}
fn mutate_and_replay(e: &mut Engine, op: &str, viewer: &str, args: &[(&str, Value)], at: i64) {
    let name = format!("social.{op}");
    let first = e.mutate(&name, Some(op), context(viewer, args, at)).unwrap();
    assert!(matches!(first.state, WriteState::Sent { .. }), "{first:?}");
    let before = rows(e);
    let retry = e.mutate(&name, Some(op), context(viewer, args, at)).unwrap();
    assert!(retry.replayed); assert_eq!(retry.state, first.state); assert_eq!(rows(e), before);
}
fn register(e: &mut Engine, viewer: &str) { mutate(e, "saveProfile", viewer, &[("name", Value::String(viewer.into()))], 1); }
fn rows(e: &Engine) -> BTreeMap<String, Vec<Value>> {
    e.schema().tables.keys().map(|table| (table.clone(), e.store().rows(table).unwrap())).collect()
}
fn page(e: &mut Engine, viewer: &str) -> Vec<Value> {
    let page = e.query("social.following", context(viewer, &[], 100)).unwrap();
    assert!(page.complete, "{page:?}");
    page.data.as_array().unwrap().iter().map(|entry| snapback4_core::value::object([
        ("postId", entry.field("postId").unwrap().clone()), ("actor", entry.field("actorId").unwrap().clone()),
        ("author", entry.field("authorId").unwrap().clone()), ("repost", entry.field("repost").unwrap().clone()),
        ("at", entry.field("at").unwrap().clone()), ("body", entry.field("post").unwrap().field("body").unwrap().clone()),
    ])).collect()
}
fn seed(e: &mut Engine, table: &str, row: serde_json::Value) {
    let row = wire::row_from_json(&e.schema().tables[table], &row).unwrap(); e.seed([(table.into(), row)]).unwrap();
}

#[test]
fn generated_and_manual_follow_repost_remove_retry_and_unfollow_agree() {
    let mut traces = Vec::new(); let mut meters = Vec::new();
    for generated in [false, true] {
        let mut e = engine(generated); let mut trace = Vec::new();
        register(&mut e, "author"); register(&mut e, "reader");
        let follow = mutate(&mut e, "follow", "reader", &[("authorId", id("author"))], 2);
        mutate(&mut e, "follow", "reader", &[("authorId", id("author"))], 2);
        let args = [("postId", id("card")), ("body", Value::String("hello".into()))];
        let post = e.mutate("social.createPost", Some("new-card"), context("author", &args, 3)).unwrap();
        assert!(matches!(post.state, WriteState::Sent { .. }), "{post:?}");
        let before = rows(&e);
        let retry = e.mutate("social.createPost", Some("new-card"), context("author", &args, 3)).unwrap();
        assert!(retry.replayed); assert_eq!(rows(&e), before);
        trace.push(page(&mut e, "reader"));
        mutate(&mut e, "repost", "author", &[("postId", id("card"))], 4);
        mutate(&mut e, "repost", "reader", &[("postId", id("card"))], 5);
        mutate(&mut e, "repost", "reader", &[("postId", id("card"))], 6);
        assert_eq!(e.store().rows("feedPosts").unwrap().len(), 3);
        trace.push(page(&mut e, "reader"));
        mutate(&mut e, "deletePost", "author", &[("postId", id("card"))], 7);
        mutate(&mut e, "deletePost", "author", &[("postId", id("card"))], 8);
        assert_eq!(e.store().rows("posts").unwrap().len(), 1);
        trace.push(page(&mut e, "reader"));
        assert_eq!(trace.last().unwrap().len(), 2, "independent reposts survive original removal");
        mutate_and_replay(&mut e, "unrepost", "reader", &[("postId", id("card"))], 9);
        trace.push(page(&mut e, "reader"));
        mutate_and_replay(&mut e, "unfollow", "reader", &[("authorId", id("author"))], 11);
        assert!(e.store().rows("follows").unwrap().is_empty() && e.store().rows("feedFollows").unwrap().is_empty());
        trace.push(page(&mut e, "reader"));
        assert!(trace.last().unwrap().is_empty());
        println!("bridge generated={generated} follow examined={} written={}; publish examined={} written={}", follow.metered.examined, follow.metered.rows_written, post.metered.examined, post.metered.rows_written);
        meters.push((follow.metered, post.metered)); traces.push(trace);
    }
    assert_eq!(traces[0], traces[1]);
    assert_eq!(meters[0].0.rows_written, meters[1].0.rows_written);
    assert_eq!(meters[0].1.rows_written, meters[1].1.rows_written);
    assert!(meters[1].0.examined <= meters[0].0.examined + 2);
    assert!(meters[1].1.examined <= meters[0].1.examined + 3);
}

#[test]
fn bridge_backfill_preserves_time_and_translates_distinct_legacy_event_ids() {
    let mut e = engine(true);
    for who in ["author", "reader"] { register(&mut e, who); }
    seed(&mut e, "posts", json!({"id":"card","authorId":"author","at":20,"body":"old card"}));
    seed(&mut e, "feedPosts", json!({"id":"legacy-event","postId":"card","actorId":"author","authorId":"author","at":20,"repost":false,"shared":false}));
    seed(&mut e, "reposts", json!({"id":"attribution","actorId":"reader","postId":"card","at":30}));
    let publish = mutate(&mut e, "publishExisting", "author", &[("postId", id("card"))], 100);
    assert!(matches!(publish.state, WriteState::Sent { result, .. } if result == id("legacy-event")));
    mutate(&mut e, "repostExisting", "reader", &[("repostId", id("attribution"))], 100);
    let before = rows(&e);
    mutate(&mut e, "repostExisting", "reader", &[("repostId", id("attribution"))], 101);
    assert_eq!(rows(&e), before, "initial backfill can resume while its live source event exists");
    seed(&mut e, "follows", json!({"id":"old-edge","followerId":"reader","followedId":"author"}));
    mutate(&mut e, "follow", "reader", &[("authorId", id("author"))], 102);
    let entries = page(&mut e, "reader");
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].field("at").unwrap(), &Value::Int(30));
    assert_eq!(entries[1].field("at").unwrap(), &Value::Int(20));
    mutate(&mut e, "deletePost", "author", &[("postId", id("card"))], 103);
    assert_eq!(e.store().rows("feedRemovedEvents").unwrap()[0].field("eventId").unwrap(), &id("legacy-event"));
    assert_eq!(page(&mut e, "reader").len(), 1);
    mutate(&mut e, "unrepost", "reader", &[("postId", id("card"))], 104);
    assert!(page(&mut e, "reader").is_empty());
}

#[test]
fn bridge_runtime_existence_ownership_identity_and_delivery_refusals_are_atomic() {
    let mut e = engine(true); register(&mut e, "author"); register(&mut e, "reader");
    mutate(&mut e, "createPost", "author", &[("postId", id("card")), ("body", Value::String("card".into()))], 2);
    for (op, viewer, args, code) in [
        ("publishExisting", "reader", vec![("postId", id("card"))], "FEED_APP_OWNER"),
        ("deletePost", "reader", vec![("postId", id("card"))], "FEED_APP_OWNER"),
        ("publishExisting", "author", vec![("postId", id("missing"))], "FEED_APP_NOT_FOUND"),
        ("follow", "reader", vec![("authorId", id("missing"))], "FEED_APP_NOT_FOUND"),
        ("repost", "reader", vec![("postId", id("missing"))], "FEED_APP_NOT_FOUND"),
    ] {
        let before = rows(&e); let out = e.mutate(&format!("social.{op}"), None, context(viewer, &args, 3)).unwrap();
        assert!(matches!(out.state, WriteState::Failed { why, .. } if why.code == code), "{op}: expected {code}");
        assert_eq!(rows(&e), before);
    }
    seed(&mut e, "posts", json!({"id":"wrong","authorId":"author","at":2,"body":"wrong"}));
    seed(&mut e, "feedPosts", json!({"id":"wrong-event","postId":"wrong","actorId":"author","authorId":"reader","at":2,"repost":false,"shared":false}));
    let before = rows(&e);
    let out = e.mutate("social.publishExisting", None, context("author", &[("postId", id("wrong"))], 3)).unwrap();
    assert!(matches!(out.state, WriteState::Failed { why, .. } if why.code == "FEED_APP_EVENT"));
    assert_eq!(rows(&e), before);
    seed(&mut e, "reposts", json!({"id":"bad-attribution","actorId":"reader","postId":"wrong","at":3}));
    seed(&mut e, "feedPosts", json!({"id":"bad-repost","postId":"wrong","actorId":"reader","authorId":"reader","at":3,"repost":true,"shared":false}));
    let before = rows(&e);
    let out = e.mutate("social.unrepost", None, context("reader", &[("postId", id("wrong"))], 3)).unwrap();
    assert!(matches!(out.state, WriteState::Failed { why, .. } if why.code == "FEED_APP_EVENT"));
    assert_eq!(rows(&e), before, "removal must not silently accept an event with the wrong original author");
    mutate(&mut e, "deletePost", "author", &[("postId", id("card"))], 4);
    let out = e.mutate("social.publishExisting", None, context("author", &[("postId", id("card"))], 5)).unwrap();
    assert!(matches!(out.state, WriteState::Failed { why, .. } if why.code == "FEED_EVENT_REMOVED"));
    let before = rows(&e);
    let out = e.mutate("social.repost", None, context("reader", &[("postId", id("card"))], 6)).unwrap();
    assert!(matches!(out.state, WriteState::Failed { why, .. } if why.code == "FEED_POST_NOT_FOUND"));
    assert_eq!(rows(&e), before, "failed delivery rolls back the app attribution insert");
}

#[test]
fn generated_and_manual_saturated_promotion_roll_back_then_recover() {
    for generated in [false, true] {
        let mut e = engine(generated);
        for who in ["author", "reader50"] { register(&mut e, who); }
        for n in 0..32 {
            let who = format!("shared{n}"); register(&mut e, &who);
            // Seeding only author mode sets the same pre-existing popular-author condition in both controls.
            let row = e.store().rows("feedAuthors").unwrap().into_iter().find(|r| r.field("principal") == Ok(&id(&who))).unwrap();
            seed(&mut e, "feedAuthors", json!({"id":row.field("id").unwrap().as_str().unwrap(),"principal":who,"shared":true}));
        }
        for n in 0..50 {
            let who = format!("reader{n:02}"); register(&mut e, &who);
            mutate(&mut e, "follow", &who, &[("authorId", id("author"))], 2);
        }
        for n in 0..32 { mutate(&mut e, "follow", "reader00", &[("authorId", id(&format!("shared{n}")))], 3); }
        let before = rows(&e); let seq = e.seq().unwrap();
        let out = e.mutate("social.follow", None, context("reader50", &[("authorId", id("author"))], 4)).unwrap();
        assert!(matches!(out.state, WriteState::Failed { why, .. } if why.code == "FEED_PROMOTION_PULL_CAP"));
        assert_eq!(rows(&e), before); assert_eq!(e.seq().unwrap(), seq);
        mutate(&mut e, "unfollow", "reader00", &[("authorId", id("shared0"))], 5);
        let out = mutate(&mut e, "follow", "reader50", &[("authorId", id("author"))], 6);
        assert_eq!(e.store().rows("feedPulls").unwrap().iter().filter(|row| row.field("authorId") == Ok(&id("author"))).count(), 52);
        println!("bridge generated={generated} recovered promotion examined={} written={}", out.metered.examined, out.metered.rows_written);
    }
}

#[test]
fn explicit_mapping_uses_selected_names() {
    fn rename(source: &str) -> String {
        source.replace("reposts", "boosts").replace("posts", "cards").replace("follows", "subscriptions").replace("profiles", "people")
            .replace("authorId", "writer").replace("actorId", "actor").replace("postId", "cardRef")
            .replace("followerId", "reader").replace("followedId", "source")
            .replace("  principal: principal", "  account: principal").replace("byPrincipal: principal", "byPrincipal: account")
            .replace("immutable principal", "immutable account").replace(".principal", ".account").replace("[principal =", "[account =")
            .replace("{ principal: viewer", "{ account: viewer")
    }
    let table_source = rename(&tables());
    let b = snapback4_lang::compile(&[("app.q".into(), table_source.clone())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let generated = Mapping::parse("people:account", "cards:writer:at", "subscriptions:reader:source", "boosts:actor:cardRef:at").unwrap().render(&b.schema, "feed").unwrap();
    let b = snapback4_lang::compile(&[("feed.q".into(), recipe::following("feed", "feed").unwrap()), ("bridge.q".into(), generated), ("app.q".into(), format!("{table_source}{}", rename(WRITES)))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);

}

#[test]
fn fresh_backfill_resumes_before_following_without_changing_original_time() {
    let mut e = engine(true); register(&mut e, "author"); register(&mut e, "reader");
    seed(&mut e, "posts", json!({"id":"old-card","authorId":"author","at":20,"body":"backfilled"}));
    mutate(&mut e, "publishExisting", "author", &[("postId", id("old-card"))], 100);
    let before = rows(&e);
    mutate(&mut e, "publishExisting", "author", &[("postId", id("old-card"))], 101);
    assert_eq!(rows(&e), before);
    mutate(&mut e, "follow", "reader", &[("authorId", id("author"))], 102);
    let entries = page(&mut e, "reader");
    assert_eq!(entries.len(), 1); assert_eq!(entries[0].field("at").unwrap(), &Value::Int(20));
}

#[test]
fn public_bridge_reports_handwritten_reduction_and_bounded_publish_overhead() {
    let old = manual();
    let old = old.split_once("mutation saveProfile").unwrap().1.split_once("query following").unwrap().0;
    let new = WRITES.split_once("mutation publishExisting").unwrap().0;
    let lines = |source: &str| source.lines().filter(|line| !line.trim().is_empty()).count();
    println!("bridge app wiring: manual={} nonblank lines, generated={} nonblank lines; eight matching app mutations (excluding adoption-only endpoints)", lines(old), lines(new));
    for generated in [false, true] {
        let mut e = engine(generated); register(&mut e, "author"); register(&mut e, "reader");
        mutate(&mut e, "follow", "reader", &[("authorId", id("author"))], 2);
        let mut times = Vec::new(); let mut meter = None;
        for n in 0..25 {
            let start = std::time::Instant::now();
            let out = mutate(&mut e, "createPost", "author", &[("postId", id(&format!("post{n}"))), ("body", Value::String("measurement".into()))], 10 + n);
            if n >= 5 { times.push(start.elapsed().as_secs_f64() * 1000.0); }
            meter = Some(out.metered);
        }
        times.sort_by(f64::total_cmp); let meter = meter.unwrap();
        assert_eq!(meter.rows_written, 4, "one app card, event, author copy and follower copy");
        println!("bridge publish generated={generated}: measured=20 warmup=5 examined={} index={} written={} p50_ms={:.3} p95_ms={:.3}", meter.examined, meter.index_entries, meter.rows_written, times[9], times[18]);
    }
}
