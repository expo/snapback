//! Progressive cold acquisition is ordinary publication, including deferral.
use super::*;

pub(super) const CURSOR: &str = "device:acquisition-cursor";
const TABLES: &str = "device:acquired-table:";
const COMPLETE_AT: &str = "device:acquisition-complete-at";
pub(super) const REPLACEMENT: &str = "device:acquisition-replacement";
const FORMAT: &str = "device:progressive-format";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AcquisitionUnit {
    pub tier: usize,
    pub table: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<Vec<serde_json::Value>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AcquisitionProgress {
    /// Adopt images_at as the sole applied watermark with the first cold unit.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    pub unit: Option<AcquisitionUnit>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub units: Vec<AcquisitionUnit>,
    pub cursor: Option<String>,
    pub exhausted: bool,
    pub whole_tables: Vec<String>,
}

pub(super) fn whole_eligible(schema: &Schema, name: &str) -> bool {
    schema.table(name).is_some_and(|table| table.sync.as_ref().is_some_and(|s| s.horizon.is_none() && !s.is_union())
        && table.through.is_none() && schema.maintain_for(name).is_none()
        && !schema.timelines.iter().any(|timeline| timeline.owns(name)))
}

pub(super) fn validate<T: DeviceTx>(tx: &T, schema: &Schema, page: &StreamPage) -> Result<(), RuntimeError> {
    let Some(progress) = &page.acquire else { return Ok(()) };
    if page.snapshot || page.snapshot_catchup || tx.meta(SNAPSHOT_OWNER)?.is_some()
        || tx.meta(REPLACEMENT)?.is_some() || tx.meta(media::FORMAT)?.as_deref() != Some(media::ROW_FORMAT) {
        return Err(RuntimeError::Generation("re-acquisition requires a staged replacement snapshot".into()));
    }
    if progress.exhausted != progress.cursor.is_none() || progress.cursor.as_deref() == Some("")
        || page.images_at.is_none_or(|head| head < page.watermark)
        || progress.whole_tables.iter().any(|name| !whole_eligible(schema, name)) {
        return Err(RuntimeError::Input("invalid progressive acquisition facts".into()));
    }
    // @ref LLP 3000.001.001#61-the-acquisition-page — a pin can skip historical joins only before any partition state has published.
    if progress.pinned {
        let started = meta_u64(tx, WATERMARK)? != 0 || tx.meta(ACQUIRED)?.is_some()
            || tx.meta(CURSOR)?.is_some() || tx.meta(COMPLETE_AT)?.is_some()
            || deferred::cursor(tx)?.is_some() || !tx.meta_prefix(TABLES)?.is_empty()
            || !tx.meta_prefix(boundary::BOUNDARIES)?.is_empty();
        if started || page.images_at != Some(page.watermark)
            || page.requested_watermark.is_some_and(|from| from != 0) {
            return Err(RuntimeError::Generation("a stream pin requires a cold empty partition; restart acquisition".into()));
        }
        for name in schema.tables.keys() {
            if tx.base_has_table(name)? || !tx.scan(name, "byId", &[], &Bounds::default(), Dir::Asc, 1)?.is_empty() {
                return Err(RuntimeError::Generation("a stream pin requires a cold empty partition; restart acquisition".into()));
            }
        }
    }
    if !progress.units.is_empty() && progress.unit.as_ref() != progress.units.first() {
        return Err(RuntimeError::Input("acquisition unit must name the first packed unit".into()));
    }
    for unit in progress.units.iter().chain(progress.unit.iter()) {
        let valid = schema.table(&unit.table).and_then(|t| t.sync.as_ref()).is_some_and(|s|
            match unit.tier { 1 => s.horizon.is_none() && unit.group.is_none(),
                2 => s.horizon.is_some() && unit.group.is_some(), _ => false });
        if !valid { return Err(RuntimeError::Input("invalid acquisition unit".into())); }
    }
    Ok(())
}

// @ref LLP 3000.001.001#9-scope-compatibility-and-costs — old Backend decoders refuse this durable envelope before reading an upgraded partition.
// Keep the wire Backend unchanged. The durable discriminator replaces only
// generation; schema stays at its existing path for host residency accounting.
// No rows, outbox entries or receipts are removed by this upgrade.
pub(super) fn backend_text(backend: &Backend, upgraded: bool) -> Result<String, RuntimeError> {
    if !upgraded { return encoded(backend); }
    #[derive(Serialize)]
    struct Kept<'a> { progressive_generation: u64, schema: &'a Schema, programs: &'a [Program] }
    encoded(&Kept { progressive_generation: backend.generation, schema: &backend.schema, programs: &backend.programs })
}

pub(super) fn stamp<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    if tx.meta(FORMAT)?.is_none() {
        let backend: Backend = decoded(&tx.meta(BACKEND)?.ok_or_else(|| RuntimeError::Store("missing device backend".into()))?)?;
        tx.set_meta(BACKEND, &backend_text(&backend, true)?)?;
        tx.set_meta(FORMAT, "1")?;
    }
    Ok(())
}

