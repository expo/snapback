//! Private catch-up effects. Fold pages through the normal applicator inside
//! a rolled-back savepoint: markers, scopes, history and media keep their exact
//! event order, while the durable row delta holds only the last image per row.
//! Nothing in that savepoint (including indexes) is observable before commit.
use super::*;
mod recording;
use recording::Recording;

pub(super) const IDENTITY: &str = "device:deferred:identity";
pub(super) const PREFIX: &str = "device:deferred:";
const ROWS: &str = "device:deferred:rows:";
const META: &str = "device:deferred:meta:";
const ACKS: &str = "device:deferred:acks";
pub(super) const CURSOR: &str = "device:deferred:cursor";

pub(super) fn clear<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> { tx.delete_meta(&[PREFIX]) }
pub(super) fn stage_identity<T: DeviceTx>(tx: &T, identity: Option<&str>) -> Result<(), RuntimeError> {
    if let Some(identity) = identity { tx.set_meta(IDENTITY, identity)?; }
    Ok(())
}
pub(super) fn cursor<T: DeviceTx>(tx: &T) -> Result<Option<u64>, RuntimeError> {
    decode_cursor(tx.meta(CURSOR)?)
}

pub(super) fn decode_cursor(value: Option<String>) -> Result<Option<u64>, RuntimeError> {
    value.filter(|v| !v.is_empty()).map(|v| decoded(&v)).transpose()
}

pub(super) fn validate(page: &StreamPage) -> Result<(), RuntimeError> {
    boundary::validate_positions(page)?;
    if page.acknowledged.values().any(|seq| *seq > page.watermark) {
        return Err(RuntimeError::Input("acknowledgement is beyond the applied watermark".into()));
    }
    if page.committed_above.values().any(|seq| *seq <= page.watermark || page.images_at.is_none_or(|head| *seq > head)) {
        return Err(RuntimeError::Input("committed_above must satisfy watermark < sequence <= images_at".into()));
    }
    Ok(())
}

pub(super) fn should_defer<T: DeviceTx>(tx: &T, programs: &BTreeMap<String, Program>, page: &StreamPage, published: u64, declaration: predictions::Declaration) -> Result<bool, RuntimeError> {
    if page.images_at.is_some_and(|head| head <= page.watermark) || (page.images_at.is_none() && !page.more) { return Ok(false); }
    // Exactly the replay eligibility this page would publish, evaluated before
    // its acknowledgements can remove a prediction from the visible overlay.
    let prospective = (declaration.0, declaration.2);
    let store = tx.meta(STORE_ID)?;
    for data in tx.outbox_entries()? {
        let q: Queued = decoded(&data)?;
        if predictions::replayable(&q, programs, published, prospective, store.as_deref())
            && (page.images_at.is_none() || page.committed_above.contains_key(&q.id)) { return Ok(true); }
    }
    Ok(false)
}

#[derive(Serialize, Deserialize)]
struct RowEffect {
    image: Option<Value>,
    // None means the row was already held in the published base. Otherwise
    // recheck its first admission, not its final (possibly moved) index key.
    admission: Option<Value>,
}

fn rows<T: DeviceTx>(tx: &T) -> Result<Vec<(String, String, RowEffect)>, RuntimeError> {
    tx.meta_prefix(ROWS)?.into_iter().map(|(key, data)| {
        let (name, id) = decoded(&key[ROWS.len()..])?;
        Ok((name, id, decoded(&data)?))
    }).collect()
}

fn metadata<T: DeviceTx>(tx: &T) -> Result<Vec<(String, Option<String>)>, RuntimeError> {
    tx.meta_prefix(META)?.into_iter().map(|(key, data)| Ok((key[META.len()..].to_owned(), decoded(&data)?))).collect()
}

fn install_metadata<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    for (key, value) in metadata(tx)? {
        match value { Some(value) => tx.set_meta(&key, &value)?, None => tx.delete_meta(&[&key])? }
    }
    Ok(())
}

fn install_rows<T: DeviceTx>(tx: &T, schema: &Schema, gate: bool, touched: &mut BTreeSet<String>) -> Result<(), RuntimeError> {
    let effects = rows(tx)?;
    if effects.is_empty() { return Ok(()); }
    let mut boundaries = boundary::Boundaries::load(tx, false)?;
    for (name, id, effect) in effects {
        let table = schema.table(&name).ok_or_else(|| RuntimeError::Schema(format!("unknown table {name}")))?;
        touched.insert(name.clone());
        let old = tx.get(&name, &id)?;
        match effect.image {
            Some(row) => {
                if gate && !boundaries.accept(tx, &name, table, effect.admission.as_ref().unwrap_or(&row), effect.admission.is_none())? {
                    // The metadata delta must not expose media for a rejected image.
                    media::forget(tx, table, &row)?;
                    // Preserve an earlier private deletion even if its later
                    // recreation no longer passes the acquisition boundary.
                    if effect.admission.is_some() && let Some(old) = old {
                        media::forget(tx, table, &old)?;
                        tx.delete(&name, table, &old)?;
                    }
                    continue;
                }
                tx.put(&name, table, &row, old.as_ref())?;
            }
            None => if let Some(old) = old { tx.delete(&name, table, &old)?; },
        }
    }
    Ok(())
}

