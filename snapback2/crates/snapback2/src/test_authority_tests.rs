use super::*;
use snapback2_core::{Index, KeyProvenance, LoopDomain, Maintain, MaintainKind, Rules, Table};
use std::collections::BTreeMap;

const CONTROL_FLOW_REASON: &str = "policy probe control flow must be independent of the protected table; only stable values and self-readable membership guards are proved";

fn statement_bearing_expressions() -> Vec<Expr> {
    let scan = json!({
        "site": "merge", "table": "messages", "index": "byConvTime", "prefix": [],
        "order": "Desc", "take": {"Literal": 1}, "provenance": "Const"
    });
    let merge = json!({"Merge": {"site": "merge", "lanes": [{
        "binding": "lane", "scan": scan, "source": null, "setup": [
            {"Const": {"name": "message", "value": {"Get": {
                "site": "get", "table": "messages", "index": "byId",
                "key": [{"Literal": {"Id": "message-1"}}], "provenance": "Const"
            }}}},
            {"Require": {"condition": {"Binary": {"op": "Ne",
                "left": {"Variable": "message"}, "right": {"Literal": "Null"}
            }}, "code": "HAS_MESSAGE"}}
        ]
    }]}});
    let mut values = vec![
        merge.clone(),
        json!({"Field": {"base": merge, "name": "id"}}),
        json!({"Array": [merge]}),
        json!({"Object": {"nested": merge}}),
        json!({"Unary": {"op": "Not", "value": merge}}),
        json!({"Binary": {"op": "Eq", "left": merge, "right": {"Literal": "Null"}}}),
        json!({"Binary": {"op": "Eq", "left": {"Literal": "Null"}, "right": merge}}),
        json!({"Builtin": {"builtin": "Len", "args": [merge]}}),
    ];
    for kind in ["Get", "Exists"] {
        values.push(
            json!({kind: {"site": "outer", "table": "messages", "index": "byId",
            "key": [merge], "provenance": "Const"}}),
        );
    }
    for prefix in [
        json!({"Scalar": merge}),
        json!({"WordPrefix": {
            "source": merge, "contract": "u17-nfc-scf-nfc-wsp-p", "source_max": 128
        }}),
    ] {
        let mut outer = scan.clone();
        outer["prefix"] = json!([prefix]);
        values.push(json!({"Scan": outer}));
    }
    for slot in ["after", "before", "gt", "gte", "lt", "lte"] {
        let mut outer = scan.clone();
        if matches!(slot, "after" | "before") {
            outer[slot] = merge.clone();
        } else {
            outer["range"] = json!({slot: merge});
        }
        values.push(json!({"Scan": outer}));
    }
    values
        .into_iter()
        .map(|value| serde_json::from_value(value).unwrap())
        .collect()
}

#[test]
fn policy_control_flow_rejects_statement_bodies_in_every_expression_position() {
    let schema = authority_schema(ColumnType::Principal);
    for value in statement_bearing_expressions() {
        let statements = [
            Stmt::Const {
                name: "unused".into(),
                value: value.clone(),
            },
            Stmt::Let {
                name: "unused".into(),
                value: value.clone(),
            },
            Stmt::Require {
                condition: value.clone(),
                code: "GUARD".into(),
            },
            Stmt::Return(value.clone()),
        ];
        for statement in statements {
            let program = Program {
                body: vec![statement],
                ..probe_mutation(false)
            };
            assert_eq!(
                policy_control_flow(&program, &schema, "messages"),
                Err(CONTROL_FLOW_REASON.into()),
                "{program:?}"
            );
        }
        for statement in [
            Stmt::Const {
                name: "unused".into(),
                value: value.clone(),
            },
            Stmt::Let {
                name: "unused".into(),
                value: value.clone(),
            },
            Stmt::Push {
                target: "rows".into(),
                value: value.clone(),
            },
        ] {
            let program = Program {
                body: vec![Stmt::For {
                    binding: "item".into(),
                    domain: LoopDomain::LiteralRange {
                        start: 0,
                        end_exclusive: 1,
                    },
                    body: vec![statement],
                }],
                ..probe_mutation(false)
            };
            assert_eq!(
                policy_control_flow(&program, &schema, "messages"),
                Err(CONTROL_FLOW_REASON.into()),
                "{program:?}"
            );
        }
        let mut domains = vec![
            LoopDomain::DerivedArray {
                value: value.clone(),
                max: 1,
                bound_source: "page".into(),
            },
            LoopDomain::Recurse(snapback2_core::Recurse {
                site: "walk".into(),
                table: "messages".into(),
                index: "byId".into(),
                seed: Box::new(value.clone()),
                next_field: "parentId".into(),
                depth: 1,
                fanout: 1,
                provenance: KeyProvenance::Const,
            }),
        ];
        if let Expr::Scan(scan) = value {
            domains.push(LoopDomain::Page(scan));
        }
        for domain in domains {
            let program = Program {
                body: vec![Stmt::For {
                    binding: "item".into(),
                    domain,
                    body: vec![],
                }],
                ..probe_mutation(false)
            };
            assert_eq!(
                policy_control_flow(&program, &schema, "messages"),
                Err(CONTROL_FLOW_REASON.into()),
                "{program:?}"
            );
        }
    }
}

