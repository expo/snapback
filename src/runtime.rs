use crate::cron::CronRunMetadata;
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::live_matcher::query_dependency_metadata;
use crate::manifest::{HandlerInput, IbexModule, MutationOutput, QueryOutput, QueryPlan};
use crate::storage::{
    BufferedWrite, CapturedReadDependency, CapturedReadKind, LocalDatabase, MutationCommit,
};
use libc::{c_char, c_int, c_void, size_t};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::cell::RefCell;
use std::env;
use std::ffi::{CStr, CString};
use std::marker::PhantomData;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::ptr;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RuntimeCapabilities {
    pub canonical_engine: String,
    pub ibex_submodule: IbexSubmoduleCapability,
    pub ibex_cli: IbexCliCapability,
    pub host_plan_runtime: bool,
    pub ibex_ctx_db_host_bridge: CapabilityState,
    pub async_handler_completion: CapabilityState,
    pub sqlite_lock_held_across_async: CapabilityState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct IbexSubmoduleCapability {
    pub present: bool,
    pub path: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct IbexCliCapability {
    pub available: bool,
    pub path: Option<PathBuf>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CapabilityState {
    Available,
    Unavailable,
    NotYetWired,
}

#[derive(Clone, Debug)]
pub struct RuntimeManager {
    capabilities: RuntimeCapabilities,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct IbexQueryRun {
    pub output: QueryOutput,
    pub read_dependencies: Vec<CapturedReadDependency>,
}

pub trait IbexActionHost {
    fn run_mutation(&mut self, name: &str, input: HandlerInput) -> SnapbackResult<MutationOutput>;
}

impl RuntimeManager {
    pub fn detect() -> Self {
        // @ref LLP 0002#decision — local dev reports Ibex as the canonical engine.
        // @ref LLP 0009#runtime-boundary — Ibex availability is a runtime capability, not an implicit fallback.
        Self {
            capabilities: RuntimeCapabilities {
                canonical_engine: "ibex".to_owned(),
                ibex_submodule: detect_ibex_submodule(),
                ibex_cli: detect_ibex_cli(),
                host_plan_runtime: true,
                ibex_ctx_db_host_bridge: CapabilityState::Available,
                async_handler_completion: CapabilityState::Available,
                sqlite_lock_held_across_async: CapabilityState::Unavailable,
            },
        }
    }

    pub fn capabilities(&self) -> &RuntimeCapabilities {
        &self.capabilities
    }

    pub fn diagnostics(&self) -> Vec<Diagnostic> {
        let mut diagnostics = Vec::new();
        if !self.capabilities.ibex_cli.available {
            diagnostics.push(
                Diagnostic::info(
                    "SNAPBACK_IBEX_CLI_UNAVAILABLE",
                    "runtime",
                    "ibex binary was not found; embedded Ibex handlers still run through the vendored runtime",
                )
                .with_details(json!({
                    "canonical_engine": self.capabilities.canonical_engine,
                    "ibex_submodule": self.capabilities.ibex_submodule,
                    "host_plan_runtime": self.capabilities.host_plan_runtime,
                    "ibex_ctx_db_host_bridge": self.capabilities.ibex_ctx_db_host_bridge
                })),
            );
        }
        diagnostics
    }

    pub fn invoke_ibex_query(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        db: &LocalDatabase,
    ) -> SnapbackResult<QueryOutput> {
        Ok(self.invoke_ibex_query_with_reads(module, input, db)?.output)
    }

    pub fn invoke_ibex_query_with_reads(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        db: &LocalDatabase,
    ) -> SnapbackResult<IbexQueryRun> {
        let mut invocation = IbexHostContext::new(db as *const LocalDatabase, input, false);
        let value = run_ibex_handler_with_context(module, &mut invocation)?;
        let output = QueryOutput {
            version: db.current_version()?,
            rows: value.as_array().cloned().unwrap_or_default(),
        };
        Ok(IbexQueryRun {
            output,
            read_dependencies: invocation.reads,
        })
    }

    pub fn invoke_ibex_mutation(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        db: &mut LocalDatabase,
    ) -> SnapbackResult<MutationCommit> {
        let mut invocation = IbexHostContext::new(db as *const LocalDatabase, input.clone(), true);
        let result = run_ibex_handler_with_context(module, &mut invocation)?;
        db.commit_buffered_writes(&input, invocation.writes, invocation.reads, result)
    }

    pub fn invoke_ibex_action(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        db: *const LocalDatabase,
        run: CronRunMetadata,
        host: &mut dyn IbexActionHost,
    ) -> SnapbackResult<Value> {
        let mut invocation = IbexHostContext::new_action(db, input, run, host);
        run_ibex_handler_with_context(module, &mut invocation)
    }
}

#[repr(C)]
struct HermesRuntimeOpaque {
    _private: [u8; 0],
}

unsafe extern "C" {
    fn ex_hermes_create() -> *mut HermesRuntimeOpaque;
    fn ex_hermes_destroy(runtime: *mut HermesRuntimeOpaque);
    fn ex_hermes_eval(
        runtime: *mut HermesRuntimeOpaque,
        data: *const u8,
        len: size_t,
        source_url: *const c_char,
        is_bytecode: c_int,
        out_value: *mut *mut c_char,
    ) -> c_int;
    fn ex_hermes_free_string(value: *mut c_char);
    fn ex_hermes_set_host_call(
        runtime: *mut HermesRuntimeOpaque,
        callback: extern "C" fn(*const c_char, *const c_char) -> *mut c_char,
    );
}

struct RuntimeGuard(*mut HermesRuntimeOpaque);

impl RuntimeGuard {
    fn create() -> SnapbackResult<Self> {
        // @ref LLP 0009#capability-model — static checks are defense-in-depth;
        // the runtime host itself must deny ambient powers.
        ibex_runtime::host::abi::install_host(ibex_runtime::host::Host::strict());
        let runtime = unsafe { ex_hermes_create() };
        if runtime.is_null() {
            return Err(SnapbackError::error(
                "SNAPBACK_RUNTIME_CREATE_FAILED",
                "runtime",
                "Ibex runtime could not be created",
            ));
        }
        unsafe { ex_hermes_set_host_call(runtime, snapback_host_call) };
        Ok(Self(runtime))
    }
}

impl Drop for RuntimeGuard {
    fn drop(&mut self) {
        unsafe { ex_hermes_destroy(self.0) };
    }
}

struct IbexHostContext<'a> {
    db: *const LocalDatabase,
    input: HandlerInput,
    mode: IbexInvocationMode,
    writes: Vec<BufferedWrite>,
    reads: Vec<CapturedReadDependency>,
    now_ms: u64,
    action_run: Option<CronRunMetadata>,
    action_host: Option<&'a mut dyn IbexActionHost>,
    _marker: PhantomData<&'a LocalDatabase>,
}

impl<'a> IbexHostContext<'a> {
    fn new(db: *const LocalDatabase, input: HandlerInput, writable: bool) -> Self {
        let reads = auth_dependencies(&input);
        Self {
            db,
            input,
            mode: if writable {
                IbexInvocationMode::Mutation
            } else {
                IbexInvocationMode::Query
            },
            writes: Vec::new(),
            reads,
            now_ms: now_millis(),
            action_run: None,
            action_host: None,
            _marker: PhantomData,
        }
    }

    fn new_action(
        db: *const LocalDatabase,
        input: HandlerInput,
        run: CronRunMetadata,
        host: &'a mut dyn IbexActionHost,
    ) -> Self {
        let reads = auth_dependencies(&input);
        Self {
            db,
            input,
            mode: IbexInvocationMode::Action,
            writes: Vec::new(),
            reads,
            now_ms: run.due_at_ms,
            action_run: Some(run),
            action_host: Some(host),
            _marker: PhantomData,
        }
    }

    fn db(&self) -> &LocalDatabase {
        unsafe { &*self.db }
    }

    fn handle_host_call(&mut self, op: &str, args: Value) -> SnapbackResult<Value> {
        match op {
            "db.query" => {
                let plan = serde_json::from_value::<QueryPlan>(
                    args.get("plan").cloned().unwrap_or(Value::Null),
                )
                .map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                        "runtime",
                        "ctx.db.query received an invalid query plan",
                    )
                    .with_details(json!({ "error": error.to_string() }))
                })?;
                let output = self.db().query(&plan, &self.input)?;
                self.capture_query_read(&plan, &output)?;
                serde_json::to_value(output).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_HANDLER_HOST_CALL_SERIALIZE_FAILED",
                        "runtime",
                        "ctx.db.query output could not be serialized",
                    )
                    .with_details(json!({ "error": error.to_string() }))
                })
            }
            "db.get" => {
                let table = required_string(&args, "table")?;
                let id = required_string(&args, "id")?;
                let row = self.db().get(&table, &id)?;
                self.capture_point_read(&table, &id, row.as_ref())?;
                Ok(row.unwrap_or(Value::Null))
            }
            "db.insert" => {
                self.ensure_writable("insert")?;
                let table = required_string(&args, "table")?;
                let values = required_object(&args, "values")?;
                let id = self.db().generate_id();
                self.writes.push(BufferedWrite::Insert {
                    table,
                    id: id.clone(),
                    values,
                });
                Ok(Value::String(id))
            }
            "db.patch" => {
                self.ensure_writable("patch")?;
                let table = required_string(&args, "table")?;
                let id = required_string(&args, "id")?;
                let values = required_object(&args, "values")?;
                let row = self.db().get(&table, &id)?;
                let existed = row.is_some();
                self.capture_point_read(&table, &id, row.as_ref())?;
                self.writes.push(BufferedWrite::Patch { table, id, values });
                Ok(Value::Bool(existed))
            }
            "db.delete" => {
                self.ensure_writable("delete")?;
                let table = required_string(&args, "table")?;
                let id = required_string(&args, "id")?;
                let row = self.db().get(&table, &id)?;
                let existed = row.is_some();
                self.capture_point_read(&table, &id, row.as_ref())?;
                self.writes.push(BufferedWrite::Delete { table, id });
                Ok(Value::Bool(existed))
            }
            "runtime.now" => Ok(json!(self.now_ms)),
            "runtime.id" => Ok(Value::String(self.db().generate_id())),
            "action.metadata" => serde_json::to_value(self.action_run.as_ref()).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ACTION_METADATA_SERIALIZE_FAILED",
                    "runtime",
                    "action run metadata could not be serialized",
                )
                .with_details(json!({ "error": error.to_string() }))
            }),
            "action.runMutation" => {
                self.ensure_action("runMutation")?;
                let name = required_string(&args, "name")?;
                let mutation_args = args
                    .get("args")
                    .cloned()
                    .unwrap_or(Value::Object(Map::new()));
                let input = HandlerInput {
                    args: mutation_args,
                    auth: self.input.auth.clone(),
                    read_set: Vec::new(),
                };
                let host = self.action_host.as_deref_mut().ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_ACTION_HOST_MISSING",
                        "runtime",
                        "action host call ran without an action host",
                    )
                })?;
                let output = host.run_mutation(&name, input)?;
                Ok(output.result)
            }
            _ => Err(SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_UNKNOWN",
                "runtime",
                format!("unknown handler host call {op}"),
            )),
        }
    }

    fn ensure_writable(&self, op: &str) -> SnapbackResult<()> {
        if self.mode == IbexInvocationMode::Mutation {
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_HANDLER_WRITE_IN_QUERY",
            "runtime",
            format!("query handler attempted ctx.db.{op}"),
        ))
    }

    fn ensure_action(&self, op: &str) -> SnapbackResult<()> {
        if self.mode == IbexInvocationMode::Action {
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_ACTION_CONTEXT_UNAVAILABLE",
            "runtime",
            format!("ctx.{op} is only available to action handlers"),
        ))
    }

    fn capture_point_read(
        &mut self,
        table: &str,
        id: &str,
        row: Option<&Value>,
    ) -> SnapbackResult<()> {
        let dependency = if let Some(row) = row {
            CapturedReadDependency {
                kind: CapturedReadKind::Row,
                table: Some(table.to_owned()),
                id: Some(id.to_owned()),
                version: Some(row_version(row)?),
                predicate: None,
                rows: Vec::new(),
                field: None,
                value: None,
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            }
        } else {
            CapturedReadDependency {
                kind: CapturedReadKind::MissingRow,
                table: Some(table.to_owned()),
                id: Some(id.to_owned()),
                version: Some(self.db().table_change_version(table)?),
                predicate: None,
                rows: Vec::new(),
                field: None,
                value: None,
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            }
        };
        self.push_read_dependency(dependency);
        Ok(())
    }

    fn capture_query_read(&mut self, plan: &QueryPlan, output: &QueryOutput) -> SnapbackResult<()> {
        let rows = output
            .rows
            .iter()
            .filter_map(|row| {
                row.get("_id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Vec<_>>();
        for row in &output.rows {
            if let (Some(id), Some(version)) = (
                row.get("_id").and_then(Value::as_str),
                row.get("_version").and_then(Value::as_u64),
            ) {
                self.push_read_dependency(CapturedReadDependency {
                    kind: CapturedReadKind::Row,
                    table: Some(plan.table.clone()),
                    id: Some(id.to_owned()),
                    version: Some(version),
                    predicate: None,
                    rows: Vec::new(),
                    field: None,
                    value: None,
                    order: None,
                    limit: None,
                    result_count: None,
                    boundary: None,
                });
            }
        }
        let (order, limit, result_count, boundary) = query_dependency_metadata(plan, &output.rows)?;
        let predicate = serde_json::to_value(plan).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CAPTURED_READ_SERIALIZE_FAILED",
                "runtime",
                "query dependency could not be serialized",
            )
            .with_details(json!({ "error": error.to_string() }))
        })?;
        self.push_read_dependency(CapturedReadDependency {
            kind: CapturedReadKind::Query,
            table: Some(plan.table.clone()),
            id: None,
            version: Some(self.db().table_change_version(&plan.table)?),
            predicate: Some(predicate),
            rows,
            field: None,
            value: None,
            order,
            limit,
            result_count,
            boundary,
        });
        Ok(())
    }

    fn push_read_dependency(&mut self, dependency: CapturedReadDependency) {
        if !self.reads.contains(&dependency) {
            self.reads.push(dependency);
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum IbexInvocationMode {
    Query,
    Mutation,
    Action,
}

thread_local! {
    static CURRENT_IBEX_HOST_CONTEXT: RefCell<*mut c_void> = const { RefCell::new(ptr::null_mut()) };
}

fn run_ibex_handler_with_context(
    module: &IbexModule,
    invocation: &mut IbexHostContext<'_>,
) -> SnapbackResult<Value> {
    let runtime = RuntimeGuard::create()?;
    let source = invocation_source(module, invocation)?;

    CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
        *slot.borrow_mut() = invocation as *mut IbexHostContext<'_> as *mut c_void;
    });
    let eval_result = eval(runtime.0, &module.export, &source);
    CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
        *slot.borrow_mut() = ptr::null_mut();
    });

    let output = eval_result?;
    if output.trim().is_empty() || output.trim() == "undefined" {
        return Ok(Value::Null);
    }
    serde_json::from_str(&output).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_HANDLER_RESULT_INVALID",
            "runtime",
            "handler returned a value that is not JSON-serializable",
        )
        .with_details(json!({
            "function": module.export,
            "error": error.to_string(),
            "output": output,
        }))
    })
}

