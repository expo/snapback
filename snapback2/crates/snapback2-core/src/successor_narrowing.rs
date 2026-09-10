use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrowingConflict {
    pub table: String,
    pub column: String,
    pub null_rows: u64,
    pub affected_rows: u64,
    pub removed_cases: Vec<String>,
    pub sample: Vec<String>,
}

// @ref LLP 1020#a2-enum-case-removal-is-checked-narrowing — enum removals compose
// through wrappers; optional-to-required keeps LLP 1016's outer-wrapper scope.
pub(super) fn is_narrowing(current: &ColumnType, next: &ColumnType) -> bool {
    if widens(current, next) {
        return false;
    }
    match (current, next) {
        (ColumnType::Optional(a), b) if !matches!(b, ColumnType::Optional(_)) => {
            widens(a, b) || enum_compatible(a, b)
        }
        _ => enum_compatible(current, next),
    }
}

fn enum_compatible(current: &ColumnType, next: &ColumnType) -> bool {
    match (current, next) {
        (ColumnType::Enum { .. }, ColumnType::Enum { .. }) => true,
        (ColumnType::Optional(a), ColumnType::Optional(b)) => enum_compatible(a, b),
        (a, ColumnType::Optional(b)) if !matches!(a, ColumnType::Optional(_)) => {
            enum_compatible(a, b)
        }
        (ColumnType::List { of: a, max: am }, ColumnType::List { of: b, max: bm }) => {
            am <= bm && enum_compatible(a, b)
        }
        _ => false,
    }
}

fn removed_cases(current: &ColumnType, next: &ColumnType) -> Vec<String> {
    match (current, next) {
        (ColumnType::Optional(a), b) => removed_cases(a, b),
        (a, ColumnType::Optional(b)) => removed_cases(a, b),
        (ColumnType::List { of: a, .. }, ColumnType::List { of: b, .. }) => removed_cases(a, b),
        (ColumnType::Enum { variants: a }, ColumnType::Enum { variants: b }) => {
            a.iter().filter(|v| !b.contains(v)).cloned().collect()
        }
        _ => vec![],
    }
}

fn contains_removed(value: &Value, removed: &[String]) -> bool {
    match value {
        Value::String(s) => removed.contains(s),
        Value::Array(items) => items.iter().any(|v| contains_removed(v, removed)),
        _ => false,
    }
}

pub(super) fn checked_narrowings(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
    owned: &OwnedIds,
) -> Result<Vec<NarrowingConflict>, RuntimeError> {
    let mut checks = Vec::new();
    for (table, previous) in &current.tables {
        let Some(successor) = next.tables.get(table) else {
            continue;
        };
        for (column, kind) in &previous.columns {
            let Some(next_kind) = successor
                .columns
                .get(column)
                .filter(|n| is_narrowing(kind, n))
            else {
                continue;
            };
            let mut check = NarrowingConflict {
                table: table.clone(),
                column: column.clone(),
                null_rows: 0,
                affected_rows: 0,
                removed_cases: removed_cases(kind, next_kind),
                sample: Vec::new(),
            };
            let required = matches!(kind, ColumnType::Optional(_))
                && !matches!(next_kind, ColumnType::Optional(_));
            let mut statement = connection
                .prepare("SELECT row_id, data FROM rows WHERE table_name = ?1 ORDER BY row_id")?;
            let rows = statement.query_map([table], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (id, data) = row?;
                if owned.get(table).is_some_and(|ids| ids.contains(&id)) {
                    continue;
                }
                let value: Value = serde_json::from_str(&data).map_err(|e| {
                    RuntimeError::Successor(Box::new(SuccessorRefusal::invalid_row(table, &id, e)))
                })?;
                let object = value.as_object().map_err(|e| {
                    RuntimeError::Successor(Box::new(SuccessorRefusal::invalid_row(table, &id, e)))
                })?;
                let value = object.get(column).unwrap_or(&Value::Null);
                let null = required && *value == Value::Null;
                if null {
                    check.null_rows += 1;
                }
                if null || contains_removed(value, &check.removed_cases) {
                    check.affected_rows += 1;
                    if check.sample.len() < 10 {
                        check.sample.push(id);
                    }
                }
            }
            checks.push(check);
        }
    }
    Ok(checks)
}

