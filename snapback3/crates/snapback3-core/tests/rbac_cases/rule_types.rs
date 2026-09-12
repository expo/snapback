use serde_json::{Value as Json, json};
use snapback3_core::{Ceilings, CheckError, Generation, ProjectJson, Value};

fn valid_project_json() -> Json {
    json!({
        "version": 1,
        "schema": {
            "tables": {
                "profiles": {
                    "columns": {
                        "id": "Id",
                        "principal": "Principal"
                    },
                    "indexes": {
                        "byId": { "components": [{"Column": "id"}], "unique": true },
                        "byPrincipal": { "components": [{"Column": "principal"}], "unique": true }
                    },
                    "rules": {
                        "read": { "Eq": [{ "Field": "principal" }, "Viewer"] },
                        "insert": { "Eq": ["Viewer", { "Literal": { "Id": "system" } }] },
                        "update": { "Ne": [{ "Field": "principal" }, { "Literal": { "Id": "system" } }] },
                        "delete": { "Not": "Deny" }
                    }
                },
                "grants": {
                    "columns": {
                        "id": "Id",
                        "scope": "Id",
                        "subject": "Principal",
                        "profile": { "Ref": { "table": "profiles" } }
                    },
                    "indexes": {
                        "byId": { "components": [{"Column": "id"}], "unique": true },
                        "byProfile": { "components": [{"Column": "profile"}], "unique": false },
                        "byScopeSubject": { "components": [{"Column": "scope"}, {"Column": "subject"}], "unique": true }
                    },
                    "rules": {
                        "read": {
                            "And": [
                                { "Eq": [{ "Field": "subject" }, "Viewer"] },
                                {
                                    "Exists": {
                                        "table": "profiles",
                                        "index": "byPrincipal",
                                        "key": ["Viewer"],
                                        "provenance": "Viewer"
                                    }
                                },
                                {
                                    "Exists": {
                                        "table": "profiles",
                                        "index": "byId",
                                        "key": [{ "Field": "profile" }],
                                        "provenance": "Shape"
                                    }
                                }
                            ]
                        },
                        "insert": "Allow",
                        "update": "Allow",
                        "delete": "Deny"
                    }
                }
            },
            "channels": {
                "presence": {
                    "args": {
                        "scope": "Id",
                        "target": "Principal"
                    },
                    "publish": { "Eq": [{ "Field": "target" }, "Viewer"] },
                    "subscribe": {
                        "Or": [
                            {
                                "Exists": {
                                    "table": "grants",
                                    "index": "byScopeSubject",
                                    "key": [{ "Field": "scope" }, { "Field": "target" }],
                                    "provenance": "Shape"
                                }
                            },
                            { "Eq": ["Viewer", { "Literal": { "Id": "system" } }] }
                        ]
                    },
                    "value": {"typing":"Bool"}, "ttl_ms": 4000
                }
            }
        },
        "programs": [],
        "effects": [],
        "auth": { "password": false, "guests": false }
    })
}

fn certify(raw: Json) -> Result<Generation, Vec<(String, CheckError)>> {
    let project: ProjectJson = serde_json::from_value(raw).expect("raw ProjectJson fixture");
    Generation::certify(&project, Ceilings::default())
}

fn only_rule_error(raw: Json, expected_site: &str, message: &str) {
    let errors = certify(raw).expect_err("invalid raw rule must be refused");
    assert_eq!(errors.len(), 1, "unexpected errors: {errors:#?}");
    let (site, error) = &errors[0];
    assert_eq!(site, expected_site);
    assert_eq!(error.code, "E_RULE_INVALID");
    assert!(error.message.contains(message), "{error:#?}");
    assert_eq!(
        error.rewrite,
        "declare authority axes as Principal and align rule terms with the referenced index columns"
    );
}

#[test]
fn raw_project_json_accepts_nominal_principal_rules_and_the_reserved_system_literal() {
    let generation = certify(valid_project_json()).expect("valid nominal rule project");
    assert_eq!(generation.schema().tables.len(), 2);
    assert_eq!(generation.schema().channels.len(), 1);
}

