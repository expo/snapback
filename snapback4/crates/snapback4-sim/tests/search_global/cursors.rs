//! Crafted positions exercise the published direct search and matching merge.
#![allow(dead_code)]
use snapback4_core::{Value, cursor::{decode_cursor, encode_cursor}, engine::QueryOutcome, ir::Order, schema::Schema};

pub fn source() -> String {
    format!("{}\nquery searchPair(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 20 by byRoomWords:\n    ['r0000']\n    ['r0001']\n    ['r0002']\n\nquery searchLane(q: text <=100, c: cursor ?):\n  return messages['r0000'] matching q after c last 20 by byRoomWords\n", super::fixture::legacy_source())
}

pub fn seed() -> Vec<(String, Value)> {
    super::fixture::seed(2).into_iter().map(|(table, mut row)| {
        // Put hidden keys inside the visible lanes' range, including exact
        // timestamp ties. The cursor must not need a visible witness row.
        if table == "messages" && row.field("roomId").unwrap().as_str().unwrap() == "r0002" {
            if let Value::Row(ref mut fields) = row { fields.insert("at".into(), Value::Int(12)); }
        }
        (table, row)
    }).collect()
}

// @ref LLP 3000.007#18.1 — matching lanes share a typed ordering position, including positions with no visible witness row.
pub fn positions(schema: &Schema, next: &str) -> Vec<(&'static str, String, Vec<String>)> {
    [("before-range", -1, "before"), ("after-range", 30, "after"), ("hidden-key", 12, "r0002-12")].into_iter().map(|(name, at, id)| {
        let mut position = decode_cursor(schema, next).unwrap();
        position.values = vec![Value::Int(at), Value::Id(id.into())];
        let token = encode_cursor(schema, &position).unwrap();
        let expected = (0..24).rev().flat_map(|n| (0..2).rev().map(move |room| (n, format!("r{room:04}-{n:02}"))))
            .filter(|(n, candidate)| (*n, candidate.as_str()) < (at, id)).map(|(_, id)| id).collect();
        (name, token, expected)
    }).collect()
}

pub fn malformed(schema: &Schema, next: &str) -> Vec<(&'static str, String)> {
    let mut cases = Vec::new();
    for name in ["table", "index", "order", "suffix-name", "suffix-type", "suffix-length"] {
        let mut position = decode_cursor(schema, next).unwrap();
        match name {
            "table" => position.table = "members".into(),
            "index" => position.index = "byRoomTime".into(),
            "order" => position.order = Order::Asc,
            "suffix-name" => position.suffix[0].name = "roomId".into(),
            "suffix-type" => position.suffix[0].kind = snapback4_core::schema::ColumnType::Int,
            "suffix-length" => { position.suffix.pop(); position.values.pop(); }
            _ => unreachable!(),
        }
        cases.push((name, encode_cursor(schema, &position).unwrap()));
    }
    cases.push(("noncanonical-base64", format!("{next}=")));
    cases.push(("malformed-encoding", "W10".into())); // [] in base64url
    cases
}

pub fn ids(page: &QueryOutcome) -> Vec<String> {
    assert!(page.complete, "{page:?}");
    assert!(page.capped_at.is_none() && page.word_cut_at.is_none());
    page.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()).collect()
}
