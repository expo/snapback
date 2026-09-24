use snapback4_core::{Context, Engine, MutationOutcome, Value, WriteState};
use snapback4_lang::{Bound, recipe::{self, bridge::Mapping}};
use std::collections::BTreeMap;

pub const APP: &str = include_str!("app.q");
pub const DECLARATION: &str = include_str!("declaration.q");
pub const OWNED: [&str; 4] = ["feedPosts", "feedRemovedEvents", "feedFeed", "feedWork"];
pub fn id(s: &str) -> Value { Value::Id(s.into()) }
pub fn context(viewer: &str, args: &[(&str, Value)], at: i64) -> Context {
    Context::new(viewer, args.iter().map(|(k,v)| (k.to_string(), v.clone())).collect()).at(at)
        .with_ids((0..1100).map(|n| format!("m{at:08}-{n:04}")))
}
pub fn compile(source: &str) -> Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
pub fn bound(declared: bool) -> Bound { sized_bound(declared, None) }
pub fn sized_bound(declared: bool, size: Option<(u32, u32)>) -> Bound {
    let mut app = APP.replacen("  immutable principal", "  delete <- .principal = viewer\n  immutable principal", 1);
    app = app.replace("  removed: bool default false", "  body: text <=4000 default ''\n  removed: bool default false");
    if let Some((_, edges)) = size { app = app.replace("  cap 100000\n", &format!("  cap {edges}\n")); }
    let mut sources = Vec::new();
    if declared {
        app.push_str(DECLARATION);
        if let Some((authors, edges)) = size { app.push_str(&format!("  size authors {authors}, edges {edges}\n")); }
    } else {
        let schema = compile(&app).schema;
        let mapping = Mapping::parse("profiles:principal", "posts:authorId:at", "follows:followerId:followedId", "reposts:actorId:postId:at").unwrap();
        let (authors, edges) = size.map(|(a,e)| (Some(a.to_string()), Some(e.to_string()))).unwrap_or_default();
        let caps = recipe::FollowingCaps::parse(authors.as_deref(), edges.as_deref()).unwrap();
        sources.push(("feed.q".into(), recipe::following_sized("feed", "feed", caps).unwrap()));
        sources.push(("bridge.q".into(), mapping.render(&schema, "feed").unwrap()));
    }
    let register = if declared { "" } else { "feedAppRegister(p.id)" };
    let publish = if declared { "" } else { "feedAppPublish(p.id)" };
    let repost = if declared { "" } else { "feedAppRepost(r.id)" };
    let unrepost = if declared { "if exists reposts[viewer, postId]:\n    delete reposts[viewer, postId]" } else { "r = reposts[viewer, postId]\n  if r != null:\n    feedAppUnrepost(r.id)" };
    let follow = if declared { "insert follows { followerId: viewer, followedId: authorId } if absent" } else { "feedAppFollow(authorId)" };
    let unfollow = if declared { "delete follows[viewer, authorId]" } else { "feedAppUnfollow(authorId)" };
    let remove = if declared { "" } else { "feedAppRemove(postId)" };
    let read = if declared { "feed[viewer] after c last 20".into() } else {
        "merge feedFeed after c last 20 by byReaderTime where not exists feedRemovedEvents[eventId = .eventId]:\n    [viewer]\n    feedBroadcast[p.authorId] for p in feedPulls[viewer] by byReaderAuthor".to_string()
    };
    let event_id = if declared { ".id" } else { ".eventId" };
    app.push_str(&format!(r#"
mutation register():
  p = insert profiles {{ principal: viewer }}
  {register}
mutation deleteProfile():
  delete profiles[viewer]
mutation publish(postId: id):
  p = insert posts {{ id: postId, authorId: viewer, at: now, body: 'hello' }}
  {publish}
mutation publishAt(postId: id, at: time):
  p = insert posts {{ id: postId, authorId: viewer, at, body: 'hello' }}
  {publish}
mutation repost(postId: posts):
  if exists reposts[viewer, postId]:
    return null
  r = insert reposts {{ actorId: viewer, postId, at: now }}
  {repost}
mutation unrepost(postId: posts):
  {unrepost}
mutation follow(authorId: principal):
  {follow}
mutation unfollow(authorId: principal):
  {unfollow}
mutation refollow(authorId: principal):
  {unfollow}
  {follow}
mutation remove(postId: posts):
  update posts[postId] {{ removed: true }}
  {remove}
query following(c: cursor ?):
  events = {read}
  return events {{ id: {event_id}, postId, actorId, authorId, repost, at }}
query cards(c: cursor ?):
  events = {read}
  return events {{ id: {event_id}, post: posts[.postId], actor: profiles[.actorId] }}
"#));
    sources.push(("schema.q".into(), app));
    let b = snapback4_lang::compile(&sources);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
pub fn engine(declared: bool) -> Engine {
    let b = bound(declared);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
pub fn rows(e: &Engine, table: &str) -> Vec<Value> { e.store().rows(table).unwrap() }
pub fn snapshot(e: &Engine) -> BTreeMap<String, Vec<Value>> {
    e.schema().tables.keys().map(|table| (table.clone(), rows(e, table))).collect()
}
pub fn sent(e: &mut Engine, op: &str, who: &str, args: &[(&str,Value)], at:i64) -> MutationOutcome {
    let out=e.mutate(op,None,context(who,args,at)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}),"{op}: {out:?}");out
}
pub fn drain(e: &mut Engine) { while e.run_timeline_chunk(10000).unwrap().is_some() {} }
