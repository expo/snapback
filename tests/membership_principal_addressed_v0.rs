//! LLP 0100 §§1–3 acceptance, full JS path: `ctx.membership.<decl>
//! .removePrincipal(resource, principal)` from an authored mutation, through
//! the generated host command, with companion application writes in the same
//! atomic commit. The RFC's disclosure calculus is asserted end to end: the
//! identical `null` for present and absent targets, the invariant transition
//! denial before target lookup, the typed self-target misuse, and the
//! branch-insensitive companion-write obligation.
//!
//! @ref LLP 0100#3-host-resolution-and-linearization — the app supplies only
//!   (resource, principal); row id, role, caller class, and writer authority
//!   stay host-derived.

use serde_json::{Value, json};
use snapback::diagnostic::DiagnosticSeverity;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, AuthRequirement, FieldManifest, FieldType, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, IbexModule, MembershipManifest, MembershipOp,
    MembershipPrincipalAddressedWrites, MembershipProvenance, MembershipScope, MembershipTarget,
    MembershipTransition, SchemaManifest, TableManifest,
};

const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async createRoom(ctx, args) {
    const roomId = await ctx.membership.roomMembers.bootstrap({ title: args.title });
    return { roomId };
  },
  async join(ctx, args) {
    await ctx.membership.roomMembers.insert({
      roomId: args.roomId, userId: ctx.auth.userId, role: 'member'
    });
    return null;
  },
  async ownerRemove(ctx, args) {
    const result = await ctx.membership.roomMembers.removePrincipal(args.roomId, args.principal);
    // Companion application write: MUST be branch-insensitive (LLP 0100 §3
    // guide obligation) — recorded on both the present and absent branches.
    await ctx.db.insert('kickAttempts', { roomId: args.roomId, target: args.principal });
    return result;
  }
};
"#;

fn function(name: &str, kind: FunctionKind) -> FunctionDefinition {
    let mut function = FunctionDefinition::new(
        name,
        kind,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: name.to_owned(),
        }),
    );
    function.auth_requirement = Some(AuthRequirement::Authenticated);
    function
}

fn schema() -> SchemaManifest {
    SchemaManifest {
        tables: vec![
            TableManifest {
                name: "rooms".to_owned(),
                fields: vec![FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: true,
                }],
                indexes: Vec::new(),
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
            },
            TableManifest {
                name: "kickAttempts".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "roomId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "target".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
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
            },
            TableManifest {
                name: "room_members".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "roomId".to_owned(),
                        field_type: FieldType::Id {
                            table: "rooms".to_owned(),
                        },
                        optional: false,
                    },
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    },
                    FieldManifest {
                        name: "role".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: Some(MembershipManifest {
                    id: Some("roomMembers".to_owned()),
                    principal: "userId".to_owned(),
                    resource: Some("roomId".to_owned()),
                    role: "role".to_owned(),
                    roles: vec!["owner".to_owned(), "member".to_owned()],
                    pending_roles: None,
                    bootstrap_role: Some("owner".to_owned()),
                    last_holder: Some(snapback::manifest::MembershipLastHolder {
                        protect: "owner".to_owned(),
                    }),
                    expiry: None,
                    incidental: None,
                    provenance: Some(MembershipProvenance::Full),
                    transitions: vec![
                        // Open join for the fixture: anyone seats themself.
                        MembershipTransition {
                            op: MembershipOp::Insert,
                            by: vec!["none".to_owned()],
                            target: MembershipTarget::Own,
                            from: None,
                            to: Some(vec!["member".to_owned()]),
                            fields: None,
                        },
                        // The TOTAL other-principal removal carrier: `from`
                        // omitted, caller class the protected role.
                        MembershipTransition {
                            op: MembershipOp::Remove,
                            by: vec!["owner".to_owned()],
                            target: MembershipTarget::Other,
                            from: None,
                            to: None,
                            fields: None,
                        },
                    ],
                    scope: MembershipScope::Resource,
                    resource_table: Some("rooms".to_owned()),
                    principal_addressed_writes: Some(MembershipPrincipalAddressedWrites {
                        remove: true,
                    }),
                }),
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            },
        ],
        ..SchemaManifest::default()
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory snapback");
    snapback.apply_schema(schema()).expect("membership schema");
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: vec![
            function("createRoom", FunctionKind::Mutation),
            function("join", FunctionKind::Mutation),
            function("ownerRemove", FunctionKind::Mutation),
        ],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != DiagnosticSeverity::Error),
        "function diagnostics: {diagnostics:?}"
    );
    snapback
}

