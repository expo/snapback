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
use crate::meter::Ceilings;
use crate::partition::Event;
use crate::schema::{Index, Schema, Table};
use crate::value::Value;
use crate::wire;
use serde_json::{Value as Json, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Write;
use std::ops::Range;

/// A chunk's instruction budget: the native job's step ceiling. Measured
/// on the fixture: one host call costs about 90,000 units (the JSON each
/// way, interpreted), so a chunk at the write ceiling (8,192 rows) spends
/// about 750,000,000; this leaves the row ceilings binding first.
pub const FUEL_PER_CHUNK: u64 = 2_000_000_000;

/// A read's instruction budget: a native query answers a screen.
pub const FUEL_PER_READ: u64 = 200_000_000;

/// The most rows one `scan` may ask for: the job's examined ceiling.
const SCAN_MAX: u64 = 16_384;

/// A wasm table slot is at least one machine word and wasmi carries tag and
/// handle state beside it. Charging sixteen bytes per slot keeps the single
/// table admitted by this ABI inside the ordinary heap ceiling.
const TABLE_SLOT_BYTES: usize = 16;

/// A compiled module, held by the engine and instantiated per chunk.
pub struct Module {
    engine: wasmi::Engine,
    module: wasmi::Module,
    digest: String,
    jobs: Vec<String>,
    reads: Vec<String>,
}

/// Log lines retained by an Engine between host drains. The same output-byte
/// ceiling that bounds one invocation bounds this queue, including each
/// String's inline bookkeeping, so an unattended host cannot grow forever.
#[derive(Default)]
pub(crate) struct Logs {
    lines: Vec<String>,
    bytes: usize,
}

impl Logs {
    pub(crate) fn extend(&mut self, job: &str, lines: Vec<String>) {
        let ceiling = native_output_ceiling();
        for line in lines {
            let line = format!("{job}: {line}");
            let bytes = line.len().saturating_add(std::mem::size_of::<String>());
            if self.bytes.saturating_add(bytes) > ceiling {
                // The invocation already succeeded under its own bound. This
                // queue is diagnostic custody only, so excess later chunks
                // are dropped rather than retroactively parking committed work.
                break;
            }
            self.bytes += bytes;
            self.lines.push(line);
        }
    }

    pub(crate) fn take(&mut self) -> Vec<String> {
        self.bytes = 0;
        std::mem::take(&mut self.lines)
    }
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
    pub outbox: Vec<super::presence::Emission>,
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
    log_bytes: usize,
    memory: Option<wasmi::Memory>,
    alloc: Option<wasmi::TypedFunc<i32, i32>>,
    /// A native read: writes are refused, the meter caps.
    read_only: bool,
    limits: wasmi::StoreLimits,
    heap_limit: usize,
    output_limit: usize,
    fuel_limit: u64,
}

impl<'a> Host<'a> {
    fn idle() -> Self {
        Self::new(None, String::new(), false, Ceilings::default(), FUEL_PER_CHUNK)
    }

    fn new(runner: Option<Runner<'a>>, job: String, read_only: bool, ceilings: Ceilings, fuel_limit: u64) -> Self {
        let heap_limit = usize::try_from(ceilings.heap_bytes).unwrap_or(usize::MAX);
        let output_limit = usize::try_from(ceilings.output_bytes).unwrap_or(usize::MAX);
        Self {
            runner,
            job,
            refused: None,
            failed: None,
            logs: Vec::new(),
            log_bytes: 0,
            memory: None,
            alloc: None,
            read_only,
            limits: native_limits(heap_limit, output_limit),
            heap_limit,
            output_limit,
            fuel_limit,
        }
    }
}

// @ref LLP 3000.005#4 — native wasm memory/table and host bridge bytes stay inside the existing heap/output ceilings.
fn native_limits(heap_limit: usize, table_bytes: usize) -> wasmi::StoreLimits {
    let table_bytes = table_bytes.min(heap_limit);
    wasmi::StoreLimitsBuilder::new()
        .memory_size(heap_limit - table_bytes)
        .table_elements(table_bytes / TABLE_SLOT_BYTES)
        .instances(1)
        .memories(1)
        .tables(1)
        .trap_on_grow_failure(true)
        .build()
}

fn native_heap_ceiling() -> usize {
    usize::try_from(Ceilings::default().heap_bytes).unwrap_or(usize::MAX)
}

fn native_output_ceiling() -> usize {
    usize::try_from(Ceilings::default().output_bytes).unwrap_or(usize::MAX)
}

fn bound(kind: MeterKind, actual: usize, ceiling: usize, site: impl Into<String>) -> RuntimeError {
    RuntimeError::Bound { kind, actual: actual as u64, ceiling: ceiling as u64, site: site.into() }
}

fn resource_bound(host: &Host<'_>, error: &impl std::fmt::Display) -> Option<RuntimeError> {
    let error = error.to_string();
    (error.contains("resource limiter denied allocation") || error.contains("growth operation limited")).then(|| {
        bound(MeterKind::HeapBytes, host.heap_limit.saturating_add(1), host.heap_limit, format!("native.{}", if host.job.is_empty() { "catalog" } else { &host.job }))
    })
}

fn set_sticky(host: &mut Host<'_>, error: RuntimeError) {
    if host.refused.is_none() && host.failed.is_none() {
        host.refused = Some(error.refusal());
    }
}

fn call_error(host: &Host<'_>, error: &wasmi::Error, site: &str) -> RuntimeError {
    if let Some(error) = resource_bound(host, error) {
        return error;
    }
    if error.as_trap_code() == Some(wasmi::TrapCode::OutOfFuel) {
        return bound(MeterKind::Steps, host.fuel_limit as usize, host.fuel_limit as usize, format!("native.{}", if host.job.is_empty() { "catalog" } else { &host.job }));
    }
    RuntimeError::Native { code: "E_NATIVE_TRAP".into(), message: format!("{site} trapped: {error}") }
}

fn checked_range(ptr: u32, len: u32, memory_size: usize, ceiling: usize, kind: MeterKind, site: &str) -> Result<Range<usize>, RuntimeError> {
    let ptr = ptr as usize;
    let len = len as usize;
    if len > ceiling {
        return Err(bound(kind, len, ceiling, site));
    }
    let end = ptr.checked_add(len).ok_or_else(|| RuntimeError::Native { code: "E_NATIVE_TRAP".into(), message: format!("{site} points outside the module's memory") })?;
    if end > memory_size {
        return Err(RuntimeError::Native { code: "E_NATIVE_TRAP".into(), message: format!("{site} points outside the module's memory") });
    }
    Ok(ptr..end)
}

struct LimitedBytes {
    bytes: Vec<u8>,
    ceiling: usize,
    overflowed: bool,
}

impl Write for LimitedBytes {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.bytes.len().saturating_add(bytes.len()) > self.ceiling {
            self.overflowed = true;
            return Err(std::io::Error::other("native JSON exceeds its byte ceiling"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}

fn json_bytes(value: &Json, ceiling: usize, kind: MeterKind, site: &str) -> Result<Vec<u8>, RuntimeError> {
    let mut out = LimitedBytes { bytes: Vec::new(), ceiling, overflowed: false };
    if let Err(error) = serde_json::to_writer(&mut out, value) {
        if out.overflowed {
            return Err(bound(kind, ceiling.saturating_add(1), ceiling, site));
        }
        return Err(structural(format!("cannot encode {site}: {error}")));
    }
    Ok(out.bytes)
}

impl Module {
    /// Compile the module and read the jobs it implements (`sb4_jobs`).
    pub fn compile(bytes: &[u8]) -> Result<Self, RuntimeError> {
        let heap_ceiling = native_heap_ceiling();
        if bytes.len() > heap_ceiling {
            return Err(bound(MeterKind::HeapBytes, bytes.len(), heap_ceiling, "native.module"));
        }
        let mut config = wasmi::Config::default();
        config.consume_fuel(true);
        let engine = wasmi::Engine::new(&config);
        let module = wasmi::Module::new(&engine, bytes).map_err(|e| structural(format!("the native module does not load: {e}")))?;
        let mut module = Self { engine, module, digest: format!("{:x}", Sha256::digest(bytes)), jobs: Vec::new(), reads: Vec::new() };
        module.jobs = module.list("sb4_jobs")?;
        module.reads = module.list("sb4_reads")?;
        if module.jobs.is_empty() && module.reads.is_empty() {
            return Err(structural("the native module names no jobs and no reads; declare them with snapback4_native::module! { jobs: [..], reads: [..] }".into()));
        }
        Ok(module)
    }

    /// The jobs the module implements, as `sb4_jobs` named them.
    pub fn jobs(&self) -> &[String] {
        &self.jobs
    }

    /// The reads the module implements, as `sb4_reads` named them.
    pub fn reads(&self) -> &[String] {
        &self.reads
    }

    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }

    fn store<'a>(&self, host: Host<'a>) -> wasmi::Store<Host<'a>> {
        let mut store = wasmi::Store::new(&self.engine, host);
        store.limiter(|host| &mut host.limits);
        store
    }

    /// The names an export lists; none when the module has no such export.
    fn list(&self, export: &str) -> Result<Vec<String>, RuntimeError> {
        let mut store = self.store(Host::idle());
        store.set_fuel(FUEL_PER_CHUNK).map_err(|e| structural(e.to_string()))?;
        let instance = self.instantiate(&mut store)?;
        let Ok(names) = instance.get_typed_func::<(), i64>(&store, export) else { return Ok(Vec::new()) };
        let packed = match names.call(&mut store, ()) {
            Ok(packed) => packed,
            Err(error) => return Err(resource_bound(store.data(), &error).unwrap_or_else(|| structural(format!("{export} trapped: {error}")))),
        };
        if let Some(failed) = store.data_mut().failed.take() {
            return Err(failed);
        }
        if let Some(refusal) = store.data().refused.clone() {
            return Err(RuntimeError::Native { code: refusal.code, message: refusal.message });
        }
        let text = read_packed(&mut store, packed)?;
        serde_json::from_str(&text).map_err(|e| structural(format!("{export} answered something other than a list of names: {e}")))
    }

    fn instantiate<'a>(&self, store: &mut wasmi::Store<Host<'a>>) -> Result<wasmi::Instance, RuntimeError> {
        let mut linker = wasmi::Linker::<Host<'a>>::new(&self.engine);
        linker.func_wrap("env", "sb4_call", host_call).map_err(|e| structural(e.to_string()))?;
        let instance = match linker.instantiate_and_start(&mut *store, &self.module) {
            Ok(instance) => instance,
            Err(error) => return Err(resource_bound(store.data(), &error).unwrap_or_else(|| structural(format!("the native module does not instantiate: {error}")))),
        };
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
    let range = match checked_range(ptr as u32, len as u32, memory.data_size(&caller), caller.data().heap_limit, MeterKind::HeapBytes, "native host request") {
        Ok(range) => range,
        Err(error) => { set_sticky(caller.data_mut(), error); return 0; }
    };
    let mut bytes = vec![0u8; range.len()];
    if let Err(error) = memory.read(&caller, range.start, &mut bytes) {
        set_sticky(caller.data_mut(), RuntimeError::Native { code: "E_NATIVE_TRAP".into(), message: format!("native host request cannot be read: {error}") });
        return 0;
    }
    let request: Json = match serde_json::from_slice(&bytes) {
        Ok(json) => json,
        Err(error) => json!({ "op": "?", "malformed": error.to_string() }),
    };
    let answer = handle(caller.data_mut(), &request);
    let text = match json_bytes(&answer, caller.data().output_limit, MeterKind::OutputBytes, "native host answer") {
        Ok(text) => text,
        Err(error) => { set_sticky(caller.data_mut(), error); return 0; }
    };
    let (Some(memory), Some(alloc)) = (caller.data().memory, caller.data().alloc.clone()) else { return 0 };
    let Ok(text_len) = i32::try_from(text.len()) else {
        let limit = caller.data().output_limit;
        set_sticky(caller.data_mut(), bound(MeterKind::OutputBytes, text.len(), limit, "native host answer"));
        return 0;
    };
    let out = match alloc.call(&mut caller, text_len) {
        Ok(out) => out,
        Err(error) => {
            let error = call_error(caller.data(), &error, "sb4_alloc");
            set_sticky(caller.data_mut(), error);
            return 0;
        }
    };
    let range = match checked_range(out as u32, text_len as u32, memory.data_size(&caller), caller.data().output_limit, MeterKind::OutputBytes, "native host answer") {
        Ok(range) => range,
        Err(error) => { set_sticky(caller.data_mut(), error); return 0; }
    };
    if let Err(error) = memory.write(&mut caller, range.start, &text) {
        set_sticky(caller.data_mut(), RuntimeError::Native { code: "E_NATIVE_TRAP".into(), message: format!("native host answer cannot be written: {error}") });
        return 0;
    }
    ((out as u32 as i64) << 32) | (text.len() as i64)
}

fn read_packed<'a>(store: &mut wasmi::Store<Host<'a>>, packed: i64) -> Result<String, RuntimeError> {
    let Some(memory) = store.data().memory else { return Err(structural("no memory".into())) };
    let range = checked_range((packed >> 32) as u32, packed as u32, memory.data_size(&*store), store.data().output_limit, MeterKind::OutputBytes, "native module answer")?;
    let mut bytes = vec![0u8; range.len()];
    memory.read(&*store, range.start, &mut bytes).map_err(|e| structural(format!("the module's answer is out of bounds: {e}")))?;
    String::from_utf8(bytes).map_err(|_| structural("the module's answer is not UTF-8".into()))
}