fn eval(
    runtime: *mut HermesRuntimeOpaque,
    source_url: &str,
    source: &str,
) -> SnapbackResult<String> {
    let source_url =
        CString::new(source_url).unwrap_or_else(|_| CString::new("handler.js").unwrap());
    let mut out: *mut c_char = ptr::null_mut();
    let status = unsafe {
        ex_hermes_eval(
            runtime,
            source.as_ptr(),
            source.len(),
            source_url.as_ptr(),
            0,
            &mut out,
        )
    };
    let output = if out.is_null() {
        String::new()
    } else {
        let text = unsafe { CStr::from_ptr(out) }
            .to_string_lossy()
            .into_owned();
        unsafe { ex_hermes_free_string(out) };
        text
    };
    if status == 0 {
        return Ok(output);
    }

    let code = if output.contains("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED") {
        "SNAPBACK_HANDLER_CAPABILITY_DENIED"
    } else if output.contains("SNAPBACK_HANDLER_EXPORT_MISSING") {
        "SNAPBACK_HANDLER_EXPORT_MISSING"
    } else {
        "SNAPBACK_HANDLER_FAILED"
    };
    Err(
        SnapbackError::error(code, "runtime", "JavaScript handler failed").with_details(json!({
            "message": first_line(&output),
        })),
    )
}

