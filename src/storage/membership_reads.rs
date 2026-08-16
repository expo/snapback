use super::{CapturedReadDependency, CapturedReadKind, LocalDatabase, SnapbackResult};
use crate::manifest::MembershipManifest;
use rusqlite::TransactionBehavior;
use serde_json::Value;

impl LocalDatabase {
    fn membership_reads_transaction<T>(
        &mut self,
        f: impl FnOnce(&rusqlite::Transaction<'_>) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let value = f(&tx)?;
        tx.commit()?;
        Ok(value)
    }

    pub(super) fn read_my_memberships_projection(
        &mut self,
        caller: Option<&str>,
        table_name: &str,
        membership: &MembershipManifest,
    ) -> SnapbackResult<(Vec<Value>, Vec<CapturedReadDependency>)> {
        // An anonymous caller holds no seats and captures no dependencies:
        // signing in is a fenced authority transition that re-establishes
        // the subscription rather than mutating this one.
        let Some(caller) = caller else {
            return Ok((Vec::new(), Vec::new()));
        };
        let caller = caller.to_owned();
        let table_name = table_name.to_owned();
        let principal_field = membership.principal.clone();
        let resource_field = membership.resource.clone();
        let role_field = membership.role.clone();
        self.membership_reads_transaction(move |tx| {
            let table_ident = super::quote_ident(&table_name)?;
            let principal_ident = super::quote_ident(&principal_field)?;
            let role_ident = super::quote_ident(&role_field)?;
            let resource_select = match &resource_field {
                Some(field) => super::quote_ident(field)?,
                None => "NULL".to_owned(),
            };
            let sql = format!(
                "SELECT _id, _version, _createdAt, {resource_select}, {role_ident} \
                 FROM {table_ident} WHERE {principal_ident} = ?1 \
                 ORDER BY _createdAt, _id"
            );
            let mut statement = tx.prepare(&sql)?;
            let mut rows = Vec::new();
            let mut dependencies = Vec::new();
            let mut result = statement.query(rusqlite::params![caller])?;
            while let Some(row) = result.next()? {
                let id: String = row.get(0)?;
                let row_version: u64 = row.get::<_, i64>(1)?.try_into().unwrap_or_default();
                let since: i64 = row.get(2)?;
                let resource: Option<String> = row.get(3)?;
                let role: String = row.get(4)?;
                dependencies.push(CapturedReadDependency {
                    kind: CapturedReadKind::Row,
                    table: Some(table_name.clone()),
                    id: Some(id.clone()),
                    version: Some(row_version),
                    predicate: None,
                    rows: Vec::new(),
                    field: None,
                    value: None,
                    order: None,
                    limit: None,
                    result_count: None,
                    boundary: None,
                });
                rows.push(serde_json::json!({
                    "id": id,
                    "resource": resource,
                    "role": role,
                    "sinceMs": since,
                }));
            }
            // The principal-slice range capture: result_count participates in
            // the fingerprint, so the empty slice is a first-class captured
            // fact (the LLP 0056 pinned-empty-capture idiom) and a grant or
            // removal moves the vector even before its row dependency exists.
            dependencies.push(CapturedReadDependency {
                kind: CapturedReadKind::Query,
                table: Some(table_name.clone()),
                id: None,
                version: None,
                predicate: None,
                rows: Vec::new(),
                field: Some(principal_field.clone()),
                value: Some(Value::String(caller.clone())),
                order: None,
                limit: None,
                result_count: Some(rows.len()),
                boundary: None,
            });
            Ok((rows, dependencies))
        })
    }

    pub(super) fn read_authority_roster_page(
        &self,
        declaration: &str,
        caller: Option<&str>,
        resource: Option<&str>,
        page: crate::membership_rules::AuthorityRosterPageRequestV1,
    ) -> SnapbackResult<
        crate::membership_rules::CapturedMembershipReadOutcome<
            crate::membership_rules::AuthorityRosterPageV1,
        >,
    > {
        // @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface —
        // roster bytes leave storage only through the profile-gated host plan.
        crate::membership_rules::authority_roster_list(
            &super::DbRead::Live(self),
            declaration,
            caller,
            resource,
            page,
        )
    }

    pub(super) fn read_authority_my_role(
        &self,
        declaration: &str,
        caller: Option<&str>,
        resource: Option<&str>,
    ) -> SnapbackResult<
        crate::membership_rules::CapturedMembershipReadOutcome<
            crate::membership_rules::AuthorityMyRoleV1,
        >,
    > {
        crate::membership_rules::authority_my_role(
            &super::DbRead::Live(self),
            declaration,
            caller,
            resource,
        )
    }

    #[cfg(test)]
    fn test_insert_channel_member(
        &mut self,
        id: &str,
        channel: &str,
        user: &str,
        role: &str,
    ) -> SnapbackResult<()> {
        self.membership_reads_transaction(|tx| {
            tx.execute(
                "INSERT INTO channel_members (_id, _version, _createdAt, _updatedAt, channelId, userId, role) \
                 VALUES (?1, 1, 1000, 1000, ?2, ?3, ?4)",
                rusqlite::params![id, channel, user, role],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    fn test_delete_channel_member_seat_a2(&mut self) -> SnapbackResult<()> {
        self.membership_reads_transaction(|tx| {
            tx.execute("DELETE FROM channel_members WHERE _id = 'seat_a2'", [])?;
            Ok(())
        })
    }
}

/// Narrow typed access to membership-domain storage reads.
///
/// @ref LLP 0225#1-ownership-map — membership projections enter the
/// storage kernel through a typed operation instead of an asset transaction.
pub struct MembershipReadsKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> MembershipReadsKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn read_my_memberships_projection(
        &mut self,
        caller: Option<&str>,
        table_name: &str,
        membership: &MembershipManifest,
    ) -> SnapbackResult<(Vec<Value>, Vec<CapturedReadDependency>)> {
        self.db
            .read_my_memberships_projection(caller, table_name, membership)
    }

    pub fn read_authority_roster_page(
        &self,
        declaration: &str,
        caller: Option<&str>,
        resource: Option<&str>,
        page: crate::membership_rules::AuthorityRosterPageRequestV1,
        register: impl FnMut(CapturedReadDependency),
    ) -> SnapbackResult<crate::membership_rules::AuthorityRosterPageV1> {
        self.db
            .read_authority_roster_page(declaration, caller, resource, page)?
            .finish(register)
    }

    pub fn read_authority_my_role(
        &self,
        declaration: &str,
        caller: Option<&str>,
        resource: Option<&str>,
        register: impl FnMut(CapturedReadDependency),
    ) -> SnapbackResult<crate::membership_rules::AuthorityMyRoleV1> {
        self.db
            .read_authority_my_role(declaration, caller, resource)?
            .finish(register)
    }

    #[cfg(test)]
    pub fn insert_channel_member(
        &mut self,
        id: &str,
        channel: &str,
        user: &str,
        role: &str,
    ) -> SnapbackResult<()> {
        self.db.test_insert_channel_member(id, channel, user, role)
    }

    #[cfg(test)]
    pub fn delete_channel_member_seat_a2(&mut self) -> SnapbackResult<()> {
        self.db.test_delete_channel_member_seat_a2()
    }
}
