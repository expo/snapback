//! The successor under the stored rows: checked narrowing is additive when
//! the data already fits. Used by both read-only check and atomic activation.
use super::*;
use crate::schema::{ColumnDefault, Constraint, materialize_optional_fields};
use crate::successor::{Change, Step};
use crate::engine::validate::{validate_column, validate_row};

pub(super) fn assess(tx: &Tx<'_>, schema: &Schema) -> Result<Vec<Step>, RuntimeError> {
    let previous: Option<String> = tx.tx.query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).optional()?;
    let Some(previous) = previous else { return Ok(Vec::new()) };
    let previous: Schema = serde_json::from_str(&previous).map_err(|e| RuntimeError::decode(e, RuntimeError::Store))?;
    let mut steps = crate::successor::classify(&previous, schema);
    for step in &mut steps {
        if let Some(position) = step.path.strip_prefix("maintains[").and_then(|s| s.strip_suffix(']')).and_then(|s| s.parse::<usize>().ok()) {
            let maintain = &schema.maintains[position];
            // Existing activation is atomic and exhaustive. Keep its assessment
            // read-only and use the same interpreted contribution, without a write.
            if previous.tables.contains_key(&maintain.source) {
                let source = &schema.tables[&maintain.source];
                let paths: Vec<_> = source.recorded.keys().filter(|path| !previous.tables[&maintain.source].recorded.contains_key(*path)).cloned().collect();
                let mut capture = crate::engine::runner::Runner::new(tx, schema, crate::engine::Context::system().at(crate::now_ms()), crate::meter::Meter::new(crate::meter::Ceilings::unbounded(), crate::meter::Cut::Abort), 0);
                let mut totals = BTreeMap::<Vec<u8>, i128>::new();
                let mut fits = true;
                super::activation::walk(tx, tx.num(&maintain.source)?, |_, mut row| {
                    if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.retain(|field, _| source.columns.contains_key(field)); }
                    // Assess the same activation-time capture that the atomic
                    // migration will write; grouping uncaptured paths as null
                    // could falsely reject sums that fit their real groups.
                    let row = capture.capture_recorded(source, crate::schema::row_image(&row, source).into_owned(), &paths)?;
                    if validate_row(schema, &maintain.source, &row).is_err() { fits = false; return Ok(()); }
                    if maintain.selected(&row) {
                        let value = match &maintain.kind {
                            crate::schema::MaintainKind::Count => 1,
                            crate::schema::MaintainKind::Sum { of } => i128::from(row.field(of)?.as_int()?),
                        };
                        let total = totals.entry(crate::key::encode(&maintain.source_key(&row))).or_default();
                        match total.checked_add(value) { Some(next) => *total = next, None => fits = false }
                    }
                    Ok(())
                })?;
                fits &= totals.values().all(|total| (crate::value::I53_MIN as i128..=crate::value::I53_MAX as i128).contains(total));
                if !fits {
                    step.change = Change::Narrowing;
                    step.message = format!("maintain {} cannot adopt these source rows: an interpreted contribution is invalid or the final value is out of range", maintain.label());
                } else { step.message.push_str("; assessed source rows fit the derived rebuild"); }
            }
            continue;
        }
        let path: Vec<_> = step.path.split('.').collect();
        let Some(name) = path.get(1).copied() else { continue };
        let Some(table) = schema.table(name) else { continue };
        // @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — check previews the engine fill, never an unfilled bit as absence.
        // Actual activation fills before this assessment and still validates
        // every row. A read-only check cannot write the old store's images.
        if let ["tables", _, "columns", column] = path.as_slice()
            && !previous.tables[name].columns.contains_key(*column)
            && table.columns.get(*column) == Some(&crate::schema::ColumnType::Bool)
            && schema.timelines.iter().any(|t| t.posts[0] == name && t.slot(false) == *column) {
            step.change = Change::Additive;
            step.message = format!("event slot {name}.{column} is added; activation fills it from byActorPost before validation; devices reacquire");
            continue;
        }
        let column_step = matches!(path.as_slice(), ["tables", _, "columns", column] if previous.tables[name].columns.contains_key(*column));
        if step.change != Change::Narrowing && !(column_step && step.change == Change::Additive) { continue; }
        let t = tx.num(name)?;
        let populated: bool = tx.tx.query_row("SELECT EXISTS(SELECT 1 FROM r WHERE t = ?1)", [t], |r| r.get(0))?;
        if !populated {
            step.change = Change::Additive;
            step.message = format!("{}; the table is empty", step.message.split(';').next().unwrap_or(&step.message));
            continue;
        }
        if matches!(path.as_slice(), ["tables", _, "sequences", _]) { continue; }
        if let ["tables", _, "columns", column] = path.as_slice() {
            if !previous.tables[name].columns.contains_key(*column) && matches!(table.defaults.get(*column), Some(ColumnDefault::Now | ColumnDefault::Viewer)) {
                continue;
            }
        }
        let mut fits = true;
        // Only the changed invariants need grouping; scan bounded image
        // buffers and retain a count per prospective key, never all rows.
        let mut groups: BTreeMap<(String, Vec<u8>), u64> = BTreeMap::new();
        super::activation::walk(tx, t, |_, mut row| {
            if !fits { return Ok(()); }
            if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.retain(|column, _| table.columns.contains_key(column)); }
            materialize_optional_fields(&mut row, table);
            match path.as_slice() {
                ["tables", _, "columns", column] => {
                    let kind = &table.columns[*column];
                    fits = validate_column(name, column, kind, row.field(column).ok()).is_ok()
                        && super::activation::validate_assets(tx, kind, row.field(column).ok()).is_ok();
                    // @ref LLP 3000.007#18.3 — changing interpretation rechecks existing dependent invariants at the column's site.
                    for (index_name, index) in table.indexes.iter().filter(|(_, index)| index.unique && index.uses_column(column)) {
                        let values = index_values(index, &row);
                        if !values.contains(&Value::Null) {
                            let count = groups.entry((format!("unique:{index_name}"), key::encode(&values))).or_default();
                            *count += 1;
                            fits &= *count <= 1;
                        }
                    }
                    for constraint in &table.constraints {
                        match constraint {
                            Constraint::Cap { by, max } if by.iter().any(|c| c == column) => {
                                let values: Vec<_> = by.iter().map(|c| row.field(c).cloned().unwrap_or(Value::Null)).collect();
                                let count = groups.entry((format!("cap:{}", canonical_json(by)), key::encode(&values))).or_default();
                                *count += 1;
                                fits &= *count <= u64::from(*max);
                            }
                            Constraint::Text { field, min, format } if field == column => {
                                if let Ok(Value::String(text)) = row.field(column) {
                                    fits &= crate::engine::validate::validate_text(&format!("{name}.{column}"), text, *min, *format).is_ok();
                                }
                            }
                            _ => {}
                        }
                    }
                }
                ["tables", _, "indexes", index] => {
                    let values = index_values(&table.indexes[*index], &row);
                    if !values.contains(&Value::Null) {
                        let count = groups.entry(((*index).into(), key::encode(&values))).or_default();
                        *count += 1;
                        fits = *count <= 1;
                    }
                }
                ["tables", _, "constraints"] => {
                    fits = validate_row(schema, name, &row).is_ok();
                    for constraint in &table.constraints {
                        if let Constraint::Cap { by, max } = constraint {
                            let values: Vec<_> = by.iter().map(|c| row.field(c).cloned().unwrap_or(Value::Null)).collect();
                            let count = groups.entry((canonical_json(by), key::encode(&values))).or_default();
                            *count += 1;
                            fits &= *count <= u64::from(*max);
                        }
                    }
                }
                _ => {}
            }
            Ok(())
        })?;
        if fits {
            step.change = Change::Additive;
            step.message.push_str("; existing rows satisfy it");
        } else {
            step.change = Change::Narrowing;
        }
    }
    Ok(steps)
}
