//! Transactional authorization-version classification and persistence.
//!
//! This is deliberately the only primitive that advances the durable pair.
//! Callers choose a closed cause and invoke it before their SQLite commit.

use super::auth_stream;
use super::{AuthorizationCommitWitness, ChangeOp, ChangedRow};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::SchemaManifest;
use rusqlite::Transaction;
use std::collections::BTreeSet;

/// The closed authorization-event universe owned by the storage commit hook.
pub(super) enum AuthorizationCommitCause<'a> {
    AppWrites {
        schema: &'a SchemaManifest,
        changes: &'a [ChangedRow],
    },
    Activation,
    DestructiveBoundary,
}

/// Advance (or observe) the durable authorization pair inside the exact
/// transaction containing its cause.
///
/// @ref LLP 0053#the-authorization-event-universe-closed — only enumerated
///   permission writes, activation, and explicit destructive boundaries fire.
/// @ref LLP 0053#the-authorization-version — all writers share this one hook.
pub(super) fn authorization_commit_hook_in(
    tx: &Transaction<'_>,
    cause: AuthorizationCommitCause<'_>,
) -> SnapbackResult<AuthorizationCommitWitness> {
    match cause {
        AuthorizationCommitCause::DestructiveBoundary => {
            let version = auth_stream::rotate_authorization_version_in(tx)?;
            Ok(AuthorizationCommitWitness {
                version,
                event: true,
                incarnation_rotated: true,
                membership_declarations: Vec::new(),
            })
        }
        AuthorizationCommitCause::Activation => {
            let version = auth_stream::advance_authorization_epoch_in(tx)?;
            Ok(AuthorizationCommitWitness {
                version,
                event: true,
                incarnation_rotated: false,
                membership_declarations: Vec::new(),
            })
        }
        AuthorizationCommitCause::AppWrites { schema, changes } => {
            let event = app_writes_are_authorization_event(schema, changes);
            let version = if event {
                auth_stream::advance_authorization_epoch_in(tx)?
            } else {
                auth_stream::ensure_authorization_version_in(tx)?
            };
            Ok(AuthorizationCommitWitness {
                version,
                event,
                incarnation_rotated: false,
                membership_declarations: if event {
                    affected_membership_declarations(schema, changes)
                } else {
                    Vec::new()
                },
            })
        }
    }
}

pub(super) fn app_writes_are_authorization_event(
    schema: &SchemaManifest,
    changes: &[ChangedRow],
) -> bool {
    changes
        .iter()
        .any(|change| change_is_authorization_event(schema, change))
}