extern "C" fn snapback_host_call(op: *const c_char, args_json: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(|| {
        let op = c_string_to_string(op)?;
        let args_json = c_string_to_string(args_json)?;
        let args = serde_json::from_str::<Value>(&args_json).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON",
                "runtime",
                "handler host call arguments were not valid JSON",
            )
            .with_details(json!({ "error": error.to_string() }))
        })?;

        CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
            let ptr = *slot.borrow();
            if ptr.is_null() {
                return Err(SnapbackError::error(
                    "SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT",
                    "runtime",
                    "handler host call ran without an invocation context",
                ));
            }
            let ctx = unsafe { &mut *(ptr as *mut IbexHostContext<'_>) };
            ctx.handle_host_call(&op, args)
        })
    });

    match result {
        Ok(Ok(value)) => c_host_response('+', value.to_string()),
        Ok(Err(error)) => c_host_response('-', error.to_string()),
        Err(_) => c_host_response('-', "SNAPBACK_HANDLER_HOST_CALL_PANIC".to_owned()),
    }
}

fn invocation_source(
    module: &IbexModule,
    invocation: &IbexHostContext<'_>,
) -> SnapbackResult<String> {
    let input = &invocation.input;
    let args_json = serde_json::to_string(&input.args).map_err(handler_serialize_error)?;
    let auth_json = serde_json::to_string(&input.auth).map_err(handler_serialize_error)?;
    let export_json = serde_json::to_string(&module.export).map_err(handler_serialize_error)?;
    let args_literal = serde_json::to_string(&args_json).map_err(handler_serialize_error)?;
    let auth_literal = serde_json::to_string(&auth_json).map_err(handler_serialize_error)?;
    let mode = match invocation.mode {
        IbexInvocationMode::Query => "query",
        IbexInvocationMode::Mutation => "mutation",
        IbexInvocationMode::Action => "action",
    };
    let mode_json = serde_json::to_string(mode).map_err(handler_serialize_error)?;
    let run_json =
        serde_json::to_string(&invocation.action_run).map_err(handler_serialize_error)?;
    let run_literal = serde_json::to_string(&run_json).map_err(handler_serialize_error)?;

    Ok(format!(
        "{}\n{}\n{}\n(async function() {{\n  var value = await globalThis.__snapbackInvoke({}, {}, {}, {}, {});\n  return JSON.stringify(value === undefined ? null : value);\n}})()",
        ambient_restriction_source(),
        module.source,
        ctx_bootstrap_source(),
        export_json,
        args_literal,
        auth_literal,
        mode_json,
        run_literal,
    ))
}

