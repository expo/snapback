#![forbid(unsafe_code)]
//! The device core on the web: the same interpreter the server runs, as
//! wasm, over the rows the host keeps (IndexedDB, or SQLite in the
//! browser) and reaches through a few synchronous callbacks. Rows cross as
//! plain JSON, the wire's form, typed by the schema on the way in.

use snapback4_core::engine::local;
use snapback4_core::error::RuntimeError;
use snapback4_core::ir::Program;
use snapback4_core::meter::Ceilings;
use snapback4_core::rows::{Bounds, Dir, Rows};
use snapback4_core::schema::{Index, Schema, Table};
use snapback4_core::value::{Value, decode_bytes_hex, encode_bytes_hex};
use snapback4_core::{Context, wire};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// The host's store, inside one transaction: rows as JSON text, keys as
    /// hex; `undefined` where there is no row.
    pub type Host;
    #[wasm_bindgen(method, structural)]
    fn get(this: &Host, table: &str, id: &str) -> JsValue;
    #[wasm_bindgen(method, structural)]
    fn lookup(this: &Host, table: &str, index: &str, key: &str) -> JsValue;
    #[wasm_bindgen(method, structural)]
    fn scan(this: &Host, table: &str, index: &str, prefix: &str, bounds: &str, dir: &str, limit: u32) -> JsValue;
    #[wasm_bindgen(method, structural)]
    fn count(this: &Host, table: &str, index: &str, prefix: &str, limit: u32) -> u32;
    #[wasm_bindgen(method, structural)]
    fn put(this: &Host, table: &str, row: &str) -> u32;
    #[wasm_bindgen(method, structural)]
    fn delete(this: &Host, table: &str, id: &str) -> u32;
}

struct HostRows<'a> {
    host: &'a Host,
    schema: &'a Schema,
}

impl HostRows<'_> {
    fn table(&self, name: &str) -> Result<&Table, RuntimeError> {
        self.schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))
    }
    fn row(&self, table: &str, value: JsValue) -> Result<Option<Value>, RuntimeError> {
        let Some(text) = value.as_string() else { return Ok(None) };
        let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| RuntimeError::Store(e.to_string()))?;
        wire::row_from_json(self.table(table)?, &json).map(Some).map_err(RuntimeError::Store)
    }
}

fn plain(values: &[Value]) -> String {
    serde_json::Value::Array(values.iter().map(wire::to_json).collect()).to_string()
}

impl Rows for HostRows<'_> {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.row(table, self.host.get(table, id))
    }
    fn lookup(&self, table: &str, index_name: &str, _index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        self.row(table, self.host.lookup(table, index_name, &plain(key)))
    }
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let bounds_json = serde_json::json!({
            "after": bounds.after.as_ref().map(|v| plain(v)),
            "before": bounds.before.as_ref().map(|v| plain(v)),
            "gt": bounds.gt.as_ref().map(wire::to_json),
            "gte": bounds.gte.as_ref().map(wire::to_json),
            "lt": bounds.lt.as_ref().map(wire::to_json),
            "lte": bounds.lte.as_ref().map(wire::to_json),
        });
        let text = self.host.scan(table, index_name, &plain(prefix), &bounds_json.to_string(), if dir == Dir::Asc { "asc" } else { "desc" }, limit.min(u32::MAX as usize) as u32).as_string().unwrap_or_else(|| "[]".into());
        let pairs: Vec<(serde_json::Value, String)> = serde_json::from_str(&text).map_err(|e| RuntimeError::Store(e.to_string()))?;
        let definition = self.table(table)?;
        pairs
            .into_iter()
            .map(|(row, key)| Ok((wire::row_from_json(definition, &row).map_err(RuntimeError::Store)?, decode_bytes_hex(&key).unwrap_or_default())))
            .collect()
    }
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        Ok(u64::from(self.host.count(table, index_name, &plain(prefix), limit.min(u32::MAX as u64) as u32)))
    }
    fn put(&self, table_name: &str, _table: &Table, row: &Value, _old: Option<&Value>) -> Result<u64, RuntimeError> {
        Ok(u64::from(self.host.put(table_name, &wire::to_json(row).to_string())))
    }
    fn delete(&self, table_name: &str, _table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        Ok(u64::from(self.host.delete(table_name, old.field("id")?.as_str()?)))
    }
}

/// The compiled backend a device runs: the schema and the programs, as
/// `GET /schema` sends them.
#[wasm_bindgen]
pub struct Device {
    schema: Schema,
    programs: BTreeMap<String, Program>,
}

