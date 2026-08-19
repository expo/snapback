//! Transactional recovery for foreign tables occupying the auth namespace.
//!
//! This is deliberately a narrow, fail-closed copier rather than a general
//! SQLite schema editor. Any shape that cannot be proved equivalent is left
//! for offline operator repair.

// @ref LLP 0057#transactional-algorithm — rescue scans dependencies, copies and proves a multiset, rewrites the manifest, and drops the source in one IMMEDIATE transaction.

use super::auth::{
    AuthCatalogState, auth_catalog_marker, inspect_auth_catalog_on,
    reject_exact_auth_catalog_object_collision,
};
use super::auth_mode::{
    META_AUTH_MODE_STATE, META_CAPABILITY_AWARE_SCHEMA_MANIFEST, META_STAGED_AUTH_MODE_MANIFEST,
};
use super::{
    LocalDatabase, META_SCHEMA_MANIFEST, is_auth_reserved_identifier,
    load_schema_manifest_from_connection, validate_schema,
};
use crate::auth::rescue::{
    CollisionRescueResult, quote_identifier, rewrite_create_index, rewrite_create_table,
    sql_may_reference_identifier, valid_identifier,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::SchemaManifest;
use rusqlite::{
    Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior, params,
};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static FAIL_RESCUE_AFTER_STEP: std::cell::Cell<Option<usize>> =
        const { std::cell::Cell::new(None) };
    static FAIL_RESCUE_COMMIT_BOUNDARY: std::cell::Cell<Option<RescueCommitFault>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RescueCommitFault {
    RolledBack,
    Committed,
    CommittedDivergent,
}

#[cfg(any(test, feature = "test-support"))]
pub fn inject_rescue_failure_after_step(step: usize) {
    FAIL_RESCUE_AFTER_STEP.with(|slot| {
        assert!(slot.get().is_none(), "rescue hook must be one-shot");
        slot.set(Some(step));
    });
}

#[cfg(any(test, feature = "test-support"))]
fn inject_rescue_commit_fault(fault: RescueCommitFault) {
    FAIL_RESCUE_COMMIT_BOUNDARY.with(|slot| {
        assert!(slot.get().is_none(), "rescue commit hook must be one-shot");
        slot.set(Some(fault));
    });
}

fn rescue_step_completed(step: usize) -> SnapbackResult<()> {
    #[cfg(not(any(test, feature = "test-support")))]
    let _ = step;
    #[cfg(any(test, feature = "test-support"))]
    FAIL_RESCUE_AFTER_STEP.with(|slot| {
        if slot.get() == Some(step) {
            slot.set(None);
            return Err(SnapbackError::error(
                "TEST_AUTH_RESCUE_FAILURE",
                "auth-rescue",
                "injected collision-rescue failure",
            ));
        }
        Ok(())
    })?;
    Ok(())
}

#[derive(Clone, Debug)]
struct SchemaObject {
    kind: String,
    name: String,
    table: String,
    sql: Option<String>,
}

#[derive(Clone, Debug)]
struct ExplicitIndex {
    source_name: String,
    target_name: String,
    target_sql: String,
}

struct RescueCompletion {
    result: CollisionRescueResult,
    rewritten_manifest: Option<SchemaManifest>,
}

impl LocalDatabase {
    /// Determine whether an ordinary open failure is the one startup case that
    /// may enter the closed collision-recovery posture. The probe opens SQLite
    /// read-only, accepts no stored manifest, and performs no infra migration.
    ///
    /// @ref LLP 0057#reachability — recovery startup is available only when
    /// stored-manifest admission failed solely because one or more declared,
    /// physically present tables occupy the protected auth namespace.
    pub fn auth_collision_recovery_eligible(
        path: &Path,
        ordinary_open_error: &crate::diagnostic::SnapbackError,
    ) -> SnapbackResult<bool> {
        if ordinary_open_error.diagnostic.code != "SNAPBACK_INVALID_IDENTIFIER"
            || ordinary_open_error.diagnostic.subsystem != "schema"
        {
            return Ok(false);
        }

        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "query_only", "ON")?;

        // An exact v1 index name is never table-copy recovery, including when
        // a declared reserved table would otherwise make the catalog inspector
        // report the table first.
        reject_exact_auth_catalog_object_collision(&connection)?;

        let Some(manifest) = load_schema_manifest_from_connection(&connection)? else {
            return Ok(false);
        };
        let reserved_tables = manifest
            .tables
            .iter()
            .enumerate()
            .filter(|(_, table)| is_auth_reserved_identifier(&table.name))
            .map(|(index, table)| (index, table.name.clone()))
            .collect::<Vec<_>>();
        if reserved_tables.is_empty() {
            return Ok(false);
        }

        // Every invalid reserved declaration must name an actual physical
        // table. A reserved field/index or an absent declaration cannot be
        // repaired by the selected table-copy operation, so startup stays
        // offline rather than advertising a dead-end recovery lane.
        for (_, source) in &reserved_tables {
            let matches: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE type = 'table' AND name = ?1 COLLATE NOCASE",
                params![source],
                |row| row.get(0),
            )?;
            if matches != 1 {
                return Ok(false);
            }
        }

        let mut admissible = manifest.clone();
        for (ordinal, (table_index, _)) in reserved_tables.iter().enumerate() {
            let mut suffix = 0_u64;
            loop {
                let candidate = format!("auth_recovery_probe_{ordinal}_{suffix}");
                if !admissible.tables.iter().enumerate().any(|(index, table)| {
                    index != *table_index && table.name.eq_ignore_ascii_case(&candidate)
                }) {
                    admissible.tables[*table_index].name = candidate;
                    break;
                }
                suffix = suffix.saturating_add(1);
            }
        }
        if validate_schema(&admissible).is_err() {
            return Ok(false);
        }

        match inspect_auth_catalog_on(&connection) {
            Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_TABLE_COLLISION" => Ok(true),
            // Unknown/corrupt/owned catalogs and exact-object collisions are
            // not ambiguous `false` results: preserve their stronger offline
            // diagnostic for the startup caller.
            Err(error) => Err(error),
            Ok(_) => Ok(false),
        }
    }

    pub fn rescue_auth_collision(
        &mut self,
        source: &str,
        target: &str,
    ) -> SnapbackResult<CollisionRescueResult> {
        require_foreign_keys(&self.conn)?;
        let completion = rescue_on_connection(&mut self.conn, source, target)?;
        if let Some(manifest) = completion.rewritten_manifest {
            self.schema = manifest;
        }
        Ok(completion.result)
    }

    /// Recovery entry point that intentionally bypasses ordinary manifest
    /// admission. It opens an existing database without creating infra or
    /// accepting the stored app schema, then runs only the closed rescue.
    pub fn rescue_auth_collision_file(
        path: &Path,
        source: &str,
        target: &str,
    ) -> SnapbackResult<CollisionRescueResult> {
        let mut connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        require_foreign_keys(&connection)?;
        Ok(rescue_on_connection(&mut connection, source, target)?.result)
    }
}

fn require_foreign_keys(connection: &Connection) -> SnapbackResult<()> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    let enabled: i64 = connection.pragma_query_value(None, "foreign_keys", |row| row.get(0))?;
    if enabled != 1 {
        return Err(rescue_invalid(
            "collision rescue requires SQLite foreign-key enforcement",
        ));
    }
    Ok(())
}

