//! Durable confirmed images beneath the ordered outbox: a prediction
//! remembers what it replaces, a refusal restores it, and the survivors
//! are replayed in submission order over the confirmed base.
use super::*;

const DELETED_GROUPS: &str = "device:receipt-deleted:";
fn deleted_key(table: &str, id: &str) -> String {
    format!("{DELETED_GROUPS}{}", snapback4_core::value::digest(&(table, id)))
}

// @ref LLP 3000.022#14.3 — save ordinary group keys while the last image exists.
// The base stays unchanged: it alone decides what rollback restores.
pub(super) fn remember_deleted<T: DeviceTx>(tx: &T, schema: &Schema, table: &str, row: &Value) -> Result<(), RuntimeError> {
    let mut fields = BTreeMap::new();
    let mut keep = |field: &String| {
        if !schema.receipt_dependencies.get(table).is_some_and(|owned| owned.contains(field)) {
            if let Ok(value) = row.field(field) { fields.insert(field.clone(), value.clone()); }
        }
    };
    for m in schema.maintains.iter().filter(|m| schema.receipt_dependencies.contains_key(&m.target)) {
        if m.source == table {
            if let Some(k) = &m.row_key { keep(&k.source_key); }
            else { for f in &m.by { keep(m.aliases.get(f).unwrap_or(f)); } }
        }
        if let Some(k) = &m.row_key { if k.table == table { keep(&k.member_key); } }
    }
    if !fields.is_empty() {
        tx.set_meta(&deleted_key(table, row.field("id")?.as_str()?), &encoded(&Value::Row(fields.into()))?)?;
    }
    Ok(())
}

// @ref LLP 3000.022#14.3 — overlay metadata, never a history scan. Include
// empty ids, the deleted base, and both domains of an update/member move.
pub(super) fn provisional_groups<T: DeviceTx>(tx: &T, table: &str, fields: &[String]) -> Result<Option<Vec<Vec<Value>>>, RuntimeError> {
    let mut groups = Vec::new();
    if !tx.base_has_table(table)? { return Ok(Some(groups)); }
    for (name, id, base) in tx.base_entries()? {
        if name != table { continue; }
        let base = base.as_deref().map(decoded::<Value>).transpose()?;
        let mut current = tx.get(table, &id)?;
        if base.is_none() && current.is_none() {
            current = tx.meta(&deleted_key(table, &id))?.as_deref().map(decoded::<Value>).transpose()?;
        }
        if base.is_none() && current.is_none() { return Ok(None); }
        for image in [base, current].into_iter().flatten() {
            let key = fields.iter().map(|f| image.field(f).cloned().ok()).collect::<Option<Vec<_>>>();
            let Some(key) = key else { return Ok(None); };
            groups.push(key);
        }
    }
    Ok(Some(groups))
}

// @ref LLP 3000#7-decisions-during-execution — pending belongs to the device
// card, not the application row supplied to the shared mutation interpreter.
// Only this metadata is removed; undeclared application fields still refuse.
pub(super) fn without_pending(mut row: Value) -> Value {
    if let Value::Row(fields) = &mut row {
        fields.remove("pending");
    }
    row
}

pub(super) fn remember<T: DeviceTx>(tx: &T, table: &str, id: &str) -> Result<(), RuntimeError> {
    let image = tx.get(table, id)?.map(|row| encoded(&row)).transpose()?;
    tx.base_remember(table, id, image.as_deref())
}

pub(super) fn sequence_floor_key(parent: &str, id: &str) -> String {
    format!("device:sequence-floor:{}", snapback4_core::value::digest(&(parent, id)))
}

pub(super) fn restore<T: DeviceTx>(tx: &T, schema: &Schema) -> Result<BTreeSet<String>, RuntimeError> {
    let mut touched = BTreeSet::new();
    for (name, id, image) in tx.base_entries()? {
        let Some(table) = schema.table(&name) else { continue };
        let old = tx.get(&name, &id)?;
        match image {
            Some(image) => {
                let row: Value = decoded(&image)?;
                tx.put(&name, table, &row, old.as_ref())?;
            }
            None => {
                if let Some(old) = old {
                    tx.delete(&name, table, &old)?;
                }
            }
        }
        touched.insert(name);
    }
    tx.delete_meta(&["device:sequence-floor:", DELETED_GROUPS])?;
    tx.base_clear()?;
    Ok(touched)
}

