use super::*;

#[test]
fn inspection_materializes_required_literals_but_not_optional_defaults() {
    let p = Project::new();
    let mut e = p.seed(&p.store(), 1);
    let source = SOURCE.replace("  read", "  tombstone: bool default false\n  score: int default -7\n  label: text <=20 default \"O'Reilly\"\n  role: enum('member', 'admin') default 'member'\n  amount: decimal 2 default 125\n  room: id default 'r'\n  optional: bool ? default true\n  read");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    // The working source remains old: inspection must use the stored generation.
    let sql = p.run(&["sql", "SELECT tombstone, score, label, role, amount, room, optional FROM messages", "--json"]);
    assert!(sql.status.success(), "{sql:?}");
    let data = p.run(&["data", "messages"]);
    println!("inspection SQL={} data={}", String::from_utf8_lossy(&sql.stdout), String::from_utf8_lossy(&data.stdout));
    assert_eq!(parsed(&sql)["rows"], json!([[0, -7, "O'Reilly", "member", 125, "r", null]]));
    assert!(data.status.success(), "{data:?}");
    assert_eq!(parsed(&data), json!({"id":"m0", "body":"old", "tombstone":false,"score":-7,"label":"O'Reilly","role":"member","amount":125,"room":"r","optional":null}));
    assert!(e.store().rows("messages").unwrap()[0].field("tombstone").is_err());
    let explicit = json!({"id":"explicit", "body":"new", "tombstone":true,"score":0,"label":"","role":"admin","amount":0,"room":"other","optional":false});
    let row = wire::row_from_json(&e.schema().tables["messages"], &explicit).unwrap();
    e.seed([("messages".into(), row)]).unwrap();
    let sql = p.run(&["sql", "SELECT tombstone, score, label, role, amount, room, optional FROM messages WHERE id = 'explicit'", "--json"]);
    assert_eq!(parsed(&sql)["rows"], json!([[1, 0, "", "admin", 0, "other", 0]]));
    let data = p.run(&["data", "messages"]);
    let lines: Vec<Value> = String::from_utf8(data.stdout).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
    assert!(lines.contains(&explicit), "explicit values win over defaults");

    for select in [
        "SELECT id, tombstone AS gone, optional, score, 1 AS one, 0 AS tombstone FROM messages ORDER BY id",
        "WITH c AS (SELECT m.id, m.tombstone AS gone, m.optional, m.score FROM messages m) SELECT id, gone, optional, score, 1 AS one, 0 AS tombstone FROM c ORDER BY id",
        "SELECT m.id, m.tombstone AS gone, m.optional, m.score, 1 AS one, 0 AS tombstone FROM messages m JOIN messages n ON m.id = n.id ORDER BY m.id",
    ] {
        let result = p.run(&["sql", select, "--json-objects"]);
        assert!(result.status.success(), "{select}: {result:?}");
        assert_eq!(parsed(&result)["rows"], json!([
            {"id":"explicit", "gone":true, "optional":false, "score":0, "one":1, "tombstone":0},
            {"id":"m0", "gone":false, "optional":null, "score":-7, "one":1, "tombstone":0},
        ]), "{select}");
    }
    let wildcard = p.run(&["sql", "SELECT * FROM messages ORDER BY id", "--json-objects", "--limit", "1"]);
    assert!(wildcard.status.success(), "{wildcard:?}");
    assert_eq!(parsed(&wildcard)["rows"][0]["tombstone"], true);
    assert_eq!(parsed(&wildcard)["more"], true);
    let duplicates = p.run(&["sql", "SELECT id AS x, tombstone AS x FROM messages", "--json-objects"]);
    assert!(!duplicates.status.success());
    assert_eq!(parsed(&duplicates)["denied"]["code"], "E_INPUT");
    assert!(!p.run(&["sql", "SELECT tombstone AS X, optional AS x FROM messages", "--json-objects"]).status.success());
    let derived = p.run(&["sql", "SELECT d.gone FROM (SELECT tombstone AS gone FROM messages) d ORDER BY gone", "--json-objects"]);
    assert_eq!(parsed(&derived)["rows"], json!([{"gone":false}, {"gone":true}]));
    let recursive = p.run(&["sql", "WITH RECURSIVE c(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM c WHERE n<2) SELECT n FROM c", "--json-objects"]);
    assert!(!recursive.status.success());
    assert_eq!(parsed(&recursive)["denied"]["code"], "E_INPUT");
    assert!(p.run(&["sql", "\\dt", "--json-objects"]).status.success());
    for sql in [
        "WITH c AS (SELECT (tombstone) FROM messages) SELECT tombstone FROM c ORDER BY tombstone",
        "SELECT tombstone FROM (SELECT (m.tombstone) FROM messages m) d ORDER BY tombstone",
        "SELECT tombstone FROM messages a JOIN messages b USING(tombstone) ORDER BY tombstone",
    ] {
        let result = p.run(&["sql", sql, "--json-objects"]);
        assert!(result.status.success(), "{sql}: {result:?}");
        assert_eq!(parsed(&result)["rows"], json!([{"tombstone":false}, {"tombstone":true}]), "{sql}");
    }
    let union = p.run(&["sql", "SELECT tombstone FROM messages UNION SELECT tombstone FROM messages ORDER BY tombstone", "--json-objects"]);
    assert_eq!(parsed(&union)["rows"], json!([{"tombstone":false}, {"tombstone":true}]));
    let mixed = p.run(&["sql", "SELECT tombstone FROM messages UNION SELECT 7 AS tombstone FROM messages ORDER BY tombstone", "--json-objects"]);
    assert_eq!(parsed(&mixed)["rows"], json!([{"tombstone":0}, {"tombstone":1}, {"tombstone":7}]));
    for sql in [
        "WITH messages AS (SELECT tombstone AS score FROM temp.messages) SELECT score FROM temp.messages",
        "WITH a AS (SELECT tombstone FROM messages), messages AS (SELECT 7 AS tombstone FROM temp.messages) SELECT tombstone FROM a",
        "WITH a AS (SELECT tombstone FROM b), b AS (SELECT tombstone FROM messages) SELECT tombstone FROM a",
    ] {
        let result = p.run(&["sql", sql, "--json-objects"]);
        assert!(!result.status.success(), "lineage must refuse, never coerce integers into booleans: {sql}: {result:?}");
        assert_eq!(parsed(&result)["denied"]["code"], "E_INPUT");
        assert!(p.run(&["sql", sql, "--json"]).status.success(), "positional SQLite remains supported: {sql}");
    }
    for sql in ["DELETE FROM messages", "SELECT * FROM _meta"] {
        assert!(!p.run(&["sql", sql, "--json-objects"]).status.success(), "{sql}");
    }
}
