use std::collections::BTreeSet;

pub use snapback_types::ephemeral::*;

const MAX_OUTBOX_BACKLOG: usize = 1_024;
const LOCAL_HARD_MAX_TTL_MS: Millis = 30_000;
const STREAM_COLLECTION_NAME: &str = "_snapback_stream";
pub const MAX_EPHEMERAL_SCOPE_FIELDS: usize = 16;
pub const MAX_EPHEMERAL_COLLECTION_NAME_BYTES: usize = 64;
pub const MAX_EPHEMERAL_SCOPE_KEY_BYTES: usize = 64;

fn valid_manifest_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn collection_requires_room_permission(collection: &EphemeralCollection) -> bool {
    matches!(
        collection.publish,
        AccessPolicy::RequireRoomPermission { .. }
    ) || matches!(
        collection.subscribe,
        AccessPolicy::RequireRoomPermission { .. }
    )
}

/// Validate the complete local ephemeral definition set before it can replace
/// live authority state. Codegen performs the same authoring checks, but the
/// Rust parser is the artifact authority (LLP 0037), so direct ingestion must
/// fail closed too.
pub fn validate_collection_definitions(
    collections: &[EphemeralCollection],
) -> Result<(), EphemeralError> {
    let mut names = BTreeSet::new();
    for collection in collections {
        if !valid_manifest_identifier(&collection.name)
            || collection.name.len() > MAX_EPHEMERAL_COLLECTION_NAME_BYTES
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection name {:?} is not a portable identifier",
                    collection.name
                ),
            ));
        }
        if !names.insert(collection.name.clone()) {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} is declared more than once",
                    collection.name
                ),
            ));
        }

        let scope = collection
            .scope_fields
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if scope.is_empty()
            || scope.len() > MAX_EPHEMERAL_SCOPE_FIELDS
            || scope.len() != collection.scope_fields.len()
            || scope.iter().any(|field| {
                !valid_manifest_identifier(field) || field.len() > MAX_EPHEMERAL_SCOPE_KEY_BYTES
            })
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} needs unique non-empty portable scope fields",
                    collection.name
                ),
            ));
        }
        let routing = collection
            .routing_fields
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if routing.is_empty()
            || routing.len() != collection.routing_fields.len()
            || !routing.is_subset(&scope)
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} needs unique routing fields drawn from its scope",
                    collection.name
                ),
            ));
        }

        if collection.default_ttl_ms == 0
            || collection.default_ttl_ms > collection.max_ttl_ms
            || collection.max_ttl_ms > LOCAL_HARD_MAX_TTL_MS
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} TTL budget must satisfy 0 < default <= max <= {}ms",
                    collection.name, LOCAL_HARD_MAX_TTL_MS
                ),
            ));
        }
        if collection.max_value_bytes == 0
            || collection.hard_max_value_bytes == 0
            || collection.max_value_bytes > collection.hard_max_value_bytes
            || (collection.hard_max_value_bytes > 4_096
                && collection.name != STREAM_COLLECTION_NAME)
            || (collection.name == STREAM_COLLECTION_NAME
                && collection.hard_max_value_bytes > 20 * 1024)
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} value budget is outside the admitted ceiling",
                    collection.name
                ),
            ));
        }
        if collection.sustained_hz == 0
            || collection.burst == 0
            || collection.dispatch_ms == 0
            || collection.max_pending_ephemeral_keys == 0
            || collection.max_pending_ephemeral_keys > MAX_OUTBOX_BACKLOG
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} rate, dispatch, and pending-key budgets must be positive and pending keys may not exceed {}",
                    collection.name, MAX_OUTBOX_BACKLOG
                ),
            ));
        }
        for policy in [&collection.publish, &collection.subscribe] {
            if matches!(policy, AccessPolicy::RequireRoomPermission { prefix } if
                !valid_manifest_identifier(prefix) || prefix.len() > MAX_EPHEMERAL_SCOPE_KEY_BYTES)
            {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::IncompatibleCollectionDefinition,
                    format!(
                        "ephemeral collection {} has an invalid authorization prefix",
                        collection.name
                    ),
                ));
            }
        }
    }
    Ok(())
}