fn rescue_on_connection(
    connection: &mut Connection,
    source: &str,
    target: &str,
) -> SnapbackResult<RescueCompletion> {
    validate_boundary_names(source, target)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let completion = rescue_in_transaction(&transaction, source, target)?;
    match commit_rescue_transaction(transaction, target) {
        Ok(()) => Ok(completion),
        Err(commit_error) => {
            // Reconcile a lost COMMIT acknowledgement against the exact
            // externally visible successor. Atomic SQLite state cannot expose
            // a partial target/source transition; anything except the complete
            // successor remains a terminal recovery refusal.
            if rescue_successor_is_durable(connection, &completion.result)? {
                Ok(completion)
            } else {
                Err(commit_error)
            }
        }
    }
}

fn commit_rescue_transaction(transaction: Transaction<'_>, target: &str) -> SnapbackResult<()> {
    #[cfg(not(any(test, feature = "test-support")))]
    let _ = target;
    #[cfg(any(test, feature = "test-support"))]
    if let Some(fault) = FAIL_RESCUE_COMMIT_BOUNDARY.with(|slot| slot.take()) {
        match fault {
            RescueCommitFault::RolledBack => transaction.execute_batch("ROLLBACK")?,
            RescueCommitFault::Committed => transaction.execute_batch("COMMIT")?,
            RescueCommitFault::CommittedDivergent => {
                transaction.execute_batch("COMMIT")?;
                transaction.execute_batch(&format!("DROP TABLE {}", quote_identifier(target)))?;
            }
        }
        return Err(SnapbackError::error(
            "TEST_AUTH_RESCUE_COMMIT_FAILURE",
            "auth-rescue",
            format!("injected rescue commit fault: {fault:?}"),
        ));
    }
    transaction.commit()?;
    Ok(())
}

fn rescue_successor_is_durable(
    connection: &Connection,
    expected: &CollisionRescueResult,
) -> SnapbackResult<bool> {
    let source_exists: i64 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
        params![expected.source],
        |row| row.get(0),
    )?;
    let target_exists: i64 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
        params![expected.target],
        |row| row.get(0),
    )?;
    if source_exists != 0 || target_exists == 0 {
        return Ok(false);
    }
    if table_row_count(connection, &expected.target)? != expected.copied_row_count {
        return Ok(false);
    }
    let explicit_indexes: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_schema
         WHERE type = 'index' AND tbl_name = ?1 AND sql IS NOT NULL",
        params![expected.target],
        |row| row.get(0),
    )?;
    if usize::try_from(explicit_indexes).ok() != Some(expected.copied_explicit_index_count) {
        return Ok(false);
    }
    if expected.manifest_updated {
        let Some(manifest) = load_schema_manifest_from_connection(connection)? else {
            return Ok(false);
        };
        let source_named = manifest
            .tables
            .iter()
            .any(|table| table.name.eq_ignore_ascii_case(&expected.source));
        let target_count = manifest
            .tables
            .iter()
            .filter(|table| table.name == expected.target)
            .count();
        if source_named || target_count != 1 {
            return Ok(false);
        }
    }
    let collision_cleared = match inspect_auth_catalog_on(connection) {
        Ok(AuthCatalogState::Uninitialized) => true,
        Err(error)
            if matches!(
                error.diagnostic.code.as_str(),
                "SNAPBACK_AUTH_TABLE_COLLISION" | "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION"
            ) =>
        {
            false
        }
        Ok(
            AuthCatalogState::ReadyV1
            | AuthCatalogState::ReadyV2
            | AuthCatalogState::ReadyV3
            | AuthCatalogState::ReadyV4,
        ) => {
            return Ok(false);
        }
        Err(error) => return Err(error),
    };
    Ok(collision_cleared == expected.catalog_collision_cleared)
}

fn rescue_in_transaction(
    transaction: &Transaction<'_>,
    requested_source: &str,
    target: &str,
) -> SnapbackResult<RescueCompletion> {
    if auth_catalog_marker(transaction)?.is_some() {
        return Err(rescue_invalid(
            "catalog-owned auth tables cannot be collision-rescued",
        ));
    }
    reject_exact_auth_catalog_object_collision(transaction)?;

    let objects = schema_objects(transaction)?;
    let source_object = unique_source_table(&objects, requested_source)?;
    if objects
        .iter()
        .any(|object| object.name.eq_ignore_ascii_case(target))
    {
        return Err(rescue_invalid(
            "collision rescue target already exists physically",
        ));
    }

    let mut stored_manifest = load_schema_manifest_from_connection(transaction)?;
    let manifest_names_source = stored_manifest.as_ref().is_some_and(|manifest| {
        manifest
            .tables
            .iter()
            .any(|table| table.name.eq_ignore_ascii_case(&source_object.name))
    });
    let managed_mode_keys: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM _snapback_meta WHERE key IN (?1, ?2, ?3)",
        params![
            META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
            META_STAGED_AUTH_MODE_MANIFEST,
            META_AUTH_MODE_STATE,
        ],
        |row| row.get(0),
    )?;
    if manifest_names_source && managed_mode_keys != 0 {
        // An orphan physical collision can be moved without changing any mode
        // key. A declared table would require an atomic rewrite of LLP 0058's
        // complete four-key authority, which this v1 rescue intentionally
        // refuses instead of leaving the next open inconsistent.
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED",
            "auth-rescue",
            "collision rescue on a managed auth-mode manifest requires offline repair",
        ));
    }
    if stored_manifest.as_ref().is_some_and(|manifest| {
        manifest
            .tables
            .iter()
            .any(|table| table.name.eq_ignore_ascii_case(target))
    }) {
        return Err(rescue_invalid(
            "collision rescue target already exists in the stored manifest",
        ));
    }

    let source_name = source_object.name.clone();
    require_ordinary_table(transaction, &source_name)?;
    let table_sql = source_object
        .sql
        .as_deref()
        .ok_or_else(|| rescue_unsupported("source table has no rewritable CREATE statement"))?;
    let target_table_sql = rewrite_create_table(table_sql, &source_name, target)
        .map_err(|_| rescue_unsupported("source CREATE TABLE statement is unsupported"))?;
    if table_sql.to_ascii_uppercase().contains("AUTOINCREMENT") {
        return Err(rescue_unsupported(
            "AUTOINCREMENT sequence history requires offline repair",
        ));
    }

    let columns = table_columns(transaction, &source_name)?;
    if columns.is_empty()
        || columns
            .iter()
            .any(|column| column.hidden != 0 || column.declared_type.trim().is_empty())
    {
        return Err(rescue_unsupported(
            "source table has generated, hidden, typeless, or unavailable columns",
        ));
    }
    require_no_foreign_keys(transaction, &objects, &source_name)?;
    require_no_trigger_or_view_dependencies(transaction, &objects, &source_name)?;
    let indexes = inspect_explicit_indexes(transaction, &objects, &source_name, target)?;
    rescue_step_completed(0)?;

    transaction
        .execute(&target_table_sql, [])
        .map_err(|_| rescue_unsupported("rewritten CREATE TABLE could not be applied"))?;
    rescue_step_completed(1)?;

    let column_list = columns
        .iter()
        .map(|column| quote_identifier(&column.name))
        .collect::<Vec<_>>()
        .join(", ");
    let rowid_alias = observable_rowid_alias(transaction, &source_name, &columns)?;
    let copy_columns = rowid_alias
        .map(|alias| format!("{}, {column_list}", quote_identifier(alias)))
        .unwrap_or_else(|| column_list.clone());
    let copy_sql = format!(
        "INSERT INTO {} ({copy_columns}) SELECT {copy_columns} FROM {}",
        quote_identifier(target),
        quote_identifier(&source_name),
    );
    let copied = transaction.execute(&copy_sql, [])?;
    rescue_step_completed(2)?;

    let source_count = table_row_count(transaction, &source_name)?;
    let target_count = table_row_count(transaction, target)?;
    if source_count != target_count || copied as u64 != target_count {
        return Err(rescue_unsupported(
            "source and copied target row counts are not equal",
        ));
    }
    prove_bidirectional_multiset_equality(transaction, &source_name, target, &columns)?;
    if let Some(alias) = rowid_alias {
        prove_rowid_equality(transaction, &source_name, target, alias)?;
    }
    rescue_step_completed(3)?;

    for index in &indexes {
        transaction
            .execute(&index.target_sql, [])
            .map_err(|_| rescue_unsupported("rewritten CREATE INDEX could not be applied"))?;
    }
    rescue_step_completed(4)?;

    let rewritten_manifest = rewrite_stored_manifest(
        transaction,
        stored_manifest.as_mut(),
        &source_name,
        target,
        &indexes,
    )?;
    rescue_step_completed(5)?;

    transaction.execute(
        &format!("DROP TABLE {}", quote_identifier(&source_name)),
        [],
    )?;
    rescue_step_completed(6)?;

    let catalog_collision_cleared = match inspect_auth_catalog_on(transaction) {
        Ok(AuthCatalogState::Uninitialized) => true,
        Ok(
            AuthCatalogState::ReadyV1
            | AuthCatalogState::ReadyV2
            | AuthCatalogState::ReadyV3
            | AuthCatalogState::ReadyV4,
        ) => {
            return Err(rescue_invalid(
                "auth catalog became owned during collision rescue",
            ));
        }
        Err(error)
            if matches!(
                error.diagnostic.code.as_str(),
                "SNAPBACK_AUTH_TABLE_COLLISION" | "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION"
            ) =>
        {
            false
        }
        Err(error) => return Err(error),
    };
    rescue_step_completed(7)?;

    Ok(RescueCompletion {
        result: CollisionRescueResult {
            source: source_name,
            target: target.to_owned(),
            copied_row_count: target_count,
            copied_explicit_index_count: indexes.len(),
            manifest_updated: rewritten_manifest.is_some(),
            catalog_collision_cleared,
        },
        rewritten_manifest,
    })
}

