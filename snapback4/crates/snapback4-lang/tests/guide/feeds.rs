//! Execute the fresh-builder card itself, not a parallel example.
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::guide::{self, card, quarry};
use std::{collections::BTreeSet, path::Path};

fn id(s: &str) -> Value { Value::Id(s.into()) }
fn text(s: &str) -> Value { Value::String(s.into()) }
fn write(e: &mut Engine, serial: &mut i64, op: &str, viewer: &str, args: &[(&str, Value)]) -> Value {
    *serial += 1;
    let out = e.mutate(op, None, Context::new(viewer, args.iter().map(|(k,v)| (k.to_string(),v.clone())).collect())
        .at(*serial).with_ids([format!("event-{serial:06}")])).unwrap();
    match out.state {
        WriteState::Sent { result, .. } => result,
        _ => panic!("{op} by {viewer}: {out:?}"),
    }
}
fn pages(e: &mut Engine, viewer: &str) -> Vec<Value> {
    let mut cursor = Value::Null;
    let mut all = Vec::new();
    for _ in 0..100 {
        let page = e.query("following", Context::new(viewer, [("c".into(), cursor)].into()).at(100_000)).unwrap();
        assert!(page.complete && page.cut.is_none(), "{viewer}: {page:?}");
        let rows = page.data.as_array().unwrap();
        assert!(rows.len() <= 20);
        if page.next.is_some() { assert_eq!(rows.len(), 20); }
        for row in rows {
            assert_eq!(row.field("post").unwrap().field("id").unwrap(), row.field("postId").unwrap());
            assert_eq!(row.field("actor").unwrap().field("principal").unwrap(), row.field("actorId").unwrap());
            assert_eq!(row.field("author").unwrap().field("principal").unwrap(), row.field("authorId").unwrap());
        }
        all.extend(rows.iter().cloned());
        let Some(next) = page.next else {
            assert_eq!(all.iter().map(|r| r.field("id").unwrap().as_str().unwrap()).collect::<BTreeSet<_>>().len(), all.len());
            assert!(all.windows(2).all(|pair| {
                let key = |r: &Value| (r.field("at").unwrap().as_int().unwrap(), r.field("id").unwrap().as_str().unwrap().to_owned());
                key(&pair[0]) > key(&pair[1])
            }));
            return all;
        };
        cursor = text(&next);
    }
    panic!("pagination did not terminate")
}

#[test]
fn complete_feeds_program_runs_at_clique_size() {
    let source = quarry(card("feeds").unwrap()).remove(0);
    let (doc, errors) = snapback4_lang::parse_document("schema.q", &source);
    assert!(errors.is_empty());
    assert_eq!(doc.tables.len(), 4);
    assert!(doc.functions.is_empty() && doc.schedules.is_empty());
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{:?} {:?}", b.diagnostics, b.notes);
    assert_eq!(b.schema.timelines[0].author_cap, 1008);
    assert_eq!(b.schema.timelines[0].edge_cap, 5921);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let mut clock = 0;
    for n in 0..1008 { write(&mut e, &mut clock, "register", &format!("u{n:04}"), &[("name", text(&format!("User {n}")))]); }
    assert_eq!(e.store().rows("profiles").unwrap().len(), 1008);
    assert_eq!(e.store().rows("feedAuthors").unwrap().len(), 1008);
    let mut originals = Vec::new();
    for n in 0..25 { originals.push(write(&mut e, &mut clock, "post", "u0000", &[("body", text(&format!("Pushed {n}")))]).field("id").unwrap().clone()); }
    let outsider = write(&mut e, &mut clock, "post", "u0900", &[("body", text("Not followed"))]).field("id").unwrap().clone();
    // The brief's 500-follow reader; following backfills the existing events.
    for n in 0..500 { write(&mut e, &mut clock, "follow", "u1007", &[("authorId", id(&format!("u{n:04}")))]); }
    assert_eq!(pages(&mut e, "u1007").len(), 25);
    assert_eq!(pages(&mut e, "u1007").iter().map(|r| r.field("id").unwrap().clone()).collect::<Vec<_>>(), originals.iter().rev().cloned().collect::<Vec<_>>());
    for n in 1..50 { write(&mut e, &mut clock, "follow", &format!("u{n:04}"), &[("authorId", id("u0000"))]); }
    let promoted = |e: &Engine| e.store().rows("feedAuthors").unwrap().iter().find(|r| r.field("principal") == Ok(&id("u0000"))).unwrap().field("shared").unwrap().clone();
    assert_eq!(promoted(&e), Value::Bool(false)); // 50 followers
    write(&mut e, &mut clock, "follow", "u0050", &[("authorId", id("u0000"))]);
    assert_eq!(promoted(&e), Value::Bool(true)); // 51st follower
    let shared = write(&mut e, &mut clock, "post", "u0000", &[("body", text("Shared"))]).field("id").unwrap().clone();
    let boost = write(&mut e, &mut clock, "repost", "u0001", &[("postId", originals[0].clone())]);
    assert_ne!(boost, Value::Null);
    assert_eq!(write(&mut e, &mut clock, "repost", "u0001", &[("postId", originals[0].clone())]), Value::Null);
    let before = pages(&mut e, "u1007");
    assert_eq!(before.len(), 27);
    let repost = &before[0];
    assert_eq!(repost.field("repost").unwrap(), &Value::Bool(true));
    assert_eq!(repost.field("actorId").unwrap(), &id("u0001"));
    assert_eq!(repost.field("authorId").unwrap(), &id("u0000"));
    assert_ne!(repost.field("id").unwrap(), &originals[0]);
    assert_eq!(before[1].field("id").unwrap(), &shared);
    assert!(!before.iter().any(|r| r.field("id") == Ok(&outsider)));
    write(&mut e, &mut clock, "remove", "u0000", &[("postId", originals[0].clone())]);
    let after = pages(&mut e, "u1007");
    assert_eq!(after.len(), 26);
    assert!(!after.iter().any(|r| r.field("id") == Ok(&originals[0])));
    assert_eq!(after[0].field("id").unwrap(), repost.field("id").unwrap());
    assert_eq!(after[0].field("post").unwrap().field("removed").unwrap(), &Value::Bool(true));
    // Unfollow drops all of that actor's history, while the other actor's repost survives.
    write(&mut e, &mut clock, "unfollow", "u1007", &[("authorId", id("u0000"))]);
    assert_eq!(pages(&mut e, "u1007").len(), 1);
    assert_eq!(pages(&mut e, "u0000").len(), 25); // implicit own membership
    for n in 1..=50 { write(&mut e, &mut clock, "unfollow", &format!("u{n:04}"), &[("authorId", id("u0000"))]); }
    assert_eq!(promoted(&e), Value::Bool(true));
    write(&mut e, &mut clock, "follow", "u0900", &[("authorId", id("u0000"))]);
    assert_eq!(pages(&mut e, "u0900").len(), 26); // own event + pushed history + shared
    write(&mut e, &mut clock, "unrepost", "u0001", &[("postId", originals[0].clone())]);
    assert!(pages(&mut e, "u1007").is_empty());
}

