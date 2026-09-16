//! Real routing-cap occupancy, shared by the server and both device witnesses.
#![allow(dead_code)]
use snapback4_core::{Engine, Value, value::object};
use super::world::{id, mutate};

pub const READER: &str = "departing";
pub const NEW_READER: &str = "new-reader";
pub const AUTHOR: &str = "shared0";

pub fn seed(engine: &mut Engine, at_cap: bool) {
    let mut rows = Vec::new();
    for n in 0..33 {
        let author = format!("shared{n}");
        rows.push(("authors".into(), object([("id", id(&author)), ("principal", id(&author)), ("shared", Value::Bool(true))])));
    }
    let mut route = |reader: &str, author: &str, follows: bool| {
        rows.push(("pulls".into(), object([("id", id(&format!("{reader}-{author}"))), ("readerId", id(reader)), ("authorId", id(author))])));
        if follows {
            rows.push(("follows".into(), object([("id", id(&format!("edge-{reader}-{author}"))), ("followerId", id(reader)), ("followedId", id(author))])));
        }
    };
    route(AUTHOR, AUTHOR, false);
    route(READER, AUTHOR, true);
    if at_cap {
        // 31,998 other active readers, spread below the 1,000-followers cap.
        // These occupy real routes, not fabricated zero-count rows.
        for n in 0..31_998 { route(&format!("reader{n:05}"), &format!("shared{}", n / 999), true); }
    } else {
        route(READER, "shared1", true);
    }
    let schema = engine.schema().clone();
    let programs: Vec<_> = engine.programs().cloned().collect();
    let mut loading = schema.clone();
    for table in loading.tables.values_mut() { table.constraints.retain(|c| !matches!(c, snapback4_core::schema::Constraint::Cap { .. })); }
    engine.adopt(loading, programs.clone()).unwrap();
    engine.seed(super::world::with_pull_counts(rows)).unwrap();
    // Validate the original caps before exercising any recipe operation.
    engine.adopt(schema, programs).unwrap();
    for author in [AUTHOR, "shared1"] { mutate(engine, "createPost", author, &[("postId", id(&format!("post-{author}")))], 1); }
}

pub fn counts(engine: &Engine, reader: &str, expected: Option<i64>, total: usize) {
    let rows = engine.store().rows("pullCounts").unwrap();
    assert_eq!(rows.len(), total);
    let row = rows.iter().find(|row| row.field("readerId") == Ok(&id(reader)));
    assert_eq!(row.map(|row| row.field("used").unwrap().as_int().unwrap()), expected, "count for {reader}");
    assert_eq!(engine.store().rows("pulls").unwrap().iter().filter(|row| row.field("readerId") == Ok(&id(reader))).count(), expected.unwrap_or(0) as usize);
}

// op, viewer, author, remaining reader routes, total count rows
pub fn steps(at_cap: bool) -> Vec<(&'static str, &'static str, &'static str, Option<i64>, usize)> {
    if at_cap {
        vec![
            ("unfollow", READER, AUTHOR, None, 31_999),
            ("follow", NEW_READER, AUTHOR, Some(1), 32_000),
            ("unfollow", NEW_READER, AUTHOR, None, 31_999),
            ("follow", READER, AUTHOR, Some(1), 32_000),
        ]
    } else {
        vec![
            ("unfollow", READER, AUTHOR, Some(1), 2),
            ("unfollow", READER, "shared1", None, 1),
            ("unfollow", READER, "shared1", None, 1),
            ("follow", READER, AUTHOR, Some(1), 2),
        ]
    }
}
