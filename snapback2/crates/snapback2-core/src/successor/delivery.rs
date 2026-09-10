//! Custody through succession: a log is installed empty (or bootstrapped on
//! request), removed or retargeted only by a destructive plan, and its
//! audience bound may fall only when no stored audience needs it (LLP 1019 §2).
use super::*;
use crate::delivery::{self, Deliver};

fn same_custody(current: &Deliver, next: &Deliver) -> bool {
    current.target == next.target
        && current.prefix == next.prefix
        && current.principal == next.principal
        && current.log == next.log
}

fn row_count(connection: &Connection, table: &str) -> Result<u64, RuntimeError> {
    let rows: i64 = connection.query_row(
        "SELECT COUNT(*) FROM rows WHERE table_name = ?1",
        [table],
        |row| row.get(0),
    )?;
    Ok(rows.max(0) as u64)
}

// @ref LLP 1019#2-the-custody-log — custodial data is never silently dropped:
// removing or retargeting a declaration drops its log even when a same-named,
// same-shaped table survives in the successor.
/// Drops the ordinary table diff does not see: a log whose declaration left,
/// moved, or changed target, prefix, or principal.
pub(super) fn custody_drops(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
    already: &[Drop],
) -> Result<Vec<Drop>, RuntimeError> {
    let mut drops = Vec::new();
    for (content, _, current_deliver) in delivery::declarations(current) {
        let next_deliver = next
            .tables
            .get(content)
            .and_then(|table| table.deliver.as_ref());
        let mut dropped = Vec::new();
        match next_deliver {
            Some(next_deliver) if same_custody(current_deliver, next_deliver) => {
                if let Some(receipts) = current_deliver.receipts_table()
                    && !next_deliver.receipts
                {
                    dropped.push(receipts);
                }
            }
            _ => dropped.extend(current_deliver.generated()),
        }
        for name in dropped {
            let seen = |drop: &Drop| matches!(drop, Drop::Table { name: dropped, .. } if *dropped == name);
            if already.iter().any(seen) || drops.iter().any(seen) {
                continue;
            }
            let rows = row_count(connection, &name)?;
            drops.push(Drop::Table { name, rows });
        }
    }
    Ok(drops)
}

// @ref LLP 1019#4-certification — `A` persists independently of the target's
// current cap; lowering it needs historical-audience evidence, so the
// successor reads the stored audiences and refuses when one exceeds the
// declared bound.
/// `A` may only rise while a stored audience exceeds it.
pub(super) fn audience_refusal(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
) -> Result<Option<SuccessorRefusal>, RuntimeError> {
    for (content, _, current_deliver) in delivery::declarations(current) {
        let Some(next_deliver) = next
            .tables
            .get(content)
            .and_then(|table| table.deliver.as_ref())
        else {
            continue;
        };
        if !same_custody(current_deliver, next_deliver)
            || next_deliver.audience >= current_deliver.audience
        {
            continue;
        }
        let mut largest = 0i64;
        for_row_batches(connection, &current_deliver.log, |row| {
            if row.field("kind")?.as_str()? == "delivered" {
                largest = largest.max(row.field("audience")?.as_int()?);
            }
            Ok(())
        })?;
        if largest <= i64::from(next_deliver.audience) {
            continue;
        }
        let group = next
            .table(&next_deliver.target)
            .and_then(|target| delivery::group_cap(target, next_deliver.prefix.len()))
            .map(|(by, _)| by.join(", "))
            .unwrap_or_else(|| next_deliver.prefix.join(", "));
        return Ok(Some(SuccessorRefusal {
            code: "E_SUCCESSOR_AUDIENCE".to_owned(),
            message: format!(
                "{} holds a stored audience of {largest}; the audience bound may only rise while a stored audience exceeds it (declared {}, installed {})",
                current_deliver.log, next_deliver.audience, current_deliver.audience
            ),
            rewrite: format!(
                "keep cap {} by {group} on {} until no stored audience exceeds {}, or remove the deliver line (a destructive plan)",
                current_deliver.audience, next_deliver.target, next_deliver.audience
            ),
            site: Some(format!("schema.tables.{content}.deliver")),
            plan: MigrationPlan::default(),
            conflicts: Vec::new(),
            cap_conflicts: Vec::new(),
            narrowings: Vec::new(),
        }));
    }
    Ok(None)
}

fn commit_seq(transaction: &Transaction<'_>) -> Result<i64, RuntimeError> {
    let sequence: Option<i64> =
        transaction.query_row("SELECT MAX(seq) FROM _commits", [], |row| row.get(0))?;
    Ok(sequence.unwrap_or(0).max(0))
}

fn insert_engine_row(
    transaction: &Transaction<'_>,
    schema: &Schema,
    table: &str,
    row: Value,
) -> Result<(), RuntimeError> {
    let id = row.field("id")?.as_str()?.to_owned();
    transaction.execute(
        "INSERT INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)",
        params![table, id, canonical_json(&row)],
    )?;
    reindex_row(transaction, schema, table, &row)?;
    Ok(())
}

// @ref LLP 1019#2-the-custody-log — adding `deliver` to a table with rows
// installs an empty log unless the successor also says `bootstrap`, which
// approximates send-time audiences with current members and says so.
/// Fan out one `delivered` event per current target row per existing content
/// row for every log being installed with `bootstrap`; one line per log for
/// the successor report.
pub(super) fn bootstrap(
    transaction: &Transaction<'_>,
    current: &Schema,
    next: &Schema,
    at: i64,
) -> Result<Vec<String>, RuntimeError> {
    let mut lines = Vec::new();
    let seq = commit_seq(transaction)?;
    for (content, content_table, deliver) in delivery::declarations(next) {
        if !deliver.bootstrap {
            continue;
        }
        let installed = current
            .tables
            .get(content)
            .and_then(|table| table.deliver.as_ref())
            .is_some_and(|installed| same_custody(installed, deliver));
        if installed {
            continue;
        }
        let target = next
            .table(&deliver.target)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {}", deliver.target)))?;
        let (by, _) = delivery::group_cap(target, deliver.prefix.len())
            .ok_or_else(|| RuntimeError::Schema(format!("{} has no group cap", deliver.target)))?;
        let mut groups = BTreeMap::<String, BTreeSet<String>>::new();
        for_row_batches(transaction, &deliver.target, |mut row| {
            materialize_optional_fields(&mut row, target);
            let key = canonical_json(&crate::cap::group_key(&row, by));
            let principal = row.field(&deliver.principal)?.as_str()?.to_owned();
            groups.entry(key).or_default().insert(principal);
            Ok(())
        })?;
        let (mut rows, mut events) = (0u64, 0u64);
        for_row_batches(transaction, content, |mut row| {
            materialize_optional_fields(&mut row, content_table);
            rows += 1;
            let key = canonical_json(&crate::cap::group_key(&row, &deliver.prefix));
            let Some(principals) = groups.get(&key) else {
                return Ok(());
            };
            let audience = principals.len() as i64;
            for principal in principals {
                let event =
                    delivery::event_row(&row, deliver, principal, "delivered", seq, audience, seq, at)?;
                insert_engine_row(transaction, next, &deliver.log, event)?;
                events += 1;
            }
            Ok(())
        })?;
        lines.push(format!(
            "{}: {events} delivered event(s) over {rows} {content} row(s) to current {} members; bootstrap approximates send-time audiences",
            deliver.log, deliver.target
        ));
    }
    Ok(lines)
}
