//! ENG-24907 — LLP 0056 M1: the `.membership()` schema surface.
//!
//! Adversarial coverage for the declaration-shape validation, the generated
//! true-unique `(principal, resource)` index, `v.principal()`, and the
//! fail-closed activation scan over existing data. These are the review-caught
//! traps the LLP 0056 loop found; each test names the invariant it pins and,
//! where the guard is subtle, comments what would happen without it.
//!
//! Write-path enforcement (the transition matrix, generated methods, and the
//! raw-`ctx.db` refusal) is M2. The live uniqueness test uses sanctioned
//! membership plans; brownfield activation tests seed the pre-declaration
//! shape directly so the adoption scan still sees adversarial existing rows.
//!
//! @ref LLP 0056#declaring-a-membership-table — the M1 declaration surface.

use serde_json::{Value, json};
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, HandlerInput, MembershipExpiry, MembershipLastHolder,
    MembershipManifest, MembershipOp, MembershipScope, MembershipTarget, MembershipTransition,
    MutationPlan, MutationStep, SchemaManifest, TableManifest, ValueExpr,
};
use snapback::storage::{LocalDatabase, MembershipWriter};
use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

fn field(name: &str, field_type: FieldType, optional: bool) -> FieldManifest {
    FieldManifest {
        name: name.to_owned(),
        field_type,
        optional,
    }
}

fn events_table() -> TableManifest {
    TableManifest {
        name: "events".to_owned(),
        fields: vec![field("title", FieldType::String, false)],
        indexes: vec![],
        search_indexes: Vec::new(),
        vector_indexes: Vec::new(),
        search_live_limits: None,
        syncable: false,
        permission_backing: false,
        permission_fields: None,
        membership: None,
        authority_profile: None,
        asset_sharing: None,
        visibility: None,
        history: None,
    }
}

/// A well-formed base declaration: `event_members(userId, eventId, role)` with a
/// three-role vocabulary, resource-scoped to `events`.
fn base_membership() -> MembershipManifest {
    MembershipManifest {
        id: None,
        principal: "userId".to_owned(),
        resource: Some("eventId".to_owned()),
        role: "role".to_owned(),
        roles: vec!["host".to_owned(), "cohost".to_owned(), "guest".to_owned()],
        pending_roles: None,
        bootstrap_role: None,
        last_holder: None,
        expiry: None,
        incidental: None,
        provenance: None,
        transitions: vec![],
        scope: MembershipScope::Resource,
        resource_table: Some("events".to_owned()),
        principal_addressed_writes: None,
    }
}

/// The `event_members` table carrying the given declaration. `userId` is
/// `v.principal()` and `eventId` is `v.id("events")`; the axes are non-null;
/// `expiresAt` is a non-axis column.
fn members_table(membership: Option<MembershipManifest>) -> TableManifest {
    TableManifest {
        name: "event_members".to_owned(),
        fields: vec![
            field("userId", FieldType::Principal, false),
            field(
                "eventId",
                FieldType::Id {
                    table: "events".to_owned(),
                },
                false,
            ),
            field("role", FieldType::String, false),
            field("expiresAt", FieldType::Integer, true),
            field("notifyPrefs", FieldType::String, true),
        ],
        indexes: vec![],
        search_indexes: Vec::new(),
        vector_indexes: Vec::new(),
        search_live_limits: None,
        syncable: false,
        permission_backing: false,
        permission_fields: None,
        membership,
        authority_profile: None,
        asset_sharing: None,
        visibility: None,
        history: None,
    }
}

fn schema(tables: Vec<TableManifest>) -> SchemaManifest {
    SchemaManifest {
        tables,
        ..SchemaManifest::default()
    }
}

/// The two-table schema for a given declaration: `events` + `event_members`.
fn app_schema(membership: MembershipManifest) -> SchemaManifest {
    schema(vec![events_table(), members_table(Some(membership))])
}

fn apply_err(membership: MembershipManifest) -> String {
    let mut db = LocalDatabase::memory().expect("memory db");
    db.schema_seed()
        .apply_schema(app_schema(membership))
        .expect_err("declaration must be refused")
        .diagnostic
        .code
}

fn input() -> HandlerInput {
    HandlerInput {
        args: json!({}),
        auth: AuthInput::default(),
        ..HandlerInput::default()
    }
}

