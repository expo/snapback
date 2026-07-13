//! Transactional authorization-version classification and persistence.
//!
//! This is deliberately the only primitive that advances the durable pair.
//! Callers choose a closed cause and invoke it before their SQLite commit.

use super::auth_stream;
use super::{AuthorizationCommitWitness, ChangeOp, ChangedRow};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::SchemaManifest;
use rusqlite::Transaction;

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
            })
        }
        AuthorizationCommitCause::Activation => {
            let version = auth_stream::advance_authorization_epoch_in(tx)?;
            Ok(AuthorizationCommitWitness {
                version,
                event: true,
                incarnation_rotated: false,
            })
        }
        AuthorizationCommitCause::AppWrites { schema, changes } => {
            let event = changes
                .iter()
                .any(|change| change_is_authorization_event(schema, change));
            let version = if event {
                auth_stream::advance_authorization_epoch_in(tx)?
            } else {
                auth_stream::ensure_authorization_version_in(tx)?
            };
            Ok(AuthorizationCommitWitness {
                version,
                event,
                incarnation_rotated: false,
            })
        }
    }
}

fn change_is_authorization_event(schema: &SchemaManifest, change: &ChangedRow) -> bool {
    let Some(table) = schema.table(&change.table) else {
        // A writer-produced change should always name a current table. If a
        // future import/admin lane supplies incomplete metadata, fail toward
        // invalidation rather than silently treating the unknown as ordinary.
        return true;
    };
    if !table.permission_backing {
        return false;
    }
    if !matches!(change.op, ChangeOp::Update) {
        return true;
    }
    let Some(permission_fields) = table.permission_fields.as_ref() else {
        return true;
    };
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
            .any(|changed| permission_fields.contains(changed))
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
    use crate::manifest::{FieldManifest, FieldType, TableManifest};

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
}
