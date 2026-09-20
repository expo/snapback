// Shared server/SQLite-device/memory-device regressions at the real examined ceiling.
use snapback4_core::{Context, Value, cursor::decode_cursor, value::object};

fn fixture(eager: bool, rejected: u64, words: usize) -> (String, Vec<(String, Value)>) {
    // Uniform matching stays lazy even without an id suffix; the eager control
    // uses an admitted membership-and-author rule with per-row authorization.
    let suffix = "at";
    let source = format!("table rooms:\n  public 'rooms'\n  sync public\ntable messages:\n  roomId: rooms\n  body: text <=200\n  at: time\n  by byRoomWords: roomId, words(body), {suffix}\n  public 'messages'\n  sync public\nquery has(roomId: rooms, q: text <=100):\n  return exists (messages[roomId] matching q by byRoomWords)\nquery grouped(q: text <=100, c: cursor ?):\n  return rooms after c first 2 by byId where exists (messages[.id] matching q by byRoomWords)\n");
    let source = if eager {
        format!("table members:\n  roomId: rooms\n  principal: principal\n  unique byRoomPrincipal: roomId, principal\n  by byPrincipal: principal, id\n  read <- .principal = viewer\n  sync to .principal\n{source}")
            .replace("  body: text <=200", "  author: principal\n  body: text <=200")
            .replace("  public 'messages'\n  sync public", "  read <- exists members[.roomId, viewer] and .author = viewer\n  online only")
    } else { source };
    // Decoded row/token scratch is now prepaid. Keep the first witness at
    // exactly the same real examined ceiling with 7,000 cheap point misses;
    // the remaining rejected text rows still exercise further-term filtering.
    // All old positive, exact-counter and two-page-walk assertions remain.
    let source = source.replace("  return exists", "  for i in range(0, 7000):\n    unused = exists rooms['missing']\n  return exists")
        .replace("  return rooms after", "  for i in range(0, 7000):\n    unused = exists rooms['missing']\n  return rooms after");
    let rejected = rejected - 7000;
    let mut rows = ["a", "b"].map(|id| ("rooms".into(), object([("id", Value::Id(id.into()))]))).to_vec();
    if eager { for room in ["a", "b"] { rows.push(("members".into(), object([("id", Value::Id(format!("member-{room}"))),
        ("roomId", Value::Id(room.into())), ("principal", Value::Id("dev:alice".into()))]))); } }
    let body = (0..words).map(|n| format!("coffee{}", char::from(b'a' + n as u8))).collect::<Vec<_>>().join(" ");
    for room in ["a", "b"] {
        let misses = if room == "a" { rejected } else { 0 };
        for n in 0..misses + 2 {
            rows.push(("messages".into(), object([("id", Value::Id(format!("{room}{n:05}"))), ("roomId", Value::Id(room.into())),
                ("at", Value::Int(n as i64)), ("body", Value::String(if n < misses { "coffeea nope".into() } else { format!("{body} zebra") }))])));
        }
    }
    if eager { for (table, row) in &mut rows { if table == "messages" { if let Value::Row(fields) = row { fields.insert("author".into(), Value::Id("dev:alice".into())); } } } }
    (source, rows)
}

fn first_witness(eager: bool) {
    for words in [1, 2, 9] {
        let ceiling = snapback4_core::Ceilings::default().examined;
        let (source, rows) = fixture(eager, ceiling - 1, words);
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        let scan = snapback4_core::ir::scans(&bound.programs.iter().find(|p| p.program.name == "has").unwrap().program).into_iter().find(|s| s.table == "messages").unwrap();
        assert_eq!(snapback4_core::engine::rules::scan_visibility(&bound.schema, scan).uniform, !eager, "the eager control must use an admitted non-uniform scope");
        super::with_fixture(&source, rows, |query| {
            let answer = query("has", Context::new("dev:alice", [("roomId".into(), Value::Id("a".into())), ("q".into(), Value::String("cof zebra".into()))].into())).unwrap();
            assert_eq!(answer.data, Value::Bool(true));
            assert_eq!(answer.metered.examined, ceiling, "eager={eager} words={words}: {answer:?}");
            assert!(answer.complete == !eager && answer.next.is_none() && answer.cut.is_none(), "{answer:?}");
            println!("first witness eager={eager} words={words}: examined={} complete={} next=none", answer.metered.examined, answer.complete);
        });
    }
}

