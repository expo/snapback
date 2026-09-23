//! Enumerate the actual compiled authoring corpus, including inlined helpers.
use snapback4_core::{ProgramKind, ir};
use snapback4_lang::{Bound, guide};
use std::collections::BTreeSet;

fn collect(label: &str, sources: Vec<(String,String)>, seen: &mut BTreeSet<String>, private: &mut BTreeSet<String>) {
    let b = snapback4_lang::compile(&sources);
    assert!(b.diagnostics.is_empty(),"{label}: {:?}",b.diagnostics);
    inspect(label,&b,seen,private);
}
fn inspect(label: &str, b: &Bound, seen: &mut BTreeSet<String>, private: &mut BTreeSet<String>) {
    for p in &b.programs {
        let p = &p.program;
        if p.kind != ProgramKind::Mutation { continue; }
        let key = format!("{label}:{}",p.name);
        seen.insert(key.clone());
        if b.schema.operations[&p.name].predicts.as_deref() == Some("never") { continue; }
        let writes = ir::write_tables(p).into_iter().filter(|(t,e)| *e != "delete" && !b.schema.tables[t].rules.read.is_uniformly_readable()).collect::<Vec<_>>();
        for (table,effect) in writes { private.insert(format!("{}/{table}/{effect}",p.name)); }
        for maintain in &b.schema.maintains {
            let target=&b.schema.tables[&maintain.target];
            if target.sync.is_some() && !target.rules.read.is_uniformly_readable() {
                assert_eq!(target.rules.read,b.schema.tables[&maintain.source].rules.read,"{label}: review changed maintained read authority");
            }
        }
    }
}
#[test]
fn authoring_census() {
    let mut seen = BTreeSet::new();
    let mut private = BTreeSet::new();
    for name in guide::KEYWORDS {
        for (n, block) in guide::quarry(guide::card(name).unwrap()).iter().enumerate() {
            let source = if block.lines().any(|s|s.starts_with("table ")) {block.clone()} else {format!("{}\n{block}",guide::language())};
            collect(&format!("card/{name}/{}",n+1),vec![("schema.q".into(),source)],&mut seen,&mut private);
        }
    }
    for (name,source) in [("template/local",guide::TEMPLATE),("template/online",guide::TEMPLATE_ONLINE),
        ("apps/chat+chat-expo",include_str!("../../../../apps/chat/snapback/schema.q"))] {
        collect(name,vec![("schema.q".into(),source.into())],&mut seen,&mut private);
    }
    for (name,doc) in [("README",include_str!("../../../../packages/snapback4/README.md")),
        ("CLIENT-AND-OPERATIONS",include_str!("../../../../packages/snapback4/CLIENT-AND-OPERATIONS.md")),
        ("SERVER",include_str!("../../../../packages/snapback4/SERVER.md"))] {
        for (n,block) in guide::quarry(doc).iter().enumerate() {
            let source = if block.lines().any(|s|s.starts_with("table ")) {block.clone()} else {format!("{}\n{block}",guide::language())};
            collect(&format!("package/{name}/{}",n+1),vec![("schema.q".into(),source)],&mut seen,&mut private);
        }
    }
    let recipe = snapback4_lang::recipe::following("feed","feed").unwrap();
    let adoption = guide::quarry(include_str!("../../../snapback4-lang/src/recipe/ADOPTION.md")).into_iter().find(|b| b.starts_with("-- Existing installed feed module;")).unwrap();
    collect("recipe/installed",vec![("feed.q".into(),recipe),("social.q".into(),adoption)],&mut seen,&mut private);
    collect("recipe/standalone",vec![("schema.q".into(),snapback4_lang::recipe::following("", "").unwrap())],&mut seen,&mut private);
    inspect("recipe/generated-bridge",&installed_bridge(),&mut seen,&mut private);
    println!("CENSUS {} mutation occurrences; private writes: {private:#?}",seen.len());
    assert_eq!(seen.len(),297,"review the corpus census when authoring examples change");
    let expected: BTreeSet<_> = [
    "add/todos/insert",
    "addMember/memberships/insert",
    "createPost/feed/insert",
    "repost/feed/insert",
    "social.publishExisting/feedFeed/insert",
    "social.repostExisting/feedFeed/insert",
    "createRoom/members/insert",
    "createRoom/rooms/insert",
    "createRoom/rooms/upsert",
    "edit/messages/update",
    "guardedLike/likes/insert",
    "guardedPost/notes/insert",
    "join/members/insert",
    "like/likes/insert",
    "markSeen/seen/insert",
    "notifyPost/notes/insert",
    "placeAvatar/profiles/update",
    "post/notes/insert",
    "postStory/stories/insert",
    "programWrites/rooms/update",
    "react/reactions/upsert",
    "saveDraft/drafts/update",
    "send/messages/insert",
    "sendBrief/messages/insert",
    "sendClip/clips/insert",
    "sendPhoto/messages/insert",
    "setAffinity/affinity/upsert",
    "setLike/likes/insert",
    "setTyping/typing/upsert",
    "social.createPost/feedFeed/insert",
    "social.repost/feedFeed/insert",
    "toggle/todos/update",
    "vote/votes/upsert",
    "writeForms/messages/insert",
    "writeForms/messages/update",
    "writeForms/reactions/insert",
    "writeForms/reactions/upsert",
    ].into_iter().map(str::to_owned).collect();
    assert_eq!(private,expected,"review every changed private write site and extend outcomes.rs when a call outcome changes");
}

// The preserved generated bridge has fn helpers rather than public operations.
// These two wrappers are the existing backfill verbs from tests/feed_bridge.rs.
pub(super) fn installed_bridge() -> Bound {
    let app = guide::quarry(include_str!("../../../snapback4-lang/src/recipe/ADOPTION.md")).into_iter()
        .find(|b| b.starts_with("-- Existing installed feed module;")).unwrap()
        .replace("  name: text <=100", "  name: text <=100\n  immutable principal");
    let mut sources=vec![("feed.q".into(),snapback4_lang::recipe::following("feed","feed").unwrap()),("social.q".into(),app)];
    let base=snapback4_lang::compile(&sources);
    assert!(base.diagnostics.is_empty(),"{:?}",base.diagnostics);
    let mapping=snapback4_lang::recipe::bridge::Mapping::parse("profiles:principal","posts:authorId:at","follows:followerId:followedId","reposts:actorId:postId:at").unwrap();
    sources.push(("feed_bridge.q".into(),mapping.render(&base.schema,"feed").unwrap()));
    sources[1].1.push_str("\nmutation publishExisting(postId: posts):\n  return feedAppPublish(postId)\nmutation repostExisting(repostId: reposts):\n  return feedAppRepost(repostId)\n");
    let bound=snapback4_lang::compile(&sources);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    bound
}
