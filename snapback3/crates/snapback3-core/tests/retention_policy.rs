use serde_json::json;
use snapback3_core::{RetentionPolicy, Table};

#[test]
fn table_retention_deserializes_default_and_round_trips_policy_spellings() {
    let old_table = json!({
        "columns": {},
        "indexes": {},
        "rules": {
            "read": "Deny",
            "insert": "Deny",
            "update": "Deny",
            "delete": "Deny"
        },
        "constraints": []
    });
    let defaulted: Table = serde_json::from_value(old_table).unwrap();
    assert_eq!(defaulted.retain, RetentionPolicy::UntilRevoked);
    assert_eq!(
        serde_json::to_value(&defaulted).unwrap()["retain"],
        "until-revoked"
    );

    let delivered: Table = serde_json::from_value(json!({
        "columns": {},
        "indexes": {},
        "rules": {
            "read": "Deny",
            "insert": "Deny",
            "update": "Deny",
            "delete": "Deny"
        },
        "constraints": [],
        "retain": "delivered-history"
    }))
    .unwrap();
    assert_eq!(delivered.retain, RetentionPolicy::DeliveredHistory);
    assert_eq!(
        serde_json::to_value(&delivered).unwrap()["retain"],
        "delivered-history"
    );

    let unknown = json!({
        "columns": {},
        "indexes": {},
        "rules": {
            "read": "Deny",
            "insert": "Deny",
            "update": "Deny",
            "delete": "Deny"
        },
        "constraints": [],
        "retain": "forever"
    });
    assert!(
        serde_json::from_value::<Table>(unknown).is_err(),
        "an unknown retention policy must fail closed"
    );
}
