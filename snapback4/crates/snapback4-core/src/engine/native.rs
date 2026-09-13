//! Native jobs (LLP 3000.005): the app's own Rust, compiled to wasm, hosted
//! by the engine as a job. One chunk per call, one transaction per chunk;
//! every read and write is the interpreter's own, so the meter counts it
//! and rules' companions — validation, constraints, maintains, the
//! partition log — apply; fuel bounds the instructions. The module imports
//! one function and nothing else: no clock, no randomness, no I/O, so a
//! native job runs under the simulator like any other.

use super::runner::Runner;
use crate::error::{MeterKind, Refusal, RuntimeError};
use crate::ir::{Bound, Expr, IndexKeyExpr, KeyProvenance, Order, Read, Scan};
use crate::partition::Event;
use crate::schema::{Index, Schema, Table};
use crate::value::Value;
use crate::wire;
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;

/// A chunk's instruction budget: the native job's step ceiling. Measured
/// on the fixture: one host call costs about 90,000 units (the JSON each
/// way, interpreted), so a chunk at the write ceiling (8,192 rows) spends
/// about 750,000,000; this leaves the row ceilings binding first.
pub const FUEL_PER_CHUNK: u64 = 2_000_000_000;

/// The most rows one `scan` may ask for: the job's examined ceiling.
const SCAN_MAX: u64 = 16_384;

/// A compiled module, held by the engine and instantiated per chunk.
pub struct Module {
    engine: wasmi::Engine,
    module: wasmi::Module,
    jobs: Vec<String>,
}

fn structural(message: String) -> RuntimeError {
    RuntimeError::Native { code: "E_NATIVE".into(), message }
}

/// What a chunk returned: done, or again with the state the module chose.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    Done,
    Again(Json),
}

/// What one chunk did, for the job row and the log.
pub(crate) struct ChunkOutcome {
    pub step: Result<Step, RuntimeError>,
    pub events: Vec<Event>,
    pub tables: Vec<String>,
    pub outbox: Vec<(String, String, Value)>,
    pub rows_written: u64,
    pub logs: Vec<String>,
}

/// The host side of one instantiation: the chunk's runner, the sticky
/// refusal, and the module's memory and allocator once instantiated.
pub(crate) struct Host<'a> {
    runner: Option<Runner<'a>>,
    job: String,
    /// The first refusal a host operation returned; every later call in
    /// the chunk returns it again, and the chunk parks with it.
    refused: Option<Refusal>,
    /// A store failure: the chunk is rolled back and the error returned.
    failed: Option<RuntimeError>,
    logs: Vec<String>,
    memory: Option<wasmi::Memory>,
    alloc: Option<wasmi::TypedFunc<i32, i32>>,
}

impl<'a> Host<'a> {
    fn idle() -> Self {
        Self { runner: None, job: String::new(), refused: None, failed: None, logs: Vec::new(), memory: None, alloc: None }
    }
}

impl Module {
    /// Compile the module and read the jobs it implements (`sb4_jobs`).
    pub fn compile(bytes: &[u8]) -> Result<Self, RuntimeError> {
        let mut config = wasmi::Config::default();
        config.consume_fuel(true);
        let engine = wasmi::Engine::new(&config);
        let module = wasmi::Module::new(&engine, bytes).map_err(|e| structural(format!("the native module does not load: {e}")))?;
        let mut module = Self { engine, module, jobs: Vec::new() };
        module.jobs = module.list_jobs()?;
        Ok(module)
    }

    /// The jobs the module implements, as `sb4_jobs` named them.
    pub fn jobs(&self) -> &[String] {
        &self.jobs
    }

    fn list_jobs(&self) -> Result<Vec<String>, RuntimeError> {
        let mut store = wasmi::Store::new(&self.engine, Host::idle());
        store.set_fuel(FUEL_PER_CHUNK).map_err(|e| structural(e.to_string()))?;
        let instance = self.instantiate(&mut store)?;
        let jobs = instance.get_typed_func::<(), i64>(&store, "sb4_jobs").map_err(|_| structural("the native module exports no sb4_jobs; declare its jobs with snapback4_native::jobs! { .. }".into()))?;
        let packed = jobs.call(&mut store, ()).map_err(|e| structural(format!("sb4_jobs trapped: {e}")))?;
        let text = read_packed(&mut store, packed)?;
        serde_json::from_str(&text).map_err(|e| structural(format!("sb4_jobs answered something other than a list of names: {e}")))
    }

