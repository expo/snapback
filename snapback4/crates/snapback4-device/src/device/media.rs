//! Server upload facts for prediction, and home-row identities for retained bytes.
use super::*;
use snapback4_core::ir::{ArgType, Expr, KeyProvenance, ProgramKind, Read, Stmt};
use snapback4_core::schema::ColumnType;
use serde_json::{Value as Json, json};

fn upload_key(viewer: &str, id: &str) -> String { format!("device:upload:{}", json!([viewer, id])) }
fn home_key(id: &str) -> String { format!("device:media:{id}") }

// @ref LLP 3000.007#8 — prediction uses the uploader's server facts, never argument facts
pub(super) fn inputs<T: DeviceTx>(tx: &T, program: &Program, viewer: &str, args: &Json) -> Result<BTreeMap<String, Value>, RuntimeError> {
    fn resolve<T: DeviceTx>(tx: &T, viewer: &str, kind: &ArgType, value: &mut Value) -> Result<(), RuntimeError> {
        match kind {
            ArgType::Optional(inner) if *value != Value::Null => resolve(tx, viewer, inner, value)?,
            ArgType::List { of: Some(inner), .. } => if let Value::Array(items) = value { for item in items { resolve(tx, viewer, inner, item)?; } },
            ArgType::Image { .. } | ArgType::Video { .. } => {
                let id = value.field("id")?.as_str()?;
                let facts = tx.meta(&upload_key(viewer, id))?.ok_or_else(|| RuntimeError::Prediction("this device has no server upload facts; the server must judge this asset".into()))?;
                *value = wire::from_json(kind, &decoded::<Json>(&facts)?).map_err(RuntimeError::Input)?;
            }
            _ => {}
        }
        Ok(())
    }
    let mut values = typed_args(program, args)?;
    for (name, value) in &mut values { resolve(tx, viewer, &program.args[name], value)?; }
    Ok(values)
}

fn media_type(kind: &ColumnType) -> Option<bool> {
    match kind {
        ColumnType::Optional(inner) => media_type(inner),
        ColumnType::Image { once, .. } => Some(*once),
        ColumnType::Video { .. } => Some(false),
        _ => None,
    }
}

/// Index only confirmed stream images, never predicted placements. Stale entries
/// are harmless: every access checks the current row, generation and lifetime.
pub(super) fn remember(tx: &dyn crate::store::StreamTx, table_name: &str, table: &Table, row: &Value, generation: u64) -> Result<(), RuntimeError> {
    if table.sync.is_none() { return Ok(()); }
    for (column, kind) in &table.columns {
        if media_type(kind).is_none() { continue; }
        let Some(id) = row.field(column).ok().and_then(|v| v.field("id").ok()).and_then(|v| v.as_str().ok()) else { continue };
        tx.set_meta(&home_key(id), &encoded(&json!({ "table": table_name, "row": row.field("id")?.as_str()?, "column": column, "generation": generation }))?)?;
    }
    Ok(())
}

pub(super) fn forget(tx: &dyn crate::store::StreamTx, table: &Table, row: &Value) -> Result<(), RuntimeError> {
    for (column, kind) in &table.columns {
        if media_type(kind).is_none() { continue; }
        if let Some(id) = row.field(column).ok().and_then(|v| v.field("id").ok()).and_then(|v| v.as_str().ok()) {
            tx.delete_meta(&[&home_key(id)])?;
        }
    }
    Ok(())
}

/// Delivered history keeps rows, but retires their media. Page by the unique
/// primary key: an audience index need not have a unique resume suffix.
pub(super) fn leave(tx: &dyn crate::store::StreamTx, name: &str, table: &Table, group: &[Value]) -> Result<(), RuntimeError> {
    if !table.columns.values().any(|kind| media_type(kind).is_some()) { return Ok(()); }
    let columns = audience_prefix(table);
    let mut bounds = Bounds::default();
    loop {
        let rows = tx.scan(name, "byId", &[], &bounds, Dir::Asc, 500)?;
        for (row, _) in &rows {
            if columns.iter().zip(group).all(|(column, value)| row.field(column).ok() == Some(value)) { forget(tx, table, row)?; }
            bounds.after = Some(vec![row.field("id")?.clone()]);
        }
        if rows.len() < 500 { return Ok(()); }
    }
}

impl<S: DeviceStore> Device<S> {
    /// Internal transport receipt: called only with the reply to this viewer's upload.
    pub fn upload_facts(&mut self, viewer: &str, asset: &Json) -> Result<(), RuntimeError> {
        let id = asset.get("id").and_then(Json::as_str).ok_or_else(|| RuntimeError::Input("upload facts need an id".into()))?;
        // Parsing is not authentication: the host supplies the authenticated receipt.
        wire::from_json(&ArgType::Image { max: u32::MAX }, asset).map_err(RuntimeError::Input)?;
        self.store.set_meta(&upload_key(viewer, id), &encoded(asset)?)
    }

    /// Retire a transport receipt whose session changed while the host persisted it.
    pub fn forget_upload_facts(&mut self, viewer: &str, id: &str) -> Result<(), RuntimeError> {
        let tx = self.store.transaction()?;
        tx.delete_meta(&[&upload_key(viewer, id)])?;
        tx.commit()
    }

    // @ref LLP 3000.007#8 — retained media follows its current home, including offline expiry
    pub fn asset_home(&mut self, id: &str, viewer: &str, now: i64) -> Result<Json, RuntimeError> {
        let tx = self.store.read_transaction()?;
        let Some(held) = tx.meta(&home_key(id))? else { return Ok(Json::Null) };
        let home: Json = decoded(&held)?;
        if home["generation"].as_u64() != Some(self.generation) { return Ok(Json::Null); }
        let (Some(name), Some(row), Some(column)) = (home["table"].as_str(), home["row"].as_str(), home["column"].as_str()) else { return Ok(Json::Null) };
        let Some(table) = self.schema.table(name) else { return Ok(Json::Null) };
        if table.sync.is_none() || table.columns.get(column).and_then(media_type) != Some(false) { return Ok(Json::Null); }
        let program = Program { name: "device asset home".into(), kind: ProgramKind::Query, args: BTreeMap::new(), read_time_granularity_ms: None, native: false, returned_shapes: Default::default(),
            body: vec![Stmt::Return(Expr::Get(Read { site: "asset home".into(), table: name.into(), index: "byId".into(), key: vec![Expr::Literal(Value::Id(row.into()))], provenance: KeyProvenance::Const }))] };
        // Media is revoked even when textual delivered history is retained.
        let mut schema = self.schema.clone();
        schema.tables.get_mut(name).expect("home table").leave = LeavePolicy::UntilRevoked;
        let read = local::query(&tx, &schema, &program, Context::new(viewer, BTreeMap::new()).at(now), Ceilings::default());
        let Ok(read) = read else { return Ok(Json::Null) };
        if read.data.field("pending").ok() == Some(&Value::Bool(true)) { return Ok(Json::Null); }
        let Some(asset) = read.data.field(column).ok() else { return Ok(Json::Null) };
        if asset.field("id").ok().and_then(|v| v.as_str().ok()) != Some(id) { return Ok(Json::Null); }
        let mut home = home;
        home["expiresAt"] = json!(read.next_expiry);
        home["type"] = json!(asset.field("type").ok().and_then(|v| v.as_str().ok()));
        tx.rollback()?;
        Ok(home)
    }
}
