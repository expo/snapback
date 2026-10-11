//! A row-independent test in a returned page's `where` is decided once, as an
//! `if` (LLP 3000.036 §15.4). The lowering is compile-time, so the server and
//! both device stores run the same program: they agree on the rows and, for a
//! caller the guard refuses, on a complete empty answer.
use super::*;

const GUARDS: &str = "table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  sync to .principal
table notes:
  owner: principal
  open: bool
  read <- .owner = viewer
  sync to .owner
query staffOpen(c: cursor ?):
  return notes where exists staff[viewer] and .open = true first 50 by .id after c
query handwritten(c: cursor ?):
  if exists staff[viewer]:
    return notes where .open = true first 50 by .id after c
  return []
query mineOrStaff(c: cursor ?):
  return notes where .owner = viewer and .open = true or exists staff[viewer] first 50 by .id after c
";

fn guards<H: Host>(mut host: H) {
    let (mut engine, backend) = compile(GUARDS);
    let row = |table: &str, fields: Json| (table.to_owned(), wire::row_from_json(&engine.schema().tables[table], &fields).unwrap());
    let rows = vec![
        row("staff", json!({"id":"s1","principal":"alice"})),
        row("notes", json!({"id":"n1","owner":"alice","open":true})),
        row("notes", json!({"id":"n2","owner":"alice","open":false})),
        row("notes", json!({"id":"n3","owner":"bob","open":true})),
        row("notes", json!({"id":"n4","owner":"bob","open":false})),
    ];
    engine.seed(rows).unwrap();
    for viewer in ["alice", "bob"] {
        let name = format!("guards-{viewer}");
        let mut device = host.open(&name, Some(snapback4_device::device::Backend { generation: engine.generation(), ..backend.clone() })).unwrap();
        for (i, page) in snapshot_pages(&mut engine, viewer, 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let mut answers = Vec::new();
        for op in ["staffOpen", "handwritten", "mineOrStaff"] {
            let server = engine.query(op, context(viewer, &[("c", snapback4_core::Value::Null)]).at(100)).unwrap();
            let (local, unknown, _) = device.query_with_coverage(op, viewer, &json!({"c": null}), 100);
            let local = local.unwrap();
            assert!(!unknown, "{} {viewer} {op}: the device answers without the server", host.label());
            assert_eq!(wire::to_json(&local.data), wire::to_json(&server.data), "{} {viewer} {op}", host.label());
            if viewer == "bob" && op != "mineOrStaff" {
                assert_eq!(wire::to_json(&server.data), json!([]), "{op}");
                assert!(server.complete && local.complete, "{op}: the guard refuses bob, so the empty answer is complete on both");
                assert!(server.metered.examined <= 1, "{op}: only the guard's probe is examined, no note is walked: {:?}", server.metered);
            }
            answers.push(wire::to_json(&server.data));
        }
        assert_eq!(answers[0], answers[1], "{viewer}: the where-guard and the handwritten if answer alike");
        host.close(&name, device);
    }
}
#[test] fn where_guards_memory() { guards(Memory::new()); }
#[test] fn where_guards_sqlite() { guards(Sqlite::new("where-guards")); }
