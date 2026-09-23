use snapback4_core::{Context, Engine, MutationOutcome, Value, WriteState};
use snapback4_lang::{Bound, recipe::{self, bridge::Mapping}};
use std::collections::BTreeMap;

pub const APP: &str = include_str!("app.q");
pub const DECLARATION: &str = include_str!("declaration.q");
pub const OWNED: [&str; 8] = ["feedAuthors", "feedPulls", "feedPullCounts", "feedPullTotals", "feedPosts", "feedRemovedEvents", "feedFeed", "feedBroadcast"];
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
pub fn bound(declared: bool) -> Bound {
    let mut app = APP.replacen("  immutable principal", "  delete <- .principal = viewer\n  immutable principal", 1);
    app = app.replace("  removed: bool default false", "  body: text <=4000 default ''\n  removed: bool default false");
    let mut sources = Vec::new();
    if declared { app.push_str(DECLARATION); } else {
        let schema = compile(&app).schema;
        let mapping = Mapping::parse("profiles:principal", "posts:authorId:at", "follows:followerId:followedId", "reposts:actorId:postId:at").unwrap();
        sources.push(("feed.q".into(), recipe::following("feed", "feed").unwrap()));
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
pub fn normalized(e: &Engine) -> BTreeMap<String, Vec<String>> {
    e.schema().tables.keys().filter(|name| name.as_str() != "feedFollows").map(|name| {
        let mut rows: Vec<_> = rows(e, name).into_iter().map(|mut row| {
            // Storage identities of route/mode/copy/application edge rows are
            // independently minted. Event identities are public and stay exact.
            if !matches!(name.as_str(), "feedPosts" | "feedRemovedEvents" | "posts") {
                if let Value::Row(fields) = &mut row { fields.remove("id"); }
            }
            snapback4_core::value::canonical_json(&row)
        }).collect();
        rows.sort(); (name.clone(), rows)
    }).collect()
}
pub struct Pair { pub recipe: Engine, pub declared: Engine, pub at: i64 }
impl Pair {
    pub fn new() -> Self { Self { recipe: engine(false), declared: engine(true), at: 1 } }
    pub fn step(&mut self, op: &str, viewer: &str, args: &[(&str,Value)]) -> [MutationOutcome;2] {
        let before_edges = rows(&self.recipe, "feedFollows").len();
        let a = self.recipe.mutate(op, None, context(viewer,args,self.at)).unwrap();
        let b = self.declared.mutate(op, None, context(viewer,args,self.at)).unwrap();
        self.at += 1;
        match (&a.state,&b.state) {
            (WriteState::Sent{..},WriteState::Sent{..}) => {
                let edge_writes = if op == "refollow" { 2 } else { before_edges.abs_diff(rows(&self.recipe,"feedFollows").len()) as u64 };
                assert_eq!(a.metered.rows_written, b.metered.rows_written + edge_writes, "{op} for {viewer}: writes");
            }
            (WriteState::Failed{why:a,..},WriteState::Failed{why:b,..}) => assert_eq!(a.code,b.code,"{op} for {viewer}"),
            _ => panic!("{op} for {viewer}: recipe {:?}; F3 {:?}",a.state,b.state),
        }
        [a,b]
    }
    pub fn sent(&mut self, op: &str, viewer: &str, args: &[(&str,Value)]) -> [MutationOutcome;2] {
        let out = self.step(op,viewer,args);
        assert!(matches!(out[0].state,WriteState::Sent{..}),"{op}: {:?}",out[0]); out
    }
    pub fn register(&mut self, viewer: &str) { self.sent("register",viewer,&[]); }
    pub fn follow(&mut self, viewer: &str, author: &str) { self.sent("follow",viewer,&[("authorId",id(author))]); }
    pub fn publish(&mut self, actor: &str, post: &str) { self.sent("publish",actor,&[("postId",id(post))]); }
    pub fn equal(&self) {
        let a=normalized(&self.recipe); let b=normalized(&self.declared);
        for (table,rows) in &a { assert_eq!(rows,&b[table],"table {table}"); }
        assert_eq!(a.len(),b.len());
    }
    pub fn pages(&mut self, viewer: &str, query: &str) -> Vec<Value> {
        let mut next = [None::<String>,None]; let mut all = Vec::new();
        for _ in 0..200 {
            let pages: Vec<_> = [&mut self.recipe,&mut self.declared].into_iter().enumerate().map(|(i,e)| {
                e.query(query,context(viewer,&[("c",next[i].clone().map(Value::String).unwrap_or(Value::Null))],self.at)).unwrap()
            }).collect();
            assert_eq!(pages[0].data,pages[1].data,"{viewer} {query}");
            assert_eq!(pages[0].complete,pages[1].complete);
            assert_eq!(pages[0].cut,pages[1].cut);
            assert_eq!(pages[0].next.is_some(),pages[1].next.is_some());
            // Compare every cursor field, translating only the physical copy id.
            let cursors: Vec<_> = pages.iter().zip([&self.recipe,&self.declared]).map(|(p,e)| p.next.as_ref().map(|token| {
                let mut c = snapback4_core::cursor::decode_cursor(e.schema(),token).unwrap();
                for (col,val) in c.suffix.iter().zip(&mut c.values) {
                    if col.name == "id" { *val = Value::Id("physical-copy".into()); }
                }
                c
            })).collect();
            assert_eq!(cursors[0],cursors[1]);
            all.extend(pages[0].data.as_array().unwrap().iter().cloned());
            if pages[0].next.is_none() { return all; }
            next = [pages[0].next.clone(),pages[1].next.clone()];
        }
        panic!("timeline did not terminate")
    }
}
