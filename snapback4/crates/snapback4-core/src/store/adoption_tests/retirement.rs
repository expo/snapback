//! Pause advice covers retained populations without running their activation.
use super::*;

fn open(source: &str) -> Engine {
    let b = compile(source);
    Engine::new_at(Store::memory().unwrap(), b.schema, b.programs, 0).unwrap()
}

fn preview(e: &mut Engine, next: &Schema) -> super::super::adoption_estimate::AdoptionEstimate {
    let before = ["r", "i", "_log", "_commits", "_generations"].map(|t| rows(e, t));
    let generation = e.generation();
    let estimate = e.store_mut().adoption_estimate(next).unwrap().expect("populated write work needs advice");
    assert_eq!(generation, e.generation());
    for (t, old) in ["r", "i", "_log", "_commits", "_generations"].into_iter().zip(before) {
        assert_eq!(rows(e, t), old, "preview wrote {t}");
    }
    estimate
}

const CHILDREN: &str = "table parents:\n  public\ntable children:\n  parent: parents\n  until: time default 50\n  immutable parent\n  expire at .until\n  read through .parent\n";
fn children(source: &str, count: usize) -> Engine {
    let mut e = open(source);
    e.seed_at(std::iter::once(("parents".into(), object([("id", Value::Id("p".into()))])))
        .chain((0..count).map(|n| ("children".into(), object([
            ("id", Value::Id(format!("c{n}"))), ("parent", Value::Id("p".into())), ("until", Value::Int(50)),
        ])))), 0).unwrap();
    e
}

