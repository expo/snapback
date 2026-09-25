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
fn acquisition_combinations_preserve_audiences_and_use_the_posts_floor_for_events() {
    for posts in ["sync public", "sync public last 40 by .at", "online only"] {
        for reposts in ["sync public", "sync public last 7 by .at", "online only"] {
            let bound = compile(&source(posts, reposts));
            assert!(bound.diagnostics.is_empty(), "{posts}/{reposts}: {:?}", bound.diagnostics);
            assert!(bound.notes.is_empty(), "{:?}", bound.notes);
            let tables = &bound.schema.tables;
            let events = &tables["feedPosts"].sync;
            assert_eq!(events.is_some(), tables["posts"].sync.is_some());
            if let Some(events) = events {
                assert_eq!(events.audience, Audience::Public);
                assert_eq!(events.horizon.as_ref().map(|h| h.last), tables["posts"].sync.as_ref().unwrap().horizon.as_ref().map(|h| h.last));
                if let Some(horizon) = &events.horizon { assert_eq!(horizon.by, "byTime"); }
            }
            let inbox = tables["feedFeed"].sync.as_ref().unwrap();
            assert_eq!(inbox.audience, Audience::Column("readerId".into()));
            let floor = inbox.horizon.as_ref().unwrap();
            assert_eq!(floor.last, HISTORY_WINDOW as u32);
            assert_eq!(floor.by, "byReaderPage");
            for table in ["follows", "feedRemovedEvents"] {
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
fn other_orders_bounded_edges_private_sources_and_expiry_still_refuse() {
    for source in [
        source("sync public last 40 by .id", "sync public"),
        source("sync public", "sync public last 7 by .id"),
        source("by wrong: authorId, at, id\n  sync public last 40 by wrong", "sync public"),
        source("by wrong: at, parentId, id\n  sync public last 40 by wrong", "sync public"),
        SOURCE.replace("sync public\n\nview activity", "sync public last 40 by .id\n\nview activity"),
        SOURCE.replace("sync public\n\nview activity", "online only\n\nview activity"),
        source("sync public last 40 by .at", "sync public").replace("public 'public posts and replies'", "read <- .authorId = viewer"),
        source("sync public last 40 by .at", "sync public").replace("  removed: bool default false", "  removed: bool default false\n  expire at .at"),
    ] {
        let bound = compile(&source);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_TIMELINE_SHAPE" && !d.rewrite.is_empty() && d.site.file == "bounded.q"), "{:?}", bound.diagnostics);
    }
}