    fn instantiate<'a>(&self, store: &mut wasmi::Store<Host<'a>>) -> Result<wasmi::Instance, RuntimeError> {
        let mut linker = wasmi::Linker::<Host<'a>>::new(&self.engine);
        linker.func_wrap("env", "sb4_call", host_call).map_err(|e| structural(e.to_string()))?;
        let instance = linker.instantiate_and_start(&mut *store, &self.module).map_err(|e| structural(format!("the native module does not instantiate: {e}")))?;
        let memory = instance.get_memory(&*store, "memory").ok_or_else(|| structural("the native module exports no memory".into()))?;
        let alloc = instance.get_typed_func::<i32, i32>(&*store, "sb4_alloc").map_err(|_| structural("the native module exports no sb4_alloc; declare its jobs with snapback4_native::jobs! { .. }".into()))?;
        store.data_mut().memory = Some(memory);
        store.data_mut().alloc = Some(alloc);
        Ok(instance)
    }
}

/// `env.sb4_call(ptr, len) -> packed`: the module's one import. A JSON
/// request in its memory; the answer written into memory it allocates,
/// returned as `(ptr << 32) | len`; 0 when the host could not answer.
fn host_call<'a>(mut caller: wasmi::Caller<'_, Host<'a>>, ptr: i32, len: i32) -> i64 {
    let Some(memory) = caller.data().memory else { return 0 };
    let mut bytes = vec![0u8; len.max(0) as usize];
    if memory.read(&caller, ptr as u32 as usize, &mut bytes).is_err() {
        return 0;
    }
    let request: Json = match serde_json::from_slice(&bytes) {
        Ok(json) => json,
        Err(error) => json!({ "op": "?", "malformed": error.to_string() }),
    };
    let answer = handle(caller.data_mut(), &request);
    let text = serde_json::to_vec(&answer).unwrap_or_default();
    let (Some(memory), Some(alloc)) = (caller.data().memory, caller.data().alloc.clone()) else { return 0 };
    let Ok(out) = alloc.call(&mut caller, text.len() as i32) else { return 0 };
    if memory.write(&mut caller, out as u32 as usize, &text).is_err() {
        return 0;
    }
    ((out as u32 as i64) << 32) | (text.len() as i64)
}

fn read_packed<'a>(store: &mut wasmi::Store<Host<'a>>, packed: i64) -> Result<String, RuntimeError> {
    let Some(memory) = store.data().memory else { return Err(structural("no memory".into())) };
    let ptr = (packed >> 32) as u32 as usize;
    let len = packed as u32 as usize;
    let mut bytes = vec![0u8; len];
    memory.read(&*store, ptr, &mut bytes).map_err(|e| structural(format!("the module's answer is out of bounds: {e}")))?;
    String::from_utf8(bytes).map_err(|_| structural("the module's answer is not UTF-8".into()))
}

fn write_bytes<'a>(store: &mut wasmi::Store<Host<'a>>, bytes: &[u8]) -> Result<(i32, i32), RuntimeError> {
    let (Some(memory), Some(alloc)) = (store.data().memory, store.data().alloc.clone()) else { return Err(structural("the module is not instantiated".into())) };
    let ptr = alloc.call(&mut *store, bytes.len() as i32).map_err(|e| structural(format!("sb4_alloc trapped: {e}")))?;
    memory.write(&mut *store, ptr as u32 as usize, bytes).map_err(|e| structural(format!("cannot write the request into the module: {e}")))?;
    Ok((ptr, bytes.len() as i32))
}

