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
    assert_eq!(bound.schema.required_capabilities(), ["sequence-by".into()].into());
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
    for code in ["E_SEQUENCE_PARENT", "E_SEQUENCE_SUPPLIED", "E_SEQUENCE_EXHAUSTED"] {
        assert!(explain_code(code).unwrap().contains("sequence"));
    }
}
