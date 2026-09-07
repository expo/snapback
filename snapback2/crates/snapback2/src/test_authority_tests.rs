use super::*;
use snapback2_core::{Index, KeyProvenance, Maintain, MaintainKind, Rules, Table};
use std::collections::BTreeMap;

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
    let recipe = protected_write_recipe();
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
    assert!(!query_isolates_protected_table(
        &program, &reads, &recipe, "messages"
    ));
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
    assert!(query_isolates_protected_table(
        &program, &reads, &recipe, "messages"
    ));
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
