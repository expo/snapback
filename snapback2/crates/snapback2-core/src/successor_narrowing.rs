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
    let mut conflicts = Vec::new();
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
                let value: Value = match serde_json::from_str(&data) {
                    Ok(value) => value,
                    Err(error) => {
                        return Ok(Some(SuccessorRefusal::invalid_row(table, &id, error)));
                    }
                };
                let object = match value.as_object() {
                    Ok(object) => object,
                    Err(error) => {
                        return Ok(Some(SuccessorRefusal::invalid_row(table, &id, error)));
                    }
                };
                if matches!(object.get(column), None | Some(Value::Null)) {
                    null_rows += 1;
                    if sample.len() < 10 {
                        sample.push(id);
                    }
                }
            }
            if null_rows > 0 {
                conflicts.push(NarrowingConflict {
                    table: table.clone(),
                    column: column.clone(),
                    null_rows,
                    sample,
                });
            }
        }
    }
    if conflicts.is_empty() {
        return Ok(None);
    }
    let message = conflicts
        .iter()
        .map(|c| {
            format!(
                "{}.{} cannot become required: {} stored rows are null or absent",
                c.table, c.column, c.null_rows
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    let rewrite = conflicts.iter().map(|c| {
        let (table, column) = (&c.table, &c.column);
        let ty = quarry_type(&next.tables[table].columns[column]);
        // @ref LLP 1016#d4--expand-fill-contract — the refusal pastes a runnable fill job; the replacement value is its typed argument.
        format!("-- keep {table}.{column} optional and apply, then fill it:\njob fill_{table}_{column}(value: {ty}):\n  chunk p in {table} first 100 by byId:\n    update {table}[p.id] {{ {column}: p.{column} ?? value }}")
    }).collect::<Vec<_>>().join("\n\n");
    Ok(Some(SuccessorRefusal {
        code: "E_SUCCESSOR_NARROWING".to_owned(),
        message: format!(
            "{message}; fill the optional column with the pasted job, then declare it required and apply again"
        ),
        rewrite,
        site: None,
        plan: MigrationPlan::default(),
        conflicts: Vec::new(),
        cap_conflicts: Vec::new(),
        narrowings: conflicts,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Store, public_table};

    #[test]
    fn narrowing_rewrite_preserves_once_column_custody() {
        let image = ColumnType::Image {
            max: 100,
            once: true,
        };
        assert_eq!(quarry_type(&image), "image <=100 once");
        assert_eq!(
            quarry_type(&ColumnType::Optional(Box::new(image.clone()))),
            "image <=100 once ?"
        );
        assert_eq!(
            quarry_type(&ColumnType::List {
                of: Box::new(image),
                max: 4
            }),
            "[image <=100 once] <=4"
        );
    }

    /// The paste is pinned to the compiler fixture that lowers it (`quarry-job-checks.ts`), so the
    /// text this refusal prints and the text the compiler accepts cannot drift apart.
    #[test]
    fn narrowing_rewrite_is_the_fixture_the_compiler_lowers_including_enum_quoting() {
        let store = Store::memory().unwrap();
        let mut current = Schema::default();
        current.tables.insert(
            "profiles".into(),
            public_table(
                BTreeMap::from([
                    ("id".into(), ColumnType::Id),
                    (
                        "avatarUrl".into(),
                        ColumnType::Optional(Box::new(ColumnType::Text { max: 2048 })),
                    ),
                    (
                        "tier".into(),
                        ColumnType::Optional(Box::new(ColumnType::Enum {
                            variants: vec!["free".into(), "pro".into()],
                        })),
                    ),
                ]),
                BTreeMap::new(),
            ),
        );
        let mut next = current.clone();
        let columns = &mut next.tables.get_mut("profiles").unwrap().columns;
        columns.insert("avatarUrl".into(), ColumnType::Text { max: 2048 });
        columns.insert(
            "tier".into(),
            ColumnType::Enum {
                variants: vec!["free".into(), "pro".into()],
            },
        );
        let stored = crate::value::canonical_json(&Value::Row(
            BTreeMap::from([("id".to_owned(), Value::Id("p1".into()))]).into(),
        ));
        store
            .conn
            .execute(
                "INSERT INTO rows(table_name, row_id, data) VALUES ('profiles', 'p1', ?1)",
                [stored],
            )
            .unwrap();
        let refusal = narrowing_refusal(&store.conn, &current, &next)
            .unwrap()
            .unwrap();
        assert_eq!(refusal.code, "E_SUCCESSOR_NARROWING");
        let fixture =
            include_str!("../../../packages/compiler/fixtures/quarry-jobs/snapback/narrowing.q");
        assert_eq!(format!("{}\n", refusal.rewrite), fixture);
        assert_eq!(
            quarry_type(&ColumnType::Enum {
                variants: vec!["it's".into()]
            }),
            "enum('it\\'s')"
        );
    }

    #[test]
    fn narrowing_malformed_stored_row_has_the_successor_row_invalid_refusal() {
        let store = Store::memory().unwrap();
        let mut current = Schema::default();
        current.tables.insert(
            "items".into(),
            public_table(
                BTreeMap::from([
                    ("id".into(), ColumnType::Id),
                    (
                        "value".into(),
                        ColumnType::Optional(Box::new(ColumnType::Int)),
                    ),
                ]),
                BTreeMap::new(),
            ),
        );
        let mut next = current.clone();
        next.tables
            .get_mut("items")
            .unwrap()
            .columns
            .insert("value".into(), ColumnType::Int);
        for data in [
            "not-json".to_owned(),
            crate::value::canonical_json(&Value::Int(7)),
        ] {
            store.conn.execute("INSERT OR REPLACE INTO rows(table_name, row_id, data) VALUES ('items', 'bad', ?1)", [data]).unwrap();
            let refusal = narrowing_refusal(&store.conn, &current, &next)
                .unwrap()
                .unwrap();
            assert_eq!(refusal.code, "E_SUCCESSOR_ROW_INVALID");
            assert_eq!(refusal.site.as_deref(), Some("items.bad"));
            assert!(refusal.message.contains("items.bad"));
            assert!(
                refusal
                    .rewrite
                    .contains("repair or remove stored row items.bad")
            );
        }
    }
}

fn quarry_type(kind: &ColumnType) -> String {
    match kind {
        ColumnType::Id => "id".into(),
        ColumnType::Principal => "principal".into(),
        ColumnType::Ref { table } => table.clone(),
        ColumnType::Text { max } => format!("text <={max}"),
        ColumnType::Int => "int".into(),
        ColumnType::Time => "time".into(),
        ColumnType::Bool => "bool".into(),
        ColumnType::Bytes { max } => format!("bytes <={max}"),
        ColumnType::Json { max_bytes } => format!("json <={max_bytes}"),
        ColumnType::Image { max, once } => {
            format!("image <={max}{}", if *once { " once" } else { "" })
        }
        ColumnType::Video { max } => format!("video <={max}"),
        ColumnType::Decimal { scale } => format!("decimal {scale}"),
        ColumnType::Money { currency, scale } => format!("money {currency} {scale}"),
        ColumnType::Enum { variants } => crate::jobs::quarry_enum(variants),
        ColumnType::Optional(inner) => format!("{} ?", quarry_type(inner)),
        ColumnType::List { of, max } => format!("[{}] <={max}", quarry_type(of)),
    }
}