pub(super) fn upgraded<S: DeviceStore>(store: &S) -> Result<bool, RuntimeError> { Ok(store.meta(FORMAT)?.is_some()) }

// @ref LLP 3000.001.001#61-the-acquisition-page — called through the ordinary recording applicator, so rows and facts defer and commit together.
pub(super) fn events(tx: &dyn crate::store::StreamTx, page: &StreamPage, touched: &mut BTreeSet<String>) -> Result<(), RuntimeError> {
    let Some(progress) = &page.acquire else { return Ok(()) };
    tx.set_meta(CURSOR, progress.cursor.as_deref().unwrap_or(""))?;
    for name in &progress.whole_tables {
        tx.set_meta(&format!("{TABLES}{name}"), &page.watermark.to_string())?;
        touched.insert(name.clone());
    }
    if progress.exhausted {
        tx.set_meta(COMPLETE_AT, &page.images_at.expect("validated acquisition head").to_string())?;
    } else { tx.delete_meta(&[COMPLETE_AT])?; }
    Ok(())
}

pub(super) fn history(tx: &dyn crate::store::StreamTx, schema: &Schema, page: &StreamPage) -> Result<(), RuntimeError> {
    let progressive = page.acquire.is_some() || tx.meta(CURSOR)?.is_some();
    let before = if progressive { history::load(tx, history::GROUPS)? } else { Default::default() };
    history::events(tx, schema, &page.events, &page.joined, false)?;
    if !progressive { return Ok(()); }
    let mut groups = history::load(tx, history::GROUPS)?;
    if let Some(progress) = &page.acquire {
        // @ref LLP 3000.001.001#61-the-acquisition-page — a mixed page carries retained tier-1 rows beside every joined group's rows and floors.
        for event in page.events.iter().filter(|e| e.kind == "put" && progress.units.iter().chain(progress.unit.iter())
            .any(|unit| unit.tier == 1 && unit.table == e.table)) {
            let Some(table) = schema.table(&event.table).filter(|t| t.leave == LeavePolicy::DeliveredHistory) else { continue };
            let row = wire::row_from_json(table, event.data.as_ref().expect("validated row")).map_err(RuntimeError::Input)?;
            groups.entry(event.table.clone()).or_default().entry(history::row_key(table, &row)?).or_insert(history::Membership::Held);
        }
    }
    // @ref LLP 3000.001.001#64-re-acquisition-stays-staged-in-the-first-increment — a cold group becomes Held; Left/Rejoined still require full replacement.
    for (name, joined) in &page.joined {
        for group in joined {
            let key = encoded(group)?;
            if !scoped(schema, &page.events, name, group)?
                && before.get(name).and_then(|g| g.get(&key)).is_none_or(|m| *m == history::Membership::Held) {
                groups.entry(name.clone()).or_default().insert(key, history::Membership::Held);
            }
        }
    }
    if groups != history::load(tx, history::GROUPS)? { tx.set_meta(history::GROUPS, &encoded(&groups)?)?; }
    Ok(())
}

