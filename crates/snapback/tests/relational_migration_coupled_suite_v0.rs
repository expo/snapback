//! RELATIONAL_MIGRATION_COUPLED_SUITE_V1 — the boundary fixtures joining
//! the LLP 0080 and LLP 0081 lanes (LLP 0080 §Acceptance, maintained-
//! projection items; the local SQLite profile).
//!
//! This file carries the capacity/atomicity boundary witnesses: the
//! 1,023/1,024 write ceiling, the pre-activation reference proof, the
//! `materializeAll` split-oracle digest over a >1,024-root population, the
//! join-key-move union, write coalescing, the disclosed-capacity ladder,
//! and whole-mutation crash equivalence. The callable-query half lives in
//! `tests/relational_corpus_v0.rs`; the engine and activation unit
//! witnesses live in `src/local.rs`. The complete item→witness map is
//! `issues/closed/20260724-step5-impl-coupled-suite.md`.
//!
//! @ref LLP 0080#5-transactionally-maintained-projections — the counted
//!   unit, the reverse-index-entry counting rule, the 1,024-write mutation
//!   bound, and commit-or-neither atomicity.

use serde_json::{Map, Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IndexManifest, JoinEquality,
    JoinKind, MaintainedProjectionPlan, MutationPlan, MutationStep, ProjectionLeaf,
    ProjectionOutputKey, ProjectionSource, ProjectionVisibility, QueryPlan, SchemaManifest,
    SeedData, TableManifest, ValueExpr,
};
use std::collections::{BTreeMap, BTreeSet};

const FAN_OUT_LIMIT: u32 = 1023;
const PLAN_ID: &str = "item-summaries";

fn schema() -> SchemaManifest {
    let string = |name: &str, optional: bool| FieldManifest {
        name: name.to_owned(),
        field_type: FieldType::String,
        optional,
    };
    let table =
        |name: &str, fields: Vec<FieldManifest>, indexes: Vec<IndexManifest>| TableManifest {
            name: name.to_owned(),
            fields,
            indexes,
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        };
    SchemaManifest {
        tables: vec![
            table(
                "items",
                vec![
                    string("title", false),
                    string("groupKey", true),
                    string("ownerId", false),
                ],
                vec![IndexManifest {
                    name: "items_by_group".to_owned(),
                    fields: vec!["groupKey".to_owned()],
                    unique: false,
                    where_applicable: false,
                }],
            ),
            table(
                "groups",
                vec![
                    string("slug", false),
                    string("label", false),
                    string("ownerId", false),
                ],
                vec![IndexManifest {
                    name: "groups_by_slug".to_owned(),
                    fields: vec!["slug".to_owned()],
                    unique: true,
                    where_applicable: false,
                }],
            ),
            table(
                "itemSummaries",
                vec![
                    string("title", false),
                    string("label", false),
                    string("ownerId", false),
                ],
                Vec::new(),
            ),
        ],
        ..SchemaManifest::default()
    }
}

fn plan() -> MaintainedProjectionPlan {
    MaintainedProjectionPlan {
        id: PLAN_ID.to_owned(),
        root: "items".to_owned(),
        root_alias: "item".to_owned(),
        joined: "groups".to_owned(),
        joined_alias: "group".to_owned(),
        join_kind: JoinKind::Inner,
        join_on: vec![JoinEquality {
            root_field: "groupKey".to_owned(),
            joined_field: "slug".to_owned(),
        }],
        root_filters: Vec::new(),
        root_visibility: ProjectionVisibility::Owner {
            field: "ownerId".to_owned(),
        },
        joined_visibility: ProjectionVisibility::PublicRead,
        projection: vec![
            ProjectionLeaf {
                name: "title".to_owned(),
                source: ProjectionSource::RootField("title".to_owned()),
            },
            ProjectionLeaf {
                name: "label".to_owned(),
                source: ProjectionSource::JoinedField("label".to_owned()),
            },
            ProjectionLeaf {
                name: "ownerId".to_owned(),
                source: ProjectionSource::RootField("ownerId".to_owned()),
            },
        ],
        output_table: "itemSummaries".to_owned(),
        output_key: ProjectionOutputKey::RootId,
        output_visibility: ProjectionVisibility::Owner {
            field: "ownerId".to_owned(),
        },
        root_reverse_index: "items_by_group".to_owned(),
        fan_out_limit: FAN_OUT_LIMIT,
        // A public-read joined source feeding an owner output couples
        // callers through the shared fanOutLimit; this suite IS the
        // disclosed fixture (LLP 0080 §3 / §Acceptance).
        shared_fan_out_disclosure: true,
        rebuild_recipe: "rebuild-v1".to_owned(),
    }
}

