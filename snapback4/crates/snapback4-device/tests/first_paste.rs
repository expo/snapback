mod common;
use common::*;
use serde_json::json;
use snapback4_core::wire;

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/ag/name.q");

fn held_names<H: Host>(host: &mut H) {
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    let mut fixed = SOURCE.to_owned();
    for note in b.notes.iter().filter(|d| d.code == "N_NEVER_COMPLETE") {
        let start = SOURCE.find(if note.rewrite.starts_with("query groupByTitle") { "query groupByTitle" } else { "query groupNamed" }).unwrap();
        let end = SOURCE[start+1..].find("\nquery ").map_or(SOURCE.len(), |n| start + 1 + n);
        fixed = fixed.replace(SOURCE[start..end].trim_end(), &note.rewrite);
    }
    let (mut e, backend) = compile(&fixed);
    for (id, owner, kind) in [
        ("0-dm", "alice", "dm"), ("a", "alice", "group"), ("b", "alice", "group"),
        ("c", "alice", "group"), ("d", "alice", "group"), ("e", "alice", "group"),
        ("f", "alice", "group"), ("hidden", "bob", "group"),
    ] {
        for (table, value) in [
            ("conversations", json!({"id":id,"title":"General","kind":kind})),
            ("members", json!({"id":format!("member-{id}"),"conversation":id,"principal":owner})),
        ] {
            let row = wire::row_from_json(&e.schema().tables[table], &value).unwrap();
            e.seed(vec![(table.into(), row)]).unwrap();
        }
    }
    let mut device = host.open("names", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut e, "alice", 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    for (op, expected) in [("groupByTitle", json!(["a"])), ("groupNamed", json!(["a", "b", "c", "d", "e"]))] {
        for title in ["General", "Missing"] {
            let (q, unknown, _) = device.query_with_coverage(op, "alice", &json!({"title":title}), 100);
            let q = q.unwrap();
            assert!(!unknown && q.complete, "{} {op}: {q:?}", host.label());
            let ids: Vec<_> = q.data.as_array().unwrap().iter().map(|row| wire::to_json(row.field("id").unwrap())).collect();
            assert_eq!(json!(ids), if title == "General" { expected.clone() } else { json!([]) }, "{} {op}", host.label());
            if op == "groupNamed" && title == "General" {
                let cursor = q.next.as_ref().expect("six groups require another page");
                let (next, unknown, _) = device.query_with_coverage(op, "alice", &json!({"title":title,"c":cursor}), 100);
                let next = next.unwrap();
                assert!(!unknown && next.complete, "{} {op}: {next:?}", host.label());
                let ids: Vec<_> = next.data.as_array().unwrap().iter().map(|row| wire::to_json(row.field("id").unwrap())).collect();
                assert_eq!(ids, vec![json!("f")], "{}: continuation must not repeat the first page", host.label());
            }
        }
    }
}

#[test] fn comparative_and_cal25_name_rewrites_run_on_memory() { held_names(&mut Memory::new()); }
#[test] fn comparative_and_cal25_name_rewrites_run_on_sqlite() { held_names(&mut Sqlite::new("ag-names")); }