fn input(user: &str, args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput {
            principal: Some(user.to_owned()),
            session_id: None,
            user_id: Some(user.to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

fn create_room(snapback: &mut LocalSnapback, owner: &str) -> String {
    let output = snapback
        .invoke_mutation("createRoom", input(owner, json!({ "title": "ops" })))
        .expect("bootstrap room");
    output.result["roomId"]
        .as_str()
        .expect("bootstrap returns the room id")
        .to_owned()
}

fn member_total(snapback: &mut LocalSnapback, principal: &str) -> usize {
    snapback
        .scan_table("room_members", 50, 0)
        .expect("scan members")
        .rows
        .iter()
        .filter(|row| row["userId"] == principal)
        .count()
}

#[test]
fn owner_removes_member_with_identical_null_and_branch_insensitive_companions() {
    let mut snapback = configured();
    let room = create_room(&mut snapback, "alice");
    snapback
        .invoke_mutation("join", input("bob", json!({ "roomId": room })))
        .expect("bob joins");
    assert_eq!(member_total(&mut snapback, "bob"), 1);

    // Present target: null result, no id/role/existence bit/count, the seat
    // is gone, and the companion write committed atomically alongside.
    let removed = snapback
        .invoke_mutation(
            "ownerRemove",
            input("alice", json!({ "roomId": room, "principal": "bob" })),
        )
        .expect("owner removes member");
    assert_eq!(removed.result, Value::Null, "the public result is null");
    assert_eq!(member_total(&mut snapback, "bob"), 0, "the seat is gone");
    assert_eq!(
        snapback
            .scan_table("kickAttempts", 50, 0)
            .expect("companions")
            .total,
        1,
        "removal and companion write commit atomically"
    );

    // The now-absent pair: the exact same null, and the companion write
    // still commits — the §3 branch-insensitivity obligation witnessed.
    let repeat = snapback
        .invoke_mutation(
            "ownerRemove",
            input("alice", json!({ "roomId": room, "principal": "bob" })),
        )
        .expect("absent-target repeat");
    assert_eq!(repeat.result, Value::Null, "identical null on the no-op");
    assert_eq!(
        snapback
            .scan_table("kickAttempts", 50, 0)
            .expect("companions")
            .total,
        2,
        "companion writes commit on the no-op branch too"
    );

    // A well-formed principal that names no user takes the same branch.
    let ghost = snapback
        .invoke_mutation(
            "ownerRemove",
            input(
                "alice",
                json!({ "roomId": room, "principal": "user_never_seen" }),
            ),
        )
        .expect("nonexistent principal no-op");
    assert_eq!(ghost.result, Value::Null);
}

#[test]
fn refusals_are_invariant_typed_and_closed_by_default() {
    let mut snapback = configured();
    let room = create_room(&mut snapback, "alice");
    snapback
        .invoke_mutation("join", input("bob", json!({ "roomId": room })))
        .expect("bob joins");
    snapback
        .invoke_mutation("join", input("carol", json!({ "roomId": room })))
        .expect("carol joins");

    // A member caller receives the invariant role denial — byte-identical
    // whether the target exists (bob) or not (nobody): no probe happened.
    let present = snapback
        .invoke_mutation(
            "ownerRemove",
            input("carol", json!({ "roomId": room, "principal": "bob" })),
        )
        .expect_err("member caller denied");
    let absent = snapback
        .invoke_mutation(
            "ownerRemove",
            input("carol", json!({ "roomId": room, "principal": "nobody" })),
        )
        .expect_err("member caller denied on absent target");
    assert_eq!(
        present.diagnostic.code,
        "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
    );
    assert_eq!(
        (present.diagnostic.code, present.diagnostic.message),
        (absent.diagnostic.code, absent.diagnostic.message),
        "the denial does not depend on target presence"
    );

    // A cross-room owner holds no role in THIS room: same invariant denial.
    let other_room = create_room(&mut snapback, "dave");
    let _ = other_room;
    let cross = snapback
        .invoke_mutation(
            "ownerRemove",
            input("dave", json!({ "roomId": room, "principal": "bob" })),
        )
        .expect_err("cross-room owner denied");
    assert_eq!(
        cross.diagnostic.code,
        "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
    );

    // Self target is a typed misuse; self-removal remains removeSelf.
    let this_is_me = snapback
        .invoke_mutation(
            "ownerRemove",
            input("alice", json!({ "roomId": room, "principal": "alice" })),
        )
        .expect_err("self target refuses");
    assert_eq!(
        this_is_me.diagnostic.code,
        "SNAPBACK_MEMBERSHIP_TARGET_SELF"
    );

    // Refusals commit nothing: no companion write landed for any refusal.
    assert_eq!(
        snapback
            .scan_table("kickAttempts", 50, 0)
            .expect("companions")
            .total,
        0,
        "a refused command commits no companion writes"
    );

    // Everyone refused above is still seated.
    assert_eq!(member_total(&mut snapback, "bob"), 1);
    assert_eq!(member_total(&mut snapback, "carol"), 1);
}