fn affected_membership_declarations(
    schema: &SchemaManifest,
    changes: &[ChangedRow],
) -> Vec<String> {
    changes
        .iter()
        .filter(|change| change_is_authorization_event(schema, change))
        .filter_map(|change| {
            let table = schema.table(&change.table)?;
            let membership = table.membership.as_ref()?;
            Some(membership.effective_id(&table.name).to_owned())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn change_is_authorization_event(schema: &SchemaManifest, change: &ChangedRow) -> bool {
    let Some(table) = schema.table(&change.table) else {
        // A writer-produced change should always name a current table. If a
        // future import/admin lane supplies incomplete metadata, fail toward
        // invalidation rather than silently treating the unknown as ordinary.
        return true;
    };
    // @ref LLP 0239#d4-grants-and-authority-are-declarative-at-the-command-edge — a
    // collection item is an addressable via-reference authority fact. Its
    // insert/remove/replacement must invalidate already-issued authority even
    // though the framework-owned table is not an app permission declaration.
    if schema
        .asset_collections
        .iter()
        .any(|collection| collection.child_table == change.table)
    {
        return true;
    }
    if !table.is_permission_backing() {
        return false;
    }
    if !matches!(change.op, ChangeOp::Update) {
        return true;
    }
    if change.changed_fields.is_empty() {
        return true;
    }

    // Unknown names mean the field set is not a proof of disjointness. Only a
    // known, nonempty set wholly disjoint from permissionFields suppresses.
    let all_fields_known = change
        .changed_fields
        .iter()
        .all(|changed| table.field(changed).is_some());
    !all_fields_known
        || change
            .changed_fields
            .iter()
            .any(|changed| table.field_affects_authorization(changed))
}

pub(super) fn epoch_exhausted() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTHORIZATION_EPOCH_EXHAUSTED",
        "auth",
        "authorization epoch exhausted the JavaScript-safe integer range",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        FieldManifest, FieldType, MembershipManifest, MembershipScope, TableManifest,
    };

    fn schema(permission_fields: Option<Vec<&str>>) -> SchemaManifest {
        SchemaManifest {
            tables: vec![TableManifest {
                name: "users".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "role".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "avatar".to_owned(),
                        field_type: FieldType::String,
                        optional: true,
                    },
                ],
                indexes: Vec::new(),
                syncable: false,
                permission_backing: true,
                permission_fields: permission_fields
                    .map(|fields| fields.into_iter().map(str::to_owned).collect()),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            }],
            ..SchemaManifest::default()
        }
    }

    fn update(fields: &[&str]) -> ChangedRow {
        ChangedRow {
            table: "users".to_owned(),
            id: "user-1".to_owned(),
            op: ChangeOp::Update,
            row: None,
            changed_fields: fields.iter().map(|field| (*field).to_owned()).collect(),
        }
    }

    fn membership_schema() -> SchemaManifest {
        SchemaManifest {
            tables: vec![TableManifest {
                name: "event_members".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "principalId".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    },
                    FieldManifest {
                        name: "eventId".to_owned(),
                        field_type: FieldType::Id {
                            table: "events".to_owned(),
                        },
                        optional: false,
                    },
                    FieldManifest {
                        name: "role".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "nickname".to_owned(),
                        field_type: FieldType::String,
                        optional: true,
                    },
                    FieldManifest {
                        name: "expiresAt".to_owned(),
                        field_type: FieldType::Integer,
                        optional: true,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                // The declaration, not a duplicated raw flag, owns this.
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: Some(MembershipManifest {
                    id: Some("event-members".to_owned()),
                    principal: "principalId".to_owned(),
                    resource: Some("eventId".to_owned()),
                    role: "role".to_owned(),
                    roles: vec!["host".to_owned(), "guest".to_owned()],
                    pending_roles: None,
                    bootstrap_role: None,
                    last_holder: None,
                    expiry: None,
                    incidental: Some(vec!["nickname".to_owned()]),
                    provenance: None,
                    transitions: Vec::new(),
                    scope: MembershipScope::Resource,
                    resource_table: Some("events".to_owned()),
                    principal_addressed_writes: None,
                }),
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            }],
            ..SchemaManifest::default()
        }
    }

    #[test]
    fn framework_owned_collection_rows_are_authorization_events() {
        let mut schema = schema(None);
        schema.tables[0].name = "_snapback_asset_collection_gallery".to_owned();
        schema.asset_collections = vec![crate::manifest::AssetCollectionManifestV1 {
            format: "snapback.asset-collection.v1".to_owned(),
            generation: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                .to_owned(),
            name: "gallery".to_owned(),
            owner_table: "posts".to_owned(),
            owner_field: "ownerId".to_owned(),
            intent: "media".to_owned(),
            max_items: 8,
            order: crate::manifest::AssetCollectionOrderV1::Manual,
            kinds: vec![crate::contract_types::MediaKindV1::Image],
            duplicate_policy: "refuse.v1".to_owned(),
            sharing: crate::manifest::AssetCollectionSharingManifestV1 {
                format: "snapback.asset-collection-sharing.v1".to_owned(),
                ceiling: vec![crate::manifest::AssetCollectionSharingPlanManifestV1 {
                    name: "none".to_owned(),
                    plan: crate::manifest::AssetCollectionSharingPlanV1::None,
                }],
                default_plan: "none".to_owned(),
            },
            child_table: "_snapback_asset_collection_gallery".to_owned(),
            fields: crate::manifest::AssetCollectionFieldsManifestV1 {
                parent_id: "parentId".to_owned(),
                parent_incarnation: "parentIncarnation".to_owned(),
                asset_id: "assetId".to_owned(),
                kind: "kind".to_owned(),
                policy_generation: "policyGeneration".to_owned(),
                ordinal: "ordinal".to_owned(),
            },
            operations: crate::manifest::AssetCollectionOperationsManifestV1 {
                query: "gallery".to_owned(),
                append: "galleryAppend".to_owned(),
                replace: "galleryReplace".to_owned(),
                remove: "galleryRemove".to_owned(),
                reorder: Some("galleryReorder".to_owned()),
            },
        }];
        assert!(change_is_authorization_event(
            &schema,
            &ChangedRow {
                table: "_snapback_asset_collection_gallery".to_owned(),
                id: "item".to_owned(),
                op: ChangeOp::Insert,
                row: None,
                changed_fields: vec![],
            }
        ));
    }

    #[test]
    fn permission_fields_suppress_only_known_nonempty_disjoint_updates() {
        let schema = schema(Some(vec!["role"]));
        assert!(!change_is_authorization_event(
            &schema,
            &update(&["avatar"])
        ));
        assert!(change_is_authorization_event(&schema, &update(&["role"])));
        assert!(change_is_authorization_event(&schema, &update(&[])));
        assert!(change_is_authorization_event(
            &schema,
            &update(&["unknown"])
        ));

        let mut insert = update(&["avatar"]);
        insert.op = ChangeOp::Insert;
        assert!(change_is_authorization_event(&schema, &insert));
        insert.op = ChangeOp::Delete;
        assert!(change_is_authorization_event(&schema, &insert));
    }

    #[test]
    fn absent_permission_fields_makes_every_update_conservative() {
        assert!(change_is_authorization_event(
            &schema(None),
            &update(&["avatar"])
        ));
    }

    #[test]
    fn absent_and_empty_changed_field_metadata_are_unknown() {
        let absent: ChangedRow = serde_json::from_value(serde_json::json!({
            "table": "users",
            "id": "user-1",
            "op": "Update",
            "row": null
        }))
        .expect("legacy changed row without changed_fields");
        assert!(absent.changed_fields.is_empty());
        assert!(change_is_authorization_event(
            &schema(Some(vec!["role"])),
            &absent
        ));

        let no_permission_fields = schema(Some(Vec::new()));
        assert!(change_is_authorization_event(
            &no_permission_fields,
            &update(&[])
        ));
        assert!(!change_is_authorization_event(
            &no_permission_fields,
            &update(&["avatar"])
        ));
    }

    #[test]
    fn membership_declaration_derives_event_one_and_incidental_narrowing() {
        let schema = membership_schema();
        let change = |op, fields: &[&str]| ChangedRow {
            table: "event_members".to_owned(),
            id: "member-1".to_owned(),
            op,
            row: None,
            changed_fields: fields.iter().map(|field| (*field).to_owned()).collect(),
        };

        assert!(change_is_authorization_event(
            &schema,
            &change(ChangeOp::Insert, &[])
        ));
        assert!(change_is_authorization_event(
            &schema,
            &change(ChangeOp::Delete, &[])
        ));
        assert!(change_is_authorization_event(
            &schema,
            &change(ChangeOp::Update, &["role"])
        ));
        assert!(change_is_authorization_event(
            &schema,
            &change(ChangeOp::Update, &["expiresAt"])
        ));
        assert!(!change_is_authorization_event(
            &schema,
            &change(ChangeOp::Update, &["nickname"])
        ));
        assert!(change_is_authorization_event(
            &schema,
            &change(ChangeOp::Update, &[])
        ));
        assert!(change_is_authorization_event(
            &schema,
            &change(ChangeOp::Update, &["futureField"])
        ));
    }
}
