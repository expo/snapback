//! EV-2: close the candidate population over retained value domains and refs.
// @ref LLP 3000.009.001.000#3.5 — SQLite's reference-closed hiding; no coercion or invented contextual history.
use super::{
    evolution,
    store::{Tx, decode},
};
use crate::{
    RuntimeError, Schema, Value,
    schema::{ColumnType, Constraint, Table, materialize_optional_fields},
    value::canonical_json,
};
use std::collections::{BTreeMap, BTreeSet};

fn incompatible(table: &Table, name: &str, column: &str, kind: &ColumnType, value: &Value) -> bool {
    crate::engine::validate::validate_column(name, column, kind, Some(value)).is_err()
        || table.constraints.iter().any(|c| {
            matches!(c, Constraint::Text { field, min, format }
            if field==column && crate::engine::validate::validate_text_value(field,value,*min,*format).is_err())
        })
}
fn bad_image(table: &Table, name: &str, image: &Value) -> bool {
    table.columns.iter().any(|(column, kind)| {
        !table.engine_field(column)
            && !table.maintained.contains_key(column)
            && image
                .field(column)
                .is_ok_and(|value| incompatible(table, name, column, kind, value))
    })
}
fn migratable(kind: &ColumnType) -> bool {
    match kind {
        ColumnType::Optional(k) => migratable(k),
        ColumnType::Image { .. }
        | ColumnType::Video { .. }
        | ColumnType::File { .. }
        | ColumnType::List { .. }
        | ColumnType::ListRange { .. }
        | ColumnType::Ref { .. } => false,
        _ => true,
    }
}
fn restore(tx: &Tx<'_>, next: &Schema) -> Result<(), RuntimeError> {
    for (name, table) in next
        .tables
        .iter()
        .filter(|(n, t)| t.ephemeral.is_none() && next.maintain_for(n).is_none())
    {
        evolution::walk(tx, "_dormant_narrow_rows", name, |id, mut image| {
            super::movement::image(tx,"_dormant_narrow_rows",name,id,None,&image)?;
            if tx.query(
                "SELECT EXISTS(SELECT 1 FROM r WHERE t=$1 AND id=$2)",
                &[name, &id],
            )?[0]
                .get::<_, bool>(0)
            {
                return Ok(());
            }
            let text: String = tx.query(
                "SELECT definition FROM _dormant_narrow_rows WHERE t=$1 AND id=$2",
                &[name, &id],
            )?[0]
                .get(0);
            let old: Table = decode(&text)?;
            materialize_optional_fields(&mut image, &old);
            if bad_image(table, name, &image) {
                return Ok(());
            }
            // Deleting and reusing a parent never recaptures its old lifetime.
            if tx.query("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=$1 AND id=$2 AND invalid=1 AND column_name=ANY($3))",&[name,&id,&table.columns.keys().cloned().collect::<Vec<_>>()])?[0].get::<_,bool>(0) { return Ok(()); }
            for column in old
                .columns
                .keys()
                .filter(|c| !table.columns.contains_key(*c))
            {
                evolution::definition(tx, name, &old, column)?;
                if let Ok(value) = image.field(column) {
                    evolution::save(tx, name, id, column, value)?;
                }
            }
            if let Value::Row(fields) | Value::Map(fields) = &mut image {
                fields.retain(|c, _| table.columns.contains_key(c));
            }
            for column in table.columns.keys() {
                if let Some(row) = tx
                    .query(
                        "SELECT data FROM _dormant_values WHERE t=$1 AND id=$2 AND column_name=$3",
                        &[name, &id, column],
                    )?
                    .first()
                {
                    if let Value::Row(fields) | Value::Map(fields) = &mut image {
                        fields.insert(column.clone(), decode(row.get(0))?);
                    }
                }
            }
            if bad_image(table, name, &image) {
                return Ok(());
            }
            materialize_optional_fields(&mut image, table);
            tx.execute(
                "INSERT INTO r(t,id,data) VALUES($1,$2,$3)",
                &[name, &id, &canonical_json(&image)],
            )?;
            super::movement::image(tx,"r",name,id,None,&image)?;
            Ok(())
        })?;
    }
    Ok(())
}