fn insert_row(db: &mut LocalDatabase, table: &str, values: &[(&str, Value)]) {
    let values = values
        .iter()
        .map(|(k, v)| ((*k).to_owned(), ValueExpr::Literal(v.clone())))
        .collect::<BTreeMap<_, _>>();
    db.mutation_writes()
        .execute_mutation(
            &MutationPlan {
            owner_write_checks: Vec::new(),
                steps: vec![MutationStep::Insert {
                    table: table.to_owned(),
                    values,
                    bind_id_as: None,
                }],
                return_value: None,
            },
            &input(),
        )
        .unwrap_or_else(|error| panic!("insert into {table} failed: {error}"));
}

fn row_count(db: &LocalDatabase, table: &str) -> usize {
    db.query_reads_read()
        .scan_table(table, 1, 0)
        .expect("schema-aware admin scan")
        .total
}

/// Seed an `events` row with a caller-chosen `_id` so a membership's `eventId`
/// axis can reference it exactly (row `_id`s are otherwise host-generated).
fn seed_event(db: &mut LocalDatabase, id: &str) {
    db.schema_seed()
        .seed(snapback::manifest::SeedData {
            tables: BTreeMap::from([(
                "events".to_owned(),
                vec![serde_json::Map::from_iter([
                    ("_id".to_owned(), json!(id)),
                    ("title".to_owned(), json!("Launch")),
                ])],
            )]),
        })
        .expect("seed event row");
}

// ---------------------------------------------------------------------------
// A well-formed declaration is accepted (guards must not false-positive)
// ---------------------------------------------------------------------------

#[test]
fn a_well_formed_declaration_applies() {
    let mut db = LocalDatabase::memory().expect("memory db");
    db.schema_seed()
        .apply_schema(app_schema(base_membership()))
        .expect("a conforming membership declaration applies cleanly");
}

// ---------------------------------------------------------------------------
// Declaration errors (the review-caught traps)
// ---------------------------------------------------------------------------

#[test]
fn optional_key_axis_is_refused() {
    // Without this guard a nullable principal defeats the whole primitive:
    // SQLite/Postgres unique indexes admit *multiple* NULL-bearing rows, so a
    // nullable axis silently breaks the `(principal, resource)` uniqueness the
    // membership rests on.
    let mut members = members_table(Some(base_membership()));
    members.fields[0] = field("userId", FieldType::Principal, true); // userId optional
    let code = {
        let mut db = LocalDatabase::memory().expect("memory db");
        db.schema_seed()
            .apply_schema(schema(vec![events_table(), members]))
            .expect_err("optional principal axis must be refused")
            .diagnostic
            .code
    };
    assert_eq!(code, "SNAPBACK_MEMBERSHIP_OPTIONAL_KEY_AXIS");
}

#[test]
fn principal_axis_must_be_v_principal() {
    // Without the nominal-type check any string column could pose as the
    // principal axis, erasing the `v.principal()` guarantee.
    let mut members = members_table(Some(base_membership()));
    members.fields[0] = field("userId", FieldType::String, false); // not Principal
    let code = {
        let mut db = LocalDatabase::memory().expect("memory db");
        db.schema_seed()
            .apply_schema(schema(vec![events_table(), members]))
            .expect_err("principal axis must be v.principal()")
            .diagnostic
            .code
    };
    assert_eq!(code, "SNAPBACK_MEMBERSHIP_PRINCIPAL_TYPE");
}

#[test]
fn resource_axis_must_be_v_id() {
    // A plain string carries no resource-table identity, so accepting it would
    // let the manifest claim a binding the field declaration cannot prove.
    let mut members = members_table(Some(base_membership()));
    members.fields[1] = field("eventId", FieldType::String, false);
    let code = {
        let mut db = LocalDatabase::memory().expect("memory db");
        db.schema_seed()
            .apply_schema(schema(vec![events_table(), members]))
            .expect_err("resource axis must be v.id(resourceTable)")
            .diagnostic
            .code
    };
    assert_eq!(code, "SNAPBACK_MEMBERSHIP_RESOURCE_TYPE");
}

#[test]
fn resource_axis_v_id_target_must_match_resource_table() {
    let mut members = members_table(Some(base_membership()));
    members.fields[1] = field(
        "eventId",
        FieldType::Id {
            table: "projects".to_owned(),
        },
        false,
    );
    let code = {
        let mut db = LocalDatabase::memory().expect("memory db");
        db.schema_seed()
            .apply_schema(schema(vec![events_table(), members]))
            .expect_err("resource v.id target must match resourceTable")
            .diagnostic
            .code
    };
    assert_eq!(code, "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_MISMATCH");
}

#[test]
fn reserved_role_self_is_refused() {
    let mut membership = base_membership();
    membership.roles = vec!["self".to_owned(), "guest".to_owned()];
    // Without this guard a role named "self" collides with the transition
    // matrix's caller class, and the host would have to guess which was meant.
    assert_eq!(apply_err(membership), "SNAPBACK_MEMBERSHIP_RESERVED_ROLE");
}

