//! A first page is not the whole acknowledgement set (LLP 3000.013 Lane O).
use serde_json::json;
use snapback4_core::{Context, Engine, Value, wire};
use std::{fs, process::Command};

const SOURCE: &str = "table messages:\n  public 'fixture messages'\n  online only\ntable chatDeliveries:\n  messageId: messages\n  principal: principal\n  cap 50 by messageId\n  public 'fixture acknowledgements'\n  online only\nquery all():\n  return chatDeliveries first 50 by .id\nquery page(c: cursor ?):\n  return chatDeliveries first 50 by .id after c\nquery forMessage(messageId: messages):\n  return chatDeliveries where .messageId = messageId\n";

#[test]
fn first_fifty_deliveries_are_complete_and_continuation_reaches_later_acknowledgements() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let notes: Vec<_> = bound.notes.iter().filter(|n| n.code == "N_NO_CURSOR").collect();
    assert_eq!(notes.len(), 1, "{:?}", bound.notes);
    let note = notes[0];
    assert_eq!(note.site.line, 10);
    for rewrite in ["if the screen pages", "c: cursor ?", "after c"] {
        assert!(note.rewrite.contains(rewrite), "{note}");
    }
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let mut rows = Vec::new();
    for n in 0..51 {
        for (table, row) in [
            ("messages", json!({"id": format!("m{n:03}")})),
            ("chatDeliveries", json!({"id": format!("d{n:03}"), "messageId": format!("m{n:03}"), "principal": "alice"})),
        ] {
            rows.push((table.into(), wire::row_from_json(&bound.schema.tables[table], &row).unwrap()));
        }
    }
    engine.seed(rows).unwrap();
    let all = engine.query("all", Context::new("alice", Default::default())).unwrap();
    assert_eq!(all.data.as_array().unwrap().len(), 50);
    assert!(all.complete); assert!(all.next.is_none());
    assert!(all.data.as_array().unwrap().iter().all(|row| row.field("id") != Ok(&Value::Id("d050".into()))));
    let page = engine.query("page", Context::new("alice", [("c".into(), Value::Null)].into())).unwrap();
    let next = engine.query("page", Context::new("alice", [("c".into(), Value::String(page.next.unwrap()))].into())).unwrap();
    assert_eq!(next.data.as_array().unwrap()[0].field("id"), Ok(&Value::Id("d050".into())));
    let scoped = engine.query("forMessage", Context::new("alice", [("messageId".into(), Value::Id("m050".into()))].into())).unwrap();
    assert!(scoped.complete);
    assert_eq!(scoped.data.as_array().unwrap().len(), 1);
    assert_eq!(scoped.data.as_array().unwrap()[0].field("id"), Ok(&Value::Id("d050".into())));

    let dir = std::env::temp_dir().join(format!("sb4-delivery-note-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    fs::write(dir.join("snapback/schema.q"), SOURCE).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["check", "--json"]).current_dir(&dir).output().unwrap();
    fs::remove_dir_all(dir).unwrap();
    assert!(output.status.success(), "{output:?}");
    let checked: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let note = checked["notes"].as_array().unwrap().iter().find(|n| n["code"] == "N_NO_CURSOR").unwrap();
    assert!(note["rewrite"].as_str().unwrap().contains("if the screen pages"), "{note}");
}
