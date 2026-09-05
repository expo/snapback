use super::*;
use crate::schema::Constraint;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapConflict {
    pub table: String,
    pub by: Vec<String>,
    pub key: Vec<Value>,
    pub count: u64,
}

// @ref LLP 1017#25-successor-admission — validate EVERY cap after drops, from base rows.
pub(super) fn validate_caps(
    connection: &Connection,
    schema: &Schema,
) -> Result<Option<SuccessorRefusal>, RuntimeError> {
    let mut conflicts = Vec::new();
    let mut messages = Vec::new();
    let mut largest = 0;
    for (name, table) in &schema.tables {
        let caps: Vec<_> = table
            .constraints
            .iter()
            .filter_map(|c| match c {
                Constraint::Cap { by, max } => Some((by, max)),
                _ => None,
            })
            .collect();
        if caps.is_empty() {
            continue;
        }
        // Index entries have already been removed by a grouping-column migration.
        let rows = fetch_rows(connection, name)?;
        for (by, max) in caps {
            let mut counts = BTreeMap::<String, (Vec<Value>, u64)>::new();
            for row in &rows {
                let key = crate::cap::group_key(row, by);
                counts
                    .entry(canonical_json(&key))
                    .and_modify(|(_, n)| *n += 1)
                    .or_insert((key, 1));
            }
            let mut exceeded = 0;
            for (_, (key, count)) in counts {
                if count <= u64::from(*max) {
                    continue;
                }
                exceeded += 1;
                largest = largest.max(count);
                if conflicts.len() < 10 {
                    conflicts.push(CapConflict {
                        table: name.clone(),
                        by: by.clone(),
                        key,
                        count,
                    });
                }
            }
            if exceeded > 0 {
                messages.push(format!(
                    "cap {max} on {name} by {} is exceeded by {exceeded} group(s)",
                    by.join(", ")
                ));
            }
        }
    }
    Ok((!conflicts.is_empty()).then(|| SuccessorRefusal {
        code: "E_SUCCESSOR_CAP".to_owned(),
        message: messages.join("; "),
        rewrite: format!(
            "raise the cap to at least {largest}, or remove rows from the group, then retry"
        ),
        plan: MigrationPlan::default(),
        conflicts: Vec::new(),
        cap_conflicts: conflicts,
        narrowings: Vec::new(),
        site: None,
    }))
}
