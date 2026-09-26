//! Frozen Vec-based oracle from 88549c7d7 (born tracking introduced by 0388900b8).
//! Only the event-list parameter is separate from Runner so both implementations
//! can execute against the same post-write store with independent birth maps.
use super::*;

mod log_events {
    use super::*;
    pub(super) fn put(events: &mut Vec<Event>, table: &str, id: &str, new: &Value, after: &BTreeSet<String>) {
        let image = new.clone();
        for partition in after {
            events.push(Event { partition: partition.clone(), table: table.to_owned(), kind: EventKind::Put, id: id.to_owned(), data: Some(image.clone()) });
        }
    }
    pub(super) fn del(events: &mut Vec<Event>, table: &str, id: &str, before: &BTreeSet<String>, after: &BTreeSet<String>) {
        for partition in before.difference(after) {
            events.push(Event { partition: partition.clone(), table: table.to_owned(), kind: EventKind::Del, id: id.to_owned(), data: None });
        }
    }
    pub(super) fn scope(events: &mut Vec<Event>, table: &str, partition: &str, group: &[Value]) {
        events.push(Event { partition: partition.to_owned(), table: table.to_owned(), kind: EventKind::Scope, id: canonical_json(&group), data: Some(Value::Array(group.to_vec())) });
    }
    pub(super) fn join(events: &mut Vec<Event>, table: &str, partition: &str, group: &[Value], expiry: Value) {
        events.push(Event { partition: partition.to_owned(), table: table.to_owned(), kind: EventKind::Join, id: canonical_json(&group), data: Some(crate::value::object([("expiresAt", expiry)])) });
    }
}