/// Run one chunk: instantiate the module, hand it the job's arguments and
/// the state it returned last time, and collect what the chunk wrote.
pub(crate) fn run_chunk(module: &Module, runner: Runner<'_>, job: &str, args: &BTreeMap<String, Value>, state: Option<Json>, now: i64) -> ChunkOutcome {
    let mut store = wasmi::Store::new(&module.engine, Host { runner: Some(runner), job: job.to_owned(), refused: None, failed: None, logs: Vec::new(), memory: None, alloc: None });
    let step = (|| -> Result<Step, RuntimeError> {
        store.set_fuel(FUEL_PER_CHUNK).map_err(|e| structural(e.to_string()))?;
        let instance = module.instantiate(&mut store)?;
        let run = instance.get_typed_func::<(i32, i32), i64>(&store, "sb4_run").map_err(|_| structural("the native module exports no sb4_run; declare its jobs with snapback4_native::jobs! { .. }".into()))?;
        let input = serde_json::to_vec(&json!({ "job": job, "args": wire::map_to_json(args), "state": state, "now": now })).unwrap_or_default();
        let (ptr, len) = write_bytes(&mut store, &input)?;
        let started = std::time::Instant::now();
        let called = run.call(&mut store, (ptr, len));
        if std::env::var_os("SNAPBACK4_FUEL_PROBE").is_some() {
            // For tuning the ceiling: what a chunk spent, and how long it took.
            eprintln!("snapback4: native {job}: {} fuel in {:?}", FUEL_PER_CHUNK.saturating_sub(store.get_fuel().unwrap_or(0)), started.elapsed());
        }
        if let Some(failed) = store.data_mut().failed.take() {
            return Err(failed);
        }
        if let Some(refusal) = store.data().refused.clone() {
            return Err(RuntimeError::Native { code: refusal.code, message: refusal.message });
        }
        let packed = match called {
            Ok(packed) => packed,
            Err(error) => {
                if error.as_trap_code() == Some(wasmi::TrapCode::OutOfFuel) {
                    return Err(RuntimeError::Bound { kind: MeterKind::Steps, actual: FUEL_PER_CHUNK, ceiling: FUEL_PER_CHUNK, site: format!("native.{job}") });
                }
                let why = store.data().logs.last().cloned().unwrap_or_else(|| error.to_string());
                return Err(RuntimeError::Native { code: "E_NATIVE_TRAP".into(), message: format!("job {job} trapped: {why}") });
            }
        };
        let text = read_packed(&mut store, packed)?;
        let answer: Json = serde_json::from_str(&text).map_err(|e| structural(format!("job {job} answered something other than JSON: {e}")))?;
        if answer.get("done").and_then(Json::as_bool) == Some(true) {
            return Ok(Step::Done);
        }
        if let Some(state) = answer.get("again") {
            return Ok(Step::Again(state.clone()));
        }
        if let Some(error) = answer.get("error") {
            let code = error.get("code").and_then(Json::as_str).unwrap_or("E_NATIVE").to_owned();
            let message = error.get("message").and_then(Json::as_str).unwrap_or("the job refused").to_owned();
            return Err(RuntimeError::Native { code, message });
        }
        Err(structural(format!("job {job} answered neither done, again nor error: {text}")))
    })();
    let host = store.into_data();
    let mut runner = host.runner.expect("the chunk's runner");
    ChunkOutcome {
        step,
        events: std::mem::take(&mut runner.events),
        tables: runner.written_tables.iter().cloned().collect(),
        outbox: std::mem::take(&mut runner.outbox),
        rows_written: runner.rows_written,
        logs: host.logs,
    }
}

/// The chunk of a native job when no module is installed.
pub(crate) fn missing(runner: Runner<'_>, job: &str) -> ChunkOutcome {
    drop(runner);
    ChunkOutcome { step: Err(structural(format!("job {job} is native but no module is installed; `snapback4 check` builds snapback/native, then restart"))), events: Vec::new(), tables: Vec::new(), outbox: Vec::new(), rows_written: 0, logs: Vec::new() }
}

/// One request from the module, answered as `{ ok }` or `{ error }`.
fn handle(host: &mut Host<'_>, request: &Json) -> Json {
    let op = request.get("op").and_then(Json::as_str).unwrap_or("");
    if op == "log" {
        host.logs.push(request.get("message").and_then(Json::as_str).unwrap_or("").to_owned());
        return json!({ "ok": null });
    }
    if let Some(refusal) = &host.refused {
        return json!({ "error": refusal });
    }
    if host.failed.is_some() {
        return json!({ "error": Refusal::new("E_STORE", "store", "the store failed earlier in this chunk") });
    }
    let Some(runner) = host.runner.as_mut() else {
        return json!({ "error": Refusal::new("E_NATIVE", "schema", "no transaction: only sb4_jobs runs outside a chunk") });
    };
    match dispatch(runner, &host.job, op, request) {
        Ok(value) => json!({ "ok": value }),
        Err(error) => {
            let refusal = error.refusal();
            if error.is_refusal() {
                host.refused = Some(refusal.clone());
            } else {
                host.failed = Some(error);
            }
            json!({ "error": refusal })
        }
    }
}

