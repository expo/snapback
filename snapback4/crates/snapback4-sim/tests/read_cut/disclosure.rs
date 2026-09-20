use snapback4_core::{Ceilings, Context, QueryOutcome, Value};

// Membership admits the scope, while authorship keeps candidates non-uniform.
// Online-only contents are hand-inserted by the device controls below; an
// authorized snapshot cannot provide the hidden candidate population.
const PRIVATE: &str = r#"
table privateMessages:
  roomId: id
  authorId: principal
  body: text <=100
  at: time
  by byRoomWords: roomId, words(body), at, id
  read <- exists members[.roomId, viewer] and .authorId = viewer
  online only
query privateWords(q: text <=100, c: cursor ?):
  return privateMessages['words'] matching q after c last 10 by byRoomWords
"#;

pub fn private_rows() -> Vec<(String, Value)> {
    use snapback4_core::value::object;
    (0..33).map(|n| ("privateMessages".into(), object([("id", Value::Id(format!("private-{n:02}"))),
        ("roomId", Value::Id("words".into())), ("authorId", Value::Id("dev:alice".into())),
        ("body", Value::String(format!("cof{n:02}"))), ("at", Value::Int(n))]))).collect()
}

pub fn source() -> String {
    format!("{}\nquery point(q: text <=100):\n  return messages['hidden-000000']\nquery merged(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 10 by byRoomWords:\n    ['readable']\n    ['words']\n", format!("{}{}", super::fixture::SOURCE, PRIVATE))
}

pub fn rows(hidden: usize) -> Vec<(String, Value)> {
    super::fixture::seed(5, hidden).into_iter().chain(private_rows()).map(|(table, mut row)| {
        if table == "messages" && row.field("roomId").unwrap().as_str().unwrap() == "hidden" {
            let n = row.field("at").unwrap().as_int().unwrap();
            let mut fields = row.as_object().unwrap().clone();
            fields.insert("body".into(), Value::String(format!("secret{n:05}")));
            row = Value::Row(fields.into());
        }
        (table, row)
    }).collect()
}

pub fn context(q: &str) -> Context {
    Context::new("dev:alice", [("q".into(), Value::String(q.into()))].into()).at(10000)
}

#[allow(dead_code)] // Shared with device tests, whose wire also carries coverage.
pub fn wire(page: &QueryOutcome) -> serde_json::Value {
    serde_json::json!({"data":snapback4_core::wire::to_json(&page.data), "complete":page.complete, "cut":page.cut,
        "next":page.next, "seq":page.seq, "tables":page.tables, "nextExpiry":page.next_expiry, "viewer":"dev:alice"})
}

pub fn sweep(mut query: impl FnMut(&str, Ceilings) -> serde_json::Value) -> Vec<serde_json::Value> {
    let mut pages = Vec::new();
    for examined in [0, 1, 31, 32, 33, 34, 82] {
        for rule_probes in [0, 1, 2, 31, 32, 33, 34] {
            for name in ["all", "point"] {
                let page = query(name, Ceilings { examined, rule_probes, ..Default::default() });
                assert!(page["data"] == serde_json::json!([]) || page["data"].is_null(), "{page}");
                assert!(page["next"].is_null());
                pages.push(page);
            }
        }
    }
    pages
}

pub fn merge_cuts(host: &str, mut query: impl FnMut(&str, &str, Ceilings) -> QueryOutcome) {
    let meter = query("merged", "coffee", Ceilings { examined: 1, ..Default::default() });
    assert_eq!(meter.cut, Some(snapback4_core::engine::ReadCut::Meter));
    assert!(meter.capped_at.is_some() && meter.word_cut_at.is_none());
    assert!(!meter.complete && meter.next.is_none());
    let uniform = query("merged", "cof", Ceilings::default());
    assert!(uniform.complete && uniform.next.is_some());
    assert_eq!(uniform.data.as_array().unwrap().len(), 10);
    assert!(uniform.cut.is_none() && uniform.word_cut_at.is_none() && uniform.capped_at.is_none());
    let words = query("privateWords", "cof", Ceilings::default());
    assert!(!words.complete && words.next.is_none());
    assert!(!words.data.as_array().unwrap().is_empty());
    assert_eq!(words.cut, if host == "server" { None } else { Some(snapback4_core::engine::ReadCut::Words) });
    assert!(words.word_cut_at.is_some() && words.capped_at.is_none());
    // Word discovery records its lane limit before examining rows. This
    // ceiling cuts the admitted non-uniform scan after discovery.
    let both = query("privateWords", "cof", Ceilings { examined: 10, ..Default::default() });
    assert!(both.word_cut_at.is_some() && both.capped_at.is_some(), "{host}: {both:?}");
    assert_eq!(both.cut, if host == "server" { None } else { Some(snapback4_core::engine::ReadCut::Meter) });
    assert!(!both.complete && both.next.is_none());
    println!("W8R1a merge host={host} words=33 word_only_examined={} both_examined={} precedence=meter", words.metered.examined, both.metered.examined);
}
