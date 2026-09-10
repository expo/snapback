use super::*;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrowingConflict {
    pub table: String,
    pub column: String,
    pub null_rows: u64,
    /// Rows whose stored value exceeds a lowered `text`, `bytes`, or list maximum.
    #[serde(default)]
    pub oversize_rows: u64,
    pub affected_rows: u64,
    pub removed_cases: Vec<String>,
    pub sample: Vec<String>,
}

// @ref LLP 1020#a2-enum-case-removal-is-checked-narrowing — enum removals and lowered
// text/bytes/list maxima compose through wrappers (the fix-round r1 ruling: a smaller
// maximum is checked like a removed case, never a retype that clears values);
// optional-to-required keeps LLP 1016's outer-wrapper scope.
pub(super) fn is_narrowing(current: &ColumnType, next: &ColumnType) -> bool {
    if widens(current, next) {
        return false;
    }
    match (current, next) {
        (ColumnType::Optional(a), b) if !matches!(b, ColumnType::Optional(_)) => {
            widens(a, b) || checked(a, b)
        }
        _ => checked(current, next),
    }
}

/// Domain changes the successor checks against stored values instead of clearing them.
fn checked(current: &ColumnType, next: &ColumnType) -> bool {
    match (current, next) {
        (ColumnType::Enum { .. }, ColumnType::Enum { .. })
        | (ColumnType::Text { .. }, ColumnType::Text { .. })
        | (ColumnType::Bytes { .. }, ColumnType::Bytes { .. }) => true,
        (ColumnType::Optional(a), ColumnType::Optional(b)) => checked(a, b),
        (a, ColumnType::Optional(b)) if !matches!(a, ColumnType::Optional(_)) => checked(a, b),
        (ColumnType::List { of: a, .. }, ColumnType::List { of: b, .. }) => {
            widens(a, b) || checked(a, b)
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

fn lowers_maximum(current: &ColumnType, next: &ColumnType) -> bool {
    match (current, next) {
        (ColumnType::Optional(a), b) => lowers_maximum(a, b),
        (a, ColumnType::Optional(b)) => lowers_maximum(a, b),
        (ColumnType::List { of: a, max: am }, ColumnType::List { of: b, max: bm }) => {
            bm < am || lowers_maximum(a, b)
        }
        (ColumnType::Text { max: a }, ColumnType::Text { max: b })
        | (ColumnType::Bytes { max: a }, ColumnType::Bytes { max: b }) => b < a,
        _ => false,
    }
}

fn contains_removed(value: &Value, removed: &[String]) -> bool {
    match value {
        Value::String(s) => removed.contains(s),
        Value::Array(items) => items.iter().any(|v| contains_removed(v, removed)),
        _ => false,
    }
}

/// A stored value larger than the successor's maximum at any depth.
fn exceeds(value: &Value, next: &ColumnType) -> bool {
    match (next, value) {
        (ColumnType::Optional(inner), value) => exceeds(value, inner),
        (ColumnType::List { of, max }, Value::Array(items)) => {
            items.len() > *max as usize || items.iter().any(|item| exceeds(item, of))
        }
        (ColumnType::Text { max }, Value::String(text)) => text.chars().count() > *max as usize,
        (ColumnType::Bytes { max }, Value::Bytes(bytes)) => bytes.len() > *max as usize,
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
                oversize_rows: 0,
                affected_rows: 0,
                removed_cases: removed_cases(kind, next_kind),
                sample: Vec::new(),
            };
            let required = matches!(kind, ColumnType::Optional(_))
                && !matches!(next_kind, ColumnType::Optional(_));
            // A sampled repair fills nulls separately. Keep them out of its delete set;
            // pure optional-to-required checks still sample nulls for their fill diagnostic.
            let sample_nulls = check.removed_cases.is_empty() && !lowers_maximum(kind, next_kind);
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
                let oversize = exceeds(value, next_kind);
                if oversize {
                    check.oversize_rows += 1;
                }
                if null || oversize || contains_removed(value, &check.removed_cases) {
                    check.affected_rows += 1;
                    if check.sample.len() < 10 && (!null || sample_nulls) {
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
            if c.removed_cases.is_empty() && c.oversize_rows == 0 {
                return format!(
                    "{}.{} cannot become required: {} stored rows are null or absent",
                    c.table, c.column, c.null_rows
                );
            }
            let what = match (!c.removed_cases.is_empty(), c.oversize_rows > 0) {
                (true, true) => format!("removes cases {:?} and lowers its maximum", c.removed_cases),
                (true, false) => format!("removes cases {:?}", c.removed_cases),
                _ => "lowers its maximum".to_owned(),
            };
            let over = if c.oversize_rows > 0 {
                format!(", {} over the new maximum", c.oversize_rows)
            } else {
                String::new()
            };
            format!(
                "{}.{} {what}: {} affected rows remain ({} null or absent{over})",
                c.table, c.column, c.affected_rows, c.null_rows
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    let rewrite = conflicts
        .iter()
        .map(|c| {
            repair_job(
                c,
                &current.tables[&c.table].columns[&c.column],
                &next.tables[&c.table].columns[&c.column],
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
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

fn quote(text: &str) -> String {
    format!("'{}'", text.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn scalar_text_max(kind: &ColumnType) -> Option<u32> {
    match kind {
        ColumnType::Text { max } => Some(*max),
        ColumnType::Optional(inner) => scalar_text_max(inner),
        _ => None,
    }
}

/// The fill argument's type: the successor's domain restricted to what the predecessor
/// schema — which the pasted job runs under — also accepts. Enum cases in both survive
/// (a smaller maximum is already accepted there); `None` when no case survives, so the
/// job needs the widening applied first.
fn fill_type(predecessor: &ColumnType, successor: &ColumnType) -> Option<String> {
    match (predecessor, successor) {
        (ColumnType::Optional(a), b) => fill_type(a, b),
        (a, ColumnType::Optional(b)) => fill_type(a, b).map(|t| format!("{t} ?")),
        (ColumnType::Enum { variants: a }, ColumnType::Enum { variants: b }) => {
            let kept = b.iter().filter(|v| a.contains(v)).cloned().collect::<Vec<_>>();
            (!kept.is_empty()).then(|| crate::jobs::quarry_enum(&kept))
        }
        // A raised maximum beside a narrowing is not accepted by the predecessor: the
        // argument takes the smaller bound of the two.
        (ColumnType::List { of: a, max: m }, ColumnType::List { of: b, max: n }) => {
            fill_type(a, b).map(|t| format!("[{t}] <={}", (*m).min(*n)))
        }
        (ColumnType::Text { max: m }, ColumnType::Text { max: n }) => Some(format!("text <={}", (*m).min(*n))),
        (ColumnType::Bytes { max: m }, ColumnType::Bytes { max: n }) => Some(format!("bytes <={}", (*m).min(*n))),
        (ColumnType::Json { max_bytes: m }, ColumnType::Json { max_bytes: n }) => Some(format!("json <={}", (*m).min(*n))),
        (_, b) => Some(quarry_type(b)),
    }
}

/// The pasted repair for one conflict, written against the predecessor schema. It is one
/// whole-table sweep whenever the check is one statement per row (`=` on a scalar case,
/// one `.length` on the outer list, `slice` on scalar text). Values inside lists would
/// need a `for` whose repeated `delete` of one row the engine refuses (and whose fan-out
/// the certificate multiplies past the write ceiling), and `bytes` cannot be measured,
/// so those jobs delete the sampled rows and are rerun until the count is zero.
fn repair_job(c: &NarrowingConflict, predecessor: &ColumnType, successor: &ColumnType) -> String {
    let (table, column) = (&c.table, &c.column);
    let required = matches!(predecessor, ColumnType::Optional(_))
        && !matches!(successor, ColumnType::Optional(_));
    let lowered = lowers_maximum(predecessor, successor);
    // @ref LLP 1020#a2-enum-case-removal-is-checked-narrowing — the argument is typed by
    // what BOTH schemas accept: the job runs under the predecessor. When no case survives
    // both, the paste says to apply the widening first, so it compiles where it runs.
    let (ty, stage) = match fill_type(predecessor, successor) {
        Some(ty) => (ty, ""),
        None => (
            quarry_type(successor),
            "-- first add the successor's cases to this declaration and apply (a widening), so this job compiles there.\n",
        ),
    };
    if c.removed_cases.is_empty() && !lowered {
        // @ref LLP 1016#d4--expand-fill-contract — the replacement is a typed job argument.
        return format!(
            "{stage}-- keep {table}.{column} optional and apply, then fill it:\njob fill_{table}_{column}(value: {ty}):\n  chunk p in {table} first 100 by byId:\n    update {table}[p.id] {{ {column}: p.{column} ?? value }}"
        );
    }
    let argument = if required { format!("value: {ty}") } else { String::new() };
    if c.removed_cases.is_empty()
        && let (Some(from), Some(to)) = (scalar_text_max(predecessor), scalar_text_max(successor))
        && to < from
    {
        let fills = if required { " and fills null or absent values" } else { "" };
        let update = if required {
            format!("    update {table}[p.id] {{ {column}: slice(p.{column} ?? value, 0, {to}) }}")
        } else if matches!(predecessor, ColumnType::Optional(_)) {
            format!("    if p.{column} != null:\n      update {table}[p.id] {{ {column}: slice(p.{column}, 0, {to}) }}")
        } else {
            format!("    update {table}[p.id] {{ {column}: slice(p.{column}, 0, {to}) }}")
        };
        let text = if matches!(predecessor, ColumnType::Optional(_)) {
            format!("(p.{column} ?? '')")
        } else {
            format!("p.{column}")
        };
        return format!(
            "-- keep the predecessor schema; this truncates every {table}.{column} to {to} characters{fills}.\n-- To delete only over-long rows, keep any null fill and replace truncation with:\n-- if {text} != slice({text}, 0, {to}):\n--   delete {table}[p.id]\njob shrink_{table}_{column}({argument}):\n  chunk p in {table} first 100 by byId:\n{update}"
        );
    }
    let name = if c.removed_cases.is_empty() { "shrink" } else { "remove" };
    let fill = if required {
        format!("    if p.{column} = null:\n      update {table}[p.id] {{ {column}: value }}\n")
    } else {
        String::new()
    };
    if let Some(lines) = sweep_lines(
        &format!("p.{column}"),
        matches!(predecessor, ColumnType::Optional(_)),
        predecessor,
        successor,
        &c.removed_cases,
        table,
    ) {
        let what = match (!c.removed_cases.is_empty(), lowered) {
            (true, true) => "holding a removed case or over the new maximum",
            (true, false) => "holding a removed case",
            _ => "over the new maximum",
        };
        let fills = if required { "; null or absent values become the job's argument" } else { "" };
        let kept = if lowered { "<kept value>" } else { "<kept case>" };
        let body = lines
            .into_iter()
            .map(|(depth, text)| format!("{}{text}", "  ".repeat(depth + 2)))
            .collect::<Vec<_>>()
            .join("\n");
        return format!(
            "{stage}-- keep the predecessor schema; this deletes every row {what}{fills}.\n-- To map instead, replace each delete with: update {table}[p.id] {{ {column}: {kept} }}\njob {name}_{table}_{column}({argument}):\n  chunk p in {table} first 100 by byId:\n{fill}{body}"
        );
    }
    // No single statement can check this value, so each sampled id gets its own exact,
    // independently bounded sweep; the refusal counts the rows that remain.
    let fill = if required {
        format!("  chunk p in {table} first 100 by byId:\n    if p.{column} = null:\n      update {table}[p.id] {{ {column}: value }}\n")
    } else {
        String::new()
    };
    let sweeps = c
        .sample
        .iter()
        .enumerate()
        .map(|(i, id)| format!("  chunk p{i} in {table}[{}] first 1 by byId:\n    delete {table}[p{i}.id]", quote(id)))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "{stage}-- keep the predecessor schema; this deletes the sampled rows (no one sweep can check values inside lists or bytes).\n-- Apply again after this job: the refusal counts the rows that remain; rerun its next sample job until that count is zero.\njob {name}_{table}_{column}({argument}):\n{fill}{sweeps}"
    )
}

/// Statements, as (relative depth, text), that delete the current row when the value at
/// `expr` leaves the successor's domain; `None` when no single statement can check it.
fn sweep_lines(
    expr: &str,
    optional: bool,
    predecessor: &ColumnType,
    successor: &ColumnType,
    removed: &[String],
    table: &str,
) -> Option<Vec<(usize, String)>> {
    let delete = |depth: usize| (depth + 1, format!("delete {table}[p.id]"));
    match (predecessor, successor) {
        (ColumnType::Optional(a), ColumnType::Optional(b)) => {
            sweep_lines(expr, true, a, b, removed, table)
        }
        (ColumnType::Optional(a), b) => sweep_lines(expr, true, a, b, removed, table),
        (a, ColumnType::Optional(b)) => sweep_lines(expr, optional, a, b, removed, table),
        (ColumnType::List { of: a, max: am }, ColumnType::List { of: b, max: bm }) => {
            // A check on the items needs a `for` that may delete one row twice (refused
            // as NOT_FOUND) and is priced per item per maintain; only the outer length
            // is one statement.
            if !removed.is_empty() || lowers_maximum(a, b) {
                return None;
            }
            let mut lines = Vec::new();
            if bm < am {
                let list = if optional { format!("({expr} ?? [])") } else { expr.to_owned() };
                lines.push((0, format!("if {list}.length > {bm}:")));
                lines.push(delete(0));
            }
            Some(lines)
        }
        (ColumnType::Enum { .. }, ColumnType::Enum { .. }) => Some(
            removed
                .iter()
                .flat_map(|case| [(0, format!("if {expr} = {}:", quote(case))), delete(0)])
                .collect(),
        ),
        (ColumnType::Text { max: a }, ColumnType::Text { max: b })
        | (ColumnType::Bytes { max: a }, ColumnType::Bytes { max: b }) => {
            (b >= a).then(Vec::new)
        }
        _ => Some(Vec::new()),
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
    /// The fill argument is typed by the cases both schemas accept: the job runs under the
    /// predecessor, which does not know the successor's new cases (review `succ-r6-codex`).
    #[test]
    fn a_mixed_enum_change_types_its_fill_by_the_cases_both_schemas_accept() {
        let conflict = |removed: Vec<&str>| NarrowingConflict {
            table: "items".into(),
            column: "value".into(),
            removed_cases: removed.into_iter().map(String::from).collect(),
            ..NarrowingConflict::default()
        };
        let enum_of = |cases: &[&str]| ColumnType::Enum { variants: cases.iter().map(|c| (*c).to_owned()).collect() };
        let optional = |inner: ColumnType| ColumnType::Optional(Box::new(inner));
        // enum('a','b')? -> enum('b','c'): 'b' is in both; the paste compiles under the predecessor.
        let paste = repair_job(&conflict(vec!["a"]), &optional(enum_of(&["a", "b"])), &enum_of(&["b", "c"]));
        assert!(paste.contains("job remove_items_value(value: enum('b')):"), "{paste}");
        assert!(!paste.contains("first add the successor's cases"), "{paste}");
        // enum('a')? -> enum('c'): nothing survives both; the paste says to widen first.
        let paste = repair_job(&conflict(vec!["a"]), &optional(enum_of(&["a"])), &enum_of(&["c"]));
        assert!(paste.starts_with("-- first add the successor's cases to this declaration and apply (a widening)"), "{paste}");
        assert!(paste.contains("job remove_items_value(value: enum('c')):"), "{paste}");
        // [enum('a','b')] <=3 ? -> [enum('b','c')] <=3: the list fill keeps the shared case.
        let paste = repair_job(
            &conflict(vec!["a"]),
            &optional(ColumnType::List { of: Box::new(enum_of(&["a", "b"])), max: 3 }),
            &ColumnType::List { of: Box::new(enum_of(&["b", "c"])), max: 3 },
        );
        assert!(paste.contains("(value: [enum('b')] <=3):"), "{paste}");
        // [enum('a','b')] <=2 ? -> [enum('b','c')] <=3: the raised maximum is not the predecessor's.
        let paste = repair_job(
            &conflict(vec!["a"]),
            &optional(ColumnType::List { of: Box::new(enum_of(&["a", "b"])), max: 2 }),
            &ColumnType::List { of: Box::new(enum_of(&["b", "c"])), max: 3 },
        );
        assert!(paste.contains("(value: [enum('b')] <=2):"), "{paste}");
        // text <=10 ? -> text <=20: a widening that becomes required fills within the predecessor's bound.
        let paste = repair_job(&conflict(vec![]), &optional(ColumnType::Text { max: 10 }), &ColumnType::Text { max: 20 });
        assert!(paste.contains("job fill_items_value(value: text <=10):"), "{paste}");
        // A widening that also becomes required fills with the cases the predecessor knows.
        let paste = repair_job(&conflict(vec![]), &optional(enum_of(&["a"])), &enum_of(&["a", "b"]));
        assert!(paste.contains("job fill_items_value(value: enum('a')):"), "{paste}");
    }
    /// One conflict may need two repairs (nulls and a removed case) or a truncation; both
    /// pastes are pinned to the fixture the compiler lowers (`repairs.q`).
    #[test]
    fn combined_and_truncating_repairs_are_the_fixture_the_compiler_lowers() {
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
        columns.insert(
            "avatarUrl".into(),
            ColumnType::Optional(Box::new(ColumnType::Text { max: 100 })),
        );
        columns.insert(
            "tier".into(),
            ColumnType::Enum {
                variants: vec!["free".into()],
            },
        );
        for (id, fields) in [
            ("p1", vec![]),
            ("p2", vec![("tier", Value::String("pro".into()))]),
            ("p3", vec![("avatarUrl", Value::String("x".repeat(150)))]),
        ] {
            let mut row = BTreeMap::from([("id".to_owned(), Value::Id(id.into()))]);
            for (name, value) in fields {
                row.insert(name.to_owned(), value);
            }
            store
                .conn
                .execute(
                    "INSERT INTO rows(table_name, row_id, data) VALUES ('profiles', ?1, ?2)",
                    [id.to_owned(), crate::value::canonical_json(&Value::Row(row.into()))],
                )
                .unwrap();
        }
        let refusal = narrowing_refusal(&store.conn, &current, &next, &OwnedIds::new())
            .unwrap()
            .unwrap();
        assert_eq!(refusal.code, "E_SUCCESSOR_NARROWING");
        let fixture =
            include_str!("../../../packages/compiler/fixtures/quarry-jobs/snapback/repairs.q");
        assert_eq!(format!("{}\n", refusal.rewrite), fixture);
        let avatar = &refusal.narrowings[0];
        assert_eq!((avatar.oversize_rows, avatar.affected_rows, avatar.null_rows), (1, 1, 0));
        let tier = &refusal.narrowings[1];
        assert_eq!((tier.null_rows, tier.affected_rows, tier.oversize_rows), (2, 3, 0));
        assert_eq!(tier.removed_cases, ["pro"]);
        assert!(
            refusal.message.contains(
                "profiles.tier removes cases [\"pro\"]: 3 affected rows remain (2 null or absent)"
            ) && refusal.message.contains(
                "profiles.avatarUrl lowers its maximum: 1 affected rows remain (0 null or absent, 1 over the new maximum)"
            ),
            "{}",
            refusal.message
        );
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