fn functions() -> FunctionManifest {
    let arg = |name: &str| ValueExpr::Arg(name.to_owned());
    let insert_item = |title: ValueExpr, group: ValueExpr| MutationStep::Insert {
        table: "items".to_owned(),
        values: BTreeMap::from([
            ("title".to_owned(), title),
            ("groupKey".to_owned(), group),
            ("ownerId".to_owned(), ValueExpr::Literal(json!("user-a"))),
        ]),
        bind_id_as: None,
    };
    let mutation = |name: &str, steps: Vec<MutationStep>| {
        FunctionDefinition::new(
            name,
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                owner_write_checks: Vec::new(),
                steps,
                return_value: None,
            })),
        )
    };
    FunctionManifest {
        functions: vec![
            mutation(
                "relabelGroup",
                vec![MutationStep::Patch {
                    table: "groups".to_owned(),
                    id: arg("id"),
                    values: BTreeMap::from([("label".to_owned(), arg("label"))]),
                }],
            ),
            mutation("addItem", vec![insert_item(arg("title"), arg("group"))]),
            mutation(
                "moveItem",
                vec![MutationStep::Patch {
                    table: "items".to_owned(),
                    id: arg("id"),
                    values: BTreeMap::from([("groupKey".to_owned(), arg("group"))]),
                }],
            ),
            mutation(
                "retitleTwice",
                vec![
                    MutationStep::Patch {
                        table: "items".to_owned(),
                        id: arg("id"),
                        values: BTreeMap::from([("title".to_owned(), arg("first"))]),
                    },
                    MutationStep::Patch {
                        table: "items".to_owned(),
                        id: arg("id"),
                        values: BTreeMap::from([("title".to_owned(), arg("second"))]),
                    },
                ],
            ),
            mutation(
                "addTwo",
                vec![
                    insert_item(arg("firstTitle"), arg("firstGroup")),
                    insert_item(arg("secondTitle"), arg("secondGroup")),
                ],
            ),
            // The portable query cap is 1,024 rows, deliberately below the
            // suite's >1,024-row populations, so every reader is filtered:
            // totals come from the rebuild receipt and per-key counts, and
            // the owner-visible output reads compose their visibility
            // predicate (the output-read fence requires it).
            FunctionDefinition::new(
                "readSummariesByLabel",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "itemSummaries".to_owned(),
                    filters: vec![
                        FilterExpr {
                            field: "ownerId".to_owned(),
                            op: FilterOp::Eq,
                            value: ValueExpr::AuthUserId,
                        },
                        FilterExpr {
                            field: "label".to_owned(),
                            op: FilterOp::Eq,
                            value: ValueExpr::Arg("label".to_owned()),
                        },
                    ],
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: Some(1024),
                    indexed_by: None,
                })),
            ),
            FunctionDefinition::new(
                "readSummariesByTitle",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "itemSummaries".to_owned(),
                    filters: vec![
                        FilterExpr {
                            field: "ownerId".to_owned(),
                            op: FilterOp::Eq,
                            value: ValueExpr::AuthUserId,
                        },
                        FilterExpr {
                            field: "title".to_owned(),
                            op: FilterOp::Eq,
                            value: ValueExpr::Arg("title".to_owned()),
                        },
                    ],
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: Some(16),
                    indexed_by: None,
                })),
            ),
            FunctionDefinition::new(
                "readItemsByGroup",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: vec![FilterExpr {
                        field: "groupKey".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::Arg("group".to_owned()),
                    }],
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: Some(1024),
                    indexed_by: Some("items_by_group".to_owned()),
                })),
            ),
            FunctionDefinition::new(
                "readItemsByTitle",
                FunctionKind::Query,
                FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: vec![FilterExpr {
                        field: "title".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::Arg("title".to_owned()),
                    }],
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: Some(16),
                    indexed_by: None,
                })),
            ),
        ],
        projections: vec![plan()],
        ..FunctionManifest::default()
    }
}