pub(super) fn narrowing_refusal(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
    owned: &OwnedIds,
) -> Result<Option<SuccessorRefusal>, RuntimeError> {
    let checks = match checked_narrowings(connection, current, next, owned) {
        Ok(checks) => checks,
        Err(RuntimeError::Successor(e)) => return Ok(Some(*e)),
        Err(e) => return Err(e),
    };
    if checks.iter().all(|c| c.affected_rows == 0) {
        return Ok(None);
    }
    let conflicts = checks
        .iter()
        .filter(|c| c.affected_rows > 0)
        .collect::<Vec<_>>();
    let message = conflicts
        .iter()
        .map(|c| {
            if c.removed_cases.is_empty() {
                format!(
                    "{}.{} cannot become required: {} stored rows are null or absent",
                    c.table, c.column, c.null_rows
                )
            } else {
                format!(
                    "{}.{} removes cases {:?}: {} affected rows ({} null or absent)",
                    c.table, c.column, c.removed_cases, c.affected_rows, c.null_rows
                )
            }
        })
        .collect::<Vec<_>>()
        .join("; ");
    let rewrite = conflicts.iter().map(|c| {
        let (table, column) = (&c.table, &c.column);
        if !c.removed_cases.is_empty() {
            return removal_job(c, &current.tables[table].columns[column]);
        }
        let ty = quarry_type(&next.tables[table].columns[column]);
        // @ref LLP 1016#d4--expand-fill-contract — the replacement is a typed job argument.
        format!("-- keep {table}.{column} optional and apply, then fill it:\njob fill_{table}_{column}(value: {ty}):\n  chunk p in {table} first 100 by byId:\n    update {table}[p.id] {{ {column}: p.{column} ?? value }}")
    }).collect::<Vec<_>>().join("\n\n");
    Ok(Some(SuccessorRefusal {
        from: String::new(),
        to: String::new(),
        code: "E_SUCCESSOR_NARROWING".to_owned(),
        message: format!(
            "{message}; run the pasted job under the predecessor schema, then apply again"
        ),
        rewrite,
        site: conflicts
            .first()
            .map(|c| format!("schema.tables.{}.columns.{}", c.table, c.column)),
        plan: MigrationPlan::default(),
        conflicts: Vec::new(),
        cap_conflicts: Vec::new(),
        narrowings: checks,
    }))
}

fn removal_job(c: &NarrowingConflict, predecessor: &ColumnType) -> String {
    let (table, column) = (&c.table, &c.column);
    let quote = |text: &str| format!("'{}'", text.replace('\\', "\\\\").replace('\'', "\\'"));
    if !holds_list(predecessor) {
        // A scalar case compares directly, so one bounded sweep repairs every affected row.
        let deletes = c
            .removed_cases
            .iter()
            .map(|case| format!("    if p.{column} = {}:\n      delete {table}[p.id]", quote(case)))
            .collect::<Vec<_>>()
            .join("\n");
        return format!(
            "-- keep the predecessor schema; this deletes every row holding a removed case.\n-- To map instead, replace each delete with: update {table}[p.id] {{ {column}: <kept case> }}\njob remove_{table}_{column}():\n  chunk p in {table} first 100 by byId:\n{deletes}"
        );
    }
    // Quarry bindings are lexical: a flag set inside nested list loops cannot reach an
    // outer delete, so each sampled id gets its own exact, independently bounded sweep.
    let sweeps = c
        .sample
        .iter()
        .enumerate()
        .map(|(i, id)| format!("  chunk p{i} in {table}[{}] first 1 by byId:\n    delete {table}[p{i}.id]", quote(id)))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "-- keep the predecessor schema; review deletion of these sampled rows.\n-- Retry narrowing after this job; if more affected rows remain, run its next sample job.\njob remove_{table}_{column}():\n{sweeps}"
    )
}

fn holds_list(kind: &ColumnType) -> bool {
    match kind {
        ColumnType::List { .. } => true,
        ColumnType::Optional(inner) => holds_list(inner),
        _ => false,
    }
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
        let refusal = narrowing_refusal(&store.conn, &current, &next, &OwnedIds::new())
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
            let refusal = narrowing_refusal(&store.conn, &current, &next, &OwnedIds::new())
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