fn text_field<'r>(request: &'r Json, name: &str, op: &str) -> Result<&'r str, RuntimeError> {
    request.get(name).and_then(Json::as_str).ok_or_else(|| RuntimeError::Input(format!("native {op} needs {name}")))
}

fn table_of<'s>(schema: &'s Schema, name: &str) -> Result<&'s Table, RuntimeError> {
    schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))
}

fn index_of<'t>(table: &'t Table, table_name: &str, name: &str) -> Result<&'t Index, RuntimeError> {
    table.index(name).ok_or_else(|| RuntimeError::Schema(format!("missing index {table_name}.{name}")))
}

/// Key components typed by the index's columns; a column the table does
/// not declare (an aggregate's group) is typed as the JSON says.
fn typed_components(table: &Table, columns: &[String], values: &[Json]) -> Result<Vec<Value>, RuntimeError> {
    columns.iter().zip(values).map(|(column, json)| match table.columns.get(column) {
        Some(kind) => wire::column_from_json(kind, json).map_err(|why| RuntimeError::Input(format!("{column}: {why}"))),
        None if column == "id" => json.as_str().map(|s| Value::Id(s.to_owned())).ok_or_else(|| RuntimeError::Input("id: a string".into())),
        None => wire::untyped(json).map_err(RuntimeError::Input),
    }).collect()
}

fn typed_row(table: &Table, table_name: &str, json: &Json) -> Result<Value, RuntimeError> {
    wire::row_from_json(table, json).map_err(|why| RuntimeError::Input(format!("{table_name}: {why}")))
}

fn point(site: String, table: &str, index: &str, key: Vec<Value>) -> Read {
    Read { site, table: table.to_owned(), index: index.to_owned(), key: key.into_iter().map(Expr::Literal).collect(), provenance: KeyProvenance::Computed }
}