fn without_existing_apps(text: &str) -> String {
    let mut existing = false;
    text.lines().filter(|line| {
        if line.starts_with("## ") { existing = *line == "## Existing apps with an installed recipe"; }
        !existing
    }).collect::<Vec<_>>().join("\n")
}
fn census(label: &str, source: &str) {
    let text = without_existing_apps(source);
    assert!(!text.contains("--recipe"), "{label}: retired installer");
    // Use the library's own declaration names, covering every helper and owned table.
    let (recipe, errors) = snapback4_lang::parse_document("feed.q", include_str!("../../src/recipe/following.q"));
    assert!(errors.is_empty());
    for helper in recipe.functions.iter().map(|f| &f.name).chain(recipe.programs.iter().map(|p| &p.name)) {
        let name = snapback4_lang::recipe::prefixed_name("feed", helper);
        assert!(!text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| word == name), "{label}: helper {name}");
    }
    for helper in ["feedAppRegister", "feedAppPublish", "feedAppRemove", "feedAppRepost", "feedAppUnrepost", "feedAppFollow", "feedAppUnfollow"] {
        assert!(!text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| word == helper), "{label}: bridge helper {helper}");
    }
    for table in &recipe.tables {
        for name in [table.name.clone(), snapback4_lang::recipe::prefixed_name("feed", &table.name)] {
            // posts/follows are application inputs too; their event/projection shape is checked below.
            if matches!(name.as_str(), "posts" | "follows") { continue; }
            assert!(!text.contains(&format!("table {name}:")), "{label}: projection {name}");
        }
    }
    for source in quarry(&text) {
        let (doc, errors) = snapback4_lang::parse_document("card.q", &source);
        assert!(errors.is_empty(), "{label}: {errors:?}");
        for table in doc.tables {
            assert!(!table.columns.iter().any(|c| c.name == "eventId") || !table.columns.iter().any(|c| c.name == "readerId"), "{label}: renamed private feed projection {}", table.name);
        }
    }
}

#[test]
fn cards_readmes_and_templates_do_not_teach_the_retired_recipe() {
    for name in guide::KEYWORDS { census(name, card(name).unwrap()); }
    assert_eq!(card("timelines"), card("feeds"));
    assert_eq!(card("timeline"), card("feeds"));
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    fn readmes(path: &Path) {
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_str().unwrap();
            if ["node_modules", "target", ".git", "dist", "build", ".expo"].contains(&name) || path.is_symlink() { continue; }
            if path.is_dir() { readmes(&path); }
            else if name == "README.md" { census(&path.display().to_string(), &std::fs::read_to_string(path).unwrap()); }
        }
    }
    readmes(&root.join("packages"));
    readmes(&root.join("apps"));
    for path in ["README.md", "packages/snapback4/CLIENT-AND-OPERATIONS.md", "packages/snapback4/SERVER.md", "crates/snapback4-lang/src/guide/templates.rs", "crates/snapback4/src/verbs/init.rs", "crates/snapback4/src/verbs/init/web.rs"] {
        census(path, &std::fs::read_to_string(root.join(path)).unwrap());
    }
    // Follow the CLI's actual embedded templates, including their Quarry/TS source.
    for name in ["crates/snapback4/src/verbs/init.rs", "crates/snapback4/src/verbs/init/web.rs"] {
        let path = root.join(name);
        let source = std::fs::read_to_string(&path).unwrap();
        for include in source.split("include_str!(\"").skip(1) {
            let relative = include.split_once('"').unwrap().0;
            let file = path.parent().unwrap().join(relative);
            census(&file.display().to_string(), &std::fs::read_to_string(&file).unwrap());
        }
    }
    census("default template", guide::TEMPLATE);
    census("online template", guide::TEMPLATE_ONLINE);
}