pub(super) fn enqueue<T: DeviceTx>(tx: &T, entry: &Queued) -> Result<(), RuntimeError> {
    tx.outbox_upsert(entry.seq, &entry.id, &encoded(entry)?)?;
    keep_issued_floor(tx, entry.now)
}

// @ref LLP 3000.019#3.3 — annotate the existing entry, without changing order,
// predictions, receipts or settlement. A late hold cannot resurrect a write.
pub(super) fn dispatch<T: DeviceTx>(tx: &T, id: &str, reason: &str) -> Result<(), RuntimeError> {
    if let Some(data) = tx.outbox_get(id)? {
        let mut entry: Queued = decoded(&data)?;
        entry.dispatch = Some(reason.chars().take(128).collect());
        enqueue(tx, &entry)?;
    }
    Ok(())
}

pub(super) fn run<T: DeviceTx>(tx: &T, schema: &Schema, program: &Program, entry: &Queued) -> Result<(Vec<String>, Vec<String>), RuntimeError> {
    // Replay consumes recorded IDs; any extra allocation withdraws the prediction.
    run_with_minter(tx, schema, program, entry, snapback4_core::ids::Mint::default())
}

pub(super) fn run_with_minter<T: DeviceTx>(tx: &T, schema: &Schema, program: &Program, entry: &Queued, minter: snapback4_core::ids::Mint) -> Result<(Vec<String>, Vec<String>), RuntimeError> {
    // Missing acquisition is missing evidence, never an authored refusal.
    // Admission already handles E_PREDICT by durably queueing without a row.
    require_acquired(tx, schema, program)?;
    // Replay mints past the admitted ids only to discover it needs more (and
    // is then withdrawn): its entropy comes from the entry, never the clock.
    let entropy = entry.id.bytes().fold(entry.seq.wrapping_mul(0x9E37_79B9_7F4A_7C15), |acc, byte| (acc ^ u64::from(byte)).wrapping_mul(0x100_0000_01B3));
    let context = Context::new(&entry.viewer, media::inputs(tx, program, &entry.viewer, &entry.args)?).at(expiry_clock::now(tx, entry.now)?).with_generation(meta_u64(tx, GENERATION)?).with_ids(entry.new_ids.clone()).with_entropy(entropy | 1).with_minter(minter);
    let predicting = Predicting { tx, schema, groups: history::load(tx, history::GROUPS)?, boundaries: boundary::Boundaries::load(tx, false)?, written: RefCell::new(Vec::new()) };
    let prediction = local::predict(&predicting, schema, program, context, Ceilings::default())?;
    Ok((predicting.written.into_inner(), prediction.new_ids))
}

// Request capture and published replay eligibility are separate: a deferred
// response must not change the overlay. The exclusion band ends at the request
// capture; writes admitted later must remain eligible on the published base.
const CAPTURE: &str = "device:declaration:capture";
const PUBLISHED: &str = "device:declaration:published";
const PENDING_LIMIT: usize = 256;

// (declared through, declaration complete, outbox upper bound at request time).
pub(super) type Declaration = (u64, bool, u64);

#[derive(Serialize, Deserialize)]
pub(super) struct Capture {
    pub ids: Vec<String>,
    pub declaration: Declaration,
    #[serde(default)]
    pub send_revision: u64,
}

// The interval and declared IDs must be the same prefix, regardless of the
// adapter's iteration order. Equal submission numbers cannot define a prefix.
fn ordered_entries<T: DeviceTx>(tx: &T) -> Result<Vec<Queued>, RuntimeError> {
    let mut entries = tx.outbox_entries()?.iter().map(|data| decoded::<Queued>(data)).collect::<Result<Vec<_>, _>>()?;
    // Equal submission numbers are refused below; stable tie ordering carries
    // no authority and would instantiate another allocation-backed sorter.
    entries.sort_unstable_by_key(|entry| entry.seq);
    if entries.windows(2).any(|pair| pair[0].seq >= pair[1].seq) {
        return Err(RuntimeError::Store("outbox submission numbers must be unique".into()));
    }
    Ok(entries)
}

// Reuse belongs to one send revision. An abandoned fetch has no response to
// reject; the next request after a send must declare the newly sent writes.
// The old capture stays durable until then, so late responses remain fenced.
pub(super) fn capture<T: DeviceTx>(tx: &T) -> Result<Capture, RuntimeError> {
    if let Some(capture) = current_capture(tx)? { return Ok(capture); }
    let capture = pending_capture(tx)?;
    tx.set_meta(CAPTURE, &encoded(&capture)?)?;
    Ok(capture)
}