pub(super) fn tables<T: DeviceTx>(tx: &T) -> Result<Vec<String>, RuntimeError> {
    Ok(tx.meta_prefix(TABLES)?.into_iter().map(|(key, _)| key[TABLES.len()..].to_owned()).collect())
}

pub(super) fn exhausted<T: DeviceTx>(tx: &T) -> Result<bool, RuntimeError> { Ok(tx.meta(COMPLETE_AT)?.is_some()) }

// This target is completion evidence, not another applied cut. WATERMARK remains
// the sole partition cut; a busy stream can pass the target without quiescing.
// @ref LLP 3000.001.001#62-the-walk-its-cursor-and-completion — exhaustion and application through the final image head jointly establish ACQUIRED.
pub(super) fn publish<T: DeviceTx>(tx: &T, schema: &Schema, page: &StreamPage, replacing: bool, generation: u64) -> Result<(), RuntimeError> {
    if replacing {
        tx.delete_meta(&[CURSOR, COMPLETE_AT, TABLES, REPLACEMENT])?;
        for (name, _, _) in schema.synced().filter(|(name, _, _)| whole_eligible(schema, name)) {
            tx.set_meta(&format!("{TABLES}{name}"), &page.watermark.to_string())?;
        }
    }
    let complete = if tx.meta(CURSOR)?.is_some() {
        tx.meta(COMPLETE_AT)?.map(|value| decoded::<u64>(&value)).transpose()?.is_some_and(|head| page.watermark >= head)
    } else {
        // Legacy transports historically complete even a replacement through
        // an ordinary terminal page. Preserve that contract for stores which
        // have never published progressive state; upgraded stores stay staged.
        !page.more && (tx.meta(REPLACEMENT)?.is_none() || tx.meta(FORMAT)?.is_none())
    };
    if complete { tx.set_meta(ACQUIRED, &generation.to_string())?; }
    Ok(())
}

pub(super) fn reset<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    tx.delete_meta(&[CURSOR, COMPLETE_AT, TABLES])?;
    tx.set_meta(boundary::COUNT, "0")?;
    tx.set_meta(REPLACEMENT, "1")
}

// @ref LLP 3000.001.001#52-a-safe-read-before-full-acquisition — admit query programs to existing per-range coverage; prediction retains require_acquired.
pub(super) fn require_read<T: DeviceTx>(tx: &T, schema: &Schema, program: &Program, boundaries: &boundary::Boundaries) -> Result<(), RuntimeError> {
    match require_acquired(tx, schema, program) {
        Ok(()) => return Ok(()),
        Err(RuntimeError::Prediction(_)) => {},
        Err(error) => return Err(error),
    }
    store_identity::require_healthy(tx)?;
    if tx.meta(BACKEND_REQUIRED)?.is_some_and(|s| !s.is_empty()) || program.native {
        return require_acquired(tx, schema, program);
    }
    for site in snapback4_core::ir::read_sites(program) {
        if schema.table(&site.table).is_some_and(|t| t.sync.is_some())
            && tx.meta(&format!("{TABLES}{}", site.table))?.is_none()
            && !boundaries.has_table(&site.table)? {
            return Err(RuntimeError::Prediction("this read needs a table that has not completed acquisition".into()));
        }
    }
    Ok(())
}

pub(super) fn scoped(schema: &Schema, events: &[StreamEvent], name: &str, group: &[serde_json::Value]) -> Result<bool, RuntimeError> {
    for event in events.iter().filter(|e| e.table == name && e.kind == "scope") {
        let table = schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("unknown table {name}")))?;
        if scope_group(table, event)?.iter().map(wire::to_json).collect::<Vec<_>>() == group { return Ok(true); }
    }
    Ok(false)
}