pub(super) fn transition(
    tx: &Tx<'_>,
    previous: &Schema,
    next: &Schema,
    restoring: &BTreeMap<String, Table>,
) -> Result<(), RuntimeError> {
    let have: bool = tx.query("SELECT EXISTS(SELECT 1 FROM _dormant_narrow_rows)", &[])?[0].get(0);
    let type_change = next.tables.iter().any(|(name, t)| {
        previous.table(name).is_some_and(|old| {
            t.columns
                .iter()
                .any(|(c, k)| old.columns.get(c).is_some_and(|p| p != k))
                || t.constraints
                    .iter()
                    .filter(|c| matches!(c, Constraint::Text { .. }))
                    .collect::<Vec<_>>()
                    != old
                        .constraints
                        .iter()
                        .filter(|c| matches!(c, Constraint::Text { .. }))
                        .collect::<Vec<_>>()
        })
    });
    let cells: bool = tx.query("SELECT EXISTS(SELECT 1 FROM _dormant_columns)", &[])?[0].get(0);
    // Definition-only restoration invokes the walk too, just as on SQLite.
    if !have
        && !type_change
        && restoring.is_empty()
        && !cells
        && tx.meta("activation_population")?.as_deref() != Some("true")
    {
        return Ok(());
    }
    restore(tx, next)?;
    let mut newly = 0u64;
    loop {
        let mut removed = 0u64;
        for (name, table) in next
            .tables
            .iter()
            .filter(|(n, t)| t.ephemeral.is_none() && next.maintain_for(n).is_none())
        {
            evolution::walk(tx, "r", name, |id, mut image| {
                materialize_optional_fields(&mut image, previous.table(name).unwrap_or(table));
                let mut causes = BTreeSet::new();
                for (column, kind) in &table.columns {
                    if table.engine_field(column) || table.maintained.contains_key(column) {
                        continue;
                    }
                    if let Ok(value) = image.field(column) {
                        if incompatible(table, name, column, kind, value) {
                            let value = match value {
                                Value::Null => "null".to_owned(),
                                Value::Array(v) => format!("a list of {} values", v.len()),
                                _ => format!("a value outside {kind}"),
                            };
                            let remedy = if migratable(kind) {
                                "declare a truthful scalar down projection or use a loosened bridge"
                            } else {
                                "computed down cannot project files, images, collections or references; use a loosened bridge"
                            };
                            causes.insert(format!(
                                "{name}.{column} holds {value}, which does not fit {kind}; {remedy}"
                            ));
                        }
                    }
                }
                for (column, kind) in &table.columns {
                    let mut edges = Vec::new();
                    if let Ok(value) = image.field(column) {
                        evolution::refs(kind, value, &mut edges);
                    }
                    for (parent, parent_id) in edges {
                        let hidden=next.table(&parent).is_none() || tx.query("SELECT NOT EXISTS(SELECT 1 FROM r WHERE t=$1 AND id=$2) AND EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=$1 AND id=$2)",&[&parent,&parent_id])?[0].get::<_,bool>(0);
                        if hidden {
                            causes.insert(format!("{name}.{column} references hidden parent {parent}; preserve the parent's domain in a loosened bridge"));
                        }
                    }
                }
                if causes.is_empty() {
                    return Ok(());
                }
                let retained: bool = tx.query(
                    "SELECT EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=$1 AND id=$2)",
                    &[name, &id],
                )?[0]
                    .get(0);
                if retained {
                    tx.execute(
                        "UPDATE _dormant_narrow_rows SET reason=$3 WHERE t=$1 AND id=$2",
                        &[name, &id, &canonical_json(&causes)],
                    )?;
                } else {
                    let old = restoring
                        .get(name)
                        .or_else(|| previous.table(name))
                        .unwrap_or(table);
                    tx.execute("INSERT INTO _dormant_narrow_rows(t,id,data,definition,reason) VALUES($1,$2,$3,$4,$5)",&[name,&id,&canonical_json(&image),&canonical_json(old),&canonical_json(&causes)])?;
                    for (column, kind) in &old.columns {
                        let captured:bool=tx.query("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=$1 AND id=$2 AND column_name=$3)",&[name,&id,column])?[0].get(0);
                        if !captured {
                            if let Ok(value) = image.field(column) {
                                evolution::capture(tx, name, id, column, kind, value)?;
                            }
                        }
                    }
                    newly += 1;
                }
                // A retained original may differ from the candidate image, but
                // must still exist before hiding the live candidate.
                if !retained {super::movement::image(tx,"_dormant_narrow_rows",name,id,None,&image)?;}
                super::movement::verify_expected(tx,"_dormant_narrow_rows",name,id)?;
                tx.rows_cache.borrow_mut().invalidate(name);
                tx.execute("DELETE FROM r WHERE t=$1 AND id=$2", &[name, &id])?;
                removed += 1;
                Ok(())
            })?;
        }
        if removed == 0 {
            break;
        }
    }
    let restored_counts=super::movement::narrowed_counts(tx)?;
    let restored=restored_counts.values().sum::<i64>() as u64;
    for (name,n) in restored_counts {
        tx.set_meta(&format!("activation_narrowed_restored:{name}"),&n.to_string())?;
    }
    tx.execute("INSERT INTO _evolution_restored(kind,t,col,id) SELECT 'narrowed',t,'',id FROM _dormant_narrow_rows n WHERE EXISTS(SELECT 1 FROM r WHERE r.t=n.t AND r.id=n.id) ON CONFLICT DO NOTHING",&[])?;
    super::movement::verify_narrowed(tx,super::store::signed(restored)?)?;
    tx.execute("DELETE FROM _dormant_narrow_rows n WHERE EXISTS(SELECT 1 FROM r WHERE r.t=n.t AND r.id=n.id)",&[])?;
    tx.set_meta("activation_narrowed_retained", &newly.to_string())?;
    tx.set_meta("activation_narrowed_restored", &restored.to_string())?;
    if newly > 0 || restored > 0 {
        tx.set_meta("activation_population", "true")?;
    }
    Ok(())
}
