use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrowingConflict {
    pub table: String,
    pub column: String,
    pub null_rows: u64,
    pub sample: Vec<String>,
}

// @ref LLP 1016#d4--expand-fill-contract — only removal of the outer optional wrapper is narrowing; retypes and changes inside lists remain destructive.
pub(super) fn is_narrowing(current: &ColumnType, next: &ColumnType) -> bool {
    matches!(current, ColumnType::Optional(inner) if inner.as_ref() == next
        && !matches!(next, ColumnType::Optional(_)))
}

pub(super) fn narrowing_refusal(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
) -> Result<Option<SuccessorRefusal>, RuntimeError> {
    for (table, previous) in &current.tables {
        let Some(successor) = next.tables.get(table) else {
            continue;
        };
        for (column, kind) in &previous.columns {
            if !successor
                .columns
                .get(column)
                .is_some_and(|next| is_narrowing(kind, next))
            {
                continue;
            }
            let mut null_rows = 0_u64;
            let mut sample = Vec::new();
            let mut statement = connection
                .prepare("SELECT row_id, data FROM rows WHERE table_name = ?1 ORDER BY row_id")?;
            let rows = statement.query_map([table], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (id, data) = row?;
                let value: Value = serde_json::from_str(&data)
                    .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
                if matches!(value.as_object()?.get(column), None | Some(Value::Null)) {
                    null_rows += 1;
                    if sample.len() < 10 {
                        sample.push(id);
                    }
                }
            }
            if null_rows > 0 {
                return Ok(Some(SuccessorRefusal {
                    code: "E_SUCCESSOR_NARROWING".to_owned(),
                    message: format!(
                        "{table}.{column} cannot become required: {null_rows} stored rows are null or absent; the fill-job rewrite is prose until J1b installs job grammar; use an operator mutation today"
                    ),
                    rewrite: format!(
                        "keep {table}.{column} optional and apply, then fill it:\njob fill_{table}_{column}:\n  chunk p in {table} first 100 by byId:\n    update {table}[p.id] {{ {column}: p.{column} ?? <value> }}\nthen declare it required and apply again"
                    ),
                    plan: MigrationPlan::default(),
                    conflicts: Vec::new(),
                    narrowing: Some(NarrowingConflict {
                        table: table.clone(),
                        column: column.clone(),
                        null_rows,
                        sample,
                    }),
                }));
            }
        }
    }
    Ok(None)
}