fn ambient_restriction_source() -> &'static str {
    r#"
(function(g) {
  function deny(name) {
    return function() { throw new Error("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED: " + name); };
  }
  try { Object.defineProperty(g, "process", { value: undefined, configurable: false, writable: false }); } catch (_) {}
  try { Object.defineProperty(g, "require", { value: undefined, configurable: false, writable: false }); } catch (_) {}
  try { Object.defineProperty(g, "fetch", { value: deny("fetch"), configurable: false, writable: false }); } catch (_) {}
  try { Object.defineProperty(g, "WebSocket", { value: deny("WebSocket"), configurable: false, writable: false }); } catch (_) {}
  try { Object.defineProperty(g, "setTimeout", { value: deny("setTimeout"), configurable: false, writable: false }); } catch (_) {}
  try { Object.defineProperty(g, "setInterval", { value: deny("setInterval"), configurable: false, writable: false }); } catch (_) {}
})(globalThis);
"#
}

fn ctx_bootstrap_source() -> &'static str {
    r#"
(function(g) {
  function host(op, args) {
    return g.__hostCall(op, JSON.stringify(args || {}));
  }
  function literal(value) { return { Literal: value }; }
  function normalizeDirection(direction) {
    return String(direction || "asc").toLowerCase() === "desc" ? "Desc" : "Asc";
  }
  function makeBuilder(table) {
    var plan = { table: table, filters: [], order: [], limit: null, indexed_by: null };
    var builder = {
      withIndex: function(name) { plan.indexed_by = name; return builder; },
      eq: function(field, value) {
        plan.filters.push({ field: field, op: "Eq", value: literal(value) });
        return builder;
      },
      in: function(field, values) {
        plan.filters.push({ field: field, op: "In", value: literal(values) });
        return builder;
      },
      lt: function(field, value) {
        plan.filters.push({ field: field, op: "Lt", value: literal(value) });
        return builder;
      },
      lte: function(field, value) {
        plan.filters.push({ field: field, op: "Lte", value: literal(value) });
        return builder;
      },
      gt: function(field, value) {
        plan.filters.push({ field: field, op: "Gt", value: literal(value) });
        return builder;
      },
      gte: function(field, value) {
        plan.filters.push({ field: field, op: "Gte", value: literal(value) });
        return builder;
      },
      order: function(field, direction) {
        plan.order.push({ field: field, direction: normalizeDirection(direction) });
        return builder;
      },
      take: function(limit) { plan.limit = Number(limit); return builder; },
      collect: function() { return host("db.query", { plan: plan }).rows; },
      first: function() {
        var old = plan.limit;
        plan.limit = 1;
        var rows = host("db.query", { plan: plan }).rows;
        plan.limit = old;
        return rows.length ? rows[0] : null;
      }
    };
    return builder;
  }
  function readonlyDenied(op) {
    return function() { throw new Error("SNAPBACK_HANDLER_WRITE_IN_QUERY: " + op); };
  }
  g.__snapbackInvoke = async function(name, argsJson, authJson, mode, runJson) {
    var args = JSON.parse(argsJson || "{}");
    var auth = JSON.parse(authJson || "{}");
    var run = runJson ? JSON.parse(runJson) : null;
    if (auth.user_id && !auth.userId) auth.userId = auth.user_id;
    var db = {
      get: function(table, id) { return host("db.get", { table: table, id: id }); },
      query: makeBuilder,
      insert: function(table, values) { return host("db.insert", { table: table, values: values }); },
      patch: function(table, id, values) { return host("db.patch", { table: table, id: id, values: values }); },
      delete: function(table, id) { return host("db.delete", { table: table, id: id }); }
    };
    if (mode !== "mutation") {
      db.insert = readonlyDenied("insert");
      db.patch = readonlyDenied("patch");
      db.delete = readonlyDenied("delete");
    }
    if (mode === "action") {
      db.get = readonlyDenied("get");
      db.query = readonlyDenied("query");
    }
    var ctx = {
      auth: auth,
      db: db,
      runtime: {
        now: function() { return host("runtime.now", {}); },
        id: function() { return host("runtime.id", {}); }
      }
    };
    if (mode === "action") {
      ctx.run = run || host("action.metadata", {});
      ctx.cron = ctx.run;
      ctx.runMutation = function(mutationName, mutationArgs) {
        return host("action.runMutation", { name: mutationName, args: mutationArgs || {} });
      };
    } else {
      ctx.runMutation = function() {
        throw new Error("SNAPBACK_ACTION_CONTEXT_UNAVAILABLE: runMutation");
      };
    }
    var handlers = g.__snapbackHandlers || {};
    var handler = handlers[name] || g[name];
    if (typeof handler !== "function") {
      throw new Error("SNAPBACK_HANDLER_EXPORT_MISSING: " + name);
    }
    return await handler(ctx, args);
  };
})(globalThis);
"#
}