pub(super) fn pending_capture<T: DeviceTx>(tx: &T) -> Result<Capture, RuntimeError> {
    if let Some(capture) = current_capture(tx)? { return Ok(capture); }
    let entries = ordered_entries(tx)?;
    Ok(Capture {
        ids: entries.iter().take(PENDING_LIMIT).map(|q| q.id.clone()).collect(),
        declaration: (entries.iter().take(PENDING_LIMIT).last().map_or(0, |q| q.seq), entries.len() <= PENDING_LIMIT,
            // SUBMISSION is the inclusive last assigned number, never the next.
            entries.last().map_or(0, |q| q.seq).max(meta_u64(tx, SUBMISSION)?)),
        send_revision: meta_u64(tx, SEND_REVISION)?,
    })
}

fn current_capture<T: DeviceTx>(tx: &T) -> Result<Option<Capture>, RuntimeError> {
    let revision = meta_u64(tx, SEND_REVISION)?;
    Ok(load_capture(tx)?.filter(|capture| capture.send_revision == revision))
}

// The checkpoint stored only bounds. Submission numbers never get reused,
// so its still-unretired IDs can be recovered without widening that capture.
fn load_capture<T: DeviceTx>(tx: &T) -> Result<Option<Capture>, RuntimeError> {
    let Some(data) = tx.meta(CAPTURE)?.filter(|s| !s.is_empty()) else { return Ok(None) };
    if let Ok(capture) = decoded::<Capture>(&data) {
        let ids: BTreeSet<_> = capture.ids.iter().collect();
        if capture.ids.len() > PENDING_LIMIT || ids.len() != capture.ids.len() || capture.declaration.0 > capture.declaration.2
            || ordered_entries(tx)?.iter().any(|q| q.seq <= capture.declaration.2 && ids.contains(&q.id) != (q.seq <= capture.declaration.0)) {
            return Err(RuntimeError::Store("pending capture does not describe a bounded outbox prefix".into()));
        }
        return Ok(Some(capture));
    }
    let declaration: Declaration = decoded(&data)?;
    if declaration.0 > declaration.2 {
        return Err(RuntimeError::Store("checkpoint pending declaration has inverted bounds".into()));
    }
    let ids: Vec<_> = ordered_entries(tx)?.into_iter().filter(|entry| entry.seq <= declaration.0).map(|entry| entry.id).collect();
    if ids.len() > PENDING_LIMIT {
        return Err(RuntimeError::Store("checkpoint pending declaration exceeds its prefix limit".into()));
    }
    Ok(Some(Capture { ids, declaration, send_revision: 0 }))
}

pub(super) fn declaration<T: DeviceTx>(tx: &T, page: &StreamPage) -> Result<Declaration, RuntimeError> {
    let revision = page.send_revision.unwrap_or(meta_u64(tx, SEND_REVISION)?);
    let capture = load_capture(tx)?.filter(|capture| capture.send_revision == revision);
    match (page.pending_through, page.pending_complete) {
        (Some(through), Some(complete)) => {
            if let Some(capture) = &capture {
                let captured = capture.declaration;
                if !echo_matches(page, captured) {
                    return Err(RuntimeError::Input("pending declaration echo differs from its request capture".into()));
                }
                return Ok(captured);
            }
            let bound = page.pending_bound;
            let bound = match bound {
                Some(bound) if bound >= through => bound,
                None if complete => through,
                _ => return Err(RuntimeError::Input("incomplete local pending declaration capture".into())),
            };
            Ok((through, complete, bound))
        }
        (None, None) => match capture {
            Some(capture) => Ok(capture.declaration),
            None => { let (through, bound) = replay_limit(tx)?; Ok((through, false, bound)) }
        },
        _ => Err(RuntimeError::Input("incomplete local pending declaration capture".into())),
    }
}

// A rejected echoed request releases only its own declaration. An unrelated
// stale response cannot erase a newer capture with different bounds.
pub(super) fn reject_capture<T: DeviceTx>(tx: &T, page: &StreamPage) -> Result<(), RuntimeError> {
    if let Some(capture) = load_capture(tx)?
        && page.send_revision.is_none_or(|revision| revision == capture.send_revision)
        && echo_matches(page, capture.declaration) {
        clear_capture(tx)?;
    }
    Ok(())
}