fn require_ordinary_table(connection: &Connection, source: &str) -> SnapbackResult<()> {
    let table_type: Option<String> = connection
        .query_row(
            "SELECT type FROM pragma_table_list
             WHERE schema = 'main' AND name = ?1 COLLATE NOCASE",
            params![source],
            |row| row.get(0),
        )
        .optional()?;
    if table_type.as_deref() != Some("table") {
        return Err(rescue_unsupported(
            "virtual and shadow tables cannot be collision-rescued",
        ));
    }
    Ok(())
}

fn validate_boundary_names(source: &str, target: &str) -> SnapbackResult<()> {
    if source.is_empty()
        || source.len() > 255
        || source.contains('\0')
        || !is_auth_reserved_identifier(source)
        || !valid_identifier(target)
        || is_auth_reserved_identifier(target)
        || target.to_ascii_lowercase().starts_with("_snapback")
        || target.to_ascii_lowercase().starts_with("sqlite_")
        || source.eq_ignore_ascii_case(target)
    {
        return Err(rescue_invalid("collision rescue table names are invalid"));
    }
    Ok(())
}

fn schema_objects(connection: &Connection) -> SnapbackResult<Vec<SchemaObject>> {
    let mut statement = connection.prepare(
        "SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         ORDER BY type, name",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok(SchemaObject {
                kind: row.get(0)?,
                name: row.get(1)?,
                table: row.get(2)?,
                sql: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn unique_source_table<'a>(
    objects: &'a [SchemaObject],
    requested_source: &str,
) -> SnapbackResult<&'a SchemaObject> {
    let matching = objects
        .iter()
        .filter(|object| object.kind == "table" && object.name == requested_source)
        .collect::<Vec<_>>();
    if matching.len() != 1 || !is_auth_reserved_identifier(&matching[0].name) {
        return Err(rescue_invalid(
            "collision rescue source is not one actual reserved physical table",
        ));
    }
    Ok(matching[0])
}

#[derive(Clone, Debug)]
struct TableColumn {
    name: String,
    declared_type: String,
    hidden: i64,
    primary_key_ordinal: i64,
}

fn table_columns(connection: &Connection, table: &str) -> SnapbackResult<Vec<TableColumn>> {
    let mut statement = connection
        .prepare("SELECT name, type, hidden, pk FROM pragma_table_xinfo(?1) ORDER BY cid")?;
    Ok(statement
        .query_map(params![table], |row| {
            Ok(TableColumn {
                name: row.get(0)?,
                declared_type: row.get(1)?,
                hidden: row.get(2)?,
                primary_key_ordinal: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn foreign_key_targets(connection: &Connection, table: &str) -> SnapbackResult<Vec<String>> {
    let mut statement =
        connection.prepare("SELECT \"table\" FROM pragma_foreign_key_list(?1) ORDER BY id, seq")?;
    Ok(statement
        .query_map(params![table], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn require_no_foreign_keys(
    connection: &Connection,
    objects: &[SchemaObject],
    source: &str,
) -> SnapbackResult<()> {
    for table in objects.iter().filter(|object| object.kind == "table") {
        let targets = foreign_key_targets(connection, &table.name)?;
        if table.name.eq_ignore_ascii_case(source) && !targets.is_empty() {
            return Err(rescue_unsupported(
                "source table has an outgoing foreign key",
            ));
        }
        if targets
            .iter()
            .any(|target| target.eq_ignore_ascii_case(source))
        {
            return Err(rescue_unsupported(
                "another table has an incoming foreign key to the source",
            ));
        }
    }
    Ok(())
}

fn require_no_trigger_or_view_dependencies(
    _connection: &Connection,
    objects: &[SchemaObject],
    source: &str,
) -> SnapbackResult<()> {
    for object in objects
        .iter()
        .filter(|object| matches!(object.kind.as_str(), "trigger" | "view"))
    {
        if object.kind == "trigger" && object.table.eq_ignore_ascii_case(source) {
            return Err(rescue_unsupported("source table owns a trigger"));
        }
        let sql = object
            .sql
            .as_deref()
            .ok_or_else(|| rescue_unsupported("trigger or view has no dependency-scannable SQL"))?;
        let depends = sql_may_reference_identifier(sql, source)
            .map_err(|_| rescue_unsupported("trigger or view SQL is ambiguous"))?;
        if depends {
            return Err(rescue_unsupported(
                "a trigger or view depends on the source table",
            ));
        }
    }
    Ok(())
}

fn inspect_explicit_indexes(
    connection: &Connection,
    objects: &[SchemaObject],
    source: &str,
    target: &str,
) -> SnapbackResult<Vec<ExplicitIndex>> {
    let mut index_list = connection.prepare("SELECT name, origin FROM pragma_index_list(?1)")?;
    let origins = index_list
        .query_map(params![source], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|(name, origin)| (name.to_ascii_lowercase(), origin))
        .collect::<BTreeMap<_, _>>();
    for object in objects
        .iter()
        .filter(|object| object.kind == "index" && object.table.eq_ignore_ascii_case(source))
    {
        let origin = origins
            .get(&object.name.to_ascii_lowercase())
            .ok_or_else(|| rescue_unsupported("source index cannot be introspected"))?;
        if object.sql.is_none() && origin == "c" {
            return Err(rescue_unsupported(
                "explicit source index has no rewritable CREATE statement",
            ));
        }
        if object.sql.is_some() && origin != "c" {
            return Err(rescue_unsupported(
                "implicit source index has an ambiguous CREATE statement",
            ));
        }
    }
    for (name, origin) in &origins {
        if origin == "c"
            && !objects.iter().any(|object| {
                object.kind == "index"
                    && object.table.eq_ignore_ascii_case(source)
                    && object.name.eq_ignore_ascii_case(name)
                    && object.sql.is_some()
            })
        {
            return Err(rescue_unsupported(
                "explicit source index is absent from the complete schema scan",
            ));
        }
    }

    let mut source_indexes = objects
        .iter()
        .filter(|object| {
            object.kind == "index"
                && object.table.eq_ignore_ascii_case(source)
                && object.sql.is_some()
        })
        .collect::<Vec<_>>();
    source_indexes.sort_by(|left, right| left.name.cmp(&right.name));

    source_indexes
        .into_iter()
        .enumerate()
        .map(|(order, object)| {
            require_supported_index_columns(connection, &object.name)?;
            let target_name = format!("{target}__rescue_idx_{order}");
            if objects
                .iter()
                .any(|candidate| candidate.name.eq_ignore_ascii_case(&target_name))
            {
                return Err(rescue_invalid(
                    "a deterministic rescue index target already exists",
                ));
            }
            let target_sql = rewrite_create_index(
                object.sql.as_deref().expect("filtered explicit index"),
                &object.name,
                source,
                &target_name,
                target,
            )
            .map_err(|_| rescue_unsupported("explicit index SQL is unsupported"))?;
            Ok(ExplicitIndex {
                source_name: object.name.clone(),
                target_name,
                target_sql,
            })
        })
        .collect()
}

fn require_supported_index_columns(connection: &Connection, index: &str) -> SnapbackResult<()> {
    let mut statement = connection
        .prepare("SELECT cid, name, coll, key FROM pragma_index_xinfo(?1) ORDER BY seqno")?;
    let rows = statement
        .query_map(params![index], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)? != 0,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if rows.is_empty() {
        return Err(rescue_unsupported(
            "explicit index has no introspectable columns",
        ));
    }
    for (column_id, name, collation, _key) in rows.into_iter().filter(|row| row.3) {
        if column_id < 0 || name.is_none() {
            return Err(rescue_unsupported(
                "expression or pseudo-column indexes are unsupported",
            ));
        }
        let Some(collation) = collation else {
            return Err(rescue_unsupported(
                "explicit index has an unknown collation",
            ));
        };
        if !matches!(
            collation.to_ascii_uppercase().as_str(),
            "BINARY" | "NOCASE" | "RTRIM"
        ) {
            return Err(rescue_unsupported(
                "explicit index uses an unknown collation",
            ));
        }
    }
    Ok(())
}

fn table_row_count(connection: &Connection, table: &str) -> SnapbackResult<u64> {
    let count: i64 = connection.query_row(
        &format!("SELECT COUNT(*) FROM {}", quote_identifier(table)),
        [],
        |row| row.get(0),
    )?;
    u64::try_from(count).map_err(|_| rescue_unsupported("table row count is invalid"))
}

fn observable_rowid_alias(
    connection: &Connection,
    table: &str,
    columns: &[TableColumn],
) -> SnapbackResult<Option<&'static str>> {
    let without_rowid: i64 = connection.query_row(
        "SELECT wr FROM pragma_table_list WHERE schema = 'main' AND name = ?1",
        params![table],
        |row| row.get(0),
    )?;
    if without_rowid != 0 {
        return Ok(None);
    }

    // A true INTEGER PRIMARY KEY is the rowid alias and is already in the
    // named-column copy. The DESC/non-alias form owns a `pk` autoindex, so it
    // falls through to explicit hidden-rowid preservation.
    let integer_primary_key = columns
        .iter()
        .filter(|column| column.primary_key_ordinal != 0)
        .count()
        == 1
        && columns.iter().any(|column| {
            column.primary_key_ordinal == 1
                && column.declared_type.trim().eq_ignore_ascii_case("INTEGER")
        });
    let pk_index: i64 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_index_list(?1) WHERE origin = 'pk')",
        params![table],
        |row| row.get(0),
    )?;
    if integer_primary_key && pk_index == 0 {
        return Ok(None);
    }

    for alias in ["_rowid_", "rowid", "oid"] {
        if !columns
            .iter()
            .any(|column| column.name.eq_ignore_ascii_case(alias))
        {
            return Ok(Some(alias));
        }
    }
    // All three aliases are shadowed by named columns, so the hidden rowid is
    // not SQL-observable and need not be copied.
    Ok(None)
}

fn prove_rowid_equality(
    connection: &Connection,
    source: &str,
    target: &str,
    alias: &str,
) -> SnapbackResult<()> {
    let alias = quote_identifier(alias);
    for (left, right) in [(source, target), (target, source)] {
        let differs: i64 = connection.query_row(
            &format!(
                "SELECT EXISTS(SELECT {alias} FROM {} EXCEPT SELECT {alias} FROM {})",
                quote_identifier(left),
                quote_identifier(right),
            ),
            [],
            |row| row.get(0),
        )?;
        if differs != 0 {
            return Err(rescue_unsupported(
                "source and copied target row identities are not equal",
            ));
        }
    }
    Ok(())
}

fn prove_bidirectional_multiset_equality(
    connection: &Connection,
    source: &str,
    target: &str,
    columns: &[TableColumn],
) -> SnapbackResult<()> {
    let values = columns
        .iter()
        .map(|column| format!("{} COLLATE BINARY", quote_identifier(&column.name)))
        .collect::<Vec<_>>()
        .join(", ");
    let types = columns
        .iter()
        .map(|column| format!("typeof({})", quote_identifier(&column.name)))
        .collect::<Vec<_>>()
        .join(", ");
    let projection = format!("{values}, {types}, COUNT(*) AS __rescue_count");
    let grouping = format!("{values}, {types}");
    let source_groups = format!(
        "SELECT {projection} FROM {} GROUP BY {grouping}",
        quote_identifier(source)
    );
    let target_groups = format!(
        "SELECT {projection} FROM {} GROUP BY {grouping}",
        quote_identifier(target)
    );
    for (left, right) in [
        (&source_groups, &target_groups),
        (&target_groups, &source_groups),
    ] {
        let differs: i64 = connection.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM ({left} EXCEPT {right}))"),
            [],
            |row| row.get(0),
        )?;
        if differs != 0 {
            return Err(rescue_unsupported(
                "source and copied target multisets are not equal",
            ));
        }
    }
    Ok(())
}

fn rewrite_stored_manifest(
    transaction: &Transaction<'_>,
    manifest: Option<&mut SchemaManifest>,
    source: &str,
    target: &str,
    indexes: &[ExplicitIndex],
) -> SnapbackResult<Option<SchemaManifest>> {
    let Some(manifest) = manifest else {
        return Ok(None);
    };
    let matching_tables = manifest
        .tables
        .iter()
        .enumerate()
        .filter(|(_, table)| table.name.eq_ignore_ascii_case(source))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if matching_tables.is_empty() {
        return Ok(None);
    }
    if matching_tables.len() != 1 {
        return Err(rescue_unsupported(
            "stored manifest names the source table ambiguously",
        ));
    }

    let table = &mut manifest.tables[matching_tables[0]];
    let source_manifest_name = table.name.clone();
    let index_targets = indexes
        .iter()
        .map(|index| (index.source_name.to_ascii_lowercase(), &index.target_name))
        .collect::<BTreeMap<_, _>>();
    let mut mapped = BTreeSet::new();
    for index in &mut table.indexes {
        let physical_source = format!("{source_manifest_name}_{}", index.name);
        let key = physical_source.to_ascii_lowercase();
        let Some(target_name) = index_targets.get(&key) else {
            return Err(rescue_unsupported(
                "stored manifest index is absent from the source table",
            ));
        };
        if !mapped.insert(key) {
            return Err(rescue_unsupported(
                "stored manifest index mapping is ambiguous",
            ));
        }
        index.name = target_name
            .strip_prefix(&format!("{target}_"))
            .ok_or_else(|| rescue_unsupported("rescue index name is inconsistent"))?
            .to_owned();
    }
    table.name = target.to_owned();
    manifest.schema_hash = None;
    manifest.inputs_hash = None;
    validate_schema(manifest).map_err(|_| {
        rescue_unsupported("rewritten stored manifest does not pass current validation")
    })?;
    let serialized = serde_json::to_string(manifest).map_err(|_| {
        rescue_unsupported("rewritten stored manifest cannot be serialized exactly")
    })?;
    transaction.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![META_SCHEMA_MANIFEST, serialized],
    )?;
    Ok(Some(manifest.clone()))
}

fn rescue_invalid(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_RESCUE_INVALID", "auth-rescue", message)
}

fn rescue_unsupported(message: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED",
        "auth-rescue",
        message,
    )
}

/// One closed row shape accepted by the auth-collision fixture guard.
///
/// The type deliberately cannot carry SQL, a connection, or transaction
/// authority. Callers describe only the logical collision needed by a test.
#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthCollisionFixtureRowForTest {
    Integer(i64),
    Text(Option<(String, String)>),
}

/// One closed index shape accepted by the auth-collision fixture guard.
#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthCollisionFixtureIndexForTest {
    None,
    IntegerAbs,
    TextValue(String),
    ExactSessionsToken,
}

/// Typed input to the auth-collision fixture guard.
#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthCollisionFixtureTableForTest {
    pub name: String,
    pub row: AuthCollisionFixtureRowForTest,
    pub index: AuthCollisionFixtureIndexForTest,
}

/// A logical database snapshot used to prove denied recovery requests do not
/// mutate schema, metadata, or row counts.
#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthCollisionLogicalSnapshotForTest {
    pub schema: Vec<(String, String, String, Option<String>)>,
    pub meta: Vec<(String, String)>,
    pub counts: BTreeMap<String, u64>,
}

