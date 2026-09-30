//! Execute current guide examples and preserve historical feed controls.
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::guide::{self, card, quarry};
use std::{collections::BTreeSet, path::Path};
#[path = "feeds_followups.rs"]
mod followups;

fn id(s: &str) -> Value { Value::Id(s.into()) }
fn text(s: &str) -> Value { Value::String(s.into()) }

#[test]
fn builder_path_precedes_internals_and_older_spellings() {
    let card = card("feeds").unwrap();
    let headings = card.lines().filter_map(|line| line.strip_prefix("## ")).collect::<Vec<_>>();
    assert_eq!(headings, ["Reference", "Global: a union view", "Following: a view for the reader", "Trending: a bounded predicate read", "Following contract", "Boundaries and refusals", "How it works", "Older spellings that still compile (do not use in new apps)"]);
    let (current, older) = card.split_once("## Older spellings").unwrap();
    for spelling in ["maintain ", "recipe", "bridge", "promotion", "size authors", "by by", "unique by"] {
        assert!(!current.contains(spelling), "current path teaches {spelling}");
    }
    let builder = current.split_once("## How it works").unwrap().0;
    for detail in ["edge epoch", "write ordinal", "Transaction sequence", "tombstone", "chunks of 256"] {
        assert!(!builder.contains(detail), "builder path teaches {detail}");
    }
    assert!(older.contains("maintain oldFeed: timeline"));
}

#[test]
fn owner_key_sign_out_preserves_the_replica_without_lending_its_proof() {
    let feeds = card("feeds").unwrap();
    assert!(feeds.contains("Sign-out preserves the replica and the owner's proof"));
    assert!(feeds.contains("same principal"));
    assert!(feeds.contains("A different caller cannot use that partition's proof"));
    assert!(!feeds.contains("Sign-out clears keys and coverage together"));
}

fn following_pages(e: &mut Engine, viewer: &str) -> (Vec<Value>, bool) {
    let mut cursor = Value::Null;
    let mut rows = Vec::new();
    let mut complete = true;
    for _ in 0..100 {
        let page = e.query("home", Context::new(viewer, [("c".into(), cursor)].into()).at(100_000)).unwrap();
        assert!(page.cut.is_none(), "{page:?}");
        complete &= page.complete;
        rows.extend(page.data.as_array().unwrap().iter().cloned());
        let Some(next) = page.next else { return (rows, complete) };
        cursor = text(&next);
    }
    panic!("Following did not exhaust")
}