#[test]
fn reserved_role_none_is_refused() {
    let mut membership = base_membership();
    membership.roles = vec!["none".to_owned(), "guest".to_owned()];
    assert_eq!(apply_err(membership), "SNAPBACK_MEMBERSHIP_RESERVED_ROLE");
}

#[test]
fn colon_in_role_is_refused() {
    let mut membership = base_membership();
    membership.roles = vec!["appRoles:admin".to_owned(), "guest".to_owned()];
    // The `:` is reserved now for the future cross-declaration `by:
    // ["appRoles:admin"]` spelling, so a role literally named that is ambiguous.
    assert_eq!(
        apply_err(membership),
        "SNAPBACK_MEMBERSHIP_ROLE_RESERVED_SEPARATOR"
    );
}

#[test]
fn roles_and_pending_roles_must_be_disjoint() {
    let mut membership = base_membership();
    membership.roles = vec!["host".to_owned(), "guest".to_owned()];
    membership.pending_roles = Some(vec!["guest".to_owned()]); // overlaps roles
    assert_eq!(
        apply_err(membership),
        "SNAPBACK_MEMBERSHIP_ROLE_PENDING_OVERLAP"
    );
}

#[test]
fn confusable_roles_are_refused() {
    // Exact-decoded comparison means "Host" and "host" are distinct strings;
    // declaring both is a near-duplicate that would let two writers disagree
    // about the same authority, so it is refused.
    let mut membership = base_membership();
    membership.roles = vec!["host".to_owned(), "Host".to_owned(), "guest".to_owned()];
    assert_eq!(
        apply_err(membership),
        "SNAPBACK_MEMBERSHIP_CONFUSABLE_ROLES"
    );
}

#[test]
fn empty_vocabulary_is_refused() {
    let mut membership = base_membership();
    membership.roles = vec![];
    assert_eq!(
        apply_err(membership),
        "SNAPBACK_MEMBERSHIP_EMPTY_VOCABULARY"
    );
}

#[test]
fn membership_plus_permission_backing_is_refused() {
    // The derivation owns the table; a hand-written permissionBacking is a
    // second, conflicting authorization declaration over the same rows.
    let mut members = members_table(Some(base_membership()));
    members.permission_backing = true;
    let code = {
        let mut db = LocalDatabase::memory().expect("memory db");
        db.schema_seed()
            .apply_schema(schema(vec![events_table(), members]))
            .expect_err(".membership() + permissionBacking must be refused")
            .diagnostic
            .code
    };
    assert_eq!(code, "SNAPBACK_MEMBERSHIP_PERMISSION_BACKING_CONFLICT");
}

#[test]
fn two_declarations_sharing_a_stable_id_collide() {
    // A table carries at most one `.membership()` — enforced structurally by
    // the single `Option<MembershipManifest>` field, so "two declarations on
    // one table" is unrepresentable. The manifest-level analog this pins is the
    // durable-reference trap: two DISTINCT tables must not share a stable
    // declaration id, because audit rows and room bindings reference it.
    let mut first = base_membership();
    first.id = Some("sharedDecl".to_owned());
    let mut second = base_membership();
    second.id = Some("sharedDecl".to_owned());

    let members_a = {
        let mut table = members_table(Some(first));
        table.name = "members_a".to_owned();
        table
    };
    let members_b = {
        let mut table = members_table(Some(second));
        table.name = "members_b".to_owned();
        table
    };
    let mut db = LocalDatabase::memory().expect("memory db");
    let code = db
        .schema_seed()
        .apply_schema(schema(vec![events_table(), members_a, members_b]))
        .expect_err("two tables sharing a declaration id must be refused")
        .diagnostic
        .code;
    assert_eq!(code, "SNAPBACK_MEMBERSHIP_ID_COLLISION");
}

#[test]
fn last_holder_requires_matching_bootstrap_role() {
    // Establishment leg: protecting `host` while seating some other role
    // establishes nothing, so the guarantee would be vacuous.
    let mut membership = base_membership();
    membership.last_holder = Some(MembershipLastHolder {
        protect: "host".to_owned(),
    });
    membership.bootstrap_role = Some("cohost".to_owned()); // mismatch
    assert_eq!(
        apply_err(membership),
        "SNAPBACK_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH"
    );
}

