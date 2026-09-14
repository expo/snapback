use snapback4_core::engine::QueryOutcome;
use snapback4_core::value::{Value, object};
use std::collections::BTreeSet;

// The ticket's twelve rows and helpers, with public sync for the device
// witness and two indexes for the matching and merge witnesses.
pub const SOURCE: &str = r#"
use personas alice

table items:
  n: int
  flags: [text <=10] <=5
  scope: int
  body: text <=20
  by byN: n, id
  by byScopeN: scope, n, id
  by byWords: words(body), n, id
  read <- allow
  insert <- allow
  sync public

fn early(i: items):
  for f in i.flags:
    if f = 'x':
      return 'hit'
  return 'miss'

fn accumulated(i: items):
  state = 'miss'
  for f in i.flags:
    if f = 'x':
      state = 'hit'
  return state

fn conditional(i: items):
  if i.n % 2 = 1:
    return 'hit'
  else if i.n % 2 = 0:
    return 'miss'
  return 'miss'

fn nested(i: items):
  for f in i.flags:
    if f = 'x':
      return early(i)
  return conditional(i)

query withEarly(c: cursor ?):
  return items[] after c last 5 by byN { id, n, mark: early(.) }

query withAccumulated(c: cursor ?):
  return items[] after c last 5 by byN { id, n, mark: accumulated(.) }

query plain(c: cursor ?):
  return items[] after c last 5 by byN { id, n }

query withConditional(c: cursor ?):
  return items[] after c last 5 by byN { id, n, mark: conditional(.) }

query withNested(c: cursor ?):
  return items[] after c last 5 by byN { id, n, mark: nested(.) }

query withMerge(c: cursor ?):
  page = merge items after c last 5 by byScopeN:
    [0]
    [1]
  return page { id, n, mark: early(.) }

query withMatching(c: cursor ?):
  return items[] matching 'hello' after c last 5 by byWords { id, n, mark: early(.) }

query withAuxiliary(c: cursor ?):
  unused = items[] after c last 1 by byN
  return items[] after c last 5 by byN { id, n, mark: early(.) }

query interrupted(c: cursor ?):
  result = []
  for i in items[] after c last 5 by byN:
    result = result + [{ id: i.id, n: i.n }]
    break
  return result

query returnedFromLoop(c: cursor ?):
  result = []
  for i in items[] after c last 5 by byN:
    result = result + [{ id: i.id, n: i.n }]
    for j in range(0, 1):
      return result
  return result
"#;

pub fn rows() -> Vec<(String, Value)> {
    (0..12).map(|n| ("items".into(), object([
        ("id", Value::Id(format!("i{n:02}"))), ("n", Value::Int(n)),
        ("flags", Value::Array(vec![Value::String(if n % 2 == 1 { "x" } else { "y" }.into()), Value::String("y".into())])),
        ("scope", Value::Int(n % 2)), ("body", Value::String("hello world".into())),
    ]))).collect()
}

pub fn check_pages(name: &str, mut query: impl FnMut(Option<String>) -> QueryOutcome) {
    let mut cursor = None;
    let mut ids = BTreeSet::new();
    let mut numbers = Vec::new();
    for (page, size) in [5, 5, 2].into_iter().enumerate() {
        let read = query(cursor);
        let rows = read.data.as_array().unwrap();
        assert_eq!(rows.len(), size, "{name}, page {page}");
        // Complete is the page's class. Without next it may certify the
        // range's end only after all twelve rows have been returned.
        assert!(!read.complete || read.next.is_some() || ids.len() + rows.len() == 12,
            "{name}, page {page}: a lost continuation must not claim complete: {read:?}");
        assert_eq!(read.next.is_some(), page < 2, "{name}, page {page}: {read:?}");
        assert!(read.complete, "{name}, page {page}: {read:?}");
        for row in rows {
            let id = row.field("id").unwrap().as_str().unwrap().to_owned();
            assert!(ids.insert(id), "{name}: duplicate row");
            let n = row.field("n").unwrap().as_int().unwrap();
            numbers.push(n);
            if name != "plain" {
                assert_eq!(row.field("mark").unwrap().as_str().unwrap(), if n % 2 == 1 { "hit" } else { "miss" });
            }
        }
        cursor = read.next;
    }
    assert_eq!(numbers, (0..12).rev().collect::<Vec<_>>(), "{name}: gaps or order changed");
    assert_eq!(ids.len(), 12);
}

pub fn check_interrupted(read: QueryOutcome) {
    assert_eq!(read.data.as_array().unwrap().len(), 1);
    assert!(read.next.is_none(), "an interrupted collector has no safe continuation");
    assert!(!read.complete, "a page with more rows and no continuation is incomplete: {read:?}");
}

pub fn check_full_final_page(read: QueryOutcome) {
    assert_eq!(read.data.as_array().unwrap().len(), 5);
    assert!(read.next.is_none());
    assert!(read.complete, "a full, exhausted page with a proven owner is complete: {read:?}");
}
