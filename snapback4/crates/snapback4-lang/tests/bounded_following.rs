//! Acquisition choices do not relax materialized Following's source authority.
use snapback4_core::schema::{timeline::HISTORY_WINDOW, Audience, SiteClass};

const SOURCE: &str = include_str!("fixtures/following-view.q");
fn source(posts: &str, reposts: &str) -> String {
    SOURCE.replacen("sync public", posts, 1)
        .replace("  sync public\n\ntable follows", &format!("  {reposts}\n\ntable follows"))
}
fn compile(source: &str) -> snapback4_lang::Bound {
    snapback4_lang::compile(&[("bounded.q".into(), source.into())])
}

#[test]
fn acquisition_combinations_preserve_event_log_and_private_inbox_floor() {
    for posts in ["sync public", "sync public last 40 by .at", "online only"] {
        for reposts in ["sync public", "sync public last 7 by .at", "online only"] {
            let bound = compile(&source(posts, reposts));
            assert!(bound.diagnostics.is_empty(), "{posts}/{reposts}: {:?}", bound.diagnostics);
            assert!(bound.notes.is_empty(), "{:?}", bound.notes);
            let tables = &bound.schema.tables;
            let inbox = tables["feedFeed"].sync.as_ref().unwrap();
            assert_eq!(inbox.audience, Audience::Column("readerId".into()));
            let floor = inbox.horizon.as_ref().unwrap();
            assert_eq!(floor.last, HISTORY_WINDOW as u32);
            assert_eq!(floor.by, "byReaderPage");
            for table in ["feedPosts", "follows", "feedRemovedEvents"] {
                let sync = tables[table].sync.as_ref().unwrap();
                assert_eq!(sync.audience, Audience::Public);
                assert!(sync.horizon.is_none());
            }
            let original = bound.schema.operations["bounded.repost"].sites.iter().find(|site|
                site.kind == "timeline transition" && site.table == "posts").unwrap();
            assert_eq!(original.class, match posts {
                "online only" => SiteClass::Server,
                "sync public" => SiteClass::Held,
                _ => SiteClass::Horizon,
            });
            for table in ["feedRemovedEvents"] {
                assert!(bound.schema.operations["bounded.repost"].sites.iter().any(|site|
                    site.kind == "timeline transition" && site.table == table && site.class == SiteClass::Held));
            }
            assert!(tables["feedWork"].sync.is_some());
            for name in ["bounded.follow", "bounded.unfollow"] {
                let fact = &bound.schema.operations[name];
                assert_eq!(fact.predicts.as_deref(), Some("never"), "{fact:?}");
                assert!(fact.sites.iter().filter(|site| site.kind == "timeline transition").all(|site| site.class == SiteClass::Server));
            }
        }
    }
}

#[test]
fn time_floor_uses_mapped_columns_and_explicit_index_spelling_still_works() {
    let source = source("sync public last 40 by .at", "sync public last 7 by .at")
        .replace("at: time", "clock: time").replace("at: now", "clock: now")
        .replace(", at", ", clock").replace(".at", ".clock");
    assert!(compile(&source).diagnostics.is_empty());
    let source = source.replace("sync public last 40 by .clock", "by timeIndex: clock, id\n  sync public last 40 by timeIndex");
    assert!(compile(&source).diagnostics.is_empty());
}

#[test]
fn other_orders_private_sources_and_expiry_still_refuse() {
    for source in [
        source("sync public last 40 by .id", "sync public"),
        source("sync public", "sync public last 7 by .id"),
        source("by wrong: authorId, at, id\n  sync public last 40 by wrong", "sync public"),
        source("by wrong: at, parentId, id\n  sync public last 40 by wrong", "sync public"),
        source("sync public last 40 by .at", "sync public").replace("public 'public posts and replies'", "read <- .authorId = viewer"),
        source("sync public last 40 by .at", "sync public").replace("  removed: bool default false", "  removed: bool default false\n  expire at .at"),
    ] {
        let bound = compile(&source);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_TIMELINE_SHAPE" && !d.rewrite.is_empty() && d.site.file == "bounded.q"), "{:?}", bound.diagnostics);
    }
}

#[test]
fn public_follows_admit_each_residency_and_slots_are_hidden_engine_columns() {
    use snapback4_core::schema::ColumnType;
    for residency in ["sync public", "sync public last 3 by .id", "online only"] {
        let text = source("sync public last 2 by .at", "sync public")
            .replace("sync public\n\nview activity", &format!("{residency}\n\nview activity"));
        let bound = compile(&text);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert!(bound.notes.is_empty(), "{:?}", bound.notes);
        assert_eq!(bound.schema.tables["posts"].columns["$timeline:feed:post"], ColumnType::Bool);
        assert_eq!(bound.schema.tables["reposts"].columns["$timeline:feed:repost"], ColumnType::Optional(Box::new(ColumnType::Id)));
        assert!(!bound.schema.tables["posts"].defaults.contains_key("$timeline:feed:post"));
    }
}

#[test]
fn per_transition_inputs_and_kind_specific_ordinary_reads() {
    let text = source("sync public last 2 by .at", "sync public") + r#"
query event(eventId: id):
  return feedPosts[eventId]
query events():
  return feedPosts last 10 by .at
query repostEvent(actor: principal, postId: id):
  return feedPosts[actor, postId, true]
query original(actor: principal, postId: id):
  return feedPosts[actor, postId, false]
"#;
    let bound = compile(&text);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let own = &bound.schema.operations["bounded.post"];
    assert_eq!(own.predicts.as_deref(), Some("eligible"));
    assert!(own.sites.iter().filter(|s| s.kind == "timeline transition").all(|s| s.table == "feedRemovedEvents" && s.class == SiteClass::Held));
    let unrepost = &bound.schema.operations["bounded.unrepost"];
    assert!(unrepost.sites.iter().all(|s| s.table != "posts" && s.table != "feedPosts"));
    assert!(unrepost.sites.iter().any(|s| s.kind == "timeline transition" && s.table == "reposts" && s.class == SiteClass::Held));
    for name in ["event", "events", "original", "repostEvent"] {
        let expected = if name == "repostEvent" { SiteClass::Held } else { SiteClass::Horizon };
        assert!(bound.schema.operations[&format!("bounded.{name}")].sites.iter().any(|s| s.table == "feedPosts" && s.class == expected), "{name}: {:?}", bound.schema.operations[&format!("bounded.{name}")]);
    }
}

#[test]
fn synced_event_aggregate_fences_only_its_partial_kinds() {
    for online in [false, true] {
        let text = source("sync public last 2 by .at", "sync public")
            + "\nview totals: count feedPosts by .actorId\n" + if online { "  online only\n" } else { "" };
        let bound = compile(&text);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        for name in ["bounded.post", "bounded.remove"] {
            let fact = &bound.schema.operations[name];
            assert_eq!(fact.predicts.as_deref(), Some(if online { "eligible" } else { "never" }), "{fact:?}");
            if !online { assert!(fact.sites.iter().any(|s| s.class == SiteClass::Server && s.reason.contains("totals")), "{fact:?}"); }
        }
        assert_eq!(bound.schema.operations["bounded.unrepost"].predicts.as_deref(), Some("eligible"));
    }
}
