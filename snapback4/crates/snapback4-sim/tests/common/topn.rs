use snapback4_core::{engine::QueryOutcome, value::{object, Value}};

pub const SOURCE: &str = r#"
table posts:
  at: time
  lane: int
  body: text <=30
  by byAt: at, id
  by byLane: lane, at, id
  search body
  cap 2000
  public 'posts'
  sync public
view cards:
  posts { at, body }
query top(slow: bool):
  return posts where not slow or count(posts) > 0 last 10 by .at
query plain():
  return posts last 10 by .at
query oldest():
  return posts first 10 by .at
query merged():
  return merge posts last 10 by byLane:
    [0]
    [1]
query projected():
  return cards last 10 by .at
query searched():
  return posts matching 'cof' last 10 by .at
query preview():
  return { latest: (posts last 1 by .at), label: 'preview' }
query decorated(c: cursor ?):
  latest = posts last 1 by .at
  return { latest, rows: posts last 10 by .at after c }
"#;

pub fn rows() -> Vec<(String, Value)> {
    (0..1000).map(|n| ("posts".into(), object([
        ("id", Value::Id(format!("p{n:04}"))), ("at", Value::Int(n)),
        ("lane", Value::Int(n % 2)), ("body", Value::String("coffee".into())),
    ]))).collect()
}

pub fn check(op: &str, read: QueryOutcome) {
    assert!(read.complete, "{op}: {read:?}");
    assert!(read.cut.is_none() && read.capped_at.is_none(), "{op}: {read:?}");
    assert_eq!(read.next.is_some(), op == "decorated", "{op}: {read:?}");
    let data = if op == "preview" { read.data.field("latest").unwrap() }
        else if op == "decorated" {
            assert_eq!(read.data.field("latest").unwrap().as_array().unwrap()[0].field("at").unwrap(), &Value::Int(999));
            read.data.field("rows").unwrap()
        } else { &read.data };
    let actual = data.as_array().unwrap().iter().map(|row| row.field("at").unwrap().as_int().unwrap()).collect::<Vec<_>>();
    let expected = if op == "oldest" { (0..10).collect() }
        else if op == "preview" { vec![999] } else { (990..1000).rev().collect() };
    assert_eq!(actual, expected, "{op}");
}

pub const OPS: &[&str] = &["plain", "oldest", "merged", "projected", "searched", "preview", "decorated"];