fn protected_write_recipe() -> Recipe {
    Recipe {
        membership_table: "memberships".to_owned(),
        membership_index: "byConversationPrincipal".to_owned(),
        scope_field: "conversationId".to_owned(),
        principal_field: "principal".to_owned(),
        scope_table: Some("conversations".to_owned()),
        protected: Vec::new(),
    }
}

#[test]
fn revocation_candidate_prefers_a_membership_guard_dependency() {
    let schema = authority_schema(ColumnType::Principal);
    let recipe = membership_recipe(&schema).unwrap();
    let membership = snapback2_core::Read {
        site: "messages.thread.0".to_owned(),
        table: recipe.membership_table.clone(),
        index: recipe.membership_index.clone(),
        key: Vec::new(),
        provenance: KeyProvenance::Const,
    };
    let reads = vec![
        ReadSite {
            site: membership.site.clone(),
            table: membership.table.clone(),
            index: membership.index.clone(),
            prefix_template: KeyProvenance::Const,
            take: 1,
            max_calls: 1,
            rule_probes_per_candidate: 0,
            hoist: false,
            decided_true: false,
            complete: false,
        },
        ReadSite {
            site: "messages.thread.1".to_owned(),
            table: "messages".to_owned(),
            index: "byConversation".to_owned(),
            prefix_template: KeyProvenance::Const,
            take: 50,
            max_calls: 1,
            rule_probes_per_candidate: 0,
            hoist: false,
            decided_true: false,
            complete: false,
        },
    ];
    let mut program = Program {
        name: "messages.thread".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Null))],
    };
    assert!(
        query_isolates_protected_table(&program, &reads, &recipe, "messages", &schema).is_err()
    );
    program.body.insert(
        0,
        Stmt::Const {
            name: "expandedHelper".to_owned(),
            value: Expr::Exists(membership),
        },
    );
    program.body.insert(
        1,
        Stmt::Require {
            condition: Expr::Variable("expandedHelper".to_owned()),
            code: "MEMBERSHIP_REQUIRED".to_owned(),
        },
    );
    assert!(query_isolates_protected_table(&program, &reads, &recipe, "messages", &schema).is_ok());
    let safe = program.clone();
    for value in statement_bearing_expressions() {
        let mut guarded = safe.clone();
        guarded.body.insert(
            2,
            Stmt::Const {
                name: "unused".into(),
                value,
            },
        );
        assert_eq!(
            query_isolates_protected_table(&guarded, &reads, &recipe, "messages", &schema),
            Err(CONTROL_FLOW_REASON.into())
        );
    }
    let read = snapback2_core::Read {
        site: "guard".into(),
        table: "messages".into(),
        index: "byId".into(),
        key: vec![],
        provenance: KeyProvenance::Const,
    };
    for terminal in [
        Stmt::Require {
            condition: Expr::Exists(read.clone()),
            code: "HAS_MESSAGE".into(),
        },
        Stmt::If {
            condition: Expr::Exists(read),
            then_body: vec![Stmt::Return(Expr::Literal(Value::Null))],
            else_body: vec![],
        },
        Stmt::Break,
        Stmt::Continue,
        Stmt::Return(Expr::Literal(Value::Null)),
    ] {
        let mut guarded = safe.clone();
        guarded.body.insert(2, terminal);
        assert_eq!(
            query_isolates_protected_table(&guarded, &reads, &recipe, "messages", &schema),
            Err(CONTROL_FLOW_REASON.into())
        );
    }
    let mut dependent_schema = schema.clone();
    dependent_schema
        .tables
        .get_mut(&recipe.membership_table)
        .unwrap()
        .rules
        .read = RuleExpr::Exists {
        table: "messages".into(),
        index: "byId".into(),
        key: vec![],
        provenance: KeyProvenance::Const,
    };
    assert!(
        query_isolates_protected_table(&safe, &reads, &recipe, "messages", &dependent_schema)
            .is_err(),
        "membership visibility must not depend on the protected table"
    );
    let Stmt::Const {
        value: Expr::Exists(membership),
        ..
    } = &mut program.body[0]
    else {
        panic!()
    };
    membership.key.push(Expr::Get(snapback2_core::Read {
        site: "key".into(),
        table: "messages".into(),
        index: "byId".into(),
        key: vec![],
        provenance: KeyProvenance::Const,
    }));
    assert!(
        query_isolates_protected_table(&program, &reads, &recipe, "messages", &schema).is_err(),
        "membership keys must not depend on the protected table"
    );
}

