//! Custody through succession: a log is installed empty (or bootstrapped on
//! request, within a fixed bound), removed or retargeted only by a destructive
//! plan, and its audience bound `A` is recomputed and recorded at every
//! installation (LLP 1019 §2, §4).
use super::*;
use crate::delivery::{self, Deliver};

/// How many `for_row_batches` source batches one bootstrap may write as
/// events inside the installation transaction.
pub const BOOTSTRAP_BATCHES: u64 = 64;

/// The most `delivered` events one installation may write: the successor's
/// row batch (`ROW_BATCH`) times `BOOTSTRAP_BATCHES`.
pub fn bootstrap_bound() -> u64 {
    ROW_BATCH as u64 * BOOTSTRAP_BATCHES
}

fn same_custody(current: &Deliver, next: &Deliver) -> bool {
    current.target == next.target
        && current.prefix == next.prefix
        && current.principal == next.principal
        && current.log == next.log
}

/// Whether `content`'s declaration in `next` is already installed under `current`.
fn installed(current: &Schema, content: &str, deliver: &Deliver) -> bool {
    current
        .tables
        .get(content)
        .and_then(|table| table.deliver.as_ref())
        .is_some_and(|installed| same_custody(installed, deliver))
}

fn row_count(connection: &Connection, table: &str) -> Result<u64, RuntimeError> {
    let rows: i64 = connection.query_row(
        "SELECT COUNT(*) FROM rows WHERE table_name = ?1",
        [table],
        |row| row.get(0),
    )?;
    Ok(rows.max(0) as u64)
}