pub(super) fn clear_capture<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    // FIRST_CAPTURE no longer has a writer: it was a second, conflicting
    // representation of the request. Remove residue at the same boundary.
    tx.delete_meta(&[CAPTURE, "device:declaration:first-capture"])
}

pub(super) fn abandon_capture<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    if tx.meta(CAPTURE)?.is_some() {
        // Fence a surviving owner's old response as well as recapturing the
        // pending IDs. Host recovery cannot prove a teardown send persisted.
        let revision = meta_u64(tx, SEND_REVISION)?.checked_add(1).filter(|n| *n <= 9_007_199_254_740_991).ok_or_else(|| RuntimeError::Store("send revision overflow".into()))?;
        tx.set_meta(SEND_REVISION, &revision.to_string())?;
        clear_capture(tx)?;
    } else if tx.meta("device:declaration:first-capture")?.is_some() {
        clear_capture(tx)?;
    }
    Ok(())
}

fn echo_matches(page: &StreamPage, captured: Declaration) -> bool {
    page.pending_through == Some(captured.0) && page.pending_complete == Some(captured.1)
        && page.pending_bound.is_none_or(|bound| bound == captured.2)
}

pub(super) fn reset<T: DeviceTx>(tx: &T, keep_images: bool) -> Result<(), RuntimeError> {
    clear_capture(tx)?;
    if !keep_images {
        tx.delete_meta(&[PUBLISHED, "device:sequence-floor:", DELETED_GROUPS])?;
        for data in tx.outbox_entries()? {
            let mut entry: Queued = decoded(&data)?;
            if success_seq(&entry).is_some() && let Some(seq) = entry.observed_seq.take() {
                // Dropping publication evidence must not turn a known execution
                // into an unsent write that a later replacement could retry.
                entry.sent_seq.get_or_insert(seq);
                enqueue(tx, &entry)?;
            }
        }
        // sent_seq proves execution, independently of our images. Keep it for
        // at-most-once settlement; with watermark zero it cannot suppress replay.
    }
    Ok(())
}

pub(super) fn publish_declaration<T: DeviceTx>(tx: &T, declaration: Declaration) -> Result<(), RuntimeError> {
    tx.set_meta(PUBLISHED, &encoded(&(declaration.0, declaration.2))?)?;
    clear_capture(tx)
}

pub(super) fn replay_limit<T: DeviceTx>(tx: &T) -> Result<(u64, u64), RuntimeError> {
    tx.meta(PUBLISHED)?.filter(|s| !s.is_empty()).map(|data| decoded(&data)).transpose().map(|v| v.unwrap_or((0, 0)))
}

// @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — the publication decision and replay share eligibility, including the declaration guard.
pub(super) fn replayable(entry: &Queued, programs: &BTreeMap<String, Program>, watermark: u64, declaration: (u64, u64), store: Option<&str>) -> bool {
    !(receipt_matches(entry, store) && entry.sent_seq.is_some_and(|seq| seq <= watermark))
        // An observation is written only with its published row effects. A
        // generation can reset the transfer watermark while retaining them.
        && !(receipt_matches(entry, store) && entry.observed_seq.is_some())
        && entry.predictable && !entry.viewer.is_empty() && programs.contains_key(&entry.op)
        && (entry.seq <= declaration.0 || entry.seq > declaration.1)
}