/// Install only the closed collision shapes required by recovery tests.
///
/// @ref LLP 0285#53-defect-3--the-caller-selectable-raw-sqlite-feature —
/// test callers receive a typed fixture guard, never raw SQLite authority.
#[cfg(any(test, feature = "test-support"))]
pub fn install_auth_collision_fixtures_for_test(
    path: &Path,
    tables: &[AuthCollisionFixtureTableForTest],
    manifest: Option<&SchemaManifest>,
) -> SnapbackResult<()> {
    let mut connection = Connection::open(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for table in tables {
        if !valid_identifier(&table.name) {
            return Err(rescue_invalid("test collision table name is invalid"));
        }
        let table_name = quote_identifier(&table.name);
        match &table.row {
            AuthCollisionFixtureRowForTest::Integer(id) => {
                transaction.execute_batch(&format!("CREATE TABLE {table_name}(id INTEGER);"))?;
                transaction.execute(
                    &format!("INSERT INTO {table_name}(id) VALUES(?1)"),
                    params![id],
                )?;
            }
            AuthCollisionFixtureRowForTest::Text(row) => {
                transaction.execute_batch(&format!(
                    "CREATE TABLE {table_name}(id TEXT PRIMARY KEY, value TEXT);"
                ))?;
                if let Some((id, value)) = row {
                    transaction.execute(
                        &format!("INSERT INTO {table_name}(id, value) VALUES(?1, ?2)"),
                        params![id, value],
                    )?;
                }
            }
        }
        match &table.index {
            AuthCollisionFixtureIndexForTest::None => {}
            AuthCollisionFixtureIndexForTest::IntegerAbs => {
                transaction.execute_batch(&format!(
                    "CREATE INDEX unsupported_expr ON {table_name}(abs(id));"
                ))?;
            }
            AuthCollisionFixtureIndexForTest::TextValue(index) => {
                if !valid_identifier(index) {
                    return Err(rescue_invalid("test collision index name is invalid"));
                }
                transaction.execute_batch(&format!(
                    "CREATE INDEX {} ON {table_name}(value);",
                    quote_identifier(index)
                ))?;
            }
            AuthCollisionFixtureIndexForTest::ExactSessionsToken => {
                transaction.execute_batch(&format!(
                    "CREATE UNIQUE INDEX _auth_sessions_token_uq ON {table_name}(id);"
                ))?;
            }
        }
    }
    if let Some(manifest) = manifest {
        let serialized = serde_json::to_string(manifest)
            .map_err(|_| rescue_invalid("test collision manifest cannot be serialized"))?;
        transaction.execute(
            "DELETE FROM _snapback_meta WHERE key IN (?1, ?2, ?3)",
            params![
                META_AUTH_MODE_STATE,
                META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
                META_STAGED_AUTH_MODE_MANIFEST,
            ],
        )?;
        transaction.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_SCHEMA_MANIFEST, serialized],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

/// Read the exact logical state needed by recovery non-mutation assertions.
///
/// @ref LLP 0285#53-defect-3--the-caller-selectable-raw-sqlite-feature — the
/// guard returns typed values and retains the connection inside the kernel.
#[cfg(any(test, feature = "test-support"))]
pub fn auth_collision_logical_snapshot_for_test(
    path: &Path,
) -> SnapbackResult<AuthCollisionLogicalSnapshotForTest> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let mut statement = connection.prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )?;
    let schema = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement = connection.prepare("SELECT key, value FROM _snapback_meta ORDER BY key")?;
    let meta = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut counts = BTreeMap::new();
    for (_, name, _, _) in &schema {
        if connection
            .query_row(
                "SELECT 1 FROM pragma_table_list
                 WHERE schema='main' AND name=?1 AND type='table'",
                params![name],
                |_| Ok(()),
            )
            .optional()?
            .is_some()
        {
            counts.insert(name.clone(), table_row_count(&connection, name)?);
        }
    }
    Ok(AuthCollisionLogicalSnapshotForTest {
        schema,
        meta,
        counts,
    })
}

