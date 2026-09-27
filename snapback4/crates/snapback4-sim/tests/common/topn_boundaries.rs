use snapback4_core::{engine::QueryOutcome, error::MeterKind, meter::Ceilings, value::{object, Value}};

pub const SOURCE: &str = r#"
table rooms:
  public 'rooms'
  sync public
table items:
  room: rooms
  n: int
  by byRoomN: room, n, id
  public 'items'
  sync public
query plain():
  return items last 10 by .n
query oldest():
  return items first 10 by .n
query continued(c: cursor ?):
  return items last 10 by .n after c
query interrupted(c: cursor ?):
  result = []
  for i in items[] last 5 by .n after c:
    result = result + [i.n]
    break
  return result
query cursorlessInterrupted():
  result = []
  for i in items[] last 5 by .n:
    result = result + [i.n]
    break
  return result
query domain():
  result = []
  for i in items:
    result = result + [i.n]
  return result
query discovered():
  return merge items last 1 by byRoomN:
    [r.id] for r in rooms first 2 by .id
query allLanes():
  return merge items last 1 by byRoomN:
    [r.id] for r in rooms first 5 by .id
"#;

// `where .room in (rooms first 2 by .id)` currently refuses the row/reference
// comparison (E_QUARRY_TYPE). Exercise its intended distinct-source runtime
// path without changing the language: the explicit merge supplies the scan,
// and the distinct key is the room id used by the membership lowering.
pub fn distinct_discovery(program: &mut snapback4_core::ir::Program) {
    use snapback4_core::ir::{self, Expr, Stmt};
    if !matches!(program.name.as_str(), "discovered" | "allLanes") { return; }
    let mut found = false;
    for stmt in &mut program.body {
        if let Stmt::Return(Expr::Merge(merge)) = stmt {
            assert_eq!(merge.lanes.len(), 1);
            let lane = &mut merge.lanes[0];
            lane.distinct = Some(ir::field(ir::var(&lane.binding), "id"));
            found = true;
        }
    }
    assert!(found, "{} must exercise distinct lane discovery", program.name);
}

pub fn rows() -> Vec<(String, Value)> {
    let mut rows = (0..5).map(|n| ("rooms".into(), object([("id", Value::Id(format!("r{n}")))]))).collect::<Vec<_>>();
    rows.extend((0..12).map(|n| ("items".into(), object([
        ("id", Value::Id(format!("i{n:02}"))), ("n", Value::Int(n)),
        ("room", Value::Id(format!("r{}", if n == 11 { 4 } else { n % 2 }))),
    ]))));
    rows
}

// @ref LLP 3000.027#2 — a full plain page consumes N, while a cursor still needs lookahead.
pub fn check_meter(mut query: impl FnMut(&str, Ceilings) -> QueryOutcome) {
    for op in ["plain", "oldest"] {
        for examined in [9, 10] {
            let read = query(op, Ceilings { examined, ..Ceilings::default() });
            let actual = read.data.as_array().unwrap().iter().map(|row| row.field("n").unwrap().as_int().unwrap()).collect::<Vec<_>>();
            let expected = if op == "plain" { (12 - examined as i64..12).rev().collect::<Vec<_>>() } else { (0..examined as i64).collect() };
            assert_eq!(actual, expected, "{op}/{examined}");
            assert_eq!(read.complete, examined == 10, "{op}/{examined}: {read:?}");
            assert!(read.next.is_none());
            assert_eq!(read.cut, (examined == 9).then_some(snapback4_core::engine::ReadCut::Meter));
            assert_eq!(read.capped_at.as_ref().map(|(kind, _)| *kind), (examined == 9).then_some(MeterKind::Examined));
            assert_eq!(read.metered.examined, 10, "the full page examines no overflow row");
        }
    }
    let cursor = query("continued", Ceilings { examined: 10, ..Ceilings::default() });
    assert_eq!(cursor.data.as_array().unwrap().len(), 10);
    assert!(!cursor.complete && cursor.next.is_some());
    assert_eq!(cursor.cut, Some(snapback4_core::engine::ReadCut::Meter));
    assert_eq!(cursor.metered.examined, 11);
    let cursor = query("continued", Ceilings::default());
    assert!(cursor.complete && cursor.next.is_some() && cursor.cut.is_none());
    let domain = query("domain", Ceilings { examined: 10, ..Ceilings::default() });
    assert_eq!(domain.data.as_array().unwrap().len(), 10);
    assert!(!domain.complete && domain.next.is_none());
    assert_eq!(domain.cut, Some(snapback4_core::engine::ReadCut::Meter), "an unbounded domain is not a declared top-N");
}

pub fn check_collectors(mut query: impl FnMut(&str) -> QueryOutcome) {
    for (op, complete) in [("interrupted", false), ("cursorlessInterrupted", true)] {
        let read = query(op);
        assert_eq!(read.data, Value::Array(vec![Value::Int(11)]));
        assert_eq!(read.complete, complete, "{op}: {read:?}");
        assert!(read.next.is_none() && read.cut.is_none() && read.capped_at.is_none());
    }
}

pub fn check_discovery(mut query: impl FnMut(&str) -> QueryOutcome) {
    for (op, complete, newest) in [("discovered", false, 10), ("allLanes", true, 11)] {
        let read = query(op);
        assert_eq!(read.complete, complete, "{op}: {read:?}");
        assert!(read.cut.is_none() && read.capped_at.is_none() && read.next.is_none(), "{op}: {read:?}");
        let rows = read.data.as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].field("n").unwrap(), &Value::Int(newest));
    }
}
