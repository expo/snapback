//! Release row lifetimes whose present values cannot inhabit the selected type.
// @ref LLP 3000.000.000#91-per-row-narrowed-value-dormancy — hide a reference-closed population; never coerce values.
use super::*;
use crate::schema::{ColumnType, Constraint};

pub(super) fn present(conn: &Connection) -> Result<bool, RuntimeError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_dormant_narrow_rows')",
        [],
        |r| r.get(0),
    )?)
}

fn incompatible(tx:&Tx<'_>,schema: &Schema, name: &str, row: &Value) -> Result<bool,RuntimeError> {
    let table = &schema.tables[name];
    for (column,kind) in &table.columns {
        if table.engine_field(column) || table.maintained.contains_key(column) {continue;}
        if let Ok(value)=row.field(column) {
            if incompatible_column(tx, table, name, column, kind, value)? { return Ok(true); }
        }
    }
    Ok(false)
}

// @ref LLP 3000.000.000#11-wave-11-factual-release-narration — the warning and activation share the value predicate, including ledger-backed assets.
pub(super) fn incompatible_column(tx: &Tx<'_>, table: &Table, name: &str, column: &str, kind: &ColumnType, value: &Value) -> Result<bool, RuntimeError> {
    if crate::engine::validate::validate_column(name, column, kind, Some(value)).is_err() { return Ok(true); }
    // @ref LLP 3000.038#1-the-type — asset facts belong to the ledger, including optional/list leaves.
    match super::activation::validate_assets(tx, kind, Some(value)) {
        Err(RuntimeError::Asset { code: "E_ASSET_TYPE" | "E_ASSET_TOO_LARGE", .. }) => return Ok(true),
        Err(error) => return Err(error),
        Ok(()) => (),
    }
    Ok(table.constraints.iter().any(|c| matches!(c, Constraint::Text { field, min, format }
        if field == column && matches!(value, Value::String(s)
            if crate::engine::validate::validate_text(field, s, *min, *format).is_err()))))
}

fn refs(kind: &ColumnType, value: &Value, out: &mut Vec<(String, String)>) {
    match (kind, value) {
        (ColumnType::Optional(inner), v) => refs(inner, v, out),
        (ColumnType::List { of, .. } | ColumnType::ListRange { of, .. }, Value::Array(vs)) => {
            for v in vs {
                refs(of, v, out);
            }
        }
        (ColumnType::Ref { table }, Value::Id(id)) => out.push((table.clone(), id.clone())),
        _ => {}
    }
}

