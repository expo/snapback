use snapback4_core::{Ceilings, Context, QueryOutcome, Value};

pub fn source() -> String {
    format!("{}\nquery point(q: text <=100):\n  return messages['hidden-000000']\nquery merged(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 10 by byRoomWords:\n    ['readable']\n    ['words']\n", super::fixture::SOURCE)
}

pub fn rows(hidden: usize) -> Vec<(String, Value)> {
    super::fixture::seed(5, hidden).into_iter().map(|(table, mut row)| {
        if table == "messages" && row.field("roomId").unwrap().as_str().unwrap() == "hidden" {
            let n = row.field("at").unwrap().as_int().unwrap();
            let mut fields = row.as_object().unwrap().to_row();
            fields.insert("body".into(), Value::String(format!("secret{n:05}")));
            row = Value::Row(fields.into());
        }
        (table, row)
    }).collect()
}

pub fn context(q: &str) -> Context {
    Context::new("dev:alice", [("q".into(), Value::String(q.into()))]).at(10000)
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

pub fn merge_cuts(host: &str, mut query: impl FnMut(&str, Ceilings) -> QueryOutcome) {
    let meter = query("coffee", Ceilings { examined: 1, ..Default::default() });
    assert_eq!(meter.cut, Some(snapback4_core::engine::ReadCut::Meter));
    assert!(meter.capped_at.is_some() && meter.word_cut_at.is_none());
    assert!(!meter.complete && meter.next.is_none());
    let words = query("cof", Ceilings::default());
    assert!(!words.complete && words.next.is_none());
    assert!(!words.data.as_array().unwrap().is_empty());
    assert_eq!(words.cut, Some(snapback4_core::engine::ReadCut::Words));
    assert!(words.word_cut_at.is_some() && words.capped_at.is_none());
    // Word discovery records its lane limit before examining rows. This
    // ceiling cuts the same merged page after the first scope's work.
    let both = query("cof", Ceilings { examined: 10, ..Default::default() });
    assert!(both.word_cut_at.is_some() && both.capped_at.is_some(), "{host}: {both:?}");
    assert_eq!(both.cut, Some(snapback4_core::engine::ReadCut::Meter));
    assert!(!both.complete && both.next.is_none());
    println!("W8R1a merge host={host} words=33 word_only_examined={} both_examined={} precedence=meter", words.metered.examined, both.metered.examined);
}