/// Probe the exact source-to-target integer transition after a rescue.
#[cfg(any(test, feature = "test-support"))]
pub fn auth_collision_integer_transition_for_test(
    path: &Path,
    source: &str,
    target: &str,
) -> SnapbackResult<(bool, i64)> {
    if !valid_identifier(source) || !valid_identifier(target) {
        return Err(rescue_invalid("test transition table name is invalid"));
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let source_exists = connection
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1",
            params![source],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    let target_id = connection.query_row(
        &format!("SELECT id FROM {}", quote_identifier(target)),
        [],
        |row| row.get(0),
    )?;
    Ok((source_exists, target_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::mode::{
        AUTH_MODE_FORMAT_VERSION, AppDataAvailability, AuthModeQuarantine, AuthModeStateRecord,
        AuthModeStatus, DeploymentIdentity, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX,
        StagedAuthModeRecord,
    };
    use crate::manifest::{
        AuthManifest, AuthMode, FieldManifest, FieldType, IndexManifest, TableManifest,
    };
    use crate::storage::auth_mode::{
        META_AUTH_MODE_STATE, META_CAPABILITY_AWARE_SCHEMA_MANIFEST, META_STAGED_AUTH_MODE_MANIFEST,
    };

    fn source_fixture(database: &mut LocalDatabase, source: &str) {
        database
            .conn
            .execute_batch(&format!(
                r#"CREATE TABLE {} (
                   id INTEGER,
                   value BLOB,
                   note TEXT DEFAULT '_auth_legacy',
                   payload TEXT
                 );
                 CREATE UNIQUE INDEX {} ON {}(id) WHERE id IS NOT NULL;
                 INSERT INTO {}(id, value, note, payload) VALUES
                   (1, x'00ff', '_auth_legacy', '{{"kind":"auth"}}'),
                   (NULL, NULL, NULL, NULL),
                   (NULL, NULL, NULL, NULL);"#,
                quote_identifier(source),
                quote_identifier(&format!("{source}_explicit")),
                quote_identifier(source),
                quote_identifier(source),
            ))
            .unwrap();
    }

    fn legacy_manifest() -> SchemaManifest {
        SchemaManifest {
            schema_hash: Some("old-schema".to_owned()),
            inputs_hash: Some("old-inputs".to_owned()),
            tables: vec![TableManifest {
                name: "_auth_legacy".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "id".to_owned(),
                        field_type: FieldType::Integer,
                        optional: true,
                    },
                    FieldManifest {
                        name: "value".to_owned(),
                        field_type: FieldType::String,
                        optional: true,
                    },
                    FieldManifest {
                        name: "note".to_owned(),
                        field_type: FieldType::String,
                        optional: true,
                    },
                    FieldManifest {
                        name: "payload".to_owned(),
                        field_type: FieldType::Json,
                        optional: true,
                    },
                ],
                indexes: vec![IndexManifest {
                    name: "explicit".to_owned(),
                    fields: vec!["id".to_owned()],
                    unique: false,
                    where_applicable: false,
                }],
                syncable: false,
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
            }],
            ..SchemaManifest::default()
        }
    }

    #[derive(Clone, Copy, Debug)]
    enum ManagedFixtureState {
        Settled,
        Pending,
        Quarantined,
    }

    fn v1_hash(prefix: &str, byte: char) -> String {
        format!("{prefix}{}", byte.to_string().repeat(64))
    }

    fn requested_sessions_pair() -> (DeploymentIdentity, SchemaManifest) {
        let schema_hash = v1_hash(SCHEMA_V1_PREFIX, 'a');
        let inputs_hash = v1_hash(INPUTS_V1_PREFIX, 'c');
        let identity = DeploymentIdentity {
            schema_version: "snapback.v1".to_owned(),
            auth_mode: AuthMode::Sessions,
            app_id: "rescue-fixture".to_owned(),
            schema_hash: schema_hash.clone(),
            bundle_hash: v1_hash(FUNCTION_V1_PREFIX, 'b'),
            inputs_hash: inputs_hash.clone(),
        };
        let manifest = SchemaManifest {
            schema_version: "snapback.v1".to_owned(),
            app_id: "rescue-fixture".to_owned(),
            auth: Some(AuthManifest {
                mode: AuthMode::Sessions,
                agents: None,
                password_identifier_mode: None,
                password_minimum_length: None,
            }),
            schema_hash: Some(schema_hash),
            inputs_hash: Some(inputs_hash),
            ..SchemaManifest::default()
        };
        (identity, manifest)
    }

    fn install_valid_managed_fixture(database: &LocalDatabase, fixture_state: ManagedFixtureState) {
        let active_manifest = legacy_manifest();
        let active_raw = serde_json::to_string(&active_manifest).unwrap();
        let (requested_deployment, requested_manifest) = requested_sessions_pair();
        let generation = match fixture_state {
            ManagedFixtureState::Settled => 0,
            ManagedFixtureState::Pending => 1,
            ManagedFixtureState::Quarantined => 2,
        };
        let staged = (!matches!(fixture_state, ManagedFixtureState::Settled)).then(|| {
            StagedAuthModeRecord {
                format_version: AUTH_MODE_FORMAT_VERSION,
                transition_generation: generation,
                requested_deployment: requested_deployment.clone(),
                schema_manifest: requested_manifest,
            }
        });
        let state = match fixture_state {
            ManagedFixtureState::Settled => AuthModeStateRecord::initial_dev(None),
            ManagedFixtureState::Pending | ManagedFixtureState::Quarantined => {
                AuthModeStateRecord {
                    format_version: AUTH_MODE_FORMAT_VERSION,
                    transition_generation: generation,
                    active: AuthMode::Dev,
                    desired: AuthMode::Sessions,
                    mode_state: if matches!(fixture_state, ManagedFixtureState::Pending) {
                        AuthModeStatus::PendingRestart
                    } else {
                        AuthModeStatus::Quarantined
                    },
                    app_data_availability: AppDataAvailability::RefusedPending,
                    sessions_ever_activated: false,
                    active_deployment: None,
                    requested_deployment: Some(requested_deployment),
                    quarantine: matches!(fixture_state, ManagedFixtureState::Quarantined).then(
                        || AuthModeQuarantine {
                            transition_generation: generation,
                            code: "SNAPBACK_AUTH_TABLE_COLLISION".to_owned(),
                        },
                    ),
                }
            }
        };
        state.validate_shape().unwrap();
        database
            .conn
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![META_SCHEMA_MANIFEST, active_raw],
            )
            .unwrap();
        database
            .conn
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![
                    META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
                    serde_json::to_string(&active_manifest).unwrap()
                ],
            )
            .unwrap();
        database
            .conn
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![META_AUTH_MODE_STATE, serde_json::to_string(&state).unwrap()],
            )
            .unwrap();
        match staged {
            Some(staged) => {
                database
                    .conn
                    .execute(
                        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![
                            META_STAGED_AUTH_MODE_MANIFEST,
                            serde_json::to_string(&staged).unwrap()
                        ],
                    )
                    .unwrap();
            }
            None => {
                database
                    .conn
                    .execute(
                        "DELETE FROM _snapback_meta WHERE key = ?1",
                        params![META_STAGED_AUTH_MODE_MANIFEST],
                    )
                    .unwrap();
            }
        }
        assert!(matches!(
            crate::storage::auth_mode::inspect_for_open(&database.conn).unwrap(),
            crate::storage::auth_mode::OpenAuthModeInspection::Managed(_)
        ));
    }

    fn four_key_values(connection: &Connection) -> BTreeMap<String, String> {
        let mut statement = connection
            .prepare(
                "SELECT key, value FROM _snapback_meta
                 WHERE key IN (?1, ?2, ?3, ?4) ORDER BY key",
            )
            .unwrap();
        statement
            .query_map(
                params![
                    META_SCHEMA_MANIFEST,
                    META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
                    META_STAGED_AUTH_MODE_MANIFEST,
                    META_AUTH_MODE_STATE,
                ],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn store_manifest(database: &LocalDatabase, manifest: &SchemaManifest) {
        // These fixtures model databases created before staged auth-mode
        // metadata existed. Retaining the managed-mode record would instead
        // create an intentionally corrupt four-key combination.
        database
            .conn
            .execute(
                "DELETE FROM _snapback_meta WHERE key IN (?1, ?2, ?3)",
                params![
                    META_AUTH_MODE_STATE,
                    META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
                    META_STAGED_AUTH_MODE_MANIFEST,
                ],
            )
            .unwrap();
        database
            .conn
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![
                    META_SCHEMA_MANIFEST,
                    serde_json::to_string(manifest).unwrap()
                ],
            )
            .unwrap();
    }

    #[test]
    fn rescue_preserves_valid_managed_mode_keys_for_every_refused_state() {
        for fixture_state in [
            ManagedFixtureState::Settled,
            ManagedFixtureState::Pending,
            ManagedFixtureState::Quarantined,
        ] {
            let mut database = LocalDatabase::memory().unwrap();
            source_fixture(&mut database, "_auth_legacy");
            install_valid_managed_fixture(&database, fixture_state);
            let before = four_key_values(&database.conn);

            let error = database
                .rescue_auth_collision("_auth_legacy", "legacy_auth")
                .unwrap_err();

            assert_eq!(
                error.diagnostic.code, "SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED",
                "fixture state: {fixture_state:?}"
            );
            assert_eq!(four_key_values(&database.conn), before);
            assert_eq!(table_row_count(&database.conn, "_auth_legacy").unwrap(), 3);
            assert!(table_row_count(&database.conn, "legacy_auth").is_err());
        }
    }

    #[test]
    fn rescues_rows_indexes_and_literal_text_without_touching_values() {
        let mut database = LocalDatabase::memory().unwrap();
        source_fixture(&mut database, "_AuTh_Legacy");

        let result = database
            .rescue_auth_collision("_AuTh_Legacy", "legacy_auth")
            .unwrap();
        assert_eq!(result.source, "_AuTh_Legacy");
        assert_eq!(result.target, "legacy_auth");
        assert_eq!(result.copied_row_count, 3);
        assert_eq!(result.copied_explicit_index_count, 1);
        assert!(!result.manifest_updated);
        assert!(result.catalog_collision_cleared);
        assert_eq!(
            database
                .conn
                .query_row(
                    "SELECT hex(value), note, payload FROM legacy_auth WHERE id = 1",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .unwrap(),
            (
                "00FF".to_owned(),
                "_auth_legacy".to_owned(),
                "{\"kind\":\"auth\"}".to_owned()
            )
        );
        assert_eq!(
            database
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM legacy_auth WHERE id IS NULL AND value IS NULL AND note IS NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        let index_sql: String = database
            .conn
            .query_row(
                "SELECT sql FROM sqlite_schema WHERE name = 'legacy_auth__rescue_idx_0'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(index_sql.contains("UNIQUE INDEX \"legacy_auth__rescue_idx_0\""));
        assert!(index_sql.contains("WHERE id IS NOT NULL"));
    }

    #[test]
    fn rescue_preserves_sparse_hidden_rowids_and_accepts_exact_quoted_source_names() {
        let mut database = LocalDatabase::memory().unwrap();
        database
            .conn
            .execute_batch(
                "CREATE TABLE \"_auth_old table\"(value TEXT);
                 INSERT INTO \"_auth_old table\"(rowid, value) VALUES(1, 'a'), (99, 'b');",
            )
            .unwrap();

        let result = database
            .rescue_auth_collision("_auth_old table", "legacy_auth_rows")
            .unwrap();
        assert_eq!(result.copied_row_count, 2);
        let rowids: String = database
            .conn
            .query_row(
                "SELECT group_concat(rowid, ',') FROM legacy_auth_rows ORDER BY rowid",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rowids, "1,99");
    }

    #[test]
    fn rescue_refuses_autoincrement_history_without_mutation() {
        let mut database = LocalDatabase::memory().unwrap();
        database
            .conn
            .execute_batch(
                "CREATE TABLE _auth_sequence(id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT);
                 INSERT INTO _auth_sequence(value) VALUES('one'), ('two');
                 DELETE FROM _auth_sequence WHERE id = 2;",
            )
            .unwrap();

        let error = database
            .rescue_auth_collision("_auth_sequence", "legacy_sequence")
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED"
        );
        assert_eq!(
            table_row_count(&database.conn, "_auth_sequence").unwrap(),
            1
        );
        assert_eq!(
            database
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = 'legacy_sequence')",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn rewrites_declared_legacy_manifest_and_clears_identity() {
        let mut database = LocalDatabase::memory().unwrap();
        source_fixture(&mut database, "_auth_legacy");
        store_manifest(&database, &legacy_manifest());

        let result = database
            .rescue_auth_collision("_auth_legacy", "legacy_auth")
            .unwrap();
        assert!(result.manifest_updated);
        let stored = load_schema_manifest_from_connection(&database.conn)
            .unwrap()
            .unwrap();
        assert_eq!(stored.schema_hash, None);
        assert_eq!(stored.inputs_hash, None);
        assert_eq!(stored.tables[0].name, "legacy_auth");
        assert_eq!(stored.tables[0].indexes[0].name, "_rescue_idx_0");
        assert_eq!(database.schema, stored);
    }

    #[test]
    fn recovery_file_path_works_when_ordinary_open_rejects_manifest() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy.sqlite3");
        {
            let mut database = LocalDatabase::open(&path).unwrap();
            source_fixture(&mut database, "_auth_legacy");
            store_manifest(&database, &legacy_manifest());
        }
        assert!(LocalDatabase::open(&path).is_err());

        let result =
            LocalDatabase::rescue_auth_collision_file(&path, "_auth_legacy", "legacy_auth")
                .unwrap();
        assert!(result.manifest_updated);
        assert!(LocalDatabase::open(&path).is_ok());
    }

    #[test]
    fn refuses_foreign_keys_triggers_views_and_expression_indexes() {
        for setup in [
            "CREATE TABLE _auth_old(id INTEGER REFERENCES parent(id)); CREATE TABLE parent(id INTEGER PRIMARY KEY);",
            "CREATE TABLE _auth_old(id INTEGER); CREATE TABLE child(parent INTEGER REFERENCES _auth_old(id));",
            "CREATE TABLE _auth_old(id INTEGER); CREATE TRIGGER source_trigger AFTER INSERT ON _auth_old BEGIN SELECT 1; END;",
            "CREATE TABLE _auth_old(id INTEGER); CREATE VIEW source_view AS SELECT * FROM _auth_old;",
            "CREATE TABLE _auth_old(id INTEGER); CREATE INDEX source_expr ON _auth_old(lower(id));",
            "CREATE TABLE _auth_old(id INTEGER, derived TEXT GENERATED ALWAYS AS (id || 'x') STORED);",
            "CREATE TABLE _auth_old AS SELECT 1 AS id;",
        ] {
            let mut database = LocalDatabase::memory().unwrap();
            database.conn.execute_batch(setup).unwrap();
            let error = database
                .rescue_auth_collision("_auth_old", "legacy")
                .unwrap_err();
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED"
            );
            assert!(
                database
                    .conn
                    .query_row(
                        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_auth_old'",
                        [],
                        |_| Ok(()),
                    )
                    .optional()
                    .unwrap()
                    .is_some()
            );
        }
    }

    #[test]
    fn reports_remaining_collisions_until_the_last_rescue() {
        let mut database = LocalDatabase::memory().unwrap();
        database
            .conn
            .execute_batch(
                "CREATE TABLE _auth_one(id INTEGER); CREATE TABLE _auth_two(id INTEGER);",
            )
            .unwrap();
        assert!(
            !database
                .rescue_auth_collision("_auth_one", "legacy_one")
                .unwrap()
                .catalog_collision_cleared
        );
        assert!(
            database
                .rescue_auth_collision("_auth_two", "legacy_two")
                .unwrap()
                .catalog_collision_cleared
        );
    }

    #[test]
    fn every_failure_point_rolls_back_table_rows_indexes_and_manifest() {
        for step in 0..=7 {
            let mut database = LocalDatabase::memory().unwrap();
            source_fixture(&mut database, "_auth_legacy");
            store_manifest(&database, &legacy_manifest());
            let before_manifest: String = database
                .conn
                .query_row(
                    "SELECT value FROM _snapback_meta WHERE key = ?1",
                    params![META_SCHEMA_MANIFEST],
                    |row| row.get(0),
                )
                .optional()
                .unwrap()
                .unwrap_or_default();
            inject_rescue_failure_after_step(step);
            assert!(
                database
                    .rescue_auth_collision("_auth_legacy", "legacy")
                    .is_err()
            );
            assert_eq!(table_row_count(&database.conn, "_auth_legacy").unwrap(), 3);
            assert!(database
                .conn
                .query_row(
                    "SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = '_auth_legacy_explicit'",
                    [],
                    |_| Ok(()),
                )
                .optional()
                .unwrap()
                .is_some());
            assert!(
                database
                    .conn
                    .query_row(
                        "SELECT 1 FROM sqlite_schema WHERE name = 'legacy'",
                        [],
                        |_| Ok(()),
                    )
                    .optional()
                    .unwrap()
                    .is_none()
            );
            let after_manifest: String = database
                .conn
                .query_row(
                    "SELECT value FROM _snapback_meta WHERE key = ?1",
                    params![META_SCHEMA_MANIFEST],
                    |row| row.get(0),
                )
                .optional()
                .unwrap()
                .unwrap_or_default();
            assert_eq!(after_manifest, before_manifest);
        }
    }

    #[test]
    fn rescue_commit_boundary_classifies_rollback_successor_and_divergence() {
        let mut rolled_back = LocalDatabase::memory().unwrap();
        source_fixture(&mut rolled_back, "_auth_legacy");
        inject_rescue_commit_fault(RescueCommitFault::RolledBack);
        let error = rolled_back
            .rescue_auth_collision("_auth_legacy", "legacy")
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_AUTH_RESCUE_COMMIT_FAILURE");
        assert_eq!(
            table_row_count(&rolled_back.conn, "_auth_legacy").unwrap(),
            3
        );
        assert!(table_row_count(&rolled_back.conn, "legacy").is_err());

        let mut committed = LocalDatabase::memory().unwrap();
        source_fixture(&mut committed, "_auth_legacy");
        inject_rescue_commit_fault(RescueCommitFault::Committed);
        let result = committed
            .rescue_auth_collision("_auth_legacy", "legacy")
            .expect("an exact committed successor reconciles as success");
        assert_eq!(result.copied_row_count, 3);
        assert!(table_row_count(&committed.conn, "_auth_legacy").is_err());
        assert_eq!(table_row_count(&committed.conn, "legacy").unwrap(), 3);

        let mut divergent = LocalDatabase::memory().unwrap();
        source_fixture(&mut divergent, "_auth_legacy");
        inject_rescue_commit_fault(RescueCommitFault::CommittedDivergent);
        let error = divergent
            .rescue_auth_collision("_auth_legacy", "legacy")
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_AUTH_RESCUE_COMMIT_FAILURE");
        assert!(table_row_count(&divergent.conn, "_auth_legacy").is_err());
        assert!(table_row_count(&divergent.conn, "legacy").is_err());
    }

    #[test]
    fn exact_auth_index_collision_is_not_treated_as_table_rescue() {
        let mut database = LocalDatabase::memory().unwrap();
        database
            .conn
            .execute_batch(
                "CREATE TABLE ordinary(id INTEGER); CREATE INDEX _auth_identities_user ON ordinary(id); CREATE TABLE _auth_old(id INTEGER);",
            )
            .unwrap();
        let error = database
            .rescue_auth_collision("_auth_old", "legacy")
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION"
        );
    }

    #[test]
    fn invalid_state_and_generated_index_targets_are_refused_without_mutation() {
        for setup in [
            "CREATE TABLE _auth_old(id INTEGER); CREATE TABLE legacy(id INTEGER);",
            "CREATE TABLE _auth_old(id INTEGER); CREATE TABLE owner(id INTEGER); CREATE INDEX legacy__rescue_idx_0 ON owner(id); CREATE INDEX source_idx ON _auth_old(id);",
        ] {
            let mut database = LocalDatabase::memory().unwrap();
            database.conn.execute_batch(setup).unwrap();
            let error = database
                .rescue_auth_collision("_auth_old", "legacy")
                .unwrap_err();
            assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_RESCUE_INVALID");
            assert!(table_row_count(&database.conn, "_auth_old").is_ok());
        }

        let mut marked = LocalDatabase::memory().unwrap();
        marked
            .conn
            .execute_batch("CREATE TABLE _auth_old(id INTEGER);")
            .unwrap();
        marked
            .conn
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES('auth_catalog_version', '1')",
                [],
            )
            .unwrap();
        assert_eq!(
            marked
                .rescue_auth_collision("_auth_old", "legacy")
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_RESCUE_INVALID"
        );
    }

    #[test]
    fn virtual_tables_and_their_shadow_tables_are_both_refused() {
        let mut database = LocalDatabase::memory().unwrap();
        database
            .conn
            .execute_batch("CREATE VIRTUAL TABLE _auth_search USING fts5(body);")
            .unwrap();
        for source in ["_auth_search", "_auth_search_data"] {
            let error = database
                .rescue_auth_collision(source, &format!("legacy_{source}"))
                .unwrap_err();
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED"
            );
        }
    }
}
