//! `tombstones <table>[.<column>] if <when>` at the project JSON trust boundary:
//! serde compatibility, hash stability for schemas without the word, and the
//! validator's acceptance and refusals (LLP 1012 §5 rule 3).
use serde_json::json;
use snapback2_core::{
    ColumnType, Index, RuleExpr, RuleTerm, Schema, Table, Tombstone, Value, public_table,
    validate_schema,
};
use std::collections::BTreeMap;

fn columns<const N: usize>(columns: [(&str, ColumnType); N]) -> BTreeMap<String, ColumnType> {
    columns
        .into_iter()
        .map(|(name, kind)| (name.to_owned(), kind))
        .collect()
}

fn by_id() -> BTreeMap<String, Index> {
    BTreeMap::from([(
        "byId".to_owned(),
        Index {
            columns: vec!["id".to_owned()],
            unique: true,
        },
    )])
}

fn kind_is(value: &str) -> RuleExpr {
    RuleExpr::Eq(
        RuleTerm::Field("kind".to_owned()),
        RuleTerm::Literal(Value::String(value.to_owned())),
    )
}

fn removed_or_expired() -> RuleExpr {
    RuleExpr::Or(vec![kind_is("removed"), kind_is("expired")])
}

fn tombstone(when: RuleExpr) -> Tombstone {
    Tombstone {
        table: "messages".to_owned(),
        column: "messageId".to_owned(),
        when,
    }
}

/// The chat template's shape: a per-recipient log whose rows name a body.
fn log_schema(tombstones: Vec<Tombstone>) -> Schema {
    let mut schema = Schema::default();
    schema.tables.insert(
        "messages".to_owned(),
        public_table(
            columns([("id", ColumnType::Id), ("body", ColumnType::Text { max: 10 })]),
            by_id(),
        ),
    );
    let mut deliveries = public_table(
        columns([
            ("id", ColumnType::Id),
            ("recipient", ColumnType::Principal),
            (
                "messageId",
                ColumnType::Ref {
                    table: "messages".to_owned(),
                },
            ),
            (
                "editOf",
                ColumnType::Optional(Box::new(ColumnType::Ref {
                    table: "messages".to_owned(),
                })),
            ),
            (
                "kind",
                ColumnType::Enum {
                    variants: ["message", "edit", "removed", "expired"]
                        .map(str::to_owned)
                        .to_vec(),
                },
            ),
            ("final", ColumnType::Bool),
            ("note", ColumnType::Optional(Box::new(ColumnType::Text { max: 20 }))),
            ("at", ColumnType::Time),
        ]),
        by_id(),
    );
    deliveries.tombstones = tombstones;
    schema.tables.insert("deliveries".to_owned(), deliveries);
    schema
}

