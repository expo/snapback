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
pub(super) fn validate_adoption_groups(
    tx: &Tx<'_>,
    previous: &Schema,
    next: &Schema,
) -> Result<(), RuntimeError> {
    validate_groups_inner(tx, previous, next, true)
}

// SQLite's defensive physical activation (programs=None) skips successor
// assessment and adoption diagnostics. Preserve that separate contract too.
#[cfg(test)]
pub(super) fn validate_groups(
    tx: &Tx<'_>,
    previous: &Schema,
    next: &Schema,
) -> Result<(), RuntimeError> {
    validate_groups_inner(tx, previous, next, false)
}

fn validate_groups_inner(
    tx: &Tx<'_>,
    previous: &Schema,
    next: &Schema,
    adoption: bool,
) -> Result<(), RuntimeError> {
    let population = tx.meta("activation_population")?.as_deref() == Some("true");
    let steps = if adoption && tx.meta("dormant_enabled")?.as_deref() != Some("1") {
        crate::successor::classify(previous, next)
    } else {
        Vec::new()
    };
    // Only schema-sized descriptors are retained, never row populations.
    let mut checks = Vec::new();
    for (name, table) in &next.tables {
        let adoption = adoption && next.maintain_for(name).is_none();
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
            checks.push((
                name,
                table,
                index_name.as_str(),
                index.components.len(),
                1,
                true,
                None,
                adoption,
            ));
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
                    checks.push((
                        name,
                        table,
                        index_name.as_str(),
                        by.len(),
                        u64::from(*max),
                        table.cap_exempts_null(by),
                        Some(by.as_slice()),
                        adoption,
                    ));
                }
            }
        }
    }
    // @ref LLP 3000.009.001.000#3.5 — dev assessment visits a column's dependent unique indexes before later index steps.
    let selected =
        |name: &str, table: &crate::schema::Table, index: &str, cap_by: Option<&[String]>| {
            steps
                .iter()
                .position(|step| step_selects(step, previous, name, table, index, cap_by))
        };
    checks.sort_by_key(|(name, table, index, _, _, _, cap_by, _)| {
        selected(name, table, index, *cap_by).unwrap_or(usize::MAX)
    });
    for (name, table, index, prefix, max, nulls, cap_by, adoption) in checks {
        let step = selected(name, table, index, cap_by).map(|n| &steps[n]);
        groups(
            tx, next, name, table, index, prefix, max, nulls, cap_by, adoption, step,
        )?;
    }
    Ok(())
}

fn step_selects(
    step: &crate::successor::Step,
    previous: &Schema,
    name: &str,
    table: &crate::schema::Table,
    index: &str,
    cap_by: Option<&[String]>,
) -> bool {
    use crate::successor::Change;
    let path: Vec<_> = step.path.split('.').collect();
    match path.as_slice() {
        ["tables", t, "columns", c]
            if *t == name
                && (step.change == Change::Narrowing
                    || (step.change == Change::Additive
                        && previous
                            .table(name)
                            .is_some_and(|old| old.columns.contains_key(*c)))) =>
        {
            match cap_by {
                Some(by) => by.iter().any(|field| field == c),
                None => table.indexes[index].uses_column(c),
            }
        }
        ["tables", t, "indexes", i] => {
            *t == name && cap_by.is_none() && *i == index && step.change == Change::Narrowing
        }
        ["tables", t, "constraints"] => {
            *t == name && cap_by.is_some() && step.change == Change::Narrowing
        }
        _ => false,
    }
}
fn groups(
    tx: &Tx<'_>,
    schema: &Schema,
    name: &str,
    table: &crate::schema::Table,
    index: &str,
    prefix: usize,
    max: u64,
    nulls_distinct: bool,
    cap_by: Option<&[String]>,
    adoption: bool,
    step: Option<&crate::successor::Step>,
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
                    if !adoption {
                        return Err(RuntimeError::Constraint(format!(
                            "cannot activate {name}.{index}: existing group exceeds {}",
                            if nulls_distinct {
                                "a unique key".into()
                            } else {
                                format!("cap {max}")
                            }
                        )));
                    }
                    return Err(group_refusal(
                        tx,
                        schema,
                        name,
                        table,
                        index,
                        max,
                        nulls_distinct,
                        cap_by,
                        step,
                    )?);
                }
            }
            after = Some(key);
        }
    }
    Ok(())
}

