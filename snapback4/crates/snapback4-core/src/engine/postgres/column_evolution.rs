//! Physical projection and indexes for maintained columns and EV-1 releases.
// @ref LLP 3000.009.001.000#3.5 — defaults stay interpreted and restored indexes are validated before publication.
// @ref LLP 3000.007.001#3.11 — project removals, rebuild private totals, then mirror before publishing the generation.
use super::store::Tx;
use crate::{RuntimeError, Schema, Value, value::canonical_json};

/// Retain the maintained-column slice and admit only the closed ordinary slice.
pub(super) fn admit(previous: &Schema, next: &Schema) -> Result<(), RuntimeError> {
    super::evolution_admission::admit(previous, next)
}

/// Run after the common recount/mirror builder: physical keys include row ids,
/// so their primary key alone cannot enforce logical uniqueness. Compare the
/// entire index definition (including all key columns), even on an index-only
/// edit whose maintain declaration does not require a rebuild.
pub(super) fn validate_groups(
    tx: &Tx<'_>,
    previous: &Schema,
    next: &Schema,
) -> Result<(), RuntimeError> {
    let population = tx.meta("activation_population")?.as_deref() == Some("true");
    for (name, table) in &next.tables {
        let old = previous.table(name);
        let projected = population || old != Some(table);
        let rebuilt = next
            .maintain_for(name)
            .is_some_and(|m| crate::successor::maintain_rebuild_needed(previous, next, m));
        for (index_name, index) in table.indexes.iter().filter(|(index_name, index)| {
            index.unique
                && (projected
                    || rebuilt
                    || old.and_then(|old| old.indexes.get(*index_name)) != Some(*index))
        }) {
            groups(tx, name, index_name, index.components.len(), 1, true)?;
        }
        if projected || rebuilt {
            for constraint in &table.constraints {
                if let crate::schema::Constraint::Cap { by, max } = constraint {
                    let (index_name, _) = table
                        .indexes
                        .iter()
                        .find(|(_, i)| i.is_plain() && i.columns().starts_with(by))
                        .ok_or_else(|| {
                            RuntimeError::Schema(format!("{name} cap has no matching index"))
                        })?;
                    groups(
                        tx,
                        name,
                        index_name,
                        by.len(),
                        u64::from(*max),
                        table.cap_exempts_null(by),
                    )?;
                }
            }
        }
    }
    Ok(())
}
fn groups(
    tx: &Tx<'_>,
    name: &str,
    index: &str,
    prefix: usize,
    max: u64,
    nulls_distinct: bool,
) -> Result<(), RuntimeError> {
    let mut after: Option<Vec<u8>> = None;
    let mut previous = None;
    let mut count = 0u64;
    loop {
        let rows=tx.query("SELECT k FROM i WHERE t=$1 AND ix=$2 AND ($3::bytea IS NULL OR k>$3) ORDER BY k LIMIT 256",&[&name,&index,&after])?;
        if rows.is_empty() {
            break;
        }
        for row in rows {
            let key: Vec<u8> = row.get(0);
            let mut group = crate::key::decode(&key)
                .ok_or_else(|| RuntimeError::Store("invalid rebuilt index key".into()))?;
            group.truncate(prefix);
            if !(nulls_distinct && group.contains(&Value::Null)) {
                if previous.as_ref() == Some(&group) {
                    count += 1;
                } else {
                    previous = Some(group);
                    count = 1;
                }
                if count > max {
                    let message = format!(
                        "cannot activate {name}.{index}: existing group exceeds {}",
                        if nulls_distinct {
                            "a unique key".into()
                        } else {
                            format!("cap {max}")
                        }
                    );
                    return Err(if tx.meta("dormant_enabled")?.as_deref() == Some("1") {
                        RuntimeError::Structural {
                            code: "E_ADOPT",
                            message,
                        }
                    } else {
                        RuntimeError::Constraint(message)
                    });
                }
            }
            after = Some(key);
        }
    }
    Ok(())
}

/// Called only by fenced attach, after admission and release CAS checks. All
/// relations already exist and passed the normal attach shape validation.
/// Canonical values stay in Rust: jsonb would reject otherwise valid escaped NUL.
pub(super) fn project(tx: &Tx<'_>, previous: &Schema, next: &Schema) -> Result<(), RuntimeError> {
    let release = tx.meta("dormant_enabled")?.as_deref() == Some("1");
    for maintain in previous
        .maintains
        .iter()
        .filter(|m| m.private.is_some() && !next.maintains.iter().any(|n| n.target == m.target))
    {
        tx.rows_cache.borrow_mut().invalidate(&maintain.target);
        tx.execute("DELETE FROM i WHERE t=$1", &[&maintain.target])?;
        tx.execute("DELETE FROM r WHERE t=$1", &[&maintain.target])?;
    }
    for (name, table) in &next.tables {
        let old = previous.table(name);
        if old == Some(table) && tx.meta("activation_population")?.as_deref() != Some("true") {
            continue;
        }
        tx.rows_cache.borrow_mut().invalidate(name);
        let indexes: std::collections::BTreeSet<_> = table
            .indexes
            .keys()
            .chain(old.into_iter().flat_map(|t| t.indexes.keys()))
            .cloned()
            .collect();
        for index in &indexes {
            tx.execute("DELETE FROM i WHERE t=$1 AND ix=$2", &[name, index])?;
        }
        super::evolution::walk(tx, "r", name, |id, mut image| {
            if let Value::Row(fields) | Value::Map(fields) = &mut image {
                let before = fields.len();
                fields.retain(|field, _| table.columns.contains_key(field));
                if fields.len() != before {
                    tx.execute(
                        "UPDATE r SET data=$3 WHERE t=$1 AND id=$2",
                        &[name, &id, &canonical_json(&image)],
                    )?;
                }
            }
            crate::schema::materialize_optional_fields(&mut image, table);
            if next.maintain_for(name).is_none() {
                crate::engine::validate::validate_row(next, name, &image).map_err(|error| {
                    if release {
                        RuntimeError::Structural {
                            code: "E_ADOPT",
                            message: format!("cannot activate {name}: {error}"),
                        }
                    } else {
                        error
                    }
                })?;
            }
            // index_write enforces the portable key bound and sparse-zero
            // interpretation, just like an ordinary row write.
            for write in crate::rows::index_write(name, table, &image, None, id)? {
                if indexes.contains(write.name) {
                    for key in write.after {
                        tx.execute(
                            "INSERT INTO i(t,ix,k,id) VALUES ($1,$2,$3,$4)",
                            &[name, &write.name, &key, &id],
                        )?;
                    }
                }
            }
            Ok(())
        })?;
    }
    Ok(())
}