#[test]
fn raw_project_json_cannot_bypass_principal_comparison_typing() {
    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        json!({ "Eq": [{ "Field": "id" }, "Viewer"] });
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read",
        "joins Id with Principal",
    );

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        json!({ "Ne": [{ "Field": "profile" }, "Viewer"] });
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read",
        "joins Ref<profiles> with Principal",
    );

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        json!({ "Eq": ["Viewer", { "Literal": { "Id": "caller-controlled" } }] });
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read",
        "joins Principal with id literal",
    );

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        json!({ "Eq": [{ "Field": "scope" }, { "Literal": { "String": "wrong" } }] });
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read",
        "joins Id with text literal",
    );

    let mut raw = valid_project_json();
    raw["schema"]["channels"]["presence"]["publish"] =
        json!({ "Eq": [{ "Field": "scope" }, "Viewer"] });
    only_rule_error(
        raw,
        "schema.channels.presence.publish",
        "joins Id with Principal",
    );

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] = json!({
        "Or": [
            "Deny",
            { "Not": { "Eq": [{ "Field": "profile" }, "Viewer"] } }
        ]
    });
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read.or[1].not",
        "joins Ref<profiles> with Principal",
    );
}

#[test]
fn raw_project_json_exists_terms_must_match_the_resolved_index_axis() {
    let exists = |table: &str, index: &str, key: Json| {
        json!({
            "Exists": {
                "table": table,
                "index": index,
                "key": key,
                "provenance": "Shape"
            }
        })
    };

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        exists("profiles", "byId", json!(["Viewer"]));
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read.exists.key[0]",
        "is Principal; expected Id",
    );

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        exists("grants", "byProfile", json!(["Viewer"]));
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read.exists.key[0]",
        "is Principal; expected Ref<profiles>",
    );

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        exists("profiles", "byPrincipal", json!([{ "Field": "scope" }]));
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read.exists.key[0]",
        "is Id; expected Principal",
    );

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        exists("profiles", "byPrincipal", json!([{ "Field": "profile" }]));
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read.exists.key[0]",
        "is Ref<profiles>; expected Principal",
    );

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        exists("profiles", "byPrincipal", json!([]));
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read",
        "has 0 terms; expected 1",
    );

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        exists("missing", "byPrincipal", json!(["Viewer"]));
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read",
        "unknown table missing",
    );

    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        exists("profiles", "missing", json!(["Viewer"]));
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read",
        "unknown index profiles.missing",
    );
}

#[test]
fn raw_project_json_exists_accepts_only_the_outer_tables_intrinsic_id_as_its_ref() {
    let exists = |table: &str, index: &str, field: &str| {
        json!({
            "Exists": {
                "table": table,
                "index": index,
                "key": [{ "Field": field }],
                "provenance": "Shape"
            }
        })
    };

    let mut accepted = valid_project_json();
    accepted["schema"]["tables"]["grants"]["rules"]["read"] = json!("Allow");
    accepted["schema"]["tables"]["profiles"]["rules"]["read"] = exists("grants", "byProfile", "id");
    certify(accepted).expect("the outer profiles.id must inhabit Ref<profiles>");

    let mut arbitrary_id = valid_project_json();
    arbitrary_id["schema"]["tables"]["grants"]["rules"]["read"] = json!("Allow");
    arbitrary_id["schema"]["tables"]["profiles"]["columns"]["alias"] = json!("Id");
    arbitrary_id["schema"]["tables"]["profiles"]["rules"]["read"] =
        exists("grants", "byProfile", "alias");
    only_rule_error(
        arbitrary_id,
        "schema.tables.profiles.rules.read.exists.key[0]",
        "is Id; expected Ref<profiles>",
    );

    let mut cross_table = valid_project_json();
    cross_table["schema"]["tables"]["profiles"]["columns"]["self_ref"] =
        json!({ "Ref": { "table": "profiles" } });
    cross_table["schema"]["tables"]["profiles"]["indexes"]["bySelfRef"] =
        json!({ "components": [{"Column": "self_ref"}], "unique": false });
    cross_table["schema"]["tables"]["profiles"]["rules"]["read"] = json!("Allow");
    cross_table["schema"]["tables"]["grants"]["rules"]["read"] =
        exists("profiles", "bySelfRef", "id");
    only_rule_error(
        cross_table,
        "schema.tables.grants.rules.read.exists.key[0]",
        "is Id; expected Ref<profiles>",
    );
}

