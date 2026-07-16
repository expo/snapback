//! LLP 0055 G1: agent-principal ownership and durable, permanent deactivation
//! on the version-2 auth catalog.
//!
//! This module owns the storage-side machinery the RFC pins as G1: creating a
//! `kind: "agent"` principal with its immutable provenance and owner, the
//! fail-closed deactivation consult that every authority-creating and
//! authority-exercising path must cross, and the eligible-holder predicate that
//! refuses a deactivation which would strand an LLP 0056 protected resource.
//!
//! The full grant/token/credential lifecycle (mint, rotate, recover, consent)
//! is G3/G4 and is deliberately **not** implemented here.
//!
//! @ref LLP 0055#principal-kinds — `kind`/`registration_provenance` are
//!   create-only; deactivation is durable, permanent in v1, and refused when it
//!   would leave a protected resource with no eligible holder.

use super::LocalDatabase;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{MembershipScope, SchemaManifest};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;

#[derive(Clone, Copy)]
struct ProtectedMembershipColumns<'a> {
    table: &'a str,
    principal: &'a str,
    resource: &'a str,
    role: &'a str,
}

/// The immutable registration facts recorded when an agent principal is created.
/// `kind` is always `agent`; `registration_provenance` and `kind` are written
/// once and never updated, which is how their documented immutability is kept.
pub(crate) struct AgentRegistration {
    pub display_name: Option<String>,
    pub operator_contact: Option<String>,
    /// Canonical JSON provenance — the tagged minting authority, invitation
    /// class, and creation timestamp; durable, exported, redacted of secrets,
    /// and independent of the sweeping invitation row.
    pub registration_provenance: String,
    /// The owner recorded for the `invitedBy: "users"` production creation path;
    /// `None` for an operator-created or `open` self-registered (unowned) agent.
    pub owner_user_id: Option<String>,
}

