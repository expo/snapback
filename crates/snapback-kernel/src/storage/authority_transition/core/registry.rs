//! Fixed resource and protected-object registry for the dormant substrate.

use super::*;

const RESOURCE_GUARD_TABLE: &str = "_snapback_authorization_publication_guard_v1";

pub(super) fn read_resource_guard(
    connection: &Connection,
) -> AuthorityTransitionResult<(DurableOrigin, ResourceBinding)> {
    let (origin, binding, state) = connection
        .query_row(
            "SELECT durable_origin, resource_binding, state
             FROM _snapback_authorization_publication_guard_v1
             WHERE singleton = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|_| AuthorityTransitionError::CorruptResourceGuard)?;
    if state != "operational" || origin.len() != 32 || binding.len() != 32 {
        return Err(AuthorityTransitionError::CorruptResourceGuard);
    }
    let mut durable_origin = [0_u8; 32];
    durable_origin.copy_from_slice(&origin);
    let mut resource_binding = [0_u8; 32];
    resource_binding.copy_from_slice(&binding);
    Ok((
        DurableOrigin(durable_origin),
        ResourceBinding(resource_binding),
    ))
}

pub(super) fn guard_matches_connection(
    connection: &Connection,
    durable_origin: &DurableOrigin,
    resource_binding: &ResourceBinding,
) -> AuthorityTransitionResult<()> {
    let (observed_origin, observed_binding) = read_resource_guard(connection)?;
    if &observed_origin == durable_origin && &observed_binding == resource_binding {
        Ok(())
    } else {
        Err(AuthorityTransitionError::ResourceGuardChanged)
    }
}

pub(super) fn is_protected_table(table_name: &str) -> bool {
    table_name.starts_with("_auth_") || table_name.eq_ignore_ascii_case(RESOURCE_GUARD_TABLE)
}
