//! One app, replayed through mutations; independent social models are the oracle.
//! SNAPBACK4_CLIQUE_FULL=1 selects the committed full social fixture.
#[path = "clique_03/mod.rs"]
mod clique_03;
use clique_03::*;

#[test]
fn admission() {
    let b = bound(APP);
    let e = engine(APP);
    assert_eq!(e.schema().timelines.len(), 1);
    assert!(b.schema.tables["posts"].columns.contains_key("likeCount"));
}

#[test]
fn application_fixture() {
    let full = std::env::var("SNAPBACK4_CLIQUE_FULL").as_deref() == Ok("1");
    run_fixture(full);
}
