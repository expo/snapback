// Shared server/SQLite-device/memory-device regressions at the real examined ceiling.
use snapback4_core::{Context, Value, cursor::decode_cursor, value::object};

fn fixture(eager: bool, rejected: u64, words: usize) -> (String, Vec<(String, Value)>) {
    // Omitting id forces the eager merge without changing public authorization.
    let suffix = if eager { "at" } else { "at, id" };
    let source = format!("table rooms:\n  public 'rooms'\n  sync public\ntable messages:\n  roomId: rooms\n  body: text <=200\n  at: time\n  by byRoomWords: roomId, words(body), {suffix}\n  public 'messages'\n  sync public\nquery has(roomId: rooms, q: text <=100):\n  return exists (messages[roomId] matching q by byRoomWords)\nquery grouped(q: text <=100, c: cursor ?):\n  return rooms after c first 2 by byId where exists (messages[.id] matching q by byRoomWords)\n");
    let mut rows = ["a", "b"].map(|id| ("rooms".into(), object([("id", Value::Id(id.into()))]))).to_vec();
    let body = (0..words).map(|n| format!("coffee{}", char::from(b'a' + n as u8))).collect::<Vec<_>>().join(" ");
    for room in ["a", "b"] {
        let misses = if room == "a" { rejected } else { 0 };
        for n in 0..misses + 2 {
            rows.push(("messages".into(), object([("id", Value::Id(format!("{room}{n:05}"))), ("roomId", Value::Id(room.into())),
                ("at", Value::Int(n as i64)), ("body", Value::String(if n < misses { "coffeea nope".into() } else { format!("{body} zebra") }))])));
        }
    }
    (source, rows)
}

fn first_witness(eager: bool) {
    for words in [1, 2, 9] {
        let ceiling = snapback4_core::Ceilings::default().examined;
        let (source, rows) = fixture(eager, ceiling - 1, words);
        super::with_fixture(&source, rows, |query| {
            let answer = query("has", Context::new("dev:alice", [("roomId".into(), Value::Id("a".into())), ("q".into(), Value::String("cof zebra".into()))].into())).unwrap();
            assert_eq!(answer.data, Value::Bool(true));
            assert_eq!(answer.metered.examined, ceiling, "eager={eager} words={words}: {answer:?}");
            assert!(answer.complete && answer.next.is_none() && answer.cut.is_none(), "{answer:?}");
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
                    assert_eq!(answer.cut, Some(snapback4_core::engine::ReadCut::Meter));
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
            assert_eq!(requests, 2);
            println!("grouped walk eager={eager} words={words}: requests={requests} ids=2 duplicates=0");
        });
    }
}

#[test] fn matching_exists_lazy_first_witness() { first_witness(false); }
#[test] fn matching_exists_eager_first_witness() { first_witness(true); }
#[test] fn matching_exists_lazy_grouped_walk() { grouped_walk(false); }
#[test] fn matching_exists_eager_grouped_walk() { grouped_walk(true); }