fn published_following() -> Engine {
    let source = quarry(card("feeds").unwrap()).into_iter().find(|s| s.contains("view following:")).unwrap();
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{:?} {:?}", b.diagnostics, b.notes);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}

#[test]
fn published_following_matches_the_builder_contract() {
    let mut e = published_following();
    let mut clock = 0;
    for n in 1..1005 {
        // The last two originals tie on event time; event id must break the tie.
        if n == 1004 { clock -= 1; }
        write(&mut e, &mut clock, "post", "alice", &[("postId", id(&format!("p{n:04}"))), ("parentId", Value::Null)]);
    }
    // The smallest id is the newest event: id-only ordering must not pass.
    write(&mut e, &mut clock, "post", "alice", &[("postId", id("p0000")), ("parentId", Value::Null)]);
    write(&mut e, &mut clock, "post", "alice", &[("postId", id("reply")), ("parentId", id("p1004"))]);
    let own = following_pages(&mut e, "alice").0;
    assert_eq!(own.len(), 1005, "own originals appear immediately; replies do not");
    assert_eq!(own[0].field("id").unwrap(), &id("p0000"), "event time precedes the id tiebreak");
    assert!(own[0].field("at").unwrap().as_int().unwrap() > own[1].field("at").unwrap().as_int().unwrap());
    for (row, n) in own.iter().zip(std::iter::once(0).chain((1..1005).rev())) {
        assert_eq!(row.field("id").unwrap(), &id(&format!("p{n:04}")));
        assert_eq!(row.field("post").unwrap(), row.field("id").unwrap());
        assert_eq!(row.field("actor").unwrap(), &id("alice"));
        assert_eq!(row.field("repost").unwrap(), &Value::Bool(false));
    }
    assert_eq!(own[1].field("at").unwrap(), own[2].field("at").unwrap());
    write(&mut e, &mut clock, "follow", "bob", &[("actor", id("alice"))]);
    let (immediate, complete) = following_pages(&mut e, "bob");
    assert_eq!(immediate, own[..50], "follow installs the newest 50 immediately");
    assert!(!complete, "the remaining backfill is pending");
    while e.run_timeline_chunk(clock + 1).unwrap().is_some() {}
    let (delivered, complete) = following_pages(&mut e, "bob");
    assert!(complete);
    assert_eq!(delivered.len(), 1000, "the history window stops at 1,000, not all older posts");
    assert_eq!(delivered, own[..1000], "backfill preserves newest-first event order including ties");
    for viewer in ["alice", "bob"] {
        assert!(!following_pages(&mut e, viewer).0.iter().any(|row| row.field("post") == Ok(&id("reply"))), "{viewer}: replies stay out after delivery");
    }
    assert_eq!(e.store().rows("posts").unwrap().len(), 1006, "the window does not delete older posts or replies");
    write(&mut e, &mut clock, "post", "alice", &[("postId", id("new")), ("parentId", Value::Null)]);
    assert_eq!(following_pages(&mut e, "alice").0[0].field("id").unwrap(), &id("new"));
    assert_eq!(following_pages(&mut e, "bob"), (delivered, true), "complete describes delivered contents, not pending event delivery");
    while e.run_timeline_chunk(clock + 1).unwrap().is_some() {}
    assert_eq!(following_pages(&mut e, "bob").0[0].field("id").unwrap(), &id("new"));
    let refused = e.mutate("remove", None, Context::new("bob", [("postId".into(), id("new"))].into()).at(clock + 1)).unwrap();
    assert!(matches!(refused.state, WriteState::Failed { ref why, .. } if why.code == "E_RULE"), "{refused:?}");
    write(&mut e, &mut clock, "remove", "alice", &[("postId", id("new"))]);
    assert!(!following_pages(&mut e, "bob").0.iter().any(|r| r.field("id") == Ok(&id("new"))), "removal hides before cleanup");
    write(&mut e, &mut clock, "unfollow", "bob", &[("actor", id("alice"))]);
    assert!(following_pages(&mut e, "bob").0.is_empty(), "unfollow hides on the next read");
}

#[test]
fn published_following_unrepost_hides_the_delivered_event() {
    let mut e = published_following();
    let mut clock = 0;
    write(&mut e, &mut clock, "post", "alice", &[("postId", id("original")), ("parentId", Value::Null)]);
    write(&mut e, &mut clock, "follow", "bob", &[("actor", id("alice"))]);
    write(&mut e, &mut clock, "repost", "alice", &[("postId", id("original"))]);
    while e.run_timeline_chunk(clock + 1).unwrap().is_some() {}
    let event_id = following_pages(&mut e, "alice").0[0].field("id").unwrap().clone();
    assert_ne!(event_id, id("original"));
    for viewer in ["alice", "bob"] {
        let (rows, complete) = following_pages(&mut e, viewer);
        assert!(complete);
        assert_eq!(rows.len(), 2, "{viewer}: original and delivered repost");
        assert_eq!(rows[0].field("id").unwrap(), &event_id);
        assert_eq!(rows[0].field("post").unwrap(), &id("original"));
        assert_eq!(rows[0].field("actor").unwrap(), &id("alice"));
        assert_eq!(rows[0].field("repost").unwrap(), &Value::Bool(true));
    }
    write(&mut e, &mut clock, "unrepost", "alice", &[("postId", id("original"))]);
    for viewer in ["alice", "bob"] {
        let rows = following_pages(&mut e, viewer).0;
        assert_eq!(rows.len(), 1, "{viewer}: unrepost hides before cleanup");
        assert_eq!(rows[0].field("id").unwrap(), &id("original"));
        assert_eq!(rows[0].field("repost").unwrap(), &Value::Bool(false));
    }
    while e.run_timeline_chunk(clock + 1).unwrap().is_some() {}
    for viewer in ["alice", "bob"] {
        let (rows, complete) = following_pages(&mut e, viewer);
        assert!(complete);
        assert_eq!(rows.len(), 1, "{viewer}: cleanup does not restore the repost");
        assert_eq!(rows[0].field("id").unwrap(), &id("original"));
    }
}

#[test]
fn published_following_unrepost_uses_the_reposting_viewer() {
    let mut e = published_following();
    let mut clock = 0;
    write(&mut e, &mut clock, "post", "alice", &[("postId", id("original")), ("parentId", Value::Null)]);
    for viewer in ["bob", "carol"] {
        write(&mut e, &mut clock, "follow", viewer, &[("actor", id("alice"))]);
    }
    write(&mut e, &mut clock, "follow", "carol", &[("actor", id("bob"))]);
    write(&mut e, &mut clock, "repost", "bob", &[("postId", id("original"))]);
    assert_eq!(following_pages(&mut e, "carol").0.len(), 1, "the repost is awaiting delivery");
    while e.run_timeline_chunk(clock + 1).unwrap().is_some() {}
    let event_id = following_pages(&mut e, "bob").0[0].field("id").unwrap().clone();
    assert_ne!(event_id, id("original"));
    for viewer in ["bob", "carol"] {
        let (rows, complete) = following_pages(&mut e, viewer);
        assert!(complete);
        assert_eq!(rows.len(), 2, "{viewer}: Alice's original and Bob's delivered repost");
        assert_eq!(rows[0].field("id").unwrap(), &event_id);
        assert_eq!(rows[0].field("post").unwrap(), &id("original"));
        assert_eq!(rows[0].field("actor").unwrap(), &id("bob"));
        assert_eq!(rows[0].field("repost").unwrap(), &Value::Bool(true));
    }
    write(&mut e, &mut clock, "unrepost", "bob", &[("postId", id("original"))]);
    for after_cleanup in [false, true] {
        if after_cleanup { while e.run_timeline_chunk(clock + 1).unwrap().is_some() {} }
        for viewer in ["alice", "bob", "carol"] {
            let (rows, complete) = following_pages(&mut e, viewer);
            if after_cleanup { assert!(complete); }
            assert_eq!(rows.len(), 1, "{viewer}: Bob's unrepost hides his event; cleanup={after_cleanup}");
            assert_eq!(rows[0].field("id").unwrap(), &id("original"));
            assert_eq!(rows[0].field("actor").unwrap(), &id("alice"));
            assert_eq!(rows[0].field("repost").unwrap(), &Value::Bool(false));
        }
    }
    assert!(e.store().rows("reposts").unwrap().is_empty());
    assert_eq!(e.store().rows("posts").unwrap().len(), 1, "the original source row survives");
}

pub(super) fn assert_stream_note(b: &snapback4_lang::Bound) {
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(b.notes.len(), 1, "{:?}", b.notes);
    let note = &b.notes[0];
    assert_eq!((note.code.as_str(), note.guide.as_str()), ("N_MAINTAINED_COLUMN_STREAM", "maintains"));
    assert_eq!(note.message, "posts: each contributing commit logs and streams the whole parent image per destination partition, coalesced once per row; a 4,000-byte parent costs every holder about 4 KB per change");
    assert!(card("feeds").unwrap().contains("N_MAINTAINED_COLUMN_STREAM warns that each contributing commit streams"));
}
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
fn legacy_complete_feeds_program_runs_at_clique_size() {
    let source = quarry(include_str!("../fixtures/legacy-feed-recipes.md")).remove(1);
    let (doc, errors) = snapback4_lang::parse_document("schema.q", &source);
    assert!(errors.is_empty());
    assert_eq!(doc.tables.len(), 7);
    assert!(doc.functions.is_empty() && doc.schedules.is_empty());
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert_stream_note(&b);
    assert_eq!(b.schema.timelines.len(), 1);
    assert_eq!(b.schema.timelines[0].name, "feed");
    assert_eq!(b.schema.timelines[0].version, 2);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let mut clock = 0;
    for n in 0..1008 { write(&mut e, &mut clock, "register", &format!("u{n:04}"), &[("name", text(&format!("User {n}")))]); }
    assert_eq!(e.store().rows("profiles").unwrap().len(), 1008);
    assert!(!e.schema().tables.contains_key("feedAuthors"));
    let mut originals = Vec::new();
    for n in 0..25 { originals.push(write(&mut e, &mut clock, "post", "u0000", &[("body", text(&format!("Pushed {n}")))]).field("id").unwrap().clone()); }
    let outsider = write(&mut e, &mut clock, "post", "u0900", &[("body", text("Not followed"))]).field("id").unwrap().clone();
    // The brief's 500-follow reader; following backfills the existing events.
    for n in 0..500 { write(&mut e, &mut clock, "follow", "u1007", &[("authorId", id(&format!("u{n:04}")))]); }
    assert_eq!(pages(&mut e, "u1007").len(), 25);
    assert_eq!(pages(&mut e, "u1007").iter().map(|r| r.field("id").unwrap().clone()).collect::<Vec<_>>(), originals.iter().rev().cloned().collect::<Vec<_>>());
    // Public threads are separate from events, even for the author and a follower.
    let viewers = ["u0000", "u1007", "u0900"];
    let before_replies = viewers.map(|viewer| pages(&mut e, viewer));
    let events = e.store().rows("feedPosts").unwrap();
    let mut replies = Vec::new();
    for body in ["First reply", "Second reply"] {
        replies.push(write(&mut e, &mut clock, "reply", "u0000", &[("postId", originals[0].clone()), ("body", text(body))]));
    }
    write(&mut e, &mut clock, "reply", "u0900", &[("postId", outsider.clone()), ("body", text("Another thread"))]);
    for (viewer, before) in viewers.into_iter().zip(before_replies) {
        let thread = e.query("thread", Context::new(viewer, [("postId".into(), originals[0].clone()), ("c".into(), Value::Null)].into()).at(clock)).unwrap();
        assert!(thread.complete && thread.cut.is_none() && thread.next.is_none(), "{thread:?}");
        assert_eq!(thread.data.as_array().unwrap(), &replies, "{viewer}: direct replies in chronological order");
        assert_eq!(pages(&mut e, viewer), before, "{viewer}: replies must not enter Following");
    }
    assert_eq!(e.store().rows("feedPosts").unwrap(), events, "replies create no timeline events");
    assert_eq!(e.store().rows("replies").unwrap().len(), 3);
    for n in 1..50 { write(&mut e, &mut clock, "follow", &format!("u{n:04}"), &[("authorId", id("u0000"))]); }
    write(&mut e, &mut clock, "follow", "u0050", &[("authorId", id("u0000"))]);
    let shared = write(&mut e, &mut clock, "post", "u0000", &[("body", text("Shared"))]).field("id").unwrap().clone();
    let boost = write(&mut e, &mut clock, "repost", "u0001", &[("postId", originals[0].clone())]);
    assert_ne!(boost, Value::Null);
    assert_eq!(write(&mut e, &mut clock, "repost", "u0001", &[("postId", originals[0].clone())]), Value::Null);
    while e.run_timeline_chunk(clock).unwrap().is_some() {}
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
    let remaining = pages(&mut e, "u1007");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].field("id").unwrap(), repost.field("id").unwrap());
    assert_eq!(pages(&mut e, "u0000").len(), 25); // implicit own membership
    for n in 1..=50 { write(&mut e, &mut clock, "unfollow", &format!("u{n:04}"), &[("authorId", id("u0000"))]); }
    write(&mut e, &mut clock, "follow", "u0900", &[("authorId", id("u0000"))]);
    assert_eq!(pages(&mut e, "u0900").len(), 26); // own event + pushed history + shared
    write(&mut e, &mut clock, "unrepost", "u0001", &[("postId", originals[0].clone())]);
    assert!(pages(&mut e, "u1007").is_empty());
}