fn required_string(args: &Value, key: &str) -> SnapbackResult<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                "runtime",
                format!("handler host call missing string field {key}"),
            )
        })
}

fn required_object(args: &Value, key: &str) -> SnapbackResult<Map<String, Value>> {
    args.get(key)
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                "runtime",
                format!("handler host call missing object field {key}"),
            )
        })
}

fn row_version(row: &Value) -> SnapbackResult<u64> {
    row.get("_version").and_then(Value::as_u64).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_INVALID",
            "runtime",
            "read row was missing a numeric _version",
        )
    })
}

fn auth_dependencies(input: &HandlerInput) -> Vec<CapturedReadDependency> {
    let mut reads = Vec::new();
    if let Some(user_id) = &input.auth.user_id {
        reads.push(CapturedReadDependency {
            kind: CapturedReadKind::Auth,
            table: None,
            id: None,
            version: None,
            predicate: None,
            rows: Vec::new(),
            field: Some("userId".to_owned()),
            value: Some(Value::String(user_id.clone())),
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
        });
    }
    reads
}

fn c_string_to_string(ptr: *const c_char) -> SnapbackResult<String> {
    if ptr.is_null() {
        return Ok(String::new());
    }
    Ok(unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned())
}

fn c_host_response(prefix: char, text: String) -> *mut c_char {
    let sanitized = text.replace('\0', "\\0");
    let value = format!("{prefix}{sanitized}");
    let bytes = value.as_bytes();
    unsafe {
        let ptr = libc::malloc(bytes.len() + 1) as *mut u8;
        if ptr.is_null() {
            return ptr::null_mut();
        }
        ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        *ptr.add(bytes.len()) = 0;
        ptr as *mut c_char
    }
}