// @ref LLP 3000.009.001.000#3.5 — refusal evidence and bridge guidance match SQLite; spill populations, bound samples.
fn group_refusal(
    tx: &Tx<'_>,
    schema: &Schema,
    name: &str,
    table: &crate::schema::Table,
    index: &str,
    max: u64,
    nulls: bool,
    cap_by: Option<&[String]>,
    step: Option<&crate::successor::Step>,
) -> Result<RuntimeError, RuntimeError> {
    use crate::store::adopt_refusals::{Samples, bounded, group_refusal, value_sample};
    let retained = tx.meta("dormant_enabled")?.as_deref() == Some("1");
    // SQLite dev detail includes exempt null groups in its samples, after
    // assessment establishes a non-exempt cap violation. Release diagnostics
    // exclude those groups throughout.
    let nulls = nulls && (retained || cap_by.is_none());
    let key = |row: &Value| match cap_by {
        Some(by) => by
            .iter()
            .map(|c| row.field(c).cloned().unwrap_or(Value::Null))
            .collect(),
        None => crate::rows::index_values(&table.indexes[index], row),
    };
    tx.batch("CREATE TEMP TABLE _adopt_groups(k BYTEA PRIMARY KEY,n BIGINT NOT NULL) ON COMMIT DROP; CREATE TEMP TABLE _adopt_conflicts(k BYTEA NOT NULL,id TEXT COLLATE \"C\" NOT NULL,restored INTEGER NOT NULL,sample TEXT COLLATE \"C\" NOT NULL,PRIMARY KEY(k,id)) ON COMMIT DROP")?;
    super::evolution::walk(tx, "r", name, |_, row| {
        let row = crate::schema::row_image(&row, table);
        let values = key(&row);
        if !(nulls && values.contains(&Value::Null)) {
            tx.execute("INSERT INTO _adopt_groups VALUES($1,1) ON CONFLICT(k) DO UPDATE SET n=_adopt_groups.n+1", &[&crate::key::encode(&values)])?;
        }
        Ok(())
    })?;
    let mut bad = Samples::default();
    super::evolution::walk(tx, "r", name, |id, row| {
        let row = crate::schema::row_image(&row, table);
        let values = key(&row);
        if !(nulls && values.contains(&Value::Null)) {
            let encoded = crate::key::encode(&values);
            let n: i64 = tx.query("SELECT n FROM _adopt_groups WHERE k=$1", &[&encoded])?[0].get(0);
            if n > max as i64 {
                let sample = value_sample(&Value::Array(values));
                bad.add(id, &sample);
                let restored = if retained {
                    tx.query("SELECT EXISTS(SELECT 1 FROM _evolution_restored WHERE t=$1 AND id=$2 AND kind IN ('table','narrowed'))", &[&name,&id])?[0].get::<_,bool>(0)
                } else {
                    false
                };
                tx.execute(
                    "INSERT INTO _adopt_conflicts VALUES($1,$2,$3,$4)",
                    &[&encoded, &id, &i32::from(restored), &sample],
                )?;
            }
        }
        Ok(())
    })?;
    let mut origin = String::new();
    for row in tx.query("SELECT k,max(sample),sum(restored),sum(1-restored) FROM _adopt_conflicts GROUP BY k HAVING max(restored)>0 ORDER BY k LIMIT 5", &[])? {
        let key: Vec<u8> = row.get(0);
        let sample: &str = row.get(1);
        let restored: i64 = row.get(2);
        let active: i64 = row.get(3);
        let ids = |which: i32| -> Result<String, RuntimeError> {
            Ok(tx.query("SELECT id FROM _adopt_conflicts WHERE k=$1 AND restored=$2 ORDER BY id LIMIT 5", &[&key,&which])?.iter().map(|r|bounded(r.get(0))).collect::<Vec<_>>().join(", "))
        };
        origin.push_str(&format!("; restoration group key {sample}: restoring dormant rows [{}] ({restored} rows); {active} active rows [{}]",ids(1)?,ids(0)?));
    }
    let groups: i64 = tx.query("SELECT count(*) FROM (SELECT k FROM _adopt_conflicts GROUP BY k HAVING max(restored)>0) AS groups", &[])?[0].get(0);
    if groups > 5 {
        origin.push_str(&format!("; {} more restoration groups (samples bounded to five groups and five ids per category)", groups-5));
    }
    let label = match cap_by {
        Some(by) => format!("{name} cap by {}", by.join(",")),
        None => format!("{name}.{index}"),
    };
    let error = group_refusal(name, &label, max, &bad, &origin);
    if let Some(step) = step {
        let mut step = step.clone();
        if let RuntimeError::Structural { message, .. } = &error {
            step.message.push_str(&format!("; {message}"));
        }
        return Ok(step.refusal(schema));
    }
    Ok(error)
}

/// Called only by fenced attach, after admission and release CAS checks. All
/// relations already exist and passed the normal attach shape validation.
/// Canonical values stay in Rust: jsonb would reject otherwise valid escaped NUL.
pub(super) fn project(tx: &Tx<'_>, previous: &Schema, next: &Schema) -> Result<(), RuntimeError> {
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
                    // An incompatible stored value is an adoption failure on
                    // SQLite too, including before retain-by-default is enabled.
                    RuntimeError::Structural {
                        code: "E_ADOPT",
                        message: format!("cannot activate {name}: {error}"),
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