pub fn validate_collection_permission_backing(
    collections: &[EphemeralCollection],
    tables: &[crate::manifest::TableManifest],
    require_for_protected: bool,
) -> Result<(), EphemeralError> {
    for collection in collections {
        if collection.name == STREAM_COLLECTION_NAME {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} is reserved for platform streaming",
                    STREAM_COLLECTION_NAME
                ),
            ));
        }
        let protected = collection_requires_room_permission(collection);
        let Some(projection) = collection.permission_backing.as_ref() else {
            if require_for_protected && protected {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::IncompatibleCollectionDefinition,
                    format!(
                        "protected ephemeral collection {} requires a durable permissionBacking projection in sessions mode",
                        collection.name
                    ),
                ));
            }
            continue;
        };
        if !protected {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} declares permissionBacking without a protected room policy",
                    collection.name
                ),
            ));
        }
        let Some(table) = tables.iter().find(|table| table.name == projection.table) else {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} permissionBacking references unknown table {}",
                    collection.name, projection.table
                ),
            ));
        };
        if !table.is_permission_backing() {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} permissionBacking table {} is not marked permissionBacking",
                    collection.name, table.name
                ),
            ));
        }
        let declared_scope = collection
            .scope_fields
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        let projected_scope = projection
            .scope_fields
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>();
        if projected_scope != declared_scope {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} permissionBacking must map every exact room scope field",
                    collection.name
                ),
            ));
        }
        let mut read_fields = projection
            .scope_fields
            .values()
            .cloned()
            .collect::<BTreeSet<_>>();
        read_fields.insert(projection.subject_field.clone());
        match (&projection.role_field, &projection.allowed_roles) {
            (None, None) => {}
            (Some(role_field), Some(allowed_roles)) => {
                // @ref LLP 0013#lowering-and-one-validator-convergence — role-aware
                // room authority is one activated projection, not a codegen-only
                // convention; direct and generated artifacts share this validator.
                let Some(membership) = table.membership.as_ref() else {
                    return Err(EphemeralError::new(
                        EphemeralErrorCode::IncompatibleCollectionDefinition,
                        format!(
                            "ephemeral collection {} role-aware permissionBacking requires a membership declaration on {}",
                            collection.name, table.name
                        ),
                    ));
                };
                if role_field != &membership.role {
                    return Err(EphemeralError::new(
                        EphemeralErrorCode::IncompatibleCollectionDefinition,
                        format!(
                            "ephemeral collection {} permissionBacking roleField must name the declared role axis on {}",
                            collection.name, table.name
                        ),
                    ));
                }
                let active_roles = membership.roles.iter().collect::<BTreeSet<_>>();
                let allowed_role_set = allowed_roles.iter().collect::<BTreeSet<_>>();
                if allowed_roles.is_empty()
                    || allowed_role_set.len() != allowed_roles.len()
                    || !allowed_role_set.is_subset(&active_roles)
                {
                    return Err(EphemeralError::new(
                        EphemeralErrorCode::IncompatibleCollectionDefinition,
                        format!(
                            "ephemeral collection {} permissionBacking allowedRoles must be a non-empty unique subset of {}'s active membership roles",
                            collection.name, table.name
                        ),
                    ));
                }
                read_fields.insert(role_field.clone());
            }
            _ => {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::IncompatibleCollectionDefinition,
                    format!(
                        "ephemeral collection {} permissionBacking roleField and allowedRoles must be declared together",
                        collection.name
                    ),
                ));
            }
        }
        if read_fields.iter().any(|field| table.field(field).is_none()) {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} permissionBacking references an unknown field on {}",
                    collection.name, table.name
                ),
            ));
        }
        if !read_fields
            .iter()
            .all(|field| table.field_affects_authorization(field))
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} permissionBacking reads fields omitted from {}.permissionFields",
                    collection.name, table.name
                ),
            ));
        }
    }
    Ok(())
}