fn group_cap(schema: &Schema, deliver: &Deliver) -> Result<u32, RuntimeError> {
    let target = schema
        .table(&deliver.target)
        .ok_or_else(|| RuntimeError::Schema(format!("missing table {}", deliver.target)))?;
    delivery::group_cap(target, &deliver.prefix)
        .ok_or_else(|| RuntimeError::Schema(format!("{} has no group cap", deliver.target)))
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

// @ref LLP 1019#2-the-custody-log — bootstrap runs inside the installation
// transaction, so it is bounded per installation: when the estimated events
// of every log the successor bootstraps sum past `bootstrap_bound()`, the
// successor is refused and the rewrite installs those logs empty (the priced
// installation job is LLP 1020 Part B's; no program may write the log, so
// none can be pasted). The bound is an estimate, `cap × content rows`, taken
// before any event is written; nothing counts the events actually inserted.
/// Refuse `bootstrap` whose estimated events, summed over every log this
/// installation would bootstrap, exceed the installation bound.
pub(super) fn bootstrap_refusal(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
) -> Result<Option<SuccessorRefusal>, RuntimeError> {
    let mut estimates = Vec::new();
    for (content, _, deliver) in delivery::declarations(next) {
        if !deliver.bootstrap || installed(current, content, deliver) {
            continue;
        }
        let cap = group_cap(next, deliver)?;
        let rows = row_count(connection, content)?;
        estimates.push((content, deliver, cap, rows, u64::from(cap) * rows));
    }
    let total = estimates.iter().map(|estimate| estimate.4).sum::<u64>();
    if estimates.is_empty() || total <= bootstrap_bound() {
        return Ok(None);
    }
    let named = |names: Vec<String>| match names.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} and {last}", rest.join(", ")),
        _ => names.concat(),
    };
    let logs = named(estimates.iter().map(|(_, deliver, ..)| deliver.log.clone()).collect());
    let contents = named(estimates.iter().map(|(content, ..)| (*content).to_owned()).collect());
    let groups = estimates
        .iter()
        .map(|(content, deliver, cap, rows, _)| {
            format!("cap {cap} by {} over {rows} {content} rows", deliver.prefix.join(", "))
        })
        .collect::<Vec<_>>()
        .join("; ");
    let lines = estimates
        .iter()
        .map(|(_, deliver, ..)| {
            let mut empty = (*deliver).clone();
            empty.bootstrap = false;
            empty.line(Some(&deliver.principal))
        })
        .collect::<Vec<_>>()
        .join("; ");
    let (installation, plural) = if estimates.len() == 1 {
        ("", ("log", "its rule"))
    } else {
        (" in one installation", ("logs", "their rules"))
    };
    Ok(Some(SuccessorRefusal {
        code: "E_SUCCESSOR_BOOTSTRAP".to_owned(),
        message: format!(
            "bootstrap of {logs} would write up to {total} delivered events{installation} ({groups}), above the installation bound of {}",
            bootstrap_bound()
        ),
        rewrite: format!(
            "install the {} empty; readers reach prior history through {contents} under {}: {lines}",
            plural.0, plural.1
        ),
        site: Some(format!("schema.tables.{}.deliver", estimates[0].0)),
        plan: MigrationPlan::default(),
        conflicts: Vec::new(),
        cap_conflicts: Vec::new(),
        narrowings: Vec::new(),
    }))
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
// @ref LLP 1019#3-what-writes-it — a bootstrapped event's `incarnation` is the
// installation's commit seq: the store keeps no per-row insert seq, so the log
// is a row's incarnation of record and D2 reads it from there.
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
    let mut ordinal = 0u32;
    for (content, content_table, deliver) in delivery::declarations(next) {
        if installed(current, content, deliver) && deliver.receipts
            && !current.tables[content].deliver.as_ref().unwrap().receipts {
            let table = deliver.receipts_table().unwrap();
            let mut count = 0;
            // Adding receipt state does not reconstruct the audience: reuse
            // the retained log, in the installer's existing bounded row batches.
            for_row_batches(transaction, &deliver.log, |event| {
                if event.field("kind")?.as_str()? != "delivered" { return Ok(()); }
                use rusqlite::OptionalExtension;
                let body: Option<String> = transaction.query_row("SELECT data FROM rows WHERE table_name=?1 AND row_id=?2",
                    params![content, event.field("row")?.as_str()?], |r| r.get(0)).optional()?;
                if let Some(body) = body {
                    let mut body: Value = serde_json::from_str(&body).map_err(|e| RuntimeError::Schema(e.to_string()))?;
                    materialize_optional_fields(&mut body, content_table);
                    insert_engine_row(transaction, next, &table, delivery::receipt_row(next, &body, &event, &table, false, seq)?)?;
                    count += 1;
                }
                Ok(())
            })?;
            lines.push(format!("{table}: initialized {count} unacknowledged receipt(s) from retained delivery events"));
        }
        if !deliver.bootstrap || installed(current, content, deliver) {
            continue;
        }
        let target = next
            .table(&deliver.target)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {}", deliver.target)))?;
        // The pinned cap's `by` tuple equals the prefix names: one key shape on both sides.
        let mut groups = BTreeMap::<String, BTreeSet<String>>::new();
        for_row_batches(transaction, &deliver.target, |mut row| {
            materialize_optional_fields(&mut row, target);
            let key = canonical_json(&crate::cap::group_key(&row, &deliver.prefix));
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
                let event = delivery::event_row(
                    &row, deliver, principal, "delivered", seq, audience, seq, ordinal, at,
                )?;
                ordinal += 1;
                if let Some(table) = deliver.receipts_table() {
                    let receipt = delivery::receipt_row(next, &row, &event, &table, false, seq)?;
                    insert_engine_row(transaction, next, &table, receipt)?;
                }
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

// @ref LLP 1019#4-certification — `A = max(target cap, largest stored delivered
// audience)`: recomputed here at every installation and persisted under
// `_meta`, so lowering the cap is admitted while historical audiences keep
// pricing until those rows are gone. The scan runs only when the cap falls
// below the recorded bound; otherwise every stored audience is already under it.
/// Record the audience bound of every declared log; forget the bounds of logs
/// no longer declared. Returns `log → A`.
pub(crate) fn record_audience_bounds(
    transaction: &Transaction<'_>,
    current: &Schema,
    next: &Schema,
) -> Result<BTreeMap<String, u32>, RuntimeError> {
    let existing = transaction
        .prepare("SELECT key, value FROM _meta WHERE key LIKE ?1")?
        .query_map([format!("{}%", delivery::AUDIENCE_META_PREFIX)], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let mut recorded = BTreeMap::new();
    for (content, _, deliver) in delivery::declarations(next) {
        let cap = group_cap(next, deliver)?;
        let key = format!("{}{}", delivery::AUDIENCE_META_PREFIX, deliver.log);
        let previous = installed(current, content, deliver)
            .then(|| existing.get(&key))
            .flatten()
            .and_then(|value| value.parse::<u32>().ok());
        let bound = match previous {
            Some(previous) if cap >= previous => cap,
            _ => {
                let mut largest = 0u32;
                for_row_batches(transaction, &deliver.log, |row| {
                    if row.field("kind")?.as_str()? == "delivered" {
                        let audience = row.field("audience")?.as_int()?;
                        largest = largest.max(u32::try_from(audience).unwrap_or(u32::MAX));
                    }
                    Ok(())
                })?;
                cap.max(largest)
            }
        };
        transaction.execute(
            "INSERT INTO _meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, bound.to_string()],
        )?;
        recorded.insert(deliver.log.clone(), bound);
    }
    for key in existing.keys() {
        if !recorded.contains_key(&key[delivery::AUDIENCE_META_PREFIX.len()..]) {
            transaction.execute("DELETE FROM _meta WHERE key = ?1", [key])?;
        }
    }
    Ok(recorded)
}