fn group_row(id: &str, slug: &str, label: &str) -> Map<String, Value> {
    json!({ "_id": id, "slug": slug, "label": label, "ownerId": "user-a" })
        .as_object()
        .cloned()
        .expect("group row")
}

fn item_row(id: &str, title: &str, group: &str) -> Map<String, Value> {
    json!({ "_id": id, "title": title, "groupKey": group, "ownerId": "user-a" })
        .as_object()
        .cloned()
        .expect("item row")
}

fn seeded(items: Vec<Map<String, Value>>, groups: Vec<Map<String, Value>>) -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory suite fixture");
    snapback.apply_schema(schema()).expect("apply suite schema");
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([("items".to_owned(), items), ("groups".to_owned(), groups)]),
        })
        .expect("seed suite data");
    snapback
}

fn activate(snapback: &mut LocalSnapback) -> Vec<snapback::diagnostic::Diagnostic> {
    snapback.load_functions(functions())
}

fn owner_input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            user_id: Some("user-a".to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

fn mutate(snapback: &mut LocalSnapback, name: &str, args: Value) -> usize {
    snapback
        .invoke_mutation(name, owner_input(args))
        .unwrap_or_else(|error| panic!("{name}: {error:?}"))
        .changed_count
}

fn summaries_by_label(snapback: &LocalSnapback, label: &str) -> Vec<Value> {
    snapback
        .invoke_query(
            "readSummariesByLabel",
            owner_input(json!({ "label": label })),
        )
        .expect("read summaries by label")
        .rows
}

fn summaries_by_title(snapback: &LocalSnapback, title: &str) -> Vec<Value> {
    snapback
        .invoke_query(
            "readSummariesByTitle",
            owner_input(json!({ "title": title })),
        )
        .expect("read summaries by title")
        .rows
}

fn items_by_group(snapback: &LocalSnapback, group: &str) -> usize {
    snapback
        .invoke_query("readItemsByGroup", owner_input(json!({ "group": group })))
        .expect("read items by group")
        .rows
        .len()
}

fn items_by_title(snapback: &LocalSnapback, title: &str) -> usize {
    snapback
        .invoke_query("readItemsByTitle", owner_input(json!({ "title": title })))
        .expect("read items by title")
        .rows
        .len()
}

/// The 1,023/1,024 boundary, the disclosed-capacity ladder (0 and 1
/// references; the 1,023/1,024 halves are the boundary assertions), the
/// join-key-move union, write coalescing, and crash equivalence — one
/// seeded population, every capacity edge (LLP 0080 §Acceptance).
///
/// Admission concurrency note (the §5 race rule on this profile): the
/// local target's single serialized writer is the isolation mechanism.
/// Two admissions racing one remaining unit of capacity cannot
/// interleave — the second transaction begins only after the first
/// commits, and its reverse-index reads observe the committed reference.
/// The sequential second-admission refusal below is therefore the
/// complete local witness; an interleaving fixture would claim a
/// concurrency this profile structurally excludes. The hosted executor
/// profile owns the genuinely concurrent variant.
#[test]
fn boundary_1023_1024_write_ceiling_and_admission() {
    let mut items: Vec<Map<String, Value>> = (0..FAN_OUT_LIMIT)
        .map(|index| item_row(&format!("i{index:04}"), &format!("t{index:04}"), "g-full"))
        .collect();
    items.push(item_row("i-one", "t-one", "g-one"));
    items.push(item_row("i-move", "t-move", "g-move"));
    let groups = vec![
        group_row("g1", "g-full", "L-full"),
        group_row("g2", "g-zero", "L-zero"),
        group_row("g3", "g-one", "L-one"),
        group_row("g4", "g-move", "L-move"),
    ];
    let mut snapback = seeded(items, groups);
    let diagnostics = activate(&mut snapback);
    assert!(
        diagnostics
            .iter()
            .all(|d| d.severity != snapback::diagnostic::DiagnosticSeverity::Error),
        "suite fixture must activate: {diagnostics:?}"
    );
    let receipt = snapback
        .projection_rebuild_receipt(PLAN_ID)
        .expect("read receipt")
        .expect("activation rebuilt");
    assert_eq!(receipt.row_count, FAN_OUT_LIMIT as usize + 2);
    assert_eq!(
        summaries_by_label(&snapback, "L-full").len(),
        FAN_OUT_LIMIT as usize,
        "activation materialized every g-full summary"
    );
    assert_eq!(summaries_by_label(&snapback, "L-one").len(), 1);
    assert_eq!(summaries_by_label(&snapback, "L-move").len(), 1);

    // Disclosed-capacity ladder, 0 references: the joined-row update is
    // exactly one write.
    assert_eq!(
        mutate(
            &mut snapback,
            "relabelGroup",
            json!({ "id": "g2", "label": "L-zero-2" })
        ),
        1,
        "0 references: 1 direct write, 0 output writes"
    );
    // 1 reference: one direct write plus one output write.
    assert_eq!(
        mutate(
            &mut snapback,
            "relabelGroup",
            json!({ "id": "g3", "label": "L-one-2" })
        ),
        2,
        "1 reference: 1 direct + 1 output write"
    );
    assert!(
        summaries_by_title(&snapback, "t-one")
            .iter()
            .any(|row| row["label"] == json!("L-one-2")),
        "the single referencing summary updated in the same commit"
    );

    // 1,023 references: exactly 1,024 total writes, and it succeeds.
    assert_eq!(
        mutate(
            &mut snapback,
            "relabelGroup",
            json!({ "id": "g1", "label": "L-full-2" })
        ),
        1 + FAN_OUT_LIMIT as usize,
        "1,023 references: 1 direct + 1,023 output writes = the full bound"
    );
    assert_eq!(
        summaries_by_label(&snapback, "L-full-2").len(),
        FAN_OUT_LIMIT as usize,
        "every referencing summary updated in the joined row's own commit"
    );

    // Admitting a 1,024th reference refuses before any write survives.
    let error = snapback
        .invoke_mutation(
            "addItem",
            owner_input(json!({ "title": "t-extra", "group": "g-full" })),
        )
        .expect_err("the 1,024th reference must refuse");
    assert_eq!(error.diagnostic.code, "SNAPBACK_PROJECTION_FANOUT_EXCEEDED");
    assert_eq!(
        items_by_title(&snapback, "t-extra"),
        0,
        "no root row leaked"
    );
    assert_eq!(
        items_by_group(&snapback, "g-full"),
        FAN_OUT_LIMIT as usize,
        "the full key's population is untouched"
    );
    assert!(summaries_by_title(&snapback, "t-extra").is_empty());

    // Join-key move INTO the full key refuses — the union counts the new
    // key's post-state population.
    let error = snapback
        .invoke_mutation(
            "moveItem",
            owner_input(json!({ "id": "i-move", "group": "g-full" })),
        )
        .expect_err("moving into a full key must refuse");
    assert_eq!(error.diagnostic.code, "SNAPBACK_PROJECTION_FANOUT_EXCEEDED");
    assert!(
        summaries_by_title(&snapback, "t-move")
            .iter()
            .any(|row| row["label"] == json!("L-move")),
        "the refused move left the output row untouched"
    );

    // Join-key move between non-full keys: one direct write plus one
    // output write, and the output's joined leaves update in the same
    // commit.
    assert_eq!(
        mutate(
            &mut snapback,
            "moveItem",
            json!({ "id": "i-move", "group": "g-one" })
        ),
        2,
        "a key move is 1 direct + 1 changed output row"
    );
    assert!(
        summaries_by_title(&snapback, "t-move")
            .iter()
            .any(|row| row["label"] == json!("L-one-2")),
        "the moved root's summary carries the new joined leaves"
    );

    // Repeated writes to one source row coalesce to one output
    // evaluation: two Patch steps, one changed output row.
    assert_eq!(
        mutate(
            &mut snapback,
            "retitleTwice",
            json!({ "id": "i-one", "first": "t-one-x", "second": "t-one-y" })
        ),
        3,
        "2 direct writes + 1 coalesced output write"
    );
    assert!(
        !summaries_by_title(&snapback, "t-one-y").is_empty(),
        "the coalesced evaluation used the final buffered post-image"
    );
    assert!(
        summaries_by_title(&snapback, "t-one-x").is_empty(),
        "no intermediate buffered image reached the output"
    );

    // Crash equivalence: a two-step mutation whose second step exceeds
    // capacity rolls back whole — the first step's insert and every
    // projection write evaporate.
    let before_g_one = items_by_group(&snapback, "g-one");
    let before_g_one_summaries = summaries_by_label(&snapback, "L-one-2").len();
    let error = snapback
        .invoke_mutation(
            "addTwo",
            owner_input(json!({
                "firstTitle": "t-ok",
                "firstGroup": "g-one",
                "secondTitle": "t-over",
                "secondGroup": "g-full",
            })),
        )
        .expect_err("the second step's refusal must fail the whole mutation");
    assert_eq!(error.diagnostic.code, "SNAPBACK_PROJECTION_FANOUT_EXCEEDED");
    assert_eq!(
        items_by_title(&snapback, "t-ok"),
        0,
        "step one rolled back too"
    );
    assert_eq!(items_by_title(&snapback, "t-over"), 0);
    assert_eq!(
        items_by_group(&snapback, "g-one"),
        before_g_one,
        "the non-full key's population is unchanged"
    );
    assert_eq!(
        summaries_by_label(&snapback, "L-one-2").len(),
        before_g_one_summaries,
        "no projection write survived the refused mutation"
    );
    assert!(summaries_by_title(&snapback, "t-ok").is_empty());
}

/// A pre-activation corpus already holding 1,024 references refuses
/// activation rather than leaving the joined row permanently
/// un-updatable, and the refused manifest does not install.
#[test]
fn pre_activation_1024_reference_corpus_refuses_activation() {
    let items: Vec<Map<String, Value>> = (0..=FAN_OUT_LIMIT)
        .map(|index| item_row(&format!("i{index:04}"), &format!("t{index:04}"), "g-full"))
        .collect();
    assert_eq!(items.len(), FAN_OUT_LIMIT as usize + 1);
    let mut snapback = seeded(items, vec![group_row("g1", "g-full", "L-full")]);
    let diagnostics = activate(&mut snapback);
    assert!(
        diagnostics
            .iter()
            .any(|d| d.code == "SNAPBACK_PROJECTION_FANOUT_EXCEEDED"),
        "{diagnostics:?}"
    );
    let error = snapback
        .invoke_query(
            "readItemsByGroup",
            owner_input(json!({ "group": "g-full" })),
        )
        .expect_err("a refused activation must not install the manifest");
    assert_eq!(error.diagnostic.code, "SNAPBACK_UNKNOWN_FUNCTION");
}

/// The `materializeAll` split oracle over a >1,024-root population
/// (LLP 0080 §Acceptance): materialization has no caller-relative
/// ordering or `take` (the plan type carries neither), the logical rows
/// byte-equal an independent evaluation computed from the seed data, and
/// the receipt's streaming content digest equals an independently
/// recomputed `seq1` digest over logical rows in canonical output-key
/// byte order.
#[test]
fn materialize_all_oracle_over_1100_roots_matches_independent_digest() {
    const ROOTS: usize = 1_100;
    let labels = [("g-a", "L-a"), ("g-b", "L-b")];
    let items: Vec<Map<String, Value>> = (0..ROOTS)
        .map(|index| {
            let (slug, _) = labels[index % 2];
            item_row(&format!("i{index:04}"), &format!("t{index:04}"), slug)
        })
        .collect();
    let groups = vec![group_row("ga", "g-a", "L-a"), group_row("gb", "g-b", "L-b")];
    let mut snapback = seeded(items, groups);
    let diagnostics = activate(&mut snapback);
    assert!(
        diagnostics
            .iter()
            .all(|d| d.severity != snapback::diagnostic::DiagnosticSeverity::Error),
        "oracle fixture must activate: {diagnostics:?}"
    );
    let receipt = snapback
        .projection_rebuild_receipt(PLAN_ID)
        .expect("read receipt")
        .expect("activation rebuilt");
    assert_eq!(receipt.row_count, ROOTS);

    // Independent logical rows from the seed data alone.
    let expected_logical: BTreeMap<String, Value> = (0..ROOTS)
        .map(|index| {
            let (_, label) = labels[index % 2];
            let id = format!("i{index:04}");
            let key_bytes = snapback::rqs::jcs(&json!([id])).expect("key bytes");
            let logical = json!({
                "title": format!("t{index:04}"),
                "label": label,
                "ownerId": "user-a",
            });
            (key_bytes, json!({ "k": [id], "r": logical }))
        })
        .collect();
    let digest_rows: Vec<Value> = expected_logical.values().cloned().collect();
    let expected_digest = snapback::rqs::seq1_digest(&digest_rows).expect("independent digest");
    assert_eq!(
        receipt.content_digest, expected_digest,
        "the streaming rebuild digest equals the independent materializeAll \
         evaluation in canonical output-key byte order"
    );

    // And the stored table byte-equals the independent evaluation:
    // multiset equality over the declared leaves, read per label to stay
    // inside the 1,024-row portable query cap.
    let mut expected_leaves: BTreeSet<String> = (0..ROOTS)
        .map(|index| {
            let (_, label) = labels[index % 2];
            format!("t{index:04}|{label}|user-a")
        })
        .collect();
    for (_, label) in labels {
        for row in summaries_by_label(&snapback, label) {
            let key = format!(
                "{}|{}|{}",
                row["title"].as_str().expect("title"),
                row["label"].as_str().expect("label"),
                row["ownerId"].as_str().expect("owner"),
            );
            assert!(expected_leaves.remove(&key), "unexpected output row {key}");
        }
    }
    assert!(
        expected_leaves.is_empty(),
        "missing output rows: {expected_leaves:?}"
    );
}

/// The named suite anchor: the coupled-suite ticket documents the complete
/// item→witness map across this file, the callable-query corpus, and the
/// engine/activation unit witnesses, and it names every test in this file.
#[test]
fn relational_migration_coupled_suite_v1_summary() {
    let ticket = std::fs::read_to_string(
        std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
            .join("issues/closed/20260724-step5-impl-coupled-suite.md"),
    )
    .expect("read coupled-suite ticket");
    for witness in [
        "RELATIONAL_MIGRATION_COUPLED_SUITE_V1",
        "boundary_1023_1024_write_ceiling_and_admission",
        "pre_activation_1024_reference_corpus_refuses_activation",
        "materialize_all_oracle_over_1100_roots_matches_independent_digest",
        "maintained_projection_engine_end_to_end",
        "maintained_projection_activation_refusals",
        "projection_activation_rebuild_materializes_and_republishes",
        "relational_corpus_v0",
    ] {
        assert!(
            ticket.contains(witness),
            "the coupled-suite ticket must map {witness}"
        );
    }
}