impl LocalDatabase {
    /// Create a `kind: "agent"` principal. The caller has already minted the id
    /// and validated the owner. Fails closed on the catalog checks the direct
    /// auth lane always crosses.
    ///
    /// @ref LLP 0055#principal-kinds — an agent created from a user's session
    ///   records that user as owner; `registration_provenance` is immutable.
    pub(crate) fn create_agent_principal(
        &mut self,
        user_id: &str,
        created_at_ms: u64,
        registration: &AgentRegistration,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES(?1, ?2, 'agent', ?3, ?4, ?5, NULL, ?6)",
                params![
                    user_id,
                    created_at_ms as i64,
                    registration.display_name,
                    registration.operator_contact,
                    registration.registration_provenance,
                    registration.owner_user_id,
                ],
            )?;
            Ok(())
        })
    }

    /// The `owner_user_id` recorded for an agent, or `None` when the principal is
    /// unowned or not an agent. Ownership is what lets an owner re-credential
    /// their own agent from an ordinary session (the production path; G3).
    pub(crate) fn agent_owner(&self, user_id: &str) -> SnapbackResult<Option<String>> {
        self.with_auth_read(|conn| {
            Ok(conn
                .query_row(
                    "SELECT owner_user_id FROM _auth_users WHERE id = ?1 AND kind = 'agent'",
                    params![user_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten())
        })
    }

    /// Fail-closed deactivation consult: `true` iff `user_id` is a principal with
    /// a durable `deactivated_at_ms`. This is the read every authority path
    /// crosses; [`Self::require_agent_not_deactivated`] is its typed-refusal twin.
    pub(crate) fn agent_is_deactivated(&self, user_id: &str) -> SnapbackResult<bool> {
        self.with_auth_read(|conn| Ok(is_deactivated_on(conn, user_id)?))
    }

    /// Refuse, typed, when `user_id` is a permanently deactivated agent. Every
    /// authority-creating and authority-exercising agent path calls this before
    /// acting, so deactivation closes every door fail-closed.
    ///
    /// @ref LLP 0055#ending-authority-revocation-expiry-deactivation — deactivation is consulted fail-closed by
    ///   token mint, invocation validation, pairing, approval, template
    ///   application, and recovery consumption.
    pub(crate) fn require_agent_not_deactivated(&self, user_id: &str) -> SnapbackResult<()> {
        if self.agent_is_deactivated(user_id)? {
            return Err(agent_deactivated(user_id));
        }
        Ok(())
    }

    /// Permanently deactivate an agent (v1: no reactivation path). Refused,
    /// typed, when it would leave any `lastHolder`-protected LLP 0056 resource
    /// with no eligible holder — naming the resources so the app can seat a
    /// replacement first. Re-deactivating an already-deactivated agent is an
    /// idempotent success.
    ///
    /// @ref LLP 0055#principal-kinds — the predicate is eligibility, not
    ///   sole-ness (a two-step schedule defeats sole-ness); a holder is eligible
    ///   iff its principal is not permanently deactivated. Same predicate as
    ///   LLP 0056 M2's eligible-holder rule, from the other side.
    pub(crate) fn deactivate_agent(
        &mut self,
        user_id: &str,
        now_ms: u64,
        manifest: &SchemaManifest,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            let existing: Option<(String, Option<i64>)> = tx
                .query_row(
                    "SELECT kind, deactivated_at_ms FROM _auth_users WHERE id = ?1",
                    params![user_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let Some((kind, deactivated_at_ms)) = existing else {
                return Err(agent_unknown(user_id));
            };
            if kind != "agent" {
                return Err(agent_unknown(user_id));
            }
            if deactivated_at_ms.is_some() {
                // Already terminal; permanent state is idempotent.
                return Ok(());
            }

            let stranded = stranded_protected_resources(tx, user_id, manifest)?;
            if !stranded.is_empty() {
                return Err(deactivation_would_strand(&stranded));
            }

            tx.execute(
                "UPDATE _auth_users
                 SET deactivated_at_ms = ?1
                 WHERE id = ?2 AND kind = 'agent' AND deactivated_at_ms IS NULL",
                params![now_ms as i64, user_id],
            )?;
            Ok(())
        })
    }
}

fn is_deactivated_on(conn: &Connection, user_id: &str) -> rusqlite::Result<bool> {
    let deactivated: Option<Option<i64>> = conn
        .query_row(
            "SELECT deactivated_at_ms FROM _auth_users WHERE id = ?1",
            params![user_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(matches!(deactivated, Some(Some(_))))
}

/// LLP 0056 M2 reuses G1's eligibility predicate from the write side: a holder
/// principal is **eligible** iff it is not permanently deactivated. A principal
/// absent from `_auth_users` (e.g. a plain human user) is not deactivated, hence
/// eligible. This is the exact predicate `has_other_eligible_holder` uses, kept
/// in one module so the two sides can never disagree.
///
/// @ref LLP 0055#principal-kinds — eligibility, not sole-ness; same predicate as
///   LLP 0056 M2's eligible-holder rule.
pub(crate) fn principal_is_eligible_on(conn: &Connection, principal: &str) -> SnapbackResult<bool> {
    // No auth catalog means no deactivation state, so every principal is
    // eligible — the same fallback the activation scan uses.
    if !table_exists(conn, "_auth_users")? {
        return Ok(true);
    }
    Ok(!is_deactivated_on(conn, principal)?)
}

/// The **eligible** holder member rows of the protected role on one resource,
/// excluding `excluding_principal` (the acting/target principal). Each entry is
/// `(member_row_id, member_row_version, principal)`. LLP 0056 M2 captures one of
/// these rows as a snapshot-bound dependency so two concurrent removals of the
/// final two eligible holders cannot both commit — the same eligibility filter
/// (`NOT IN` the deactivated set) `has_other_eligible_holder` applies, but
/// returning the row identity the write path must capture.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   holder-set read is captured; the survivor row linearizes the race.
#[allow(clippy::too_many_arguments)]
pub(crate) fn eligible_protected_holder_rows(
    conn: &Connection,
    table: &str,
    principal_column: &str,
    resource_column: &str,
    role_column: &str,
    resource: &str,
    protect: &str,
    excluding_principal: &str,
) -> SnapbackResult<Vec<(String, u64, String)>> {
    // The `NOT IN` deactivation filter only applies when the auth catalog
    // exists; without it, no principal is deactivated so every holder is eligible.
    let deactivation_filter = if table_exists(conn, "_auth_users")? {
        format!(
            "AND m.{principal} NOT IN (
               SELECT id FROM _auth_users WHERE deactivated_at_ms IS NOT NULL
             )",
            principal = quote_ident(principal_column),
        )
    } else {
        String::new()
    };
    let sql = format!(
        "SELECT m._id, m._version, m.{principal} FROM {table} AS m
         WHERE m.{resource} = ?1 AND m.{role} = ?2 AND m.{principal} <> ?3
           {deactivation_filter}
         ORDER BY m._id",
        table = quote_ident(table),
        resource = quote_ident(resource_column),
        role = quote_ident(role_column),
        principal = quote_ident(principal_column),
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![resource, protect, excluding_principal], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)? as u64,
            row.get::<_, String>(2)?,
        ))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// The `lastHolder`-protected resources that deactivating `principal` would
/// strand: for each membership declaration with `lastHolder`, every resource in
/// which `principal` holds the protected role and no **other eligible** holder
/// remains. Reads the app membership tables and the auth deactivation state in
/// the same transaction.
fn stranded_protected_resources(
    conn: &Connection,
    principal: &str,
    manifest: &SchemaManifest,
) -> SnapbackResult<Vec<String>> {
    let mut stranded = Vec::new();
    for table in &manifest.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        let Some(last_holder) = &membership.last_holder else {
            continue;
        };
        // `lastHolder` is valid only on resource scope (M1 refuses it on app
        // scope), so a resource column is always present here.
        if membership.scope != MembershipScope::Resource {
            continue;
        }
        let Some(resource_column) = membership.resource.as_deref() else {
            continue;
        };
        if !table_exists(conn, &table.name)? {
            continue;
        }
        let protect = last_holder.protect.as_str();
        let columns = ProtectedMembershipColumns {
            table: &table.name,
            principal: &membership.principal,
            resource: resource_column,
            role: &membership.role,
        };
        let held = resources_held_by(
            conn,
            columns,
            principal,
            protect,
        )?;
        for resource in held {
            if !has_other_eligible_holder(
                conn,
                columns,
                principal,
                &resource,
                protect,
            )? {
                stranded.push(format!("{}:{resource}", table.name));
            }
        }
    }
    stranded.sort();
    stranded.dedup();
    Ok(stranded)
}