#[test]
fn raw_project_json_fields_are_resolved_from_the_outer_table_or_channel() {
    let mut raw = valid_project_json();
    raw["schema"]["tables"]["grants"]["rules"]["read"] =
        json!({ "Eq": [{ "Field": "principal" }, "Viewer"] });
    only_rule_error(
        raw,
        "schema.tables.grants.rules.read.left",
        "unknown field principal on its outer subject",
    );

    let mut raw = valid_project_json();
    raw["schema"]["channels"]["presence"]["publish"] =
        json!({ "Eq": [{ "Field": "principal" }, "Viewer"] });
    only_rule_error(
        raw,
        "schema.channels.presence.publish.left",
        "unknown field principal on its outer subject",
    );
}

#[test]
fn raw_project_json_checks_literal_domains_without_erasing_principal_or_ref_types() {
    let typed_rule = |column: &str, kind: Json, value: Value| {
        let mut raw = valid_project_json();
        raw["schema"]["tables"]["grants"]["columns"][column] = kind;
        raw["schema"]["tables"]["grants"]["rules"]["read"] = json!({
            "Eq": [
                { "Field": column },
                { "Literal": serde_json::to_value(value).unwrap() }
            ]
        });
        raw
    };

    certify(typed_rule(
        "role",
        json!({ "Enum": { "variants": ["member", "admin"] } }),
        Value::String("member".to_owned()),
    ))
    .expect("a declared enum variant must be admitted");

    only_rule_error(
        typed_rule(
            "role",
            json!({ "Enum": { "variants": ["member", "admin"] } }),
            Value::String("admn".to_owned()),
        ),
        "schema.tables.grants.rules.read",
        "joins Enum<member|admin> with text literal \"admn\"",
    );

    only_rule_error(
        typed_rule("price", json!({ "Decimal": { "scale": 2 } }), Value::Int(2)),
        "schema.tables.grants.rules.read",
        "joins Decimal<2> with integer literal",
    );
    only_rule_error(
        typed_rule(
            "budget",
            json!({ "Money": { "currency": "USD", "scale": 2 } }),
            Value::Int(2),
        ),
        "schema.tables.grants.rules.read",
        "joins Money<USD,2> with integer literal",
    );

    for value in [
        Value::Null,
        Value::Bool(true),
        Value::Int(7),
        Value::String("ok".to_owned()),
        Value::Array(vec![Value::Null, Value::String("nested".to_owned())]),
        Value::Map(
            std::collections::BTreeMap::from([("nested".to_owned(), Value::Bool(true))]).into(),
        ),
    ] {
        certify(typed_rule(
            "metadata",
            json!({ "Json": { "max_bytes": 1024 } }),
            value,
        ))
        .expect("every JSON literal shape must be admitted against Json");
    }

    let mut literal_arrays = valid_project_json();
    literal_arrays["schema"]["tables"]["grants"]["rules"]["read"] = json!({
        "Ne": [
            { "Literal": serde_json::to_value(Value::Array(vec![Value::Int(1)])).unwrap() },
            { "Literal": serde_json::to_value(Value::Array(vec![
                Value::Null,
                Value::String("nested".to_owned()),
            ])).unwrap() }
        ]
    });
    certify(literal_arrays).expect("JSON array literals must share one compiler/core domain");

    only_rule_error(
        typed_rule(
            "scope",
            json!("Id"),
            Value::Id("caller-controlled".to_owned()),
        ),
        "schema.tables.grants.rules.read",
        "joins Id with id literal",
    );
    only_rule_error(
        typed_rule(
            "profile",
            json!({ "Ref": { "table": "profiles" } }),
            Value::Id("profile-1".to_owned()),
        ),
        "schema.tables.grants.rules.read",
        "joins Ref<profiles> with id literal",
    );
}