fn without_older_spellings(text: &str) -> String {
    let mut existing = false;
    let mut fence = None;
    text.lines().filter(|line| {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let marker = &trimmed[..3];
            if fence == Some(marker) { fence = None; }
            else if fence.is_none() { fence = Some(marker); }
        } else if fence.is_none() {
            let level = trimmed.chars().take_while(|c| *c == '#').count();
            if (1..=2).contains(&level) && trimmed.as_bytes().get(level) == Some(&b' ') {
                let title = trimmed[level..].trim().trim_end_matches('#').trim_end();
                existing = level == 2 && title == "Older spellings that still compile (do not use in new apps)";
            }
        }
        !existing
    }).collect::<Vec<_>>().join("\n")
}
fn census(label: &str, source: &str) {
    // Only the feeds Markdown card owns the compatibility exemption; Rust literals do not.
    let text = if source.starts_with("# Feeds:") { without_older_spellings(source) } else { source.to_owned() };
    assert!(!text.contains("--recipe"), "{label}: retired installer");
    // Use the library's own declaration names, covering every helper and owned table.
    let (recipe, errors) = snapback4_lang::parse_document("feed.q", include_str!("../../src/recipe/following.q"));
    assert!(errors.is_empty());
    for helper in recipe.functions.iter().map(|f| &f.name).chain(recipe.programs.iter().map(|p| &p.name)) {
        let name = snapback4_lang::recipe::prefixed_name("feed", helper);
        assert!(!text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| word == name), "{label}: helper {name}");
    }
    for helper in ["feedAppRegister", "feedAppPublish", "feedAppRemove", "feedAppRepost", "feedAppUnrepost", "feedAppFollow", "feedAppUnfollow"] {
        assert!(!text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| word.ends_with(&helper[4..])), "{label}: bridge helper {helper}");
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
            for original in &recipe.tables {
                if matches!(original.name.as_str(), "posts" | "follows") { continue; }
                assert!(table.name != original.name && table.name != snapback4_lang::recipe::prefixed_name("feed", &original.name), "{label}: projection {}", table.name);
            }
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
    readmes(&root.join("crates"));
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

