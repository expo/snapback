//! Membership identity policy helpers.

use super::*;

/// Resolve a stable membership declaration id to its table and declaration.
///
/// This shape-only lookup lives with the declaration types so storage-owned
/// search evaluation does not depend upward on the realtime rule engine.
pub(crate) fn find_membership_declaration<'a>(
    schema: &'a SchemaManifest,
    declaration_id: &str,
) -> Option<(&'a TableManifest, &'a MembershipManifest)> {
    schema.tables.iter().find_map(|table| {
        table
            .membership
            .as_ref()
            .filter(|membership| membership.effective_id(&table.name) == declaration_id)
            .map(|membership| (table, membership))
    })
}

/// The satisfying role set for a membership declaration.
///
/// @ref LLP 0056#rule-helpers — `memberOf` excludes `pendingRoles`.
pub(crate) fn effective_membership_roles(
    membership: &MembershipManifest,
    requested: Option<&[String]>,
) -> Vec<String> {
    match requested {
        Some(roles) => roles.to_vec(),
        None => membership.roles.clone(),
    }
}