fn dispatch(runner: &mut Runner<'_>, job: &str, op: &str, request: &Json) -> Result<Json, RuntimeError> {
    let site = format!("native.{job}.{op}");
    match op {
        "now" => Ok(json!(runner.context.now)),
        "mint" => Ok(json!(runner.context.mint())),
        "get" => {
            let table = text_field(request, "table", op)?;
            let id = text_field(request, "id", op)?;
            table_of(runner.schema, table)?;
            let row = runner.get(&point(site, table, "byId", vec![Value::Id(id.to_owned())]))?;
            Ok(wire::to_json(&row))
        }
        "lookup" => {
            let table_name = text_field(request, "table", op)?;
            let index_name = text_field(request, "index", op)?;
            let table = table_of(runner.schema, table_name)?;
            let index = index_of(table, table_name, index_name)?;
            let values = request.get("key").and_then(Json::as_array).ok_or_else(|| RuntimeError::Input("native lookup needs key: [..]".into()))?;
            let columns = index.columns();
            if values.len() != columns.len() {
                return Err(RuntimeError::Input(format!("lookup {table_name}.{index_name} takes {} key components, received {}", columns.len(), values.len())));
            }
            let key = typed_components(table, &columns, values)?;
            let row = runner.get(&point(site, table_name, index_name, key))?;
            Ok(wire::to_json(&row))
        }
        "scan" => {
            let table_name = text_field(request, "table", op)?;
            let index_name = text_field(request, "index", op)?;
            let table = table_of(runner.schema, table_name)?;
            let index = index_of(table, table_name, index_name)?;
            let columns = index.columns();
            let prefix_json = request.get("prefix").and_then(Json::as_array).cloned().unwrap_or_default();
            if prefix_json.len() >= columns.len() {
                return Err(RuntimeError::Input(format!("scan {table_name}.{index_name}: a prefix of {} leaves nothing to scan over", prefix_json.len())));
            }
            let prefix = typed_components(table, &columns[..prefix_json.len()], &prefix_json)?;
            let first = request.get("first").and_then(Json::as_u64).ok_or_else(|| RuntimeError::Input("native scan needs first: N".into()))?;
            if first == 0 || first > SCAN_MAX {
                return Err(RuntimeError::Input(format!("native scan takes first 1..={SCAN_MAX}")));
            }
            let order = match request.get("order").and_then(Json::as_str).unwrap_or("asc") {
                "asc" => Order::Asc,
                "desc" => Order::Desc,
                other => return Err(RuntimeError::Input(format!("native scan order is asc or desc, not {other}"))),
            };
            let suffix_columns = &columns[prefix_json.len()..];
            let after = match request.get("after") {
                None | Some(Json::Null) => None,
                Some(Json::Array(values)) => {
                    if values.len() != suffix_columns.len() {
                        return Err(RuntimeError::Input(format!("scan {table_name}.{index_name}: after takes {} components, received {}", suffix_columns.len(), values.len())));
                    }
                    Some(Box::new(Expr::Literal(Value::Array(typed_components(table, suffix_columns, values)?))))
                }
                Some(_) => return Err(RuntimeError::Input("native scan after is the previous page's next, or null".into())),
            };
            let scan = Scan {
                site,
                table: table_name.to_owned(),
                index: index_name.to_owned(),
                prefix: prefix.into_iter().map(|value| IndexKeyExpr::Scalar(Expr::Literal(value))).collect(),
                order,
                take: Bound::Literal(first as u32),
                after,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Computed,
            };
            let (rows, keys) = runner.scan_with_keys(&scan)?;
            let filled = rows.len() as u64 == first;
            let next = if filled {
                keys.last().and_then(|key| crate::key::decode(key)).map(|values| Json::Array(values.into_iter().take(columns.len()).skip(prefix_json.len()).map(|value| wire::to_json(&value)).collect()))
            } else {
                None
            };
            Ok(json!({ "rows": rows.iter().map(wire::to_json).collect::<Vec<_>>(), "next": next }))
        }
        "insert" | "insert_if_absent" => {
            let table_name = text_field(request, "table", op)?;
            let table = table_of(runner.schema, table_name)?;
            let mut json = request.get("row").cloned().ok_or_else(|| RuntimeError::Input(format!("native {op} needs row")))?;
            if json.get("id").is_none_or(|id| id.is_null() || id.as_str() == Some("")) {
                let id = runner.context.mint();
                json.as_object_mut().ok_or_else(|| RuntimeError::Input("a row is an object".into()))?.insert("id".into(), Json::String(id));
            }
            let row = typed_row(table, table_name, &json)?;
            if op == "insert" {
                runner.insert(table_name, row)?;
                Ok(json)
            } else if runner.insert_if_absent(table_name, row)? {
                Ok(json)
            } else {
                Ok(Json::Null)
            }
        }
        "update" => {
            let table_name = text_field(request, "table", op)?;
            let id = text_field(request, "id", op)?;
            let table = table_of(runner.schema, table_name)?;
            let patch = request.get("patch").and_then(Json::as_object).ok_or_else(|| RuntimeError::Input("native update needs patch: {..}".into()))?;
            let mut fields = BTreeMap::new();
            for (name, value) in patch {
                let kind = table.columns.get(name).ok_or_else(|| RuntimeError::Input(format!("{table_name}: undeclared column {name}")))?;
                fields.insert(name.clone(), wire::column_from_json(kind, value).map_err(|why| RuntimeError::Input(format!("{table_name}.{name}: {why}")))?);
            }
            runner.update(table_name, &Value::Id(id.to_owned()), Value::Row(fields.into()))?;
            Ok(Json::Null)
        }
        "upsert" => {
            let table_name = text_field(request, "table", op)?;
            let id = text_field(request, "id", op)?;
            let table = table_of(runner.schema, table_name)?;
            let mut json = request.get("row").cloned().ok_or_else(|| RuntimeError::Input("native upsert needs row".into()))?;
            json.as_object_mut().ok_or_else(|| RuntimeError::Input("a row is an object".into()))?.insert("id".into(), Json::String(id.to_owned()));
            let row = typed_row(table, table_name, &json)?;
            runner.upsert(table_name, &Value::Id(id.to_owned()), row)?;
            Ok(json)
        }
        "delete" => {
            let table_name = text_field(request, "table", op)?;
            let id = text_field(request, "id", op)?;
            table_of(runner.schema, table_name)?;
            runner.delete(table_name, id)?;
            Ok(Json::Null)
        }
        other => Err(RuntimeError::Input(format!("unknown native op {other}; the ops are get, lookup, scan, mint, insert, insert_if_absent, update, upsert, delete, log, now"))),
    }
}