pub(crate) fn account_row_change<const LOG: bool>(runner: &mut Runner<'_>, events: &mut Vec<Event>, table_name: &str, old: Option<&Value>, new: Option<&Value>, origin: Origin) -> Result<(), RuntimeError> {
    let schema = runner.schema;
    let table = schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
    // @ref LLP 3000.007#18.3 — audience keys and lifetimes use the same interpreted image as rules and indexes.
    let old_image = old.map(|row| row_image(row, table));
    let new_image = new.map(|row| row_image(row, table));
    let old = old_image.as_deref();
    let new = new_image.as_deref();
    // Rows born in this commit, in every table: synced ones log only their
    // final image, and a born membership is no predecessor of a grant.
    #[cfg(feature = "sqlite")]
    let row_key = if LOG { Some((table_name.to_owned(), old.or(new).expect("a row change has an image").field("id")?.as_str()?.to_owned())) } else { None };
    #[cfg(feature = "sqlite")]
    if let Some(key) = &row_key && old.is_none() {
        let earlier = events.iter().filter(|event| matches!(event.kind, EventKind::Put | EventKind::Del) && event.table == key.0 && event.id == key.1).count();
        runner.born_rows.insert(key.clone(), earlier);
    }
    if let Some(sync) = &table.sync {
        let before: BTreeSet<String> = old.map(|old| partitions(table_name, sync, old)).unwrap_or_default().into_iter().collect();
        let after: BTreeSet<String> = new.map(|new| partitions(table_name, sync, new)).unwrap_or_default().into_iter().collect();
        let id = old.or(new).expect("a row change has an image").field("id")?.as_str()?;
        #[cfg(feature = "sqlite")]
        let id = if LOG { id.to_owned() } else { String::new() };
        #[cfg(not(feature = "sqlite"))]
        let _ = id;
        // @ref LLP 3000#7-decisions-during-execution — a row born in a commit logs only its image at the commit's end: no id of a row, or of a row's place, that existed at no commit boundary crosses the wire.
        #[cfg(feature = "sqlite")]
        if LOG {
            let key = (table_name.to_owned(), id.clone());
            let row_event = |event: &Event| matches!(event.kind, EventKind::Put | EventKind::Del) && event.table == key.0 && event.id == key.1;
            if let Some(&earlier) = runner.born_rows.get(&key) {
                withdraw(events, earlier, row_event);
                // A born row whose lifetime has already ended is not live at
                // this commit's end either: it logs nothing (the stream would
                // re-read it as absent and send its id as a `del`).
                let live = new.filter(|new| !runner.context.now.is_some_and(|now| table.expired(new, now)));
                if let Some(new) = live {
                    log_events::put(events, table_name, &id, new, &after);
                }
            } else {
                if let Some(new) = new {
                    log_events::put(events, table_name, &id, new, &after);
                }
                log_events::del(events, table_name, &id, &before, &after);
            }
        }
        if origin == Origin::Maintained { runner.charge_maintain(MeterKind::Steps, (before.len() + after.len()) as u64)?; }
        else { runner.meter.charge(MeterKind::Steps, (before.len() + after.len()) as u64)?; }
    }
    #[cfg(feature = "sqlite")]
    if let Some(key) = &row_key && new.is_none() {
        runner.born_rows.remove(key);
    }
    // This table as the target of other tables' audiences.
    let dependents: Vec<(String, Sync)> = schema
        .synced()
        .filter_map(|(name, _, sync)| match &sync.audience {
            Audience::Target { table, .. } if table == table_name => Some((name.to_owned(), sync.clone())),
            _ => None,
        })
        .collect();
    if dependents.is_empty() {
        return Ok(());
    }
    let membership = |row: Option<&Value>, content_name: &str, sync: &Sync| -> Option<(String, Vec<Value>)> {
        let row = row?;
        let bound = binding(schema, content_name, sync)?;
        let Ok(Value::Id(p)) = row.field(&bound.principal) else { return None };
        let group: Vec<Value> = bound.columns.iter().map(|c| row.field(c).cloned().unwrap_or(Value::Null)).collect();
        if group.iter().any(|value| *value == Value::Null) {
            return None;
        }
        Some((partition_of(p), group))
    };
    for (content_name, sync) in dependents {
        let was = membership(old, &content_name, &sync);
        let is = membership(new, &content_name, &sync);
        let expiry = |row: Option<&Value>| row.and_then(|row| table.deadline(row)).map(Value::Int).unwrap_or(Value::Null);
        if was == is && expiry(old) == expiry(new) {
            continue;
        }
        #[cfg(feature = "sqlite")]
        let mut undone_born: Option<(String, String, String)> = None;
        // A grant that ends inside the commit that made it was never an
        // authority, and the principal never held the group at a commit
        // boundary: its join and its scope are both withdrawn, so the
        // principal learns nothing of the group. A renewal is not a new
        // grant, so a revocation after one is always logged.
        if let Some((partition, group)) = &was {
            // Sweeping an expired predecessor must not revoke the live
            // replacement admitted under the same logical unique key.
            let mut replaced = false;
            if old.is_some_and(|row| runner.context.now.is_some_and(|now| table.expired(row, now))) {
                let bound = binding(schema, &content_name, &sync).expect("validated audience");
                let mut key = group.clone();
                key.push(old.unwrap().field(&bound.principal)?.clone());
                let mut bounds = Bounds::default();
                loop {
                    let rows = runner.metered_scan(|runner, allowance| runner.tx.scan(allowance, table_name, &bound.group_index, &key, &bounds, Dir::Asc, 32))?;
                    let count = rows.len();
                    for (candidate, stored) in rows {
                        let candidate = row_image(&candidate, table);
                        runner.meter.charge(MeterKind::Examined, 1)?;
                        bounds.after = crate::key::decode(&stored).map(|values| values.into_iter().skip(key.len()).collect());
                        if !runner.context.now.is_some_and(|now| table.expired(&candidate, now)) { replaced = true; break; }
                    }
                    if replaced || count < 32 { break; }
                }
            }
            // A live deadline renewal is a join transition without a
            // revocation. If the old lifetime already ended, catch-up inserts
            // its scope before that join; shortening to expiry still revokes.
            let renewed = was == is && new.is_some_and(|row| !runner.context.now.is_some_and(|now| table.expired(row, now)));
            #[cfg(not(feature = "sqlite"))]
            let _ = (partition, replaced, renewed);
            #[cfg(feature = "sqlite")]
            if LOG && !replaced && !renewed {
                let key = (partition.clone(), content_name.clone(), canonical_json(group));
                match runner.born_grants.get(&key).copied() {
                    Some(earlier) => {
                        withdraw(events, earlier, |event| event.kind == EventKind::Join && event.partition == key.0 && event.table == key.1 && event.id == key.2);
                        // Siblings born beside it still carry the birth.
                        let row = old.expect("a revoked grant had an image");
                        let own = row.field("id")?.as_str()?.to_owned();
                        let bound = binding(schema, &content_name, &sync).expect("validated audience");
                        let mut probe = group.clone();
                        probe.push(row.field(&bound.principal)?.clone());
                        if !runner.metered_scan(|runner, allowance| key_has_row(runner, allowance, table_name, &bound.group_index, &probe, |other| other != own))? {
                            runner.born_grants.remove(&key);
                        }
                        undone_born = Some(key);
                    }
                    None => log_events::scope(events, &content_name, partition, group),
                }
            }
        }
        // A grant born in this commit stays born through renewals, and
        // through a new lifetime that ends it at once, until it is undone. A
        // grant beside another row of its key that existed before the commit
        // (an expired predecessor not yet swept, which the log still holds)
        // is not born: it replaces that predecessor, whose revocation is
        // still owed. Rows born in this commit held no authority before it,
        // so they are passed over. The probe is log bookkeeping, not program
        // work, so no host is charged for it (the device builds no log).
        #[cfg(feature = "sqlite")]
        if LOG && let Some((partition, group)) = &is {
            let key = (partition.clone(), content_name.clone(), canonical_json(group));
            if (was != is || undone_born.as_ref() == Some(&key)) && !runner.born_grants.contains_key(&key) {
                let row = new.expect("a membership has an image");
                let bound = binding(schema, &content_name, &sync).expect("validated audience");
                let mut probe = group.clone();
                probe.push(row.field(&bound.principal)?.clone());
                let own = row.field("id")?.as_str()?;
                let predecessor = runner.metered_scan(|runner_now, allowance| key_has_row(runner_now, allowance, table_name, &bound.group_index, &probe, |other| other != own && !runner_now.born_rows.contains_key(&(table_name.to_owned(), other.to_owned()))))?;
                if !predecessor {
                    let earlier = events.iter().filter(|event| event.kind == EventKind::Join && event.partition == key.0 && event.table == key.1 && event.id == key.2).count();
                    runner.born_grants.insert(key, earlier);
                }
            }
            log_events::join(events, &content_name, partition, group, expiry(new));
        }
        runner.meter.charge(MeterKind::Steps, 1)?;
    }
    Ok(())
}

fn withdraw(events: &mut Vec<Event>, keep: usize, matches: impl Fn(&Event) -> bool) {
    let mut seen = 0;
    events.retain(|event| {
        if !matches(event) {
            return true;
        }
        seen += 1;
        seen <= keep
    });
}