fn refusal_json(error: &RuntimeError) -> String {
    serde_json::to_string(&error.refusal()).unwrap_or_default()
}

#[wasm_bindgen]
impl Device {
    #[wasm_bindgen(constructor)]
    pub fn new(backend: &str) -> Result<Device, JsError> {
        #[derive(serde::Deserialize)]
        struct Backend {
            schema: Schema,
            programs: Vec<Program>,
        }
        let backend: Backend = serde_json::from_str(backend).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Device { schema: backend.schema, programs: backend.programs.into_iter().map(|p| (p.name.clone(), p)).collect() })
    }

    /// A query over the host's rows: `{ data, complete, next, tables }` or
    /// `{ denied }`, as the card reads it.
    pub fn query(&self, host: &Host, name: &str, viewer: &str, args: &str, now: f64) -> String {
        let Some(program) = self.programs.get(name) else { return format!(r#"{{"denied":{}}}"#, refusal_json(&RuntimeError::UnknownOp(name.to_owned()))) };
        let rows = HostRows { host, schema: &self.schema };
        let context = match self.context(program, viewer, args, now, "[]", 0) {
            Ok(context) => context,
            Err(error) => return format!(r#"{{"denied":{}}}"#, refusal_json(&error)),
        };
        match local::query(&rows, &self.schema, program, context, Ceilings::default()) {
            Ok(outcome) => serde_json::json!({ "data": wire::to_json(&outcome.data), "complete": outcome.complete, "next": outcome.next, "tables": outcome.tables }).to_string(),
            Err(refusal) => serde_json::json!({ "denied": refusal }).to_string(),
        }
    }

    /// A mutation predicted over the host's rows, inside the host's
    /// transaction: `{ result, written }` or `{ denied }`; the host marks
    /// the rows pending, or rolls back on `denied`.
    pub fn predict(&self, host: &Host, name: &str, viewer: &str, args: &str, now: f64, new_ids: &str, entropy: f64) -> String {
        let Some(program) = self.programs.get(name) else { return format!(r#"{{"denied":{}}}"#, refusal_json(&RuntimeError::UnknownOp(name.to_owned()))) };
        let rows = HostRows { host, schema: &self.schema };
        let context = match self.context(program, viewer, args, now, new_ids, entropy as u64) {
            Ok(context) => context,
            Err(error) => return format!(r#"{{"denied":{}}}"#, refusal_json(&error)),
        };
        match local::predict(&rows, &self.schema, program, context, Ceilings::default()) {
            Ok(prediction) => serde_json::json!({ "result": wire::to_json(&prediction.result), "written": prediction.written, "read": prediction.read }).to_string(),
            Err(error) => format!(r#"{{"denied":{}}}"#, refusal_json(&error)),
        }
    }

    fn context(&self, program: &Program, viewer: &str, args: &str, now: f64, new_ids: &str, entropy: u64) -> Result<Context, RuntimeError> {
        let json: serde_json::Value = serde_json::from_str(if args.is_empty() { "{}" } else { args }).map_err(|e| RuntimeError::Input(e.to_string()))?;
        let mut typed = BTreeMap::new();
        if let serde_json::Value::Object(fields) = &json {
            for (name, value) in fields {
                let kind = program.args.get(name).ok_or_else(|| RuntimeError::Input(format!("{} takes no argument {name}", program.name)))?;
                typed.insert(name.clone(), wire::from_json(kind, value).map_err(|why| RuntimeError::Input(format!("argument {name}: {why}")))?);
            }
        }
        let ids: Vec<String> = serde_json::from_str(new_ids).unwrap_or_default();
        Ok(Context::new(viewer, typed).at(now as i64).with_ids(ids).with_entropy(entropy.max(1)))
    }
}

/// The key bytes of one index entry, for a host that stores keys the
/// server's way: components then the id, hex.
#[wasm_bindgen]
pub fn index_key(schema_table: &str, index: &str, row: &str) -> Result<String, JsError> {
    let table: Table = serde_json::from_str(schema_table).map_err(|e| JsError::new(&e.to_string()))?;
    let definition = table.index(index).ok_or_else(|| JsError::new("no such index"))?;
    let json: serde_json::Value = serde_json::from_str(row).map_err(|e| JsError::new(&e.to_string()))?;
    let row = wire::row_from_json(&table, &json).map_err(|e| JsError::new(&e))?;
    let id = row.field("id").map_err(|e| JsError::new(&e.to_string()))?.as_str().map_err(|e| JsError::new(&e.to_string()))?.to_owned();
    Ok(encode_bytes_hex(&snapback4_core::rows::index_key(definition, &row, &id)))
}