#[test]
fn retirement_census_rejects_installers_helpers_and_projection_examples() {
    for source in ["Run init --recipe feeds", "Call feedAppPublish(post)", "Call myAppFollow(author)",
        "```quarry\ntable feedAuthors :\n  principal: principal\n```",
        "```quarry\ntable posts:\n  eventId: id\n  readerId: principal\n```",
        "const TEMPLATE: &str = r#\"\n## Older spellings that still compile (do not use in new apps)\nRun init --recipe feeds\n\"#;"] {
        assert!(std::panic::catch_unwind(|| census("negative fixture", source)).is_err(), "census missed {source}");
    }
}

#[test]
fn older_spelling_exemption_respects_headings_and_fenced_samples() {
    let section = "  ## Older spellings that still compile (do not use in new apps) ##\nlegacy\n# New apps\nnew\n";
    assert_eq!(without_older_spellings(section), "# New apps\nnew");
    let sample = "```text\n## Older spellings that still compile (do not use in new apps)\n```\nnew";
    assert_eq!(without_older_spellings(sample), sample);
}

#[test]
fn refusal_and_usage_sources_do_not_recommend_the_retired_installer() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    fn scan(path: &Path) {
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() { scan(&path); }
            else if matches!(path.extension().and_then(|ext| ext.to_str()), Some("rs" | "md" | "q" | "js" | "mjs" | "ts")) {
                let source = std::fs::read_to_string(&path).unwrap();
                // Includes stderr emitters in main/verbs and compiler diagnostic rewrites.
                let words = source.replace("\\n", " ").split_whitespace().collect::<Vec<_>>().join(" ");
                assert!(!words.contains("init --recipe feeds"), "{} recommends the retired installer", path.display());
            }
        }
    }
    for path in ["crates/snapback4/src", "crates/snapback4-lang/src", "crates/snapback4-core/src", "crates/snapback4-device/src", "packages/snapback4/bin"] {
        scan(&root.join(path));
    }
}