#[test]
fn inherited_expiry_default_warns_before_retiring_one_thousand_children() {
    let mut e = children(CHILDREN, 1000);
    let next = compile(&CHILDREN.replace("default 50", "default 200"));
    let estimate = preview(&mut e, &next.schema);
    assert_eq!(estimate.deadline_rewrite_rows, 0);
    let message = estimate.summary();
    assert!(message.contains("unestimated write pause") && message.contains("read-through retirement/recapture children (1000 stored rows; deletion subset depends on activation time)"), "{message}");
    assert!(!message.contains("to recompute deadlines"), "{message}");
    e.adopt_at(next.schema, next.programs, 100).unwrap();
    assert!(e.store().rows("children").unwrap().is_empty());
    assert_eq!(e.store().conn().query_row("SELECT count(*) FROM i JOIN _catalog c ON c.num=i.ti WHERE c.name LIKE 'children.%'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}

#[test]
fn adding_and_removing_read_through_warn_about_predecessor_retirement() {
    let ordinary = CHILDREN.replace("read through .parent", "public");
    for (old, new) in [(ordinary.as_str(), CHILDREN), (CHILDREN, ordinary.as_str())] {
        let mut e = children(old, 3);
        let next = compile(new);
        let estimate = preview(&mut e, &next.schema);
        assert_eq!(estimate.deadline_rewrite_rows, 0);
        let message = estimate.summary();
        assert!(message.contains("read-through retirement/recapture children (3 stored rows; deletion subset depends on activation time)"), "{message}");
        assert!(!message.contains("to recompute deadlines"), "{message}");
        e.adopt_at(next.schema, next.programs, 100).unwrap();
        assert!(e.store().rows("children").unwrap().is_empty());
    }
}

#[test]
fn unchanged_read_through_tables_warn_about_deadline_rewrites_without_retirement() {
    for now in [10, 100] {
        let mut e = children(CHILDREN, 3);
        let next = compile(&format!("{CHILDREN}\ntable unrelated:\n  public\n"));
        let estimate = preview(&mut e, &next.schema);
        assert_eq!(estimate.deadline_rewrite_rows, 3);
        assert_eq!((estimate.retired_rows, estimate.retired_index_entries), (0, 0));
        assert_eq!(estimate.seconds(), (0.0, 0.0)); // No measured rewrite rate.
        let message = estimate.summary();
        assert!(message.contains("unestimated write pause") && message.contains("read-through children rewrites 3 stored rows to recompute deadlines"), "{message}");
        assert!(!message.contains("retirement/recapture") && !message.contains("deletion subset"), "{message}");
        e.adopt_at(next.schema, next.programs, now).unwrap();
        assert_eq!(e.store().rows("children").unwrap().len(), 3);
    }
}

const GROUPS: &str = "table entries:\n  n: int\n  bucket: int\n  public\nview totals: count entries by .n\n";
fn groups() -> Engine {
    let mut e = open(GROUPS);
    e.seed_at((0..4).map(|n| ("entries".into(), object([
        ("id", Value::Id(format!("r{n}"))), ("n", Value::Int(n)), ("bucket", Value::Int(0)),
    ]))), 0).unwrap();
    e
}
fn rebuild_groups(next: &str, remaining: usize) {
    let mut e = groups();
    let next = compile(next);
    let estimate = preview(&mut e, &next.schema);
    assert_eq!(estimate.retired_rows, 4);
    assert!(estimate.retired_index_entries >= 8);
    assert!(estimate.summary().contains("unestimated retirement pause"));
    e.adopt_at(next.schema, next.programs, 10).unwrap();
    assert_eq!(e.store().rows("totals").unwrap().len(), remaining);
}
#[test]
fn changed_filter_counts_cleared_retained_view_rows() {
    rebuild_groups(&GROUPS.replace("count entries by", "count entries where .n < 0 by"), 0);
}
#[test]
fn changed_key_counts_cleared_retained_view_rows() {
    rebuild_groups(&GROUPS.replace("by .n", "by .bucket"), 1);
}
#[test]
fn empty_source_does_not_hide_retained_target_cleanup() {
    let mut e = groups();
    // A legacy/imported target may outlive its source population.
    e.store().conn().execute_batch("DELETE FROM r WHERE t=(SELECT num FROM _catalog WHERE name='entries'); DELETE FROM i WHERE ti IN (SELECT num FROM _catalog WHERE name LIKE 'entries.%');").unwrap();
    let next = compile(&GROUPS.replace("count entries by", "count entries where .n < 0 by"));
    let estimate = preview(&mut e, &next.schema);
    assert_eq!(estimate.aggregate_rows, 0);
    assert_eq!(estimate.retired_rows, 4);
    e.adopt_at(next.schema, next.programs, 10).unwrap();
    assert!(e.store().rows("totals").unwrap().is_empty());
}

#[test]
fn parent_lifetime_change_warns_about_mirror_without_private_rebuild() {
    let source = "table posts:\n  until: time default 50\n  expire at .until\n  likes: count likes by postId\n  public\ntable likes:\n  postId: posts\n  public\n";
    let mut e = open(source);
    e.seed_at([("posts".into(), object([("id", Value::Id("p".into())), ("until", Value::Int(50))]))], 0).unwrap();
    let next = compile(&source.replace("default 50", "default 200"));
    assert!(!crate::successor::maintain_rebuild_needed(e.schema(), &next.schema, &next.schema.maintains[0]));
    let message = preview(&mut e, &next.schema).summary();
    assert!(message.contains("maintained-column mirror posts (1 stored rows)"), "{message}");
    assert!(!message.contains("$column:"));
}

#[test]
fn cap_occupancy_reset_is_visible_even_when_table_definition_is_unchanged() {
    let source = "table entries:\n  n: int\n  until: time ?\n  expire at .until\n  cap 4 by n\n  public\n";
    let mut e = open(source);
    e.seed_at([("entries".into(), object([("id", Value::Id("e".into())), ("n", Value::Int(0)), ("until", Value::Int(50))]))], 0).unwrap();
    let next = compile(&format!("{source}\ntable unrelated:\n  public\n"));
    let message = preview(&mut e, &next.schema).summary();
    assert!(message.contains("cap occupancy reset/rebuild (1 stored entries, 1 source rows)"), "{message}");
    // Legacy activation repairs missing occupancy metadata on unchanged schemas too.
    e.store().conn().execute("DELETE FROM _meta WHERE key='cap_counts_schema'", []).unwrap();
    let same = e.schema().clone();
    assert!(preview(&mut e, &same).summary().contains("cap occupancy reset/rebuild"));
}

#[test]
fn asset_home_retirement_warns_even_without_application_rows() {
    let mut e = open("table entries:\n  photo: image <=1000 ?\n  public\n");
    // The activation ledger can outlive the home row; no asset bytes are needed.
    e.store().conn().execute_batch("INSERT INTO _assets(id,owner,kind,content_type,bytes,created_at,home_table,home_id,home_column) VALUES('a','alice','image','image/png',1,0,'entries','gone','photo');").unwrap();
    let next = compile("table entries:\n  public\n");
    assert!(preview(&mut e, &next.schema).summary().contains("asset-home retirement entries.photo (1 ledger rows)"));
    assert!(e.store().conn().query_row("SELECT released_at IS NULL FROM _assets WHERE id='a'", [], |r| r.get::<_, bool>(0)).unwrap());
}

#[test]
fn legacy_live_sum_repair_is_visible_even_without_schema_change() {
    let source = "table entries:\n  n: int\n  until: time ?\n  expire at .until\n  public\nview totals: sum entries of .n by .n\n";
    let mut e = open(source);
    e.seed_at([("entries".into(), object([("id", Value::Id("e".into())), ("n", Value::Int(1)), ("until", Value::Int(50))]))], 0).unwrap();
    e.store().conn().execute("DELETE FROM _meta WHERE key='live_sum_candidates'", []).unwrap();
    let next = e.schema().clone();
    let estimate = preview(&mut e, &next);
    assert_eq!(estimate.retired_rows, 1);
    assert_eq!(estimate.aggregate_rows, 1);
}

#[test]
fn row_view_rebuild_counts_retained_recount_and_basis_rows() {
    const SOURCE: &str = include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q");
    for count in [1, 1100] {
        let mut e = open(SOURCE.split("view unread:").next().unwrap());
        let mut input = vec![("members".into(), crate::wire::row_from_json(&e.schema().tables["members"],
            &serde_json::json!({"id":"m","conversationId":"c","principal":"bob","readUpTo":0,"joinedAt":0})).unwrap())];
        input.extend((1..=count).map(|n| ("messages".into(), crate::wire::row_from_json(&e.schema().tables["messages"],
            &serde_json::json!({"id":format!("r{n:04}"),"conversationId":"c","ordinal":n,"senderId":"alice","tombstone":false,"until":1000})).unwrap())));
        e.seed_at(input, 0).unwrap();
        let bound = compile(SOURCE);
        e.adopt_at(bound.schema, bound.programs, 1).unwrap();
        let hidden = if count == 1 { "$basis:unread" } else { "$recount:unread" };
        assert!(!e.store().rows(hidden).unwrap().is_empty(), "{hidden}");
        let rows: i64 = e.store().conn().query_row("SELECT count(*) FROM r JOIN _catalog c ON c.num=r.t WHERE c.name IN ('unread','$basis:unread','$recount:unread')", [], |r| r.get(0)).unwrap();
        let next = compile(&SOURCE.replace("and not .tombstone", "and .tombstone"));
        let estimate = preview(&mut e, &next.schema);
        assert_eq!(estimate.retired_rows, rows as u64);
        assert!(!estimate.summary().contains("$basis:") && !estimate.summary().contains("$recount:"));
        e.adopt_at(next.schema, next.programs, 2).unwrap();
    }
}

#[test]
fn projection_index_replacement_and_capture_fills_keep_their_population_advice() {
    let source = "table entries:\n  n: int\n  junk: int\n  by byN: n\n  public\n";
    let mut e = open(source);
    e.seed_at([("entries".into(), object([("id", Value::Id("r".into())), ("n", Value::Int(1)), ("junk", Value::Int(2))]))], 0).unwrap();
    let next = compile(&source.replace("  junk: int\n", "").replace("byN: n", "byN: id"));
    let estimate = preview(&mut e, &next.schema);
    assert_eq!((estimate.projected_rows, estimate.index_rows, estimate.retired_index_entries), (1, 1, 1));
    e.adopt_at(next.schema, next.programs, 1).unwrap();
    assert!(e.store().rows("entries").unwrap()[0].field("junk").is_err());
    let mut e = engine(false);
    let next = compile(&format!("{BASE}{VIEWS}"));
    assert!(preview(&mut e, &next.schema).capture_rows > 0);
}

#[test]
fn unchanged_and_empty_stores_remain_quiet() {
    let mut e = open(GROUPS);
    let next = compile(&GROUPS.replace("by .n", "by .bucket"));
    assert!(e.store_mut().adoption_estimate(&next.schema).unwrap().is_none());
    let mut e = groups();
    let same = e.schema().clone();
    assert!(e.store_mut().adoption_estimate(&same).unwrap().is_none());
}