pub(super) fn replay<T: DeviceTx>(tx: &T, schema: &Schema, programs: &BTreeMap<String, Program>, watermark: u64) -> Result<BTreeSet<String>, RuntimeError> {
    let mut touched = BTreeSet::new();
    let declaration = replay_limit(tx)?;
    let store = tx.meta(STORE_ID)?;
    for data in tx.outbox_entries()? {
        let mut entry: Queued = decoded(&data)?;
        if receipt_matches(&entry, store.as_deref()) && entry.sent_seq.is_some_and(|seq| success_seq(&entry) == Some(seq) && seq <= watermark) {
            remove(tx, &entry.id)?;
            continue;
        }
        if !replayable(&entry, programs, watermark, declaration, store.as_deref()) { continue; }
        let program = &programs[&entry.op];
        tx.savepoint("replay")?;
        match run(tx, schema, program, &entry) {
            // B2a is independent of page deferral: refusal withdrawal uses this set.
            Ok((predicted, ids)) if ids.len() <= entry.new_ids.len() => {
                tx.release("replay")?;
                touched.extend(predicted.iter().filter_map(|key| key.split_once('/').map(|(table, _)| table.to_owned())));
                if entry.predicted != predicted {
                    entry.predicted = predicted;
                    enqueue(tx, &entry)?;
                }
            },
            Ok(_) => {
                // An in-flight server request already owns the admitted id
                // supply. A changed population cannot invent more stable
                // client ids retroactively; withdraw this prediction.
                tx.rollback_to("replay")?;
                entry.predictable = false;
                entry.predicted.clear();
                enqueue(tx, &entry)?;
            }
            Err(RuntimeError::Prediction(_)) => {
                tx.rollback_to("replay")?;
                entry.predictable = false;
                entry.predicted.clear();
                enqueue(tx, &entry)?;
            }
            Err(error) if error.is_refusal() => tx.rollback_to("replay")?,
            Err(error) => return Err(error),
        }
    }
    Ok(touched)
}

// Receipts and their incarnation are one outbox value, persisted together.
pub(super) fn receipt_matches(entry: &Queued, store: Option<&str>) -> bool {
    entry.receipt_store.as_ref().and_then(|receipt| receipt.id.as_deref()).is_none_or(|id| Some(id) == store)
}

// @ref LLP 3000.013#6 — a sequence alone proves a decision, not its outcome.
pub(super) fn success_seq(entry: &Queued) -> Option<u64> {
    entry.receipt_store.as_ref()?.success_seq.filter(|seq| entry.sent_seq == Some(*seq) || entry.observed_seq == Some(*seq))
}

pub(super) fn qualify_receipts<T: DeviceTx>(tx: &T, page: &StreamPage) -> Result<(), RuntimeError> {
    for (id, seq) in &page.acknowledged {
        if page.sent.get(id) != Some(seq) { continue; }
        if let Some(data) = tx.outbox_get(id)? {
            let mut entry: Queued = decoded(&data)?;
            // Keep the qualification through private snapshot/deferred pages,
            // but expose it only after that same sequence is published.
            stamp_receipt(tx, &mut entry, *seq, true)?;
        }
    }
    Ok(())
}

pub(super) fn record_receipt<T: DeviceTx>(tx: &T, entry: &mut Queued, seq: u64, observed: bool, success: bool) -> Result<(), RuntimeError> {
    // @ref LLP 3000.038.000#3 — an unresolved upload cannot have dispatched its placement; an old same-id acknowledgement owns no byte custody.
    if entry.upload.as_ref().is_some_and(|u|u["state"]!="placing"){return Ok(());}
    if observed { entry.observed_seq = Some(seq); } else { entry.sent_seq = Some(seq); }
    stamp_receipt(tx, entry, seq, success)
}

fn stamp_receipt<T: DeviceTx>(tx: &T, entry: &mut Queued, seq: u64, success: bool) -> Result<(), RuntimeError> {
    if entry.upload.as_ref().is_some_and(|u|u["state"]!="placing"){return Ok(());}
    let store = tx.meta(STORE_ID)?.or(tx.meta(deferred::IDENTITY)?);
    if !receipt_matches(entry, store.as_deref()) {
        return Ok(()); // A replacement cannot rebind a preserved old receipt.
    }
    let success_seq = if success { Some(seq) } else { entry.receipt_store.as_ref().and_then(|receipt| receipt.success_seq) };
    entry.receipt_store = (store.is_some() || success_seq.is_some()).then_some(ReceiptStore { id: store, success_seq });
    enqueue(tx, entry)
}

pub(super) fn remove<T: DeviceTx>(tx: &T, id: &str) -> Result<(), RuntimeError> {
    tx.outbox_delete(id)
}

// Upgrade old implicit receipts while their original incarnation is still
// available. The ordinary receipt writer owns the only persisted binding.
pub(super) fn bind_legacy_receipts<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    for data in tx.outbox_entries()? {
        let mut entry: Queued = decoded(&data)?;
        if entry.receipt_store.as_ref().is_none_or(|receipt| receipt.id.is_none()) && let Some(seq) = entry.sent_seq.or(entry.observed_seq) {
            let observed = entry.sent_seq.is_none();
            record_receipt(tx, &mut entry, seq, observed, false)?;
        }
    }
    Ok(())
}