fn refusal(schema: &Schema) -> String {
    let errors = validate_schema(schema).expect_err("schema must be refused");
    assert!(
        errors.iter().all(|error| error.code() == "E_SCHEMA"),
        "tombstone refusals are E_SCHEMA: {errors:?}"
    );
    errors
        .iter()
        .map(|error| error.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn a_table_without_the_word_serializes_and_hashes_exactly_as_before() {
    let old_table = json!({
        "columns": {},
        "indexes": {},
        "rules": { "read": "Deny", "insert": "Deny", "update": "Deny", "delete": "Deny" },
        "constraints": [],
        "retain": "until-revoked"
    });
    let table: Table = serde_json::from_value(old_table.clone()).unwrap();
    assert!(table.tombstones.is_empty());
    assert_eq!(
        serde_json::to_value(&table).unwrap(),
        old_table,
        "an empty tombstones list must leave the canonical bytes untouched"
    );
    let bare = log_schema(Vec::new());
    assert!(!serde_json::to_string(&bare).unwrap().contains("tombstones"));
    let declared = log_schema(vec![tombstone(removed_or_expired())]);
    assert_ne!(bare.hash(), declared.hash(), "the declaration is part of schema identity");
}

#[test]
fn the_declaration_round_trips_in_the_rule_expression_encoding() {
    let schema = log_schema(vec![tombstone(removed_or_expired())]);
    let encoded = serde_json::to_value(&schema).unwrap();
    assert_eq!(
        encoded["tables"]["deliveries"]["tombstones"],
        json!([{
            "table": "messages",
            "column": "messageId",
            "when": { "Or": [
                { "Eq": [{ "Field": "kind" }, { "Literal": { "String": "removed" } }] },
                { "Eq": [{ "Field": "kind" }, { "Literal": { "String": "expired" } }] }
            ] }
        }])
    );
    let decoded: Schema = serde_json::from_value(encoded).unwrap();
    assert_eq!(decoded, schema);
}

#[test]
fn well_formed_declarations_validate() {
    for (name, tombstones) in [
        ("removed or expired", vec![tombstone(removed_or_expired())]),
        (
            "several lines union",
            vec![tombstone(kind_is("removed")), tombstone(kind_is("expired"))],
        ),
        (
            "optional reference and text column",
            vec![Tombstone {
                table: "messages".to_owned(),
                column: "editOf".to_owned(),
                when: RuleExpr::Ne(
                    RuleTerm::Field("note".to_owned()),
                    RuleTerm::Literal(Value::String("keep".to_owned())),
                ),
            }],
        ),
        (
            "bool column, not, and",
            vec![tombstone(RuleExpr::And(vec![
                RuleExpr::Eq(
                    RuleTerm::Field("final".to_owned()),
                    RuleTerm::Literal(Value::Bool(true)),
                ),
                RuleExpr::Not(Box::new(kind_is("message"))),
            ]))],
        ),
    ] {
        assert!(
            validate_schema(&log_schema(tombstones)).is_ok(),
            "{name} was refused"
        );
    }
}

#[test]
fn unknown_target_table_is_refused() {
    let schema = log_schema(vec![Tombstone {
        table: "bodies".to_owned(),
        column: "messageId".to_owned(),
        when: kind_is("removed"),
    }]);
    let text = refusal(&schema);
    assert!(text.contains("schema.tables.deliveries.tombstones[0]"), "{text}");
    assert!(text.contains("tombstones bodies[.messageId] names unknown table bodies"), "{text}");
    assert!(text.contains("is Ref(messages), not a reference to bodies"), "{text}");
}

#[test]
fn unknown_or_non_reference_column_is_refused() {
    let unknown = log_schema(vec![Tombstone {
        table: "messages".to_owned(),
        column: "bodyId".to_owned(),
        when: kind_is("removed"),
    }]);
    assert!(refusal(&unknown).contains("names unknown column deliveries.bodyId"));
    let principal = log_schema(vec![Tombstone {
        table: "messages".to_owned(),
        column: "recipient".to_owned(),
        when: kind_is("removed"),
    }]);
    assert!(refusal(&principal).contains("column deliveries.recipient is Principal, not a reference to messages"));
}

#[test]
fn predicates_outside_the_row_local_vocabulary_are_refused() {
    let viewer = tombstone(RuleExpr::Eq(
        RuleTerm::Field("recipient".to_owned()),
        RuleTerm::Viewer,
    ));
    let text = refusal(&log_schema(vec![viewer]));
    assert!(text.contains("cannot mention viewer"), "{text}");
    assert!(text.contains("column recipient is Principal"), "{text}");

    let exists = tombstone(RuleExpr::Exists {
        table: "messages".to_owned(),
        index: "byId".to_owned(),
        key: vec![RuleTerm::Field("messageId".to_owned())],
        provenance: snapback2_core::KeyProvenance::Shape,
    });
    assert!(refusal(&log_schema(vec![exists])).contains("cannot probe other tables with exists or created"));

    let allow = tombstone(RuleExpr::Allow);
    assert!(refusal(&log_schema(vec![allow])).contains("allow, deny, and public are not predicates"));

    let old_image = tombstone(RuleExpr::Eq(
        RuleTerm::OldField("kind".to_owned()),
        RuleTerm::Literal(Value::String("removed".to_owned())),
    ));
    assert!(refusal(&log_schema(vec![old_image])).contains("there are no old or next images"));
}

#[test]
fn predicate_columns_and_literals_must_be_enum_bool_or_text() {
    let unknown = tombstone(RuleExpr::Eq(
        RuleTerm::Field("state".to_owned()),
        RuleTerm::Literal(Value::String("removed".to_owned())),
    ));
    assert!(refusal(&log_schema(vec![unknown])).contains("names unknown column state"));

    let time = tombstone(RuleExpr::Eq(
        RuleTerm::Field("at".to_owned()),
        RuleTerm::Literal(Value::String("never".to_owned())),
    ));
    assert!(refusal(&log_schema(vec![time])).contains("column at is Time; only enum, bool, and text columns decide a tombstone"));

    let int_literal = tombstone(RuleExpr::Eq(
        RuleTerm::Field("kind".to_owned()),
        RuleTerm::Literal(Value::Int(1)),
    ));
    assert!(refusal(&log_schema(vec![int_literal])).contains("must be a string or bool"));

    let mismatch = tombstone(RuleExpr::Eq(
        RuleTerm::Field("final".to_owned()),
        RuleTerm::Literal(Value::String("yes".to_owned())),
    ));
    assert!(refusal(&log_schema(vec![mismatch])).contains("compares a bool with text"));

    let variant = tombstone(kind_is("gone"));
    let text = refusal(&log_schema(vec![variant]));
    assert!(text.contains("compares kind with 'gone', which is not one of message|edit|removed|expired"), "{text}");
}

#[test]
fn every_refusal_in_one_declaration_is_reported_together() {
    let schema = log_schema(vec![Tombstone {
        table: "bodies".to_owned(),
        column: "recipient".to_owned(),
        when: RuleExpr::And(vec![
            RuleExpr::Eq(RuleTerm::Field("at".to_owned()), RuleTerm::Viewer),
            kind_is("gone"),
        ]),
    }]);
    let errors = validate_schema(&schema).unwrap_err();
    assert_eq!(errors.len(), 5, "{errors:?}");
}