fn table_exists(conn: &Connection, table: &str) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1",
            params![table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn resources_held_by(
    conn: &Connection,
    columns: ProtectedMembershipColumns<'_>,
    principal: &str,
    protect: &str,
) -> SnapbackResult<Vec<String>> {
    let sql = format!(
        "SELECT DISTINCT {resource} FROM {table}
         WHERE {principal} = ?1 AND {role} = ?2",
        resource = quote_ident(columns.resource),
        table = quote_ident(columns.table),
        principal = quote_ident(columns.principal),
        role = quote_ident(columns.role),
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![principal, protect], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Whether `resource` still has a holder of the protected role that is neither
/// `principal` (about to be deactivated) nor a permanently-deactivated agent. A
/// holder principal absent from `_auth_users` is not deactivated, hence eligible.
fn has_other_eligible_holder(
    conn: &Connection,
    columns: ProtectedMembershipColumns<'_>,
    principal: &str,
    resource: &str,
    protect: &str,
) -> SnapbackResult<bool> {
    let sql = format!(
        "SELECT 1 FROM {table} AS m
         WHERE m.{resource} = ?1 AND m.{role} = ?2 AND m.{principal} <> ?3
           AND m.{principal} NOT IN (
             SELECT id FROM _auth_users WHERE deactivated_at_ms IS NOT NULL
           )
         LIMIT 1",
        table = quote_ident(columns.table),
        resource = quote_ident(columns.resource),
        role = quote_ident(columns.role),
        principal = quote_ident(columns.principal),
    );
    Ok(conn
        .query_row(&sql, params![resource, protect, principal], |_| Ok(()))
        .optional()?
        .is_some())
}

/// Quote a SQLite identifier. Membership table/column names are validated
/// identifiers by schema validation; doubling any embedded quote keeps this
/// injection-safe even if that ever changes.
fn quote_ident(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn agent_unknown(user_id: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_UNKNOWN",
        "auth",
        "no agent principal exists for the named user id",
    )
    .with_details(json!({ "userId": user_id }))
}

fn agent_deactivated(user_id: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_DEACTIVATED",
        "auth",
        "the agent principal is permanently deactivated",
    )
    .with_details(json!({ "userId": user_id }))
}

fn deactivation_would_strand(resources: &[String]) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND",
        "auth",
        "deactivation would leave a protected resource with no eligible holder",
    )
    .with_details(json!({ "resources": resources }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::SchemaManifest;
    use crate::storage::auth::AUTH_CATALOG_VERSION;

    fn ready_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog().expect("activate catalog v2");
        db
    }

    fn empty_manifest() -> SchemaManifest {
        serde_json::from_value(json!({ "tables": [] })).expect("empty manifest")
    }

    fn seed_human(db: &LocalDatabase, id: &str) {
        db.conn
            .execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, 0)",
                params![id],
            )
            .expect("seed human user");
    }

    fn create_agent(db: &mut LocalDatabase, id: &str, owner: Option<&str>) {
        db.create_agent_principal(
            id,
            0,
            &AgentRegistration {
                display_name: Some(format!("agent {id}")),
                operator_contact: None,
                registration_provenance: json!({
                    "invitedBy": "users",
                    "class": "creation",
                    "createdAtMs": 0,
                })
                .to_string(),
                owner_user_id: owner.map(str::to_owned),
            },
        )
        .expect("create agent principal");
    }

    /// A `.membership()` on `eventMembers` protecting the `host` role, plus the
    /// physical app table the eligibility scan reads.
    fn host_membership(db: &LocalDatabase) -> SchemaManifest {
        db.conn
            .execute(
                "CREATE TABLE eventMembers (principal TEXT, resource TEXT, role TEXT)",
                [],
            )
            .expect("create membership table");
        serde_json::from_value(json!({
            "tables": [{
                "name": "eventMembers",
                "membership": {
                    "principal": "principal",
                    "resource": "resource",
                    "role": "role",
                    "roles": ["host"],
                    "lastHolder": { "protect": "host" }
                }
            }]
        }))
        .expect("membership manifest")
    }

    fn seat(db: &LocalDatabase, principal: &str, resource: &str, role: &str) {
        db.conn
            .execute(
                "INSERT INTO eventMembers(principal, resource, role) VALUES(?1, ?2, ?3)",
                params![principal, resource, role],
            )
            .expect("seat membership");
    }

    #[test]
    fn create_records_kind_owner_and_immutable_provenance() {
        let mut db = ready_database();
        seed_human(&db, "owner-1");
        create_agent(&mut db, "agent-1", Some("owner-1"));

        let (kind, owner, provenance, deactivated): (String, Option<String>, String, Option<i64>) =
            db.conn
                .query_row(
                    "SELECT kind, owner_user_id, registration_provenance, deactivated_at_ms
                     FROM _auth_users WHERE id = 'agent-1'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .expect("agent row");
        assert_eq!(kind, "agent");
        assert_eq!(owner.as_deref(), Some("owner-1"));
        assert!(provenance.contains("\"invitedBy\":\"users\""));
        assert_eq!(deactivated, None);
        assert_eq!(db.agent_owner("agent-1").unwrap().as_deref(), Some("owner-1"));
        assert!(!db.agent_is_deactivated("agent-1").unwrap());
    }

    #[test]
    fn deactivation_is_durable_permanent_and_closes_doors() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("app.sqlite");
        {
            let mut db = LocalDatabase::open(&path).expect("open db");
            db.activate_current_auth_catalog().expect("activate");
            create_agent(&mut db, "agent-1", None);
            // No memberships → deactivation strands nothing.
            db.deactivate_agent("agent-1", 100, &empty_manifest())
                .expect("deactivate");
            assert!(db.agent_is_deactivated("agent-1").unwrap());
            // Every door is closed fail-closed.
            let error = db.require_agent_not_deactivated("agent-1").unwrap_err();
            assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_AGENT_DEACTIVATED");
            // Permanent + idempotent: re-deactivating does not move the timestamp
            // and there is no reactivation path.
            db.deactivate_agent("agent-1", 999, &empty_manifest())
                .expect("idempotent redeactivate");
            let at: i64 = db
                .conn
                .query_row(
                    "SELECT deactivated_at_ms FROM _auth_users WHERE id = 'agent-1'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(at, 100, "deactivation timestamp must not move");
        }
        // Survives restart: reopen the same file and the state is still terminal.
        let db = LocalDatabase::open(&path).expect("reopen db");
        assert!(db.agent_is_deactivated("agent-1").unwrap());
        assert!(
            db.require_agent_not_deactivated("agent-1").is_err(),
            "deactivation must survive restart"
        );
    }

    #[test]
    fn deactivation_refused_when_it_would_strand_the_sole_holder() {
        let mut db = ready_database();
        let manifest = host_membership(&db);
        create_agent(&mut db, "agent-a", None);
        seat(&db, "agent-a", "event-1", "host");

        let error = db
            .deactivate_agent("agent-a", 100, &manifest)
            .expect_err("sole holder deactivation must be refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND"
        );
        assert_eq!(
            error.diagnostic.details["resources"][0],
            "eventMembers:event-1"
        );
        // Refusal leaves the principal live.
        assert!(!db.agent_is_deactivated("agent-a").unwrap());
    }

    #[test]
    fn two_step_deactivation_schedule_cannot_strand_a_resource() {
        // The review-caught trap: a sole-holder check is defeated by deactivating
        // A (not sole) then B (now the last *eligible* holder). Eligibility, not
        // sole-ness, closes it.
        let mut db = ready_database();
        let manifest = host_membership(&db);
        create_agent(&mut db, "agent-a", None);
        create_agent(&mut db, "agent-b", None);
        seat(&db, "agent-a", "event-1", "host");
        seat(&db, "agent-b", "event-1", "host");

        // Deactivating A is allowed — B is still an eligible holder.
        db.deactivate_agent("agent-a", 100, &manifest)
            .expect("A is not the last eligible holder");
        assert!(db.agent_is_deactivated("agent-a").unwrap());

        // Deactivating B is refused — A is now ineligible, so B is the last
        // eligible holder and the resource would strand permanently.
        let error = db
            .deactivate_agent("agent-b", 200, &manifest)
            .expect_err("second-step deactivation must be refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND"
        );
        assert!(!db.agent_is_deactivated("agent-b").unwrap());
    }

    #[test]
    fn deactivation_allowed_while_another_eligible_holder_remains() {
        let mut db = ready_database();
        let manifest = host_membership(&db);
        create_agent(&mut db, "agent-a", None);
        create_agent(&mut db, "agent-b", None);
        seat(&db, "agent-a", "event-1", "host");
        seat(&db, "agent-b", "event-1", "host");

        db.deactivate_agent("agent-a", 100, &manifest)
            .expect("another eligible holder remains");
        assert!(db.agent_is_deactivated("agent-a").unwrap());
    }

    #[test]
    fn deactivating_a_non_agent_or_unknown_principal_is_typed() {
        let mut db = ready_database();
        seed_human(&db, "human-1");
        for id in ["human-1", "nobody"] {
            let error = db
                .deactivate_agent(id, 100, &empty_manifest())
                .expect_err("non-agent must be refused");
            assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_AGENT_UNKNOWN");
        }
    }

    #[test]
    fn catalog_refuses_a_version_above_this_binary_understanding() {
        // Refuse-at-open: a fresh catalog is v2 and recognized; a marker naming a
        // higher version must fail closed rather than reopen "without agents".
        let db = ready_database();
        assert_eq!(
            db.inspect_auth_catalog().unwrap(),
            crate::storage::auth::AuthCatalogState::ReadyV2
        );
        assert_eq!(AUTH_CATALOG_VERSION, "2");
        db.conn
            .execute(
                "UPDATE _snapback_meta SET value = '3' WHERE key = 'auth_catalog_version'",
                [],
            )
            .expect("bump marker above understanding");
        let error = db
            .inspect_auth_catalog()
            .expect_err("a higher catalog version must be refused at open");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED"
        );
    }
}
