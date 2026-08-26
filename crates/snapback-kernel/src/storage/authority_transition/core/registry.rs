//! Fixed resource and protected-object registry for the dormant substrate.

use super::*;

const RESOURCE_GUARD_TABLE: &str = "_snapback_authorization_publication_guard_v1";
const PASSWORD_CREDENTIALS_TABLE: &str = "_auth_password_credentials";
const SESSIONS_TABLE: &str = "_auth_sessions";
const KNOWN_PROTECTED_TABLES: [&str; 2] = [PASSWORD_CREDENTIALS_TABLE, SESSIONS_TABLE];

#[derive(Debug, Eq, PartialEq)]
struct ColumnShape {
    name: String,
    declared_type: String,
    not_null: bool,
    default_value: Option<String>,
    primary_key_position: i64,
    hidden: i64,
}

fn expected_column(
    name: &str,
    declared_type: &str,
    not_null: bool,
    primary_key_position: i64,
) -> ColumnShape {
    ColumnShape {
        name: name.to_owned(),
        declared_type: declared_type.to_owned(),
        not_null,
        default_value: None,
        primary_key_position,
        hidden: 0,
    }
}

// @ref LLP 0313#4-connection-owned-scope-and-private-derivation — durable
// schema is hostile input. The owner validates the exact protected footprint,
// protected-table trigger absence, canonical identifier case, attachment set,
// and virtual-table prohibition before installing its permanent composite
// callback. FK effects remain independently denied by the callback.
#[allow(unexpected_cfgs)]
pub(super) fn validate_initialized_schema(
    connection: &Connection,
) -> AuthorityTransitionResult<()> {
    let databases = connection
        .prepare("PRAGMA database_list")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if databases.iter().any(|database| {
        !database.eq_ignore_ascii_case("main") && !database.eq_ignore_ascii_case("temp")
    }) {
        return Err(hostile("attached database present before activation"));
    }

    let table_kinds = connection
        .prepare("PRAGMA table_list")?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if !cfg!(snapback_authority_mutation_allow_virtual_table)
        && table_kinds.iter().any(|(_, _, kind)| {
            kind.eq_ignore_ascii_case("virtual") || kind.eq_ignore_ascii_case("shadow")
        })
    {
        return Err(hostile("virtual or shadow table present before activation"));
    }

    let objects = connection
        .prepare(
            "SELECT 'main', type, name, tbl_name, sql FROM main.sqlite_schema
             UNION ALL
             SELECT 'temp', type, name, tbl_name, sql FROM temp.sqlite_schema
             ORDER BY 1, 2, 3",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    for (schema, kind, name, table_name, _sql) in &objects {
        if kind.eq_ignore_ascii_case("table") && name.to_ascii_lowercase().starts_with("_auth_") {
            let canonical = KNOWN_PROTECTED_TABLES
                .iter()
                .copied()
                .find(|expected| expected.eq_ignore_ascii_case(name));
            if canonical.is_none()
                || (!cfg!(snapback_authority_mutation_casefold_schema)
                    && (schema != "main" || canonical != Some(name.as_str())))
            {
                return Err(hostile("protected table name is not canonical"));
            }
        }
        if kind.eq_ignore_ascii_case("table")
            && name.eq_ignore_ascii_case(RESOURCE_GUARD_TABLE)
            && !cfg!(snapback_authority_mutation_casefold_schema)
            && (schema != "main" || name != RESOURCE_GUARD_TABLE)
        {
            return Err(hostile("resource guard table name is not canonical"));
        }
        if kind.eq_ignore_ascii_case("trigger") {
            if is_protected_table(table_name)
                && !cfg!(snapback_authority_mutation_casefold_schema)
                && !cfg!(snapback_authority_mutation_accept_suppressing_trigger)
            {
                return Err(hostile("trigger can affect the protected footprint"));
            }
        }
    }

    validate_table_shape(
        connection,
        RESOURCE_GUARD_TABLE,
        &[
            expected_column("singleton", "INTEGER", false, 1),
            expected_column("durable_origin", "BLOB", true, 0),
            expected_column("resource_binding", "BLOB", true, 0),
            expected_column("state", "TEXT", true, 0),
        ],
    )?;
    validate_table_shape(
        connection,
        PASSWORD_CREDENTIALS_TABLE,
        &[
            expected_column("user_id", "TEXT", false, 1),
            expected_column("secret_digest", "BLOB", true, 0),
            expected_column("assurance_generation", "INTEGER", true, 0),
        ],
    )?;
    validate_table_shape(
        connection,
        SESSIONS_TABLE,
        &[
            expected_column("id", "TEXT", false, 1),
            expected_column("user_id", "TEXT", true, 0),
            expected_column("assurance_generation", "INTEGER", true, 0),
        ],
    )?;

    Ok(())
}

fn validate_table_shape(
    connection: &Connection,
    table: &str,
    expected: &[ColumnShape],
) -> AuthorityTransitionResult<()> {
    let observed = connection
        .prepare(
            "SELECT name, type, \"notnull\", dflt_value, pk, hidden
             FROM pragma_table_xinfo(?1)
             ORDER BY cid",
        )?
        .query_map([table], |row| {
            Ok(ColumnShape {
                name: row.get(0)?,
                declared_type: row.get(1)?,
                not_null: row.get::<_, i64>(2)? != 0,
                default_value: row.get(3)?,
                primary_key_position: row.get(4)?,
                hidden: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let matches = observed.len() == expected.len()
        && observed.iter().zip(expected).all(|(left, right)| {
            left.name == right.name
                && left
                    .declared_type
                    .eq_ignore_ascii_case(&right.declared_type)
                && left.not_null == right.not_null
                && left.default_value == right.default_value
                && left.primary_key_position == right.primary_key_position
                && left.hidden == right.hidden
        });
    if matches {
        Ok(())
    } else {
        Err(hostile("protected table shape is not exact"))
    }
}

fn hostile(reason: &'static str) -> AuthorityTransitionError {
    AuthorityTransitionError::HostileSchema(reason)
}

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
    #[allow(unexpected_cfgs)]
    let auth_table = if cfg!(snapback_authority_mutation_casefold_schema) {
        table_name.starts_with("_auth_")
    } else {
        table_name.to_ascii_lowercase().starts_with("_auth_")
    };
    auth_table || table_name.eq_ignore_ascii_case(RESOURCE_GUARD_TABLE)
}
