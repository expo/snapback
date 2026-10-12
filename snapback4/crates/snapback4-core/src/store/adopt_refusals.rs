//! Privileged, bounded population evidence for adoption refusals.
// @ref LLP 3000.000.000#3-older-writes-and-incompatible-values — count all affected rows, retain at most five samples.
use super::*;
use crate::schema::{Constraint, materialize_optional_fields};

#[derive(Default)]
pub(super) struct Samples {
    pub count: u64,
    ids: Vec<String>,
    values: Vec<String>,
    last_id: Option<String>,
}
pub(super) fn bounded(text: &str) -> String {
    if text.len() <= 256 {
        return text.into();
    }
    let mut end = 256;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}… [truncated]", &text[..end])
}

fn value_sample(value: &Value) -> String {
    struct Prefix(Vec<u8>);
    impl std::io::Write for Prefix {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let n = bytes.len().min(256 - self.0.len());
            self.0.extend_from_slice(&bytes[..n]);
            if n < bytes.len() {
                return Err(std::io::Error::other("sample truncated"));
            }
            Ok(n)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    if let Value::Bytes(bytes) = value {
        return format!("{} bytes", bytes.len());
    }
    let mut prefix = Prefix(Vec::with_capacity(256));
    let truncated = serde_json::to_writer(&mut prefix, &crate::wire::Plain(value)).is_err();
    let mut text = String::from_utf8_lossy(&prefix.0).into_owned();
    if truncated {
        text.push_str("… [truncated]")
    }
    text
}
impl Samples {
    pub fn add(&mut self, id: &str, value: &str) {
        if self.last_id.as_deref() != Some(id) {
            self.count += 1;
            if self.ids.len() < 5 {
                self.ids.push(bounded(id));
            }
            self.last_id = Some(id.into());
        }
        let value = bounded(value);
        if self.values.len() < 5 && !self.values.contains(&value) {
            self.values.push(value);
        }
    }
    pub fn describe(&self) -> String {
        format!(
            "{} affected rows; sample ids [{}]; values/keys [{}]",
            self.count,
            self.ids.join(", "),
            self.values.join(", ")
        )
    }
}

pub(super) fn candidate(
    tx: &Tx<'_>,
    schema: &Schema,
    previous: Option<&Schema>,
    complete: bool,
) -> Result<(), RuntimeError> {
    for (name, table) in schema
        .tables
        .iter()
        .filter(|(n, t)| t.ephemeral.is_none() && schema.maintain_for(n).is_none())
    {
        if previous.and_then(|p| p.table(name)) == Some(table) {
            continue;
        }
        let mut bad = Samples::default();
        super::activation::walk(tx, tx.num(name)?, |id, mut row| {
            if let Value::Row(f) | Value::Map(f) = &mut row {
                f.retain(|c, _| table.columns.contains_key(c));
            }
            materialize_optional_fields(&mut row, table);
            let validation = if complete {
                crate::engine::validate::validate_row(schema, name, &row)
            } else {
                crate::engine::validate::validate_adoption_input(schema, name, &row)
            };
            if let Err(error) = validation {
                let mut detailed = false;
                for (column, kind) in &table.columns {
                    if (complete || !table.engine_field(column))
                        && crate::engine::validate::validate_column(
                            name,
                            column,
                            kind,
                            row.field(column).ok(),
                        )
                        .is_err()
                    {
                        let value = row
                            .field(column)
                            .map(value_sample)
                            .unwrap_or_else(|_| "<missing>".into());
                        bad.add(id, &format!("{name}.{column}={value}; {error}"));
                        detailed = true;
                    }
                }
                if !detailed {
                    bad.add(id, &error.to_string());
                }
            }
            for (column, kind) in &table.columns {
                if let Err(error) =
                    super::activation::validate_assets(tx, kind, row.field(column).ok())
                {
                    bad.add(id, &format!("{name}.{column}: {error}"));
                }
            }
            Ok(())
        })?;
        if bad.count != 0 {
            return Err(RuntimeError::Structural {
                code: "E_ADOPT",
                message: format!(
                    "table {name}: {}; rewrite: repair the named values under the current release, or deploy a bridge with optional/literal-default columns using --restore-dormant, backfill through a bridge mutation, then deploy required types; inspect: snapback4 sql \"SELECT id,data FROM r WHERE t=(SELECT num FROM _catalog WHERE name='{name}')\" --release <dir>",
                    bad.describe()
                ),
            });
        }
        for (index, definition) in table.indexes.iter().filter(|(_, i)| {
            i.unique
                && (complete
                    || !table
                        .columns
                        .keys()
                        .any(|c| table.engine_field(c) && i.uses_column(c)))
        }) {
            groups(
                tx,
                name,
                table,
                &format!("{name}.{index}"),
                definition.components.len(),
                1,
                true,
                |row| index_values(definition, row),
            )?;
        }
        for constraint in &table.constraints {
            if let Constraint::Cap { by, max } = constraint
                && (complete || !by.iter().any(|c| table.engine_field(c)))
            {
                groups(
                    tx,
                    name,
                    table,
                    &format!("{name} cap by {}", by.join(",")),
                    by.len(),
                    u64::from(*max),
                    false,
                    |row| {
                        by.iter()
                            .map(|c| row.field(c).cloned().unwrap_or(Value::Null))
                            .collect()
                    },
                )?;
            }
        }
    }
    Ok(())
}

fn groups(
    tx: &Tx<'_>,
    name: &str,
    table: &Table,
    label: &str,
    _prefix: usize,
    max: u64,
    nulls: bool,
    key: impl Fn(&Value) -> Vec<Value>,
) -> Result<(), RuntimeError> {
    // Spill group counts to SQLite's temporary store, rather than retaining
    // every key or row image in the operator's heap. Read-only preview may
    // write TEMP but never the application's main database.
    tx.conn().execute_batch("DROP TABLE IF EXISTS temp._adopt_groups; CREATE TEMP TABLE _adopt_groups(k BLOB PRIMARY KEY,n INTEGER NOT NULL) WITHOUT ROWID;")?;
    super::activation::walk(tx, tx.num(name)?, |_, row| {
        let row = crate::schema::row_image(&row, table);
        let values = key(&row);
        if !(nulls && values.contains(&Value::Null)) {
            tx.conn().execute(
                "INSERT INTO temp._adopt_groups VALUES(?1,1) ON CONFLICT(k) DO UPDATE SET n=n+1",
                [crate::key::encode(&values)],
            )?;
        }
        Ok(())
    })?;
    let count: i64 = tx.conn().query_row(
        "SELECT COALESCE(SUM(n),0) FROM temp._adopt_groups WHERE n>?1",
        [max as i64],
        |r| r.get(0),
    )?;
    let mut bad = Samples::default();
    if count != 0 {
        super::activation::walk(tx, tx.num(name)?, |id, row| {
            let row = crate::schema::row_image(&row, table);
            let values = key(&row);
            if !(nulls && values.contains(&Value::Null)) {
                let n: i64 = tx.conn().query_row(
                    "SELECT n FROM temp._adopt_groups WHERE k=?1",
                    [crate::key::encode(&values)],
                    |r| r.get(0),
                )?;
                if n > max as i64 {
                    bad.add(id, &crate::wire::to_json(&Value::Array(values)).to_string());
                }
            }
            Ok(())
        })?;
    }
    tx.conn().execute_batch("DROP TABLE temp._adopt_groups;")?;
    if count != 0 {
        return Err(RuntimeError::Structural {
            code: "E_ADOPT",
            message: format!(
                "{label}: {}; limit {max}; rewrite: repair duplicate/overfull groups through the current release, or make this index non-unique / increase the cap; inspect: snapback4 sql \"SELECT id,data FROM r WHERE t=(SELECT num FROM _catalog WHERE name='{name}')\" --release <dir>",
                bad.describe()
            ),
        });
    }
    Ok(())
}

pub(super) fn detail(
    tx: &Tx<'_>,
    schema: &Schema,
    step: &crate::successor::Step,
) -> Result<String, RuntimeError> {
    let path: Vec<_> = step.path.split('.').collect();
    let Some(name) = path.get(1).filter(|_| path.first() == Some(&"tables")) else {
        return Ok(step.message.clone());
    };
    let Some(table) = schema.table(name) else {
        return Ok(step.message.clone());
    };
    if let ["tables", _, "indexes", index] = path.as_slice() {
        let definition = &table.indexes[*index];
        if definition.unique {
            if let Err(error) = groups(
                tx,
                name,
                table,
                &format!("{name}.{index}"),
                definition.components.len(),
                1,
                true,
                |r| index_values(definition, r),
            ) {
                return match error {
                    RuntimeError::Structural { message, .. } => {
                        Ok(format!("{}; {message}", step.message))
                    }
                    error => Err(error),
                };
            }
        }
    }
    if matches!(path.as_slice(), ["tables", _, "constraints"]) {
        for constraint in &table.constraints {
            if let Constraint::Cap { by, max } = constraint {
                if let Err(error) = groups(
                    tx,
                    name,
                    table,
                    &format!("{name} cap by {}", by.join(",")),
                    by.len(),
                    u64::from(*max),
                    false,
                    |r| {
                        by.iter()
                            .map(|c| r.field(c).cloned().unwrap_or(Value::Null))
                            .collect()
                    },
                ) {
                    return match error {
                        RuntimeError::Structural { message, .. } => {
                            Ok(format!("{}; {message}", step.message))
                        }
                        error => Err(error),
                    };
                }
            }
        }
    }
    let mut samples = Samples::default();
    super::activation::walk(tx, tx.num(name)?, |id, mut row| {
        if let Value::Row(f) | Value::Map(f) = &mut row {
            f.retain(|c, _| table.columns.contains_key(c));
        }
        materialize_optional_fields(&mut row, table);
        match path.as_slice() {
            ["tables", _, "columns", column] => {
                if crate::engine::validate::validate_column(
                    name,
                    column,
                    &table.columns[*column],
                    row.field(column).ok(),
                )
                .is_err()
                {
                    let value = row
                        .field(column)
                        .map(|v| crate::wire::to_json(v).to_string())
                        .unwrap_or_else(|_| "<missing>".into());
                    samples.add(id, &format!("{name}.{column}={value}"));
                }
            }
            _ => {
                samples.add(id, &format!("{name}: invariant population"));
            }
        }
        Ok(())
    })?;
    Ok(format!(
        "{}; {}; inspect: snapback4 sql \"SELECT id,data FROM r WHERE t=(SELECT num FROM _catalog WHERE name='{name}')\" --release <dir>",
        step.message,
        samples.describe()
    ))
}