fn write_bytes<'a>(store: &mut wasmi::Store<Host<'a>>, bytes: &[u8]) -> Result<(i32, i32), RuntimeError> {
    let (Some(memory), Some(alloc)) = (store.data().memory, store.data().alloc.clone()) else { return Err(structural("the module is not instantiated".into())) };
    if bytes.len() > store.data().heap_limit {
        return Err(bound(MeterKind::HeapBytes, bytes.len(), store.data().heap_limit, "native module request"));
    }
    let len = i32::try_from(bytes.len()).map_err(|_| bound(MeterKind::HeapBytes, bytes.len(), store.data().heap_limit, "native module request"))?;
    let ptr = match alloc.call(&mut *store, len) {
        Ok(ptr) => ptr,
        Err(error) => return Err(resource_bound(store.data(), &error).unwrap_or_else(|| structural(format!("sb4_alloc trapped: {error}")))),
    };
    let range = checked_range(ptr as u32, len as u32, memory.data_size(&*store), store.data().heap_limit, MeterKind::HeapBytes, "native module request")?;
    memory.write(&mut *store, range.start, bytes).map_err(|e| structural(format!("cannot write the request into the module: {e}")))?;
    Ok((ptr, len))
}

/// Run one chunk: instantiate the module, hand it the job's arguments and
/// the state it returned last time, and collect what the chunk wrote.
pub(crate) fn run_chunk(module: &Module, runner: Runner<'_>, job: &str, args: &BTreeMap<String, Value>, state: Option<Json>, now: i64) -> ChunkOutcome {
    let ceilings = runner.meter.ceilings;
    let mut store = module.store(Host::new(Some(runner), job.to_owned(), false, ceilings, FUEL_PER_CHUNK));
    let step = (|| -> Result<Step, RuntimeError> {
        store.set_fuel(FUEL_PER_CHUNK).map_err(|e| structural(e.to_string()))?;
        let instance = module.instantiate(&mut store)?;
        let run = instance.get_typed_func::<(i32, i32), i64>(&store, "sb4_run").map_err(|_| structural("the native module exports no sb4_run; declare its jobs with snapback4_native::jobs! { .. }".into()))?;
        let input = json_bytes(&json!({ "job": job, "args": wire::map_to_json(args), "state": state, "now": now }), store.data().heap_limit, MeterKind::HeapBytes, "native job input")?;
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
                if let Some(error) = resource_bound(store.data(), &error) {
                    return Err(error);
                }
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
        events: runner.events.take(),
        tables: runner.written_tables.iter().cloned().collect(),
        outbox: std::mem::take(&mut runner.outbox),
        rows_written: runner.rows_written,
        logs: host.logs,
    }
}

/// A native read (LLP 3000.005 §9): the module's `sb4_read` over the runner
/// the host built — a viewer's rules on the server, the device's words on a
/// device — under the read meter, writes refused. Returns the value and the
/// runner, whose flags say whether the read was complete.
pub fn run_read<'a>(module: &Module, runner: Runner<'a>, name: &str, args: &BTreeMap<String, Value>, now: i64) -> (Result<Value, RuntimeError>, Runner<'a>) {
    let ceilings = runner.meter.ceilings;
    let mut store = module.store(Host::new(Some(runner), name.to_owned(), true, ceilings, FUEL_PER_READ));
    let value = (|| -> Result<Value, RuntimeError> {
        store.set_fuel(FUEL_PER_READ).map_err(|e| structural(e.to_string()))?;
        let instance = module.instantiate(&mut store)?;
        let read = instance.get_typed_func::<(i32, i32), i64>(&store, "sb4_read").map_err(|_| structural("the native module exports no sb4_read; declare its reads with snapback4_native::module! { reads: [..] }".into()))?;
        let input = json_bytes(&json!({ "read": name, "args": wire::map_to_json(args), "now": now }), store.data().heap_limit, MeterKind::HeapBytes, "native read input")?;
        let (ptr, len) = write_bytes(&mut store, &input)?;
        let called = read.call(&mut store, (ptr, len));
        if let Some(failed) = store.data_mut().failed.take() {
            return Err(failed);
        }
        if let Some(refusal) = store.data().refused.clone() {
            return Err(RuntimeError::Native { code: refusal.code, message: refusal.message });
        }
        let packed = match called {
            Ok(packed) => packed,
            Err(error) => {
                if let Some(error) = resource_bound(store.data(), &error) {
                    return Err(error);
                }
                if error.as_trap_code() == Some(wasmi::TrapCode::OutOfFuel) {
                    return Err(RuntimeError::Bound { kind: MeterKind::Steps, actual: FUEL_PER_READ, ceiling: FUEL_PER_READ, site: format!("native.{name}") });
                }
                let why = store.data().logs.last().cloned().unwrap_or_else(|| error.to_string());
                return Err(RuntimeError::Native { code: "E_NATIVE_TRAP".into(), message: format!("read {name} trapped: {why}") });
            }
        };
        let text = read_packed(&mut store, packed)?;
        let answer: Json = serde_json::from_str(&text).map_err(|e| structural(format!("read {name} answered something other than JSON: {e}")))?;
        if let Some(error) = answer.get("error") {
            let code = error.get("code").and_then(Json::as_str).unwrap_or("E_NATIVE").to_owned();
            let message = error.get("message").and_then(Json::as_str).unwrap_or("the read refused").to_owned();
            return Err(RuntimeError::Native { code, message });
        }
        let Some(value) = answer.get("ok") else { return Err(structural(format!("read {name} answered neither ok nor error: {text}"))) };
        // The value model: ints, text, ids as strings, rows; a float is not
        // a value, so a score is rounded before it is returned.
        wire::untyped(value).map_err(|why| RuntimeError::Native { code: "E_NATIVE".into(), message: format!("read {name} returned something outside the value model: {why}") })
    })();
    let host = store.into_data();
    (value, host.runner.expect("the read's runner"))
}