fn handler_serialize_error(error: serde_json::Error) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_HANDLER_INPUT_SERIALIZE_FAILED",
        "runtime",
        "handler invocation input could not be serialized",
    )
    .with_details(json!({ "error": error.to_string() }))
}

fn first_line(value: &str) -> String {
    value.lines().next().unwrap_or(value).to_owned()
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn detect_ibex_cli() -> IbexCliCapability {
    let path = env::var_os("SNAPBACK_IBEX")
        .map(PathBuf::from)
        .or_else(find_vendored_ibex_cli)
        .or_else(|| find_on_path("ibex"));
    let Some(path) = path else {
        return IbexCliCapability {
            available: false,
            path: None,
            version: None,
        };
    };

    let version = Command::new(&path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
            } else {
                None
            }
        })
        .filter(|value| !value.is_empty());

    IbexCliCapability {
        available: true,
        path: Some(path),
        version,
    }
}

fn detect_ibex_submodule() -> IbexSubmoduleCapability {
    let path = snapback_root().join("vendor").join("ibex");
    let present = path.join("Cargo.toml").is_file();
    IbexSubmoduleCapability {
        present,
        path: present.then_some(path),
    }
}

fn find_vendored_ibex_cli() -> Option<PathBuf> {
    let root = snapback_root();
    let binary = if cfg!(windows) { "ibex.exe" } else { "ibex" };
    [
        root.join("vendor")
            .join("ibex")
            .join("target")
            .join("debug")
            .join(binary),
        root.join("vendor")
            .join("ibex")
            .join("target")
            .join("release")
            .join(binary),
    ]
    .into_iter()
    .find(|path| is_executable(path))
}

fn snapback_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn find_on_path(binary: &str) -> Option<PathBuf> {
    let paths = env::var_os("PATH")?;
    env::split_paths(&paths)
        .map(|path| path.join(binary))
        .find(|path| is_executable(path))
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}