fn grouped_walk(eager: bool) {
    for words in [1, 2, 9] {
        let ceiling = snapback4_core::Ceilings::default().examined;
        let (source, rows) = fixture(eager, ceiling - 2, words);
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        super::with_fixture(&source, rows, |query| {
            let mut cursor = Value::Null;
            let mut ids = Vec::new();
            let mut requests = 0;
            loop {
                let answer = query("grouped", Context::new("dev:alice", [("q".into(), Value::String("cof zebra".into())), ("c".into(), cursor.clone())].into())).unwrap();
                requests += 1;
                let page = answer.data.as_array().unwrap();
                if requests == 1 {
                    assert_eq!(page.len(), 1, "eager={eager} words={words}: {answer:?}");
                    assert_eq!(page[0].field("id").unwrap(), &Value::Id("a".into()));
                    let position = decode_cursor(&bound.schema, answer.next.as_deref().expect("cut page continues")).unwrap();
                    assert_eq!(position.values, vec![Value::Id("a".into())]);
                    assert_eq!(answer.cut, if eager && !super::DEVICE { None } else { Some(snapback4_core::engine::ReadCut::Meter) });
                    assert!(!answer.complete);
                    // The witness was unit 8192; only the next outer candidate attempts 8193.
                    assert_eq!(answer.metered.examined, ceiling + 1);
                    println!("grouped boundary eager={eager} words={words}: rows=1 witness={ceiling} examined={} next=a", answer.metered.examined);
                }
                ids.extend(page.iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()));
                match answer.next { Some(next) => cursor = Value::String(next), None => break }
                assert!(requests < 4, "walk must terminate");
            }
            assert_eq!(ids, ["a", "b"]);
            // Non-uniform direct pages keep the terminal empty request: even
            // an uncut last visible position cannot certify the range's end.
            assert_eq!(requests, if eager { 3 } else { 2 });
            println!("grouped walk eager={eager} words={words}: requests={requests} ids=2 duplicates=0");
        });
    }
}

#[test] fn matching_exists_lazy_first_witness() { first_witness(false); }
#[test] fn matching_exists_eager_first_witness() { first_witness(true); }
#[test] fn matching_exists_lazy_grouped_walk() { grouped_walk(false); }
#[test] fn matching_exists_eager_grouped_walk() { grouped_walk(true); }

#[test]
fn first_witness_predicate_retry_without_shape_stops_when_it_cannot_progress() {
    let source = "table rooms:\n  public 'rooms'\n  sync public\ntable messages:\n  roomId: rooms\n  expiresAt: time\n  expire at .expiresAt\n  by byExpiry: expiresAt\n  by byRoom: roomId, id\n  public 'messages'\n  sync public\nquery grouped(c: cursor ?):\n  return rooms after c first 2 by byId where exists (messages[.id] by byRoom)\n";
    for expired in [false, true] {
        let mut rows = ["a", "b"].map(|id| ("rooms".into(), object([("id", Value::Id(id.into()))]))).to_vec();
        for room in ["a", "b"] { for n in 0..if room == "a" { 8193 } else { 1 } {
            rows.push(("messages".into(), object([("id", Value::Id(format!("{room}{n:05}"))), ("roomId", Value::Id(room.into())),
                ("expiresAt", Value::Int(if expired && room == "a" { 1 } else { 1_000_000 }))])));
        } }
        super::with_fixture(source, rows, |query| {
            let context = |cursor| Context::new("dev:alice", [("c".into(), cursor)].into()).at(100);
            let first = query("grouped", context(Value::Null)).unwrap();
            if !expired {
                assert_eq!(first.data.as_array().unwrap().len(), 2);
                assert!(first.complete && first.cut.is_none());
                return;
            }
            assert!(first.data.as_array().unwrap().is_empty() && !first.complete);
            assert_eq!(first.cut, Some(snapback4_core::engine::ReadCut::Meter));
            assert_eq!(first.metered.examined, 8193);
            let next = first.next.expect("the first interruption retries its membership");
            let second = query("grouped", context(Value::String(next))).unwrap();
            assert!(second.data.as_array().unwrap().is_empty() && !second.complete);
            assert_eq!(second.cut, Some(snapback4_core::engine::ReadCut::Meter));
            assert_eq!(second.metered.examined, 8193);
            assert!(second.next.is_none(), "same input membership interrupted again with no emission must not loop: {second:?}");
        });
    }
}