#[test]
fn last_holder_is_not_available_on_app_scope() {
    let mut membership = base_membership();
    membership.scope = MembershipScope::App;
    membership.resource = None;
    membership.resource_table = None;
    membership.last_holder = Some(MembershipLastHolder {
        protect: "host".to_owned(),
    });
    // An app singleton has no creation event to anchor establishment on.
    assert_eq!(
        apply_err(membership),
        "SNAPBACK_MEMBERSHIP_LAST_HOLDER_APP_SCOPE"
    );
}

#[test]
fn expiry_downgrade_effect_is_refused() {
    // With no declared role ordering the host cannot prove a downgrade is
    // non-escalating, so only `remove` is admissible in v1.
    let mut membership = base_membership();
    membership.expiry = Some(MembershipExpiry {
        field: "expiresAt".to_owned(),
        on_expiry: "downgradeTo:guest".to_owned(),
    });
    assert_eq!(
        apply_err(membership),
        "SNAPBACK_MEMBERSHIP_EXPIRY_EFFECT_UNSUPPORTED"
    );
}

#[test]
fn incidental_may_not_name_an_authorization_axis() {
    // The floor: naming the role column incidental would suppress event-1
    // authorization advances for role changes — exactly what the primitive
    // exists to protect.
    let mut membership = base_membership();
    membership.incidental = Some(vec!["role".to_owned()]);
    assert_eq!(
        apply_err(membership),
        "SNAPBACK_MEMBERSHIP_INCIDENTAL_FLOOR"
    );
}

// ---------------------------------------------------------------------------
// The generated true-unique (principal, resource) index
// ---------------------------------------------------------------------------

#[test]
fn concurrent_same_pair_inserts_yield_one_row_and_one_typed_conflict() {
    // Exactly-one-wins is delivered by the generated unique index at serialized
    // commit (LLP 0004's concurrency model). Two inserts of the same
    // (principal, resource) pair: the first commits, the second fails with one
    // typed conflict, and the table holds exactly one row.
    let mut membership = base_membership();
    membership.transitions = vec![MembershipTransition {
        op: MembershipOp::Insert,
        by: vec!["none".to_owned()],
        target: MembershipTarget::Other,
        from: None,
        to: Some(vec!["guest".to_owned()]),
        fields: None,
    }];
    let mut db = LocalDatabase::memory().expect("memory db");
    db.schema_seed()
        .apply_schema(app_schema(membership))
        .expect("apply membership schema");
    seed_event(&mut db, "event_1");

    let writer = MembershipWriter::User {
        effective_principal: "user_1".to_owned(),
    };
    let values = json!({
        "userId": "user_2",
        "eventId": "event_1",
        "role": "guest"
    })
    .as_object()
    .expect("object")
    .clone();
    // Plan both from the same pre-insert snapshot. The writer inserts another
    // principal, so the first commit does not change the writer's absent
    // caller-class witness and mask the unique-index result with an earlier
    // authority conflict. The sanctioned gate owns authorization; the
    // generated true-unique index owns this exactly-one-wins result.
    let first = db
        .membership_plans()
        .plan_membership_insert(&writer, "event_members", values.clone())
        .expect("first plan");
    let second = db
        .membership_plans()
        .plan_membership_insert(&writer, "event_members", values)
        .expect("concurrent second plan");
    db.membership_plans()
        .commit_membership_plan(&writer, first)
        .expect("first plan commits");
    let conflict = db
        .membership_plans()
        .commit_membership_plan(&writer, second)
        .map(|_| ())
        .map_err(|error| error.diagnostic.code)
        .expect_err("a duplicate (principal, resource) pair must be refused");
    assert_eq!(conflict, "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION");
    assert_eq!(
        row_count(&db, "event_members"),
        1,
        "exactly one row survives the same-pair race"
    );

    // A different resource for the same principal is a distinct pair and is
    // admitted — the index is over the pair, not the principal alone.
    seed_event(&mut db, "event_2");
    let other_resource = json!({
        "userId": "user_2",
        "eventId": "event_2",
        "role": "guest"
    })
    .as_object()
    .expect("object")
    .clone();
    let other_resource = db
        .membership_plans()
        .plan_membership_insert(&writer, "event_members", other_resource)
        .expect("different-resource plan");
    db.membership_plans()
        .commit_membership_plan(&writer, other_resource)
        .expect("different resource commits");
    assert_eq!(row_count(&db, "event_members"), 2);
}

// ---------------------------------------------------------------------------
// Fail-closed activation over existing data
// ---------------------------------------------------------------------------