fn probe_mutation(scoped: bool) -> Program {
    Program {
        name: "messages.send".to_owned(),
        kind: ProgramKind::Mutation,
        args: if scoped {
            BTreeMap::from([(
                "conversationId".to_owned(),
                ArgType::Ref {
                    table: "conversations".to_owned(),
                },
            )])
        } else {
            BTreeMap::new()
        },
        read_time_granularity_ms: None,
        body: Vec::new(),
    }
}

fn insert_site(table: &str) -> WriteSite {
    WriteSite {
        table: table.to_owned(),
        kind: WriteKind::Insert,
        max_rows: 1,
    }
}

fn maintained_message_counts_schema() -> Schema {
    Schema {
        maintains: vec![Maintain {
            kind: MaintainKind::Count,
            source: "messages".to_owned(),
            by: vec!["conversationId".to_owned()],
            target: "messageCounts".to_owned(),
            readable: None,
        }],
        ..Schema::default()
    }
}

fn authority_schema(principal_column: ColumnType) -> Schema {
    let membership_rule = RuleExpr::Exists {
        table: "memberships".to_owned(),
        index: "byScopePrincipal".to_owned(),
        key: vec![RuleTerm::Field("scopeId".to_owned()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let viewer_is_principal =
        RuleExpr::Eq(RuleTerm::Field("principal".to_owned()), RuleTerm::Viewer);
    let memberships = Table {
        columns: BTreeMap::from([
            (
                "scopeId".to_owned(),
                ColumnType::Ref {
                    table: "scopes".to_owned(),
                },
            ),
            ("principal".to_owned(), principal_column),
        ]),
        indexes: BTreeMap::from([(
            "byScopePrincipal".to_owned(),
            Index {
                components: (vec!["scopeId".to_owned(), "principal".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
        rules: Rules {
            read: membership_rule.clone(),
            insert: RuleExpr::Allow,
            update: viewer_is_principal.clone(),
            delete: viewer_is_principal,
        },
        constraints: Vec::new(),
        retain: Default::default(),
        tombstones: Vec::new(),
    };
    let protected = Table {
        columns: BTreeMap::from([(
            "scopeId".to_owned(),
            ColumnType::Ref {
                table: "scopes".to_owned(),
            },
        )]),
        indexes: BTreeMap::new(),
        rules: Rules {
            read: membership_rule,
            insert: RuleExpr::Allow,
            update: RuleExpr::Allow,
            delete: RuleExpr::Allow,
        },
        constraints: Vec::new(),
        retain: Default::default(),
        tombstones: Vec::new(),
    };
    Schema {
        tables: BTreeMap::from([
            ("memberships".to_owned(), memberships),
            ("documents".to_owned(), protected),
        ]),
        ..Schema::default()
    }
}

#[test]
fn authority_recipe_requires_a_nominal_principal_axis() {
    let principal = authority_schema(ColumnType::Principal);
    let recipe = membership_recipe(&principal).expect("Principal axis should be discovered");
    assert_eq!(recipe.membership_table, "memberships");
    assert_eq!(recipe.principal_field, "principal");

    let pseudo_membership = authority_schema(ColumnType::Ref {
        table: "profiles".to_owned(),
    });
    assert!(
        membership_recipe(&pseudo_membership).is_none(),
        "a Ref column must not synthesize canonical authority proofs"
    );
}

#[test]
fn protected_write_accepts_a_scoped_direct_target_write() {
    assert!(protected_write_eligible(
        &probe_mutation(true),
        &[insert_site("messages")],
        &Schema::default(),
        &protected_write_recipe(),
        "messages",
    ));
}

#[test]
fn protected_write_accepts_a_scoped_maintain_source_write() {
    assert!(protected_write_eligible(
        &probe_mutation(true),
        &[insert_site("messages")],
        &maintained_message_counts_schema(),
        &protected_write_recipe(),
        "messageCounts",
    ));
    assert!(
        !protected_write_eligible(
            &probe_mutation(true),
            &[insert_site("notifications")],
            &maintained_message_counts_schema(),
            &protected_write_recipe(),
            "messageCounts",
        ),
        "an unrelated write was treated as maintained-target evidence"
    );
}

#[test]
fn protected_write_rejects_unscoped_direct_and_maintained_writes() {
    for (schema, protected) in [
        (Schema::default(), "messages"),
        (maintained_message_counts_schema(), "messageCounts"),
    ] {
        assert!(
            !protected_write_eligible(
                &probe_mutation(false),
                &[insert_site("messages")],
                &schema,
                &protected_write_recipe(),
                protected,
            ),
            "an unscoped {protected} write became revocation evidence"
        );
    }
}

#[test]
fn authority_recipe_accepts_self_delete_as_one_admin_policy_branch() {
    let mut schema = authority_schema(ColumnType::Principal);
    schema.tables.get_mut("memberships").unwrap().rules.delete = RuleExpr::Or(vec![
        RuleExpr::Eq(RuleTerm::Field("principal".to_owned()), RuleTerm::Viewer),
        RuleExpr::Exists {
            table: "memberships".to_owned(),
            index: "byScopePrincipal".to_owned(),
            key: vec![RuleTerm::Field("scopeId".to_owned()), RuleTerm::Viewer],
            provenance: KeyProvenance::Shape,
        },
    ]);
    assert!(
        membership_recipe(&schema).is_some(),
        "an admin branch must not hide the exact self-delete authority path"
    );
}

#[test]
fn membership_candidates_require_the_authenticated_principal() {
    let schema = authority_schema(ColumnType::Principal);
    let recipe = membership_recipe(&schema).expect("Principal axis should be discovered");
    let seed = SeedData {
        personas: vec!["alice".to_owned()],
        rows: BTreeMap::from([(
            "memberships".to_owned(),
            vec![
                json!({ "id": "legacy", "scopeId": "scope-1", "principal": "alice" }),
                json!({ "id": "exact", "scopeId": "scope-1", "principal": "dev:alice" }),
            ],
        )]),
    };

    let candidates = membership_candidates(&seed, &recipe);
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].1, "dev:alice");
    assert_eq!(candidates[0].2, "exact");
}

#[test]
fn successor_denial_requires_the_unique_program_rule() {
    let expected = "SNAPBACK2_TEST_SUCCESSOR_POLICY_FENCE:g";
    for delivery in [
        json!({ "state": "denied", "data": [] }),
        json!({ "state": "denied", "rule": "generation-g-rule", "data": [] }),
        json!({ "state": "complete", "rule": expected, "data": [] }),
    ] {
        assert!(
            require_exact_denial(&delivery, expected, "probe").is_err(),
            "a non-G+1 denial was accepted: {delivery}"
        );
    }
    require_exact_denial(
        &json!({ "state": "denied", "rule": expected, "data": [] }),
        expected,
        "probe",
    )
    .expect("the exact empty G+1 denial should pass");
}

#[test]
fn initial_authority_probe_accepts_only_visible_collection_data() {
    for data in [
        json!([{ "id": "row-1" }]),
        json!({ "conversation": { "id": "conversation-1" } }),
    ] {
        require_visible_complete(&json!({ "state": "complete", "data": data }))
            .expect("nonempty arrays and objects should prove initial visibility");
    }

    for data in [
        Json::Null,
        json!([]),
        json!({}),
        json!(false),
        json!(1),
        json!("visible-looking scalar"),
    ] {
        let delivery = json!({ "state": "complete", "data": data });
        assert!(
            require_visible_complete(&delivery).is_err(),
            "non-collection or empty data proved initial visibility: {delivery}"
        );
    }

    assert!(
        require_visible_complete(&json!({ "state": "denied", "data": { "id": "row-1" } })).is_err(),
        "visible data without a complete delivery proved initial visibility"
    );
}
#[test]
fn post_revocation_probe_treats_any_object_as_a_leak() {
    for delivery in [
        json!({ "state": "denied" }),
        json!({ "state": "denied", "data": null }),
        json!({ "state": "denied", "data": [] }),
    ] {
        require_no_rows(&delivery).expect("empty denied evidence should stay private");
    }

    for data in [json!({}), json!({ "conversation": null })] {
        let delivery = json!({ "state": "denied", "data": data });
        assert!(
            require_no_rows(&delivery).is_err(),
            "an object escaped the post-revocation leak check: {delivery}"
        );
    }
}

#[test]
fn projected_policy_probe_requires_body_redaction_and_preserves_log_metadata() {
    let schema = authority_schema(ColumnType::Principal);
    let table = &schema.tables["documents"];
    let mut body = serde_json::Map::new();
    for key in table.columns.keys() {
        body.insert(key.clone(), json!("protected"));
    }
    let projection = BTreeMap::from([("id".to_owned(), false), ("message".to_owned(), true)]);
    let initial = json!([{ "id": "delivery", "message": body }]);
    for leaked in [
        json!("secret"),
        json!(["secret"]),
        json!({"nested": "secret"}),
    ] {
        let mixed = json!([{ "id": "delivery", "message": body, "leakedBody": leaked }]);
        assert!(
            projected_policy_data(&mixed, &projection, table).is_err(),
            "unproved mixed projection accepted: {mixed}"
        );
    }
    let expected = projected_policy_data(&initial, &projection, table).unwrap();
    assert_eq!(expected, json!([{ "id": "delivery", "message": null }]));
    require_policy_filtered(
        &json!({"state":"complete", "data":expected}),
        "projection",
        &expected,
        &projection,
    )
    .unwrap();
    assert!(
        require_policy_filtered(
            &json!({"state":"complete", "data":initial}),
            "projection",
            &expected,
            &projection
        )
        .is_err()
    );
    assert!(
        require_policy_filtered(
            &json!({"state":"complete", "data":[]}),
            "projection",
            &expected,
            &projection
        )
        .is_err()
    );
    assert!(
        projected_policy_data(
            &json!([{ "id": "delivery", "message": null }]),
            &projection,
            table
        )
        .is_err()
    );
    assert!(
        projected_policy_data(
            &json!([{ "message": {"unknown":"shape"} }]),
            &projection,
            table
        )
        .is_err()
    );
}

#[test]
fn policy_projection_proves_carrier_fields_and_blocks_mixed_protected_values() {
    let mut schema = authority_schema(ColumnType::Principal);
    let mut carrier = schema.tables["documents"].clone();
    carrier.tombstones = vec![snapback2_core::Tombstone {
        table: "documents".into(),
        column: "scopeId".into(),
        when: RuleExpr::Allow,
    }];
    schema.tables.insert("log".into(), carrier);
    let mut program: Program = serde_json::from_value(json!({
        "name": "thread", "kind": "Query", "args": {}, "body": [
            {"Const": {"name": "page", "value": {"Scan": {
                "site": "page", "table": "log", "index": "byId", "prefix": [],
                "order": "Asc", "take": {"Literal": 1}, "provenance": "Shape"
            }}}},
            {"Const": {"name": "rows", "value": {"Array": []}}},
            {"For": {"binding": "row", "domain": {"DerivedArray": {
                "value": {"Variable": "page"}, "max": 1, "bound_source": "page"
            }}, "body": [
                {"Const": {"name": "message", "value": {"Get": {
                    "site": "get", "table": "documents", "index": "byId", "key": [], "provenance": "Shape"
                }}}},
                {"Push": {"target": "rows", "value": {"Object": {
                    "metadata": {"Field": {"base": {"Variable": "row"}, "name": "scopeId"}},
                    "message": {"Variable": "message"}
                }}}}
            ]}},
            {"Return": {"Variable": "rows"}}
        ]
    })).unwrap();
    let projection = policy_projection(&program, &schema, "documents").unwrap();
    for value in statement_bearing_expressions() {
        for statement in [
            Stmt::Const {
                name: "unused".into(),
                value: value.clone(),
            },
            Stmt::Let {
                name: "unused".into(),
                value,
            },
        ] {
            let mut guarded = program.clone();
            guarded.body.insert(0, statement);
            assert_eq!(
                policy_projection(&guarded, &schema, "documents"),
                Err(CONTROL_FLOW_REASON.into())
            );
        }
    }
    let exists = Expr::Exists(snapback2_core::Read {
        site: "guard".into(),
        table: "documents".into(),
        index: "byId".into(),
        key: vec![],
        provenance: KeyProvenance::Const,
    });
    for aliased in [false, true] {
        let mut guarded = program.clone();
        let condition = if aliased {
            guarded.body.insert(
                0,
                Stmt::Const {
                    name: "hasMessage".into(),
                    value: exists.clone(),
                },
            );
            Expr::Variable("hasMessage".into())
        } else {
            exists.clone()
        };
        guarded.body.insert(
            usize::from(aliased),
            Stmt::Require {
                condition,
                code: "HAS_MESSAGE".into(),
            },
        );
        assert!(
            policy_projection(&guarded, &schema, "documents").is_err(),
            "protected-dependent Require accepted (aliased={aliased})"
        );
    }
    assert_eq!(
        projection,
        BTreeMap::from([("metadata".into(), false), ("message".into(), true)])
    );
    let initial = json!([{"metadata": "scope", "message": {"scopeId": "secret"}}]);
    let expected =
        projected_policy_data(&initial, &projection, &schema.tables["documents"]).unwrap();
    for subject in ["retained G handle", "fresh invocation"] {
        let counts = require_policy_filtered(
            &json!({"state": "complete", "data": expected}),
            subject,
            &expected,
            &projection,
        )
        .unwrap();
        assert_eq!(
            (counts.rows, counts.protected_images, counts.nulled_images),
            (1, 0, 1)
        );
        assert!(
            require_policy_filtered(
                &json!({"state": "complete", "data": initial}),
                subject,
                &expected,
                &projection
            )
            .is_err()
        );
    }
    let protected_field = Expr::Field {
        base: Box::new(Expr::Variable("message".into())),
        name: "scopeId".into(),
    };
    for value in [
        protected_field.clone(),
        Expr::Array(vec![protected_field.clone()]),
        Expr::Object(BTreeMap::from([("nested".into(), protected_field)])),
        Expr::Literal(Value::String("unproved constant".into())),
    ] {
        let Stmt::For { body, .. } = &mut program.body[2] else {
            panic!()
        };
        let Stmt::Push {
            value: Expr::Object(fields),
            ..
        } = &mut body[1]
        else {
            panic!()
        };
        fields.insert("leakedBody".into(), value);
        assert!(
            policy_projection(&program, &schema, "documents").is_err(),
            "mixed scalar/array/nested candidates must be ineligible"
        );
    }
}
