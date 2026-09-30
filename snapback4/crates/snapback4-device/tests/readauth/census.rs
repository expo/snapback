//! Enumerate the actual compiled authoring corpus, including inlined helpers.
#[path = "../../../snapback4-lang/tests/guide/context.rs"]
mod guide_context;
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
        let predicts=b.schema.operations[&p.name].predicts.as_deref().unwrap_or("eligible");
        seen.insert(format!("{label}:{} | {predicts}",p.name));
        if predicts=="never" {continue;}
        // Bound IR includes inlined helpers, branches and loops. This is a
        // syntactic write-site inventory, not a claim about surviving rows.
        let mut writes: BTreeSet<(String,String)>=ir::write_tables(p).into_iter().map(|(t,e)|(t.to_owned(),e.to_owned())).collect();
        loop {
            let prior=writes.len();
            for maintain in &b.schema.maintains {
                if writes.iter().any(|(t,_)|t==&maintain.source) { writes.insert((maintain.target.clone(),"maintain".into())); }
            }
            if writes.len()==prior {break;}
        }
        for (table,effect) in writes {
            let t=&b.schema.tables[&table];
            if effect=="delete" || t.rules.read.is_uniformly_readable() {continue;}
            private.insert(format!("{}/{table}/{effect}",p.name));
            let rule=serde_json::to_string(&t.rules.read).unwrap();
            seen.insert(format!("{label}:{} | {table}/{effect} | {rule} | read rule",p.name));
        }
    }
}
#[test]
fn authoring_census() {
    let mut seen = BTreeSet::new();
    let mut private = BTreeSet::new();
    for name in guide::KEYWORDS {
        for (n, block) in guide::quarry(guide::card(name).unwrap()).iter().enumerate() {
            let source = guide_context::source(block);
            collect(&format!("card/{name}/{}",n+1),vec![("schema.q".into(),source)],&mut seen,&mut private);
        }
    }
    for (name,source) in [("template/local",guide::TEMPLATE),("template/online",guide::TEMPLATE_ONLINE),
        ("apps/chat (Expo/web init source)",include_str!("../../../../apps/chat/snapback/schema.q"))] {
        collect(name,vec![("schema.q".into(),source.into())],&mut seen,&mut private);
    }
    for (name,doc) in [("README",include_str!("../../../../packages/snapback4/README.md")),
        ("CLIENT-AND-OPERATIONS",include_str!("../../../../packages/snapback4/CLIENT-AND-OPERATIONS.md")),
        ("SERVER",include_str!("../../../../packages/snapback4/SERVER.md"))] {
        for (n,block) in guide::quarry(doc).iter().enumerate() {
            let source = guide_context::source(block);
            collect(&format!("package/{name}/{}",n+1),vec![("schema.q".into(),source)],&mut seen,&mut private);
        }
    }
    let recipe = snapback4_lang::recipe::following("feed","feed").unwrap();
    let adoption_blocks=guide::quarry(include_str!("../../../../packages/snapback4/FOLLOWING-ADOPTION.md"));
    assert_eq!(adoption_blocks.len(),1,"pair new adoption fragments with their example program");
    for (n,adoption) in adoption_blocks.into_iter().enumerate() {
        collect(&format!("recipe/installed/{}",n+1),vec![("feed.q".into(),recipe.clone()),("social.q".into(),adoption)],&mut seen,&mut private);
    }
    collect("recipe/standalone",vec![("schema.q".into(),snapback4_lang::recipe::following("", "").unwrap())],&mut seen,&mut private);
    inspect("recipe/generated-bridge",&installed_bridge(),&mut seen,&mut private);
    let occurrences=seen.iter().filter(|s|!s.ends_with(" | read rule")).count();
    println!("CENSUS {occurrences} mutation occurrences; {} distinct private write sites: {private:#?}",private.len());
    for item in &seen {println!("CENSUS_ITEM {item}");}
    let expected: BTreeSet<String>=include_str!("census.txt").lines().map(str::to_owned).collect();
    assert_eq!(seen,expected,"review corpus membership, read rules and outcomes.rs together");
}

// The preserved generated bridge has fn helpers rather than public operations.
// These two wrappers are the existing backfill verbs from tests/feed_bridge.rs.
pub(super) fn installed_bridge() -> Bound {
    let original = guide::quarry(include_str!("../../../../packages/snapback4/FOLLOWING-ADOPTION.md")).into_iter()
        .find(|b| b.starts_with("-- Existing installed feed module;")).unwrap();
    let app=original;
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
