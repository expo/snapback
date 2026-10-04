use snapback4_core::schema::ColumnType;
use snapback4_lang::{compile, guide::explain_code};
const SOURCE: &str = include_str!("fixtures/sequence-by.q");

#[test]
fn parses_binds_and_round_trips_int_sequences() {
    let bound = compile(&[("sequence.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    for (table, column) in [("messages", "ordinal"), ("members", "joinedAt")] {
        assert_eq!(bound.schema.tables[table].columns[column], ColumnType::Int);
        assert_eq!(bound.schema.tables[table].sequences[column], "conversationId");
    }
    let json = serde_json::to_string(&bound.schema).unwrap();
    let decoded: snapback4_core::schema::Schema = serde_json::from_str(&json).unwrap();
    assert_eq!(bound.schema, decoded);
    assert_eq!(bound.schema.required_capabilities(), ["sequence-by".into(), "source-write-reservations-v1".into(), "source-write-reservations-v2".into()].into());
    let mut unfenced: serde_json::Value = serde_json::from_str(&json).unwrap();
    for table in unfenced["tables"].as_object_mut().unwrap().values_mut() {
        table["constraints"].as_array_mut().unwrap().retain(|c| c.get("Capabilities").is_none());
    }
    assert!(serde_json::from_value::<snapback4_core::schema::Schema>(unfenced).unwrap_err().to_string().contains("E_SCHEMA_CAPABILITY"));
}

#[test]
fn parent_and_supplied_refusals_have_rewrites_and_explanations() {
    for source in [
        SOURCE.replace("sequence by conversationId", "sequence by missing"),
        SOURCE.replace("conversationId: conversations", "conversationId: int"),
        SOURCE.replace("conversationId: conversations", "conversationId: conversations ?"),
        SOURCE.replace("sequence by conversationId", "sequence by"),
    ] {
        let bound = compile(&[("bad.q".into(), source)]);
        let d = bound.diagnostics.iter().find(|d| d.code == "E_SEQUENCE_PARENT").expect("parent diagnostic");
        assert!(!d.rewrite.is_empty());
    }
    for op in [
        "insert messages { conversationId: 'c', body: 'x', ordinal: 9 }",
        "update messages['m'] { ordinal: 9 }",
        "upsert messages['m'] { ordinal: 9 }",
    ] {
        let bound = compile(&[("bad.q".into(), format!("{SOURCE}\nmutation bad():\n  {op}\n"))]);
        let d = bound.diagnostics.iter().find(|d| d.code == "E_SEQUENCE_SUPPLIED").expect("supplied diagnostic");
        assert!(!d.rewrite.is_empty());
        assert!(d.rewrite.contains("ordinal"));
    }
    assert!(explain_code("E_SEQUENCE_PARENT").unwrap().contains("import a new row id"));
    for code in ["E_SEQUENCE_PARENT", "E_SEQUENCE_SUPPLIED", "E_SEQUENCE_EXHAUSTED"] {
        assert!(explain_code(code).unwrap().contains("sequence"));
    }
}

#[test]
fn sequence_remains_an_ordinary_table_reference_without_by() {
    let source = "table sequence:\n  public 'parent'\n  online only\ntable children:\n  parent: sequence\n  ordinal: sequence by parent\n  public 'child'\n  online only\n";
    let bound = compile(&[("sequence.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.schema.tables["children"].columns["parent"], ColumnType::Ref { table: "sequence".into() });
}

#[test]
fn maintained_paths_see_implicit_sequence_and_parent_immutability() {
    let source = SOURCE.replace("  immutable ordinal\n", "");
    let source = format!("{source}\ntable receipts:\n  messageId: messages\n  serial: sequence by messageId\n  public 'receipts'\n  sync public\nview receiptsByOrdinal: count receipts by messageId.ordinal\nview messagesByTitle: count messages by conversationId.title\n");
    let source = source.replace("  title: text <=40", "  title: text <=40\n  immutable title");
    let bound = compile(&[("sequence.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.schema.tables["receipts"].recorded.contains_key("messageId.ordinal"));
    assert!(bound.schema.tables["messages"].recorded.contains_key("conversationId.title"));
}

#[test]
fn maintained_target_ordinal_needs_no_explicit_immutable() {
    let source = SOURCE.replace("  immutable ordinal\n", "");
    let source = format!("{source}\ntable receipts:\n  messageId: messages\n  immutable messageId\n  public 'receipts'\n  sync public\nview receiptsByOrdinal: count receipts by messageId.ordinal\n");
    let bound = compile(&[("sequence.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.schema.tables["receipts"].recorded.contains_key("messageId.ordinal"));
}

#[test]
fn sequence_read_prerequisite_is_in_the_generic_rule_explanation() {
    let explanation = explain_code("E_RULE").unwrap();
    assert!(explanation.contains("sequence insert requires read authority independent of its ordinal"));
    assert!(explanation.contains("unique key or cap group"));
}