/// The chunk of a native job when no module is installed.
pub(crate) fn missing(runner: Runner<'_>, job: &str) -> ChunkOutcome {
    drop(runner);
    ChunkOutcome { step: Err(structural(format!("job {job} is native but no module is installed; `snapback4 check` builds snapback/native, then restart"))), events: Vec::new(), tables: Vec::new(), outbox: Vec::new(), rows_written: 0, logs: Vec::new() }
}

/// One request from the module, answered as `{ ok }` or `{ error }`.
fn handle(host: &mut Host<'_>, request: &Json) -> Json {
    let op = request.get("op").and_then(Json::as_str).unwrap_or("");
    if let Some(refusal) = &host.refused {
        return json!({ "error": refusal });
    }
    if host.failed.is_some() {
        return json!({ "error": Refusal::new("E_STORE", "store", "the store failed earlier in this chunk") });
    }
    if op == "log" {
        let message = request.get("message").and_then(Json::as_str).unwrap_or("");
        let bytes = message.len().saturating_add(std::mem::size_of::<String>());
        if host.log_bytes.saturating_add(bytes) > host.output_limit {
            let error = bound(MeterKind::OutputBytes, host.log_bytes.saturating_add(bytes), host.output_limit, format!("native.{}.log", host.job));
            let refusal = error.refusal();
            host.refused = Some(refusal.clone());
            return json!({ "error": refusal });
        }
        host.log_bytes += bytes;
        host.logs.push(message.to_owned());
        return json!({ "ok": null });
    }
    let Some(runner) = host.runner.as_mut() else {
        return json!({ "error": Refusal::new("E_NATIVE", "schema", "no transaction: only sb4_jobs and sb4_reads run outside a chunk") });
    };
    if host.read_only && matches!(op, "mint" | "insert" | "insert_if_absent" | "update" | "upsert" | "delete") {
        let refusal = Refusal::new("E_NATIVE", "native", format!("a native read cannot {op}; make it a job"));
        host.refused = Some(refusal.clone());
        return json!({ "error": refusal });
    }
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
    schema.refuse_private(name)?;
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
        "viewer" => Ok(json!(runner.context.viewer)),
        "mint" => Ok(json!(runner.context.mint()?)),
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
            let scan = Scan { variant: None,
                site,
                table: table_name.to_owned(),
                index: index_name.to_owned(),
                prefix: prefix.into_iter().map(|value| IndexKeyExpr::Scalar(Expr::Literal(value))).collect(),
                order,
                take: Bound::Literal(first as u32),
                existence: false,
                after,
                before: None,
                range: None, filter: None,
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
                let id = runner.context.mint()?;
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
        other => Err(RuntimeError::Input(format!("unknown native op {other}; the ops are get, lookup, scan, mint, insert, insert_if_absent, update, upsert, delete, log, now, viewer"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exports `sb4_jobs() -> (ptr=0,len=u32::MAX)`. The host must reject the
    /// advertised length before allocating it; the whole malicious module is
    /// only 100 bytes.
    const HUGE_PACKED_LENGTH: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x0a, 0x02, 0x60,
        0x00, 0x01, 0x7e, 0x60, 0x01, 0x7f, 0x01, 0x7f, 0x03, 0x04, 0x03, 0x01,
        0x00, 0x00, 0x05, 0x03, 0x01, 0x00, 0x01, 0x07, 0x2d, 0x04, 0x06, 0x6d,
        0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x09, 0x73, 0x62, 0x34, 0x5f,
        0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00, 0x08, 0x73, 0x62, 0x34, 0x5f,
        0x6a, 0x6f, 0x62, 0x73, 0x00, 0x01, 0x09, 0x73, 0x62, 0x34, 0x5f, 0x72,
        0x65, 0x61, 0x64, 0x73, 0x00, 0x02, 0x0a, 0x14, 0x03, 0x04, 0x00, 0x41,
        0x00, 0x0b, 0x08, 0x00, 0x42, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x0b, 0x04,
        0x00, 0x42, 0x00, 0x0b,
    ];

    /// Grows memory by 1,000 pages from `sb4_jobs`; the 122-byte module is
    /// rejected by the catalog path under the same 16 MiB store limit used by
    /// jobs and reads.
    const CATALOG_GROWS_MEMORY: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x0a, 0x02, 0x60,
        0x00, 0x01, 0x7e, 0x60, 0x01, 0x7f, 0x01, 0x7f, 0x03, 0x04, 0x03, 0x01,
        0x00, 0x00, 0x05, 0x03, 0x01, 0x00, 0x01, 0x07, 0x2d, 0x04, 0x06, 0x6d,
        0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x09, 0x73, 0x62, 0x34, 0x5f,
        0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00, 0x08, 0x73, 0x62, 0x34, 0x5f,
        0x6a, 0x6f, 0x62, 0x73, 0x00, 0x01, 0x09, 0x73, 0x62, 0x34, 0x5f, 0x72,
        0x65, 0x61, 0x64, 0x73, 0x00, 0x02, 0x0a, 0x1b, 0x03, 0x04, 0x00, 0x41,
        0x10, 0x0b, 0x0a, 0x00, 0x41, 0xe8, 0x07, 0x40, 0x00, 0x1a, 0x42, 0x05,
        0x0b, 0x09, 0x00, 0x42, 0x82, 0x80, 0x80, 0x80, 0xd0, 0x00, 0x0b, 0x0b,
        0x0d, 0x01, 0x00, 0x41, 0x00, 0x0b, 0x07, 0x5b, 0x22, 0x78, 0x22, 0x5d,
        0x5b, 0x5d,
    ];

    /// Calls the host from `sb4_jobs`, ignores its zero result, and returns a
    /// valid catalog after `sb4_alloc` traps. The host must retain that first
    /// allocator failure instead of accepting the apparently valid list.
    const CATALOG_ALLOCATOR_TRAPS: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x10, 0x03, 0x60,
        0x00, 0x01, 0x7e, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e, 0x60, 0x01, 0x7f,
        0x01, 0x7f, 0x02, 0x10, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x08, 0x73, 0x62,
        0x34, 0x5f, 0x63, 0x61, 0x6c, 0x6c, 0x00, 0x01, 0x03, 0x04, 0x03, 0x02,
        0x00, 0x00, 0x05, 0x03, 0x01, 0x00, 0x01, 0x07, 0x2d, 0x04, 0x06, 0x6d,
        0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x09, 0x73, 0x62, 0x34, 0x5f,
        0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x01, 0x08, 0x73, 0x62, 0x34, 0x5f,
        0x6a, 0x6f, 0x62, 0x73, 0x00, 0x02, 0x09, 0x73, 0x62, 0x34, 0x5f, 0x72,
        0x65, 0x61, 0x64, 0x73, 0x00, 0x03, 0x0a, 0x1f, 0x03, 0x03, 0x00, 0x00,
        0x0b, 0x0f, 0x00, 0x41, 0x00, 0x41, 0x02, 0x10, 0x00, 0x1a, 0x42, 0x85,
        0x80, 0x80, 0x80, 0x20, 0x0b, 0x09, 0x00, 0x42, 0x82, 0x80, 0x80, 0x80,
        0xf0, 0x00, 0x0b, 0x0b, 0x0f, 0x01, 0x00, 0x41, 0x00, 0x0b, 0x09, 0x7b,
        0x7d, 0x5b, 0x22, 0x78, 0x22, 0x5d, 0x5b, 0x5d,
    ];

    #[test]
    fn native_job_requests_cannot_forge_recorded_fields() {
        use crate::{Context, Engine, meter::{Cut, Meter}};
        let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../snapback4-lang/tests/fixtures/recorded-attribution.q").into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        // The language dev-dependency links the non-test core; round-trip its
        // schema into this unit-test crate's types at the normal text boundary.
        let schema: crate::schema::Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
        assert_eq!(schema.tables["likes"].recorded["postId.authorId"].table,"posts");
        assert_eq!(schema.tables["likes"].columns["postId.authorId"],crate::schema::ColumnType::Optional(Box::new(crate::schema::ColumnType::Principal)));
        let mut engine = Engine::memory(schema.clone(), []).unwrap();
        let row = |table: &str, value: serde_json::Value| (table.to_owned(),crate::wire::row_from_json(&schema.tables[table],&value).unwrap());
        engine.seed([row("posts",json!({"id":"p","authorId":"alice","at":100})),row("likes",json!({"id":"l","postId":"p","principal":"alice","at":100}))]).unwrap();
        let tx = engine.store.transaction().unwrap();
        let stored = tx.get("likes","l").unwrap();
        assert_eq!(stored.as_ref().expect("seeded source").field("postId.authorId").unwrap(),&crate::Value::Id("alice".into()));
        let mut runner = Runner::new(&tx, &schema, Context::system().at(1000), Meter::new(Ceilings::job(), Cut::Abort), 1);
        for request in [
            json!({"op":"insert", "table":"likes", "row":{"id":"forged", "postId":"p", "principal":"alice", "at":100, "postId.authorId":"mallory"}}),
            json!({"op":"update", "table":"likes", "id":"l", "patch":{"postId.authorId":null}}),
            json!({"op":"update", "table":"likes", "id":"l", "patch":{"postId.authorId":"alice","note":"must roll back"}}),
            json!({"op":"upsert", "table":"likes", "id":"l", "row":{"id":"l","postId.authorId":"mallory","note":"must roll back"}}),
        ] {
            let error = dispatch(&mut runner, "forger", request["op"].as_str().unwrap(), &request).unwrap_err();
            assert_eq!(error.code(), "E_RECORDED_FIELD", "{error}");
            assert_eq!(tx.get("likes","l").unwrap(),stored);
            assert_eq!(tx.get("likes","forged").unwrap(),None);
        }
        tx.rollback().unwrap();
    }

    #[test]
    fn duplicate_target_cannot_shadow_native_privacy() {
        use crate::{Context, Engine, meter::{Cut, Meter}};
        let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../snapback4-lang/tests/fixtures/maintained-columns.q").into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let base: Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
        let mut engine = Engine::memory(base.clone(), []).unwrap();
        for first in [true,false] {
            let mut schema=base.clone();
            let target = schema.maintains[0].target.clone();
            let mut shadow = schema.maintains[0].clone();
            shadow.private = None;
            if first { schema.maintains.insert(0, shadow); } else { schema.maintains.push(shadow); }
            let tx = engine.store.transaction().unwrap();
            let mut runner = Runner::new(&tx, &schema, Context::system(), Meter::new(Ceilings::job(), Cut::Abort), 1);
            for op in ["get", "lookup", "scan", "insert", "insert_if_absent", "upsert", "update", "delete"] {
                let request = json!({"table":target,"id":"p","index":"byGroup","key":["p"],"prefix":[],"first":1,"row":{"id":"p"},"patch":{}});
                let error = dispatch(&mut runner, "job", op, &request).unwrap_err();
                assert_eq!(error.code(), "E_MAINTAINED_COLUMN_PRIVATE", "{op}: {error}");
                assert!(error.to_string().contains("posts.likeCount"));
                assert!(!error.to_string().contains(&target));
            }
            tx.rollback().unwrap();
        }
    }

    #[test]
    fn native_column_results_and_private_targets() {
        use crate::{Context, Engine, meter::{Cut, Meter}};
        let bound = snapback4_lang::compile(&[("schema.q".into(),include_str!("../../../snapback4-lang/tests/fixtures/maintained-columns.q").into())]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let schema: Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
        let mut engine = Engine::memory(schema.clone(),[]).unwrap();
        let tx = engine.store.transaction().unwrap();
        let mut runner = Runner::new(&tx,&schema,Context::system().at(1000),Meter::new(Ceilings::job(),Cut::Abort),1);
        for op in ["insert","insert_if_absent","upsert","update"] {
            let request = json!({"op":op,"table":"posts","id":"p","row":{"id":"p","at":1,"likeCount":0},"patch":{"likeCount":0}});
            assert_eq!(dispatch(&mut runner,"job",op,&request).unwrap_err().code(),"E_MAINTAINED_COLUMN");
        }
        for op in ["get","scan","insert","delete"] {
            let request = json!({"op":op,"table":schema.maintains[0].target,"id":"p","index":"byGroup","prefix":[],"first":1,"row":{"id":"p"}});
            let error = dispatch(&mut runner,"job",op,&request).unwrap_err();
            assert_eq!(error.code(),"E_MAINTAINED_COLUMN_PRIVATE","{error}");
            assert!(error.to_string().contains("posts.likeCount"));
            assert!(!error.to_string().contains("$column"));
        }
        let like = json!({"table":"likes","row":{"id":"l","postId":"p","active":true,"amount":4}});
        dispatch(&mut runner,"job","insert",&like).unwrap();
        let post = json!({"table":"posts","row":{"id":"p","at":1}});
        let result = dispatch(&mut runner,"job","insert",&post).unwrap();
        assert_eq!(result,json!({"id":"p","at":1}));
        let old=tx.get("posts","p").unwrap().unwrap();
        let read=dispatch(&mut runner,"job","get",&json!({"table":"posts","id":"p"})).unwrap();
        assert_eq!((read["likeCount"].as_i64(),read["selected"].as_i64(),read["total"].as_i64()),(Some(1),Some(1),Some(4)));
        let legacy=crate::value::object([("id",Value::Id("legacy".into())),("at",Value::Int(1))]);
        tx.put("posts",&schema.tables["posts"],&legacy,None).unwrap();
        let read=dispatch(&mut runner,"job","get",&json!({"table":"posts","id":"legacy"})).unwrap();
        assert_eq!((read["likeCount"].as_i64(),read["selected"].as_i64(),read["total"].as_i64()),(Some(0),Some(0),Some(0)));
        assert_eq!(old.field("total").unwrap(),&Value::Int(4));
        assert_eq!(tx.get("posts","p").unwrap().unwrap().field("likeCount").unwrap(),&Value::Int(1));
        tx.rollback().unwrap();
    }

    #[test]
    fn packed_lengths_and_catalog_growth_are_bounded_before_large_allocations() {
        for bytes in [HUGE_PACKED_LENGTH, CATALOG_GROWS_MEMORY] {
            let error = Module::compile(bytes).err().expect("malicious module refused");
            assert_eq!(error.code(), "E_BOUND", "{error}");
        }
        let error = Module::compile(CATALOG_ALLOCATOR_TRAPS).err().expect("allocator trap retained");
        assert_eq!(error.code(), "E_NATIVE_TRAP", "{error}");
    }

    #[test]
    fn module_bytes_and_the_single_table_share_the_heap_budget() {
        let oversized = vec![0; native_heap_ceiling() + 1];
        let error = Module::compile(&oversized).err().expect("oversized module refused");
        assert_eq!(error.code(), "E_BOUND");
        let table_bytes = native_output_ceiling();
        let memory_bytes = native_heap_ceiling() - table_bytes;
        assert_eq!(memory_bytes + table_bytes, native_heap_ceiling());
        let mut limits = native_limits(native_heap_ceiling(), table_bytes);
        assert!(wasmi::ResourceLimiter::memory_growing(&mut limits, 0, memory_bytes, None).unwrap());
        assert!(wasmi::ResourceLimiter::memory_growing(&mut limits, memory_bytes, memory_bytes + 65_536, None).is_err());
        assert!(wasmi::ResourceLimiter::table_growing(&mut limits, 0, table_bytes / TABLE_SLOT_BYTES, None).unwrap());
        assert!(wasmi::ResourceLimiter::table_growing(&mut limits, table_bytes / TABLE_SLOT_BYTES, table_bytes / TABLE_SLOT_BYTES + 1, None).is_err());
    }

    #[test]
    fn log_bounds_are_sticky_per_invocation_and_drop_excess_retained_lines() {
        let mut host = Host::idle();
        host.job = "chatty".into();
        host.output_limit = 64;
        assert_eq!(handle(&mut host, &json!({ "op": "log", "message": "kept" })), json!({ "ok": null }));
        let overflow = handle(&mut host, &json!({ "op": "log", "message": "x".repeat(64) }));
        assert_eq!(overflow["error"]["code"], "E_BOUND");
        let sticky = handle(&mut host, &json!({ "op": "log", "message": "ignored" }));
        assert_eq!(sticky, overflow);
        assert_eq!(host.logs, ["kept"]);

        let mut retained = Logs::default();
        retained.extend("chatty", vec![String::new(); 50_000]);
        assert!(retained.bytes <= native_output_ceiling());
        assert!(retained.lines.len() < native_output_ceiling());
        let taken = retained.take();
        assert!(!taken.is_empty());
        assert_eq!(retained.bytes, 0);
    }
}