// @ref LLP 3000.001#reliability-catchup — fold in order without publishing authority or retiring predictions.
pub(super) fn stage<T: DeviceTx>(tx: &T, schema: &Schema, generation: u64, page: &StreamPage) -> Result<(), RuntimeError> {
    tx.savepoint("deferred")?;
    predictions::restore(tx, schema)?;
    install_metadata(tx)?;
    install_rows(tx, schema, false, &mut BTreeSet::new())?;
    let inherited = rows(tx)?.into_iter().map(|(name, id, effect)| ((name, id), effect.admission)).collect();
    let recording = Recording::new(tx, inherited, metadata(tx)?.into_iter().collect());
    events(&recording, schema, generation, page, &mut BTreeSet::new())?;
    let mut row_delta = Vec::new();
    for ((name, id), present) in recording.rows.borrow().iter() {
        row_delta.push((format!("{ROWS}{}", encoded(&(name, id))?), encoded(&RowEffect {
            image: if *present { tx.get(name, id)? } else { None },
            admission: if *present { recording.admission.borrow().get(&(name.clone(), id.clone())).cloned()
                .ok_or_else(|| RuntimeError::Store("deferred row has no admission provenance".into()))? } else { None },
        })?));
    }
    // Older concrete children removed by a new prefix operation become
    // tombstones too. Keep one last operation per key; clear owns all deletion.
    for (key, _) in metadata(tx)? { recording.meta.borrow_mut().entry(key).or_insert(None); }
    let meta_delta = recording.meta.borrow().iter().map(|(key, value)|
        Ok((format!("{META}{key}"), encoded(value)?))).collect::<Result<Vec<_>, RuntimeError>>()?;
    tx.rollback_to("deferred")?;
    for (key, value) in row_delta.into_iter().chain(meta_delta) { tx.set_meta(&key, &value)?; }
    let mut acks: BTreeMap<String, u64> = tx.meta(ACKS)?.map(|v| decoded(&v)).transpose()?.unwrap_or_default();
    acks.extend(page.acknowledged.clone());
    tx.set_meta(ACKS, &encoded(&acks)?)?;
    tx.set_meta(CURSOR, &encoded(&page.watermark)?)
}

pub(super) fn install<T: DeviceTx>(tx: &T, schema: &Schema, touched: &mut BTreeSet<String>) -> Result<(), RuntimeError> {
    install_metadata(tx)?;
    install_rows(tx, schema, true, touched)?;
    // Include non-row-only changes in watch invalidation.
    if cursor(tx)?.is_some() { touched.extend(schema.tables.keys().cloned()); }
    Ok(())
}

pub(super) fn acknowledge<T: DeviceTx>(tx: &T, watermark: u64, current: &BTreeMap<String, u64>) -> Result<(), RuntimeError> {
    let mut all: BTreeMap<String, u64> = tx.meta(ACKS)?.map(|v| decoded(&v)).transpose()?.unwrap_or_default();
    all.extend(current.clone());
    // Acknowledgements must be complete through the watermark for the declared
    // prefix. The durable replay guard excludes the undeclared suffix.
    for (id, seq) in all {
        if seq > watermark { return Err(RuntimeError::Input("deferred acknowledgement is beyond publication".into())); }
        if let Some(data) = tx.outbox_get(&id)? {
            let mut q: Queued = decoded(&data)?;
            predictions::record_receipt(tx, &mut q, seq, true)?;
        }
    }
    clear(tx)
}

pub(super) fn events<T: DeviceTx>(tx: &T, schema: &Schema, generation: u64, page: &StreamPage, touched: &mut BTreeSet<String>) -> Result<(), RuntimeError> {
    let mut boundaries = boundary::Boundaries::editing(false);
    let mut markers = page.acquisitions.iter().peekable();
    boundary::validate_positions(page)?;
    for position in 0..=page.events.len() {
        while markers.peek().is_some_and(|marker| marker.at == position) {
            boundaries.marker(tx, schema, markers.next().unwrap(), false)?;
        }
        let Some(event) = page.events.get(position) else { break };
        touched.insert(event.table.clone());
        let table = schema.table(&event.table).ok_or_else(|| RuntimeError::Schema(format!("unknown table {}", event.table)))?;
        match event.kind.as_str() {
            "put" => {
                let row = wire::row_from_json(table, event.data.as_ref().ok_or_else(|| RuntimeError::Input("event row is missing".into()))?).map_err(RuntimeError::Input)?;
                if row.field("id")?.as_str()? != event.id {
                    return Err(RuntimeError::Input("row identity does not match its event".into()));
                }
                let old = tx.get(&event.table, &event.id)?;
                if !boundaries.accept(tx, &event.table, table, &row, old.is_some())? { continue; }
                if let Some(old) = &old { media::forget(tx, table, old)?; }
                tx.put(&event.table, table, &row, old.as_ref())?;
                media::remember(tx, &event.table, table, &row, generation)?;
            }
            "del" => {
                if let Some(old) = tx.get(&event.table, &event.id)? {
                    media::forget(tx, table, &old)?;
                    tx.delete(&event.table, table, &old)?;
                }
            }
            "scope" => {
                let group = scope_group(table, event)?;
                leave(tx, schema, &event.table, &group)?;
                boundaries.scope(tx, &event.table, table, &group)?;
            }
            _ => return Err(RuntimeError::Input("unknown stream event".into())),
        }
    }
    boundaries.save(tx, false)?;
    history::events(tx, schema, &page.events, &page.joined, false)?;
    touched.extend(page.joined.keys().cloned());
    touched.extend(page.acquisitions.iter().map(|marker| marker.table.clone()));
    Ok(())
}