/// Apply the plain (pre-membership) shape, seed rows, then adopt the
/// declaration — the brownfield path the activation scan guards.
fn adopt_over_existing(
    seed: impl FnOnce(&mut LocalDatabase),
    membership: MembershipManifest,
) -> Result<(), String> {
    let mut db = LocalDatabase::memory().expect("memory db");
    // The plain shape carries identical columns (so adopting the declaration is
    // not a field retype) but no `.membership()` metadata yet.
    db.schema_seed()
        .apply_schema(schema(vec![events_table(), members_table(None)]))
        .expect("apply plain schema");
    seed(&mut db);
    db.schema_seed()
        .apply_schema(app_schema(membership))
        .map(|_| ())
        .map_err(|error| error.diagnostic.code)
}

#[test]
fn activation_refuses_a_role_outside_the_vocabulary() {
    // A pre-existing `"Host"` row against a `"host"` vocabulary fails: role
    // comparison is exact-decoded, so this is both the activation refusal and
    // the "Host"-vs-"host" refusal. It is also the vocabulary-shrink-with-
    // extant-rows refusal.
    let code = adopt_over_existing(
        |db| {
            seed_event(db, "event_1");
            insert_row(
                db,
                "event_members",
                &[
                    ("userId", json!("user_1")),
                    ("eventId", json!("event_1")),
                    ("role", json!("Host")), // wrong case
                ],
            );
        },
        base_membership(),
    )
    .expect_err("nonconforming role must refuse activation");
    assert_eq!(code, "SNAPBACK_MEMBERSHIP_ACTIVATION_UNKNOWN_ROLE");
}

#[test]
fn activation_refuses_a_duplicate_pair() {
    // Before the declaration exists there is no unique index, so a duplicate
    // pair can be seeded; the activation scan refuses adopting the declaration
    // over it (a typed diagnostic, not a raw SQLite failure from the index DDL).
    let code = adopt_over_existing(
        |db| {
            seed_event(db, "event_1");
            for _ in 0..2 {
                insert_row(
                    db,
                    "event_members",
                    &[
                        ("userId", json!("user_1")),
                        ("eventId", json!("event_1")),
                        ("role", json!("guest")),
                    ],
                );
            }
        },
        base_membership(),
    )
    .expect_err("duplicate pair must refuse activation");
    assert_eq!(code, "SNAPBACK_MEMBERSHIP_ACTIVATION_DUPLICATE");
}

#[test]
fn activation_refuses_a_membership_on_a_missing_resource() {
    // Referential integrity: a membership may not reference a resource row that
    // does not exist, or it mints authority over an object that is not there.
    let code = adopt_over_existing(
        |db| {
            // No events row is seeded, so "ghost" dangles.
            insert_row(
                db,
                "event_members",
                &[
                    ("userId", json!("user_1")),
                    ("eventId", json!("ghost")),
                    ("role", json!("guest")),
                ],
            );
        },
        base_membership(),
    )
    .expect_err("dangling resource must refuse activation");
    assert_eq!(code, "SNAPBACK_MEMBERSHIP_ACTIVATION_DANGLING_RESOURCE");
}

#[test]
fn activation_refuses_a_protected_resource_with_no_holder() {
    // With `lastHolder: { protect: "host" }`, every live resource must have a
    // host holder at activation, or the invariant is already violated.
    let mut membership = base_membership();
    membership.last_holder = Some(MembershipLastHolder {
        protect: "host".to_owned(),
    });
    membership.bootstrap_role = Some("host".to_owned());
    let code = adopt_over_existing(
        |db| {
            // A live event with only a guest (no host).
            seed_event(db, "event_1");
            insert_row(
                db,
                "event_members",
                &[
                    ("userId", json!("user_1")),
                    ("eventId", json!("event_1")),
                    ("role", json!("guest")),
                ],
            );
        },
        membership,
    )
    .expect_err("an unprotected live resource must refuse activation");
    assert_eq!(code, "SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE");
}

#[test]
fn activation_accepts_conforming_existing_data() {
    // The positive control: a host holder on every live resource, in-vocabulary
    // roles, one row per pair — activation succeeds.
    let mut membership = base_membership();
    membership.last_holder = Some(MembershipLastHolder {
        protect: "host".to_owned(),
    });
    membership.bootstrap_role = Some("host".to_owned());
    adopt_over_existing(
        |db| {
            seed_event(db, "event_1");
            insert_row(
                db,
                "event_members",
                &[
                    ("userId", json!("host_1")),
                    ("eventId", json!("event_1")),
                    ("role", json!("host")),
                ],
            );
            insert_row(
                db,
                "event_members",
                &[
                    ("userId", json!("guest_1")),
                    ("eventId", json!("event_1")),
                    ("role", json!("guest")),
                ],
            );
        },
        membership,
    )
    .expect("conforming existing data activates cleanly");
}