pub(super) fn transition(
    tx: &Tx<'_>,
    next: &Schema,
    previous: Option<&Schema>,
    now: i64,
    restored_images: bool,
    source_definitions: &BTreeMap<String, Table>,
) -> Result<(), RuntimeError> {
    // An expired predecessor must not be archived and later revived without its lifetime.
    if let Some(previous) = previous {
        let retirement = crate::engine::through_activation::Retirement::new(next, previous, now);
        for (name, old) in &previous.tables {
            if next.tables.contains_key(name) && retirement.affects(name) {
                super::activation::walk(tx, tx.num(name)?, |_, row| {
                    if retirement.retires(name, &row) {
                        tx.delete(name, old, &row)?;
                    }
                    Ok(())
                })?;
            }
        }
    }
    let have_dormant: bool = tx.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM _dormant_narrow_rows)",
        [],
        |r| r.get(0),
    )?;
    let type_change = previous.is_some_and(|old| {
        next.tables.iter().any(|(name, t)| {
            old.table(name).is_some_and(|p| {
                t.columns
                    .iter()
                    .any(|(c, k)| p.columns.get(c).is_some_and(|old| old != k))
                    || t.constraints
                        .iter()
                        .filter(|c| matches!(c, Constraint::Text { .. }))
                        .collect::<Vec<_>>()
                        != p.constraints
                            .iter()
                            .filter(|c| matches!(c, Constraint::Text { .. }))
                            .collect::<Vec<_>>()
            })
        })
    });
    if !have_dormant && !type_change && !restored_images {
        return Ok(());
    }
    let mut newly_retained = 0u64;
    // Stream on the primary key. Do not retain a store-sized list of images.
    let mut cursor = (0i64, String::new());
    loop {
        let item: Option<(i64,String,String,String)> = tx.conn().query_row(
            "SELECT t,id,data,definition FROM _dormant_narrow_rows WHERE (t,id)>(?1,?2) ORDER BY t,id LIMIT 1",
            params![cursor.0,cursor.1],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        let Some((t, id, data, definition)) = item else {
            break;
        };
        cursor = (t, id.clone());
        let name: String =
            tx.conn()
                .query_row("SELECT name FROM _catalog WHERE num=?1", [t], |r| r.get(0))?;
        let Some(table) = next
            .table(&name)
            .filter(|t| t.ephemeral.is_none() && next.maintain_for(&name).is_none())
        else {
            continue;
        };
        let old: Table =
            serde_json::from_str(&definition).map_err(|e| RuntimeError::Store(e.to_string()))?;
        super::dormant::check_owner(tx, &name, &old, next)?;
        let mut row: Value =
            serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?;
        if incompatible(tx,next, &name, &row)? {
            continue;
        }
        // Retained source deadlines precede projection, including removal of read-through itself.
        if crate::engine::through_activation::Retirement::retires_image(table,&old,&row,now) {
            tx.delete(&name,&old,&row)?;
            continue;
        }
        // Actual deletion/reuse never recaptures a different parent lifetime.
        let invalid_columns = tx
            .conn()
            .prepare_cached(
                "SELECT column_name FROM _dormant_refs WHERE t=?1 AND id=?2 AND invalid=1",
            )?
            .query_map(params![t, id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let invalid = invalid_columns
            .iter()
            .any(|c| table.columns.contains_key(c));
        if invalid {
            continue;
        }
        for column in old.columns.keys() {
            if !table.columns.contains_key(column) {
                super::dormant::definition(tx, &name, &old, column)?;
                if let Ok(value) = row.field(column) {
                    super::dormant::save_cell(tx, &name, &old, &id, column, value, false)?;
                }
            }
        }
        if let Value::Row(fields) | Value::Map(fields) = &mut row {
            fields.retain(|c, _| table.columns.contains_key(c));
        }
        let values = tx
            .conn()
            .prepare_cached("SELECT column_name,data FROM _dormant_values WHERE t=?1 AND id=?2")?
            .query_map(params![t, id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        if let Value::Row(fields) | Value::Map(fields) = &mut row {
            for (column, data) in values {
                if table.columns.contains_key(&column) {
                    fields.insert(
                        column,
                        serde_json::from_str(&data)
                            .map_err(|e| RuntimeError::Store(e.to_string()))?,
                    );
                }
            }
        }
        crate::schema::materialize_optional_fields(&mut row, table);
        // Missing required new fields are a genuine backfill refusal, not dormancy.
        tx.conn().execute(
            "INSERT INTO r(t,id,data) VALUES(?1,?2,?3)",
            params![t, id, canonical_json(&row)],
        )?;
    }
    tx.clear_activation_scan();
    // References to a hidden row hide their dependents, including memberships.
    loop {
        let mut removed = 0u64;
        for (name, table) in next
            .tables
            .iter()
            .filter(|(n, t)| t.ephemeral.is_none() && next.maintain_for(n).is_none())
        {
            let t = tx.num(name)?;
            super::activation::walk(tx, t, |id, mut row| {
                if let Some(source)=source_definitions.get(name) {
                    if crate::engine::through_activation::Retirement::retires_image(table,source,&row,now) {
                        tx.delete(name,source,&row)?;
                        return Ok(());
                    }
                }
                crate::schema::materialize_optional_fields(
                    &mut row,
                    previous.and_then(|s| s.table(name)).unwrap_or(table),
                );
                let mut hidden = incompatible(tx,next, name, &row)?;
                for (column, kind) in &table.columns {
                    let mut edges = Vec::new();
                    if let Ok(value) = row.field(column) {
                        refs(kind, value, &mut edges);
                    }
                    for (parent, parent_id) in edges {
                        let missing = next.table(&parent).is_none()
                            || (tx.get(&parent, &parent_id)?.is_none()
                                && reserved(tx, tx.num(&parent)?, &parent_id)?);
                        if missing {
                            hidden = true;
                        }
                    }
                }
                if !hidden {
                    return Ok(());
                }
                let retained: bool = tx.conn().query_row(
                    "SELECT EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=?1 AND id=?2)",
                    params![t, id],
                    |r| r.get(0),
                )?;
                if !retained {
                    newly_retained += 1;
                    let old = source_definitions.get(name).unwrap_or(table);
                    tx.conn().execute(
                        "INSERT INTO _dormant_narrow_rows VALUES(?1,?2,?3,?4,?5)",
                        params![
                            t,
                            id,
                            canonical_json(&row),
                            canonical_json(old),
                            "type or dormant reference"
                        ],
                    )?;
                    for (column, kind) in &old.columns {
                        // Retained cells/whole rows already captured a lifetime; moving them must not erase deletion evidence.
                        let captured:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3)",params![t,id,column],|r|r.get(0))?;
                        if captured {
                            continue;
                        }
                        if let Ok(value) = row.field(column) {
                            super::dormant::capture_refs(tx, t, id, column, kind, value)?;
                        }
                        super::dormant::capture_through_parent(tx, name, old, id, column, &row)?;
                        // Nominal keep references may already be dangling. They have no bound lifetime.
                    }
                }
                tx.conn()
                    .execute("DELETE FROM r WHERE t=?1 AND id=?2", params![t, id])?;
                removed += 1;
                Ok(())
            })?;
            tx.clear_activation_scan();
        }
        if removed == 0 {
            break;
        }
    }
    // Consume only rows that survived the closed population, not hidden dependents.
    let restored:u64=tx.conn().query_row("SELECT COUNT(*) FROM _dormant_narrow_rows n WHERE EXISTS(SELECT 1 FROM r WHERE r.t=n.t AND r.id=n.id)",[],|r|r.get::<_,i64>(0).map(|n|n as u64))?;
    let restored_rows=tx.conn().prepare("SELECT c.name,n.id FROM _dormant_narrow_rows n JOIN _catalog c ON c.num=n.t WHERE EXISTS(SELECT 1 FROM r WHERE r.t=n.t AND r.id=n.id)")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<Result<Vec<_>,_>>()?;
    let mut restored_tables:std::collections::BTreeMap<String,Vec<String>>=std::collections::BTreeMap::new();
    for (name,id) in restored_rows {restored_tables.entry(name).or_default().push(id);}
    for (name, ids) in restored_tables {
        tx.set_meta(&format!("activation_narrowed_restored:{name}"),&ids.len().to_string())?;
        tx.set_meta(&format!("activation_narrowed_restored_ids:{name}"),&serde_json::to_string(&ids).map_err(|e|RuntimeError::Store(e.to_string()))?)?;
    }
    tx.set_meta("activation_narrowed_retained", &newly_retained.to_string())?;
    tx.set_meta("activation_narrowed_restored", &restored.to_string())?;
    tx.conn().execute("DELETE FROM _dormant_narrow_rows WHERE EXISTS(SELECT 1 FROM r WHERE r.t=_dormant_narrow_rows.t AND r.id=_dormant_narrow_rows.id)",[])?;
    if newly_retained > 0 || restored > 0 {
        tx.set_meta("activation_population", "true")?;
    }
    Ok(())
}

pub(super) fn reserved(tx: &Tx<'_>, t: i64, id: &str) -> Result<bool, RuntimeError> {
    if !present(tx.conn())? {
        return Ok(false);
    }
    Ok(tx.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=?1 AND id=?2)",
        params![t, id],
        |r| r.get(0),
    )?)
}

pub(super) fn check_write(
    tx: &Tx<'_>,
    name: &str,
    _table: &Table,
    row: &Value,
    old: Option<&Value>,
) -> Result<(), RuntimeError> {
    if !present(tx.conn())? {
        return Ok(());
    }
    let id = row.field("id")?.as_str()?;
    let conflict = old.is_none() && reserved(tx, tx.num(name)?, id)?;
    if conflict {
        return Err(RuntimeError::Rule {
            table: name.into(),
            effect: if old.is_some() {
                crate::schema::Effect::Update
            } else {
                crate::schema::Effect::Insert
            },
        });
    }
    Ok(())
}
