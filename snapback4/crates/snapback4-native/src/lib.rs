//! The guest side of a Snapback 4 native job (LLP 3000.005).
//!
//! A native job is a job whose body is the app's own Rust: `job name():
//! native` in `schema.q`, a crate under `snapback/native/` built to wasm by
//! `snapback4 check`, hosted by the engine one chunk per commit. The crate
//! names its jobs with [`jobs!`]; each is `fn(&Ctx, &Chunk) -> Result<Next>`.
//! Every read and write on [`Ctx`] is the interpreter's own operation on the
//! chunk's transaction: rules pass for the system, validation, constraints,
//! maintains and partition events apply, and the meter counts it. The
//! module imports one host function and nothing else — no clock, no
//! randomness, no I/O — so it runs under the simulator like any job.

pub use serde;
pub use serde_json::{self, Value as Json, json};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Map, Value};

/// A row as plain JSON: ids and text are strings, numbers are numbers.
pub type Row = Map<String, Value>;

/// A refusal in the engine's envelope: a stable code and a message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub code: String,
    pub message: String,
}

impl Error {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Order {
    Asc,
    Desc,
}

/// One page of a scan. `next` is the position to pass as `after` for the
/// following page; none when this page did not fill.
#[derive(Clone, Debug, Default)]
pub struct Page {
    pub rows: Vec<Row>,
    pub next: Option<Value>,
}

/// What a chunk returns: the job is done, or run it again with this state.
/// The state is the job's own — a scan's `next`, a phase name — committed
/// with the chunk's rows and handed back as [`Chunk::state`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Next {
    Done,
    Again(Value),
}

/// One invocation: the job's name, its arguments, the state the previous
/// chunk returned (none on the first), and the host's clock in ms.
#[derive(Clone, Debug)]
pub struct Chunk {
    pub job: String,
    pub args: Value,
    pub state: Option<Value>,
    pub now: i64,
}

/// The chunk's transaction, as the system principal.
pub struct Ctx {
    _private: (),
}

impl Ctx {
    fn call(&self, request: Value) -> Result<Value> {
        call(&request)
    }

    /// One row by id; none when absent or expired.
    pub fn get(&self, table: &str, id: &str) -> Result<Option<Row>> {
        row_or_none(self.call(json!({ "op": "get", "table": table, "id": id }))?)
    }

    /// One row by a unique key, all components given in index order.
    pub fn lookup(&self, table: &str, index: &str, key: &[Value]) -> Result<Option<Row>> {
        row_or_none(self.call(json!({ "op": "lookup", "table": table, "index": index, "key": key }))?)
    }

    /// A maintained aggregate's value for a group: the number, 0 when the
    /// group has no row.
    pub fn maintained(&self, maintain: &str, key: &[Value]) -> Result<i64> {
        Ok(self.lookup(maintain, "byGroup", key)?.and_then(|row| row.get("value").and_then(Value::as_i64)).unwrap_or(0))
    }

    /// A page of at most `first` rows under `prefix` in index order,
    /// resuming `after` the previous page's `next`.
    pub fn scan(&self, table: &str, index: &str, prefix: &[Value], order: Order, first: u32, after: Option<&Value>) -> Result<Page> {
        let order = match order { Order::Asc => "asc", Order::Desc => "desc" };
        let answer = self.call(json!({ "op": "scan", "table": table, "index": index, "prefix": prefix, "order": order, "first": first, "after": after }))?;
        let rows = answer.get("rows").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter_map(|row| match row { Value::Object(map) => Some(map), _ => None }).collect();
        let next = answer.get("next").filter(|next| !next.is_null()).cloned();
        Ok(Page { rows, next })
    }

    /// A fresh id from the chunk's context.
    pub fn mint(&self) -> Result<String> {
        Ok(self.call(json!({ "op": "mint" }))?.as_str().unwrap_or_default().to_owned())
    }

    /// Insert a row; the id is minted unless given. Returns the row as
    /// written. A unique clash, a cap, a bad value refuses the chunk.
    pub fn insert(&self, table: &str, row: Row) -> Result<Row> {
        row_or_none(self.call(json!({ "op": "insert", "table": table, "row": row }))?)?.ok_or_else(|| Error::new("E_NATIVE", "insert answered no row"))
    }

    /// Insert unless a unique index already holds the row; none on a clash.
    pub fn insert_if_absent(&self, table: &str, row: Row) -> Result<Option<Row>> {
        row_or_none(self.call(json!({ "op": "insert_if_absent", "table": table, "row": row }))?)
    }

    /// Patch the columns of the row with this id; `NOT_FOUND` when absent.
    pub fn update(&self, table: &str, id: &str, patch: Row) -> Result<()> {
        self.call(json!({ "op": "update", "table": table, "id": id, "patch": patch })).map(|_| ())
    }

    /// Insert or replace the row with this id.
    pub fn upsert(&self, table: &str, id: &str, row: Row) -> Result<()> {
        self.call(json!({ "op": "upsert", "table": table, "id": id, "row": row })).map(|_| ())
    }

    /// Insert or update by a unique key: the row's `id` is ignored; the
    /// existing row's id, or a minted one, is returned.
    pub fn upsert_by(&self, table: &str, index: &str, key: &[Value], mut row: Row) -> Result<String> {
        row.remove("id");
        match self.lookup(table, index, key)? {
            Some(existing) => {
                let id = existing.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
                self.update(table, &id, row)?;
                Ok(id)
            }
            None => {
                let id = self.mint()?;
                row.insert("id".into(), Value::String(id.clone()));
                self.insert(table, row)?;
                Ok(id)
            }
        }
    }

    pub fn delete(&self, table: &str, id: &str) -> Result<()> {
        self.call(json!({ "op": "delete", "table": table, "id": id })).map(|_| ())
    }

    /// The host's clock, as `now` is for a Quarry program.
    pub fn now(&self) -> Result<i64> {
        Ok(self.call(json!({ "op": "now" }))?.as_i64().unwrap_or(0))
    }

    /// A line the server prints with the job's name.
    pub fn log(&self, message: &str) {
        let _ = self.call(json!({ "op": "log", "message": message }));
    }
}

fn row_or_none(value: Value) -> Result<Option<Row>> {
    match value {
        Value::Null => Ok(None),
        Value::Object(map) => Ok(Some(map)),
        other => Err(Error::new("E_NATIVE", format!("expected a row, received {other}"))),
    }
}

/// A row as the struct the generated `native.rs` declares for its table.
pub fn from_row<T: DeserializeOwned>(row: Row) -> Result<T> {
    serde_json::from_value(Value::Object(row)).map_err(|error| Error::new("E_INPUT", error.to_string()))
}

/// A generated row struct as a row.
pub fn row_of<T: Serialize>(value: &T) -> Result<Row> {
    match serde_json::to_value(value) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(Error::new("E_INPUT", "a row is an object")),
        Err(error) => Err(Error::new("E_INPUT", error.to_string())),
    }
}

// ---- The ABI: one import, and the exports `jobs!` writes into the app's crate.

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn sb4_call(ptr: *const u8, len: usize) -> u64;
}

#[cfg(target_arch = "wasm32")]
fn host_call(bytes: &[u8]) -> u64 {
    // SAFETY: the host reads exactly `len` bytes at `ptr` and returns memory
    // it allocated through `sb4_alloc`, whose ownership passes back here.
    unsafe { sb4_call(bytes.as_ptr(), bytes.len()) }
}

#[cfg(not(target_arch = "wasm32"))]
fn host_call(_bytes: &[u8]) -> u64 {
    panic!("a snapback4 native job runs inside the snapback4 host as wasm; build with --target wasm32-unknown-unknown")
}

/// One request to the host, answered as `{ ok }` or `{ error }`.
#[doc(hidden)]
pub fn call(request: &Value) -> Result<Value> {
    let bytes = serde_json::to_vec(request).map_err(|error| Error::new("E_INPUT", error.to_string()))?;
    let packed = host_call(&bytes);
    if packed == 0 {
        panic!("the snapback4 host did not answer {}", request.get("op").and_then(Value::as_str).unwrap_or("a request"));
    }
    let ptr = (packed >> 32) as usize as *mut u8;
    let len = (packed & 0xffff_ffff) as usize;
    // SAFETY: the host wrote `len` bytes at `ptr`, memory it obtained from
    // `sb4_alloc` with this capacity, and hands its ownership back here.
    let answer = unsafe { Vec::from_raw_parts(ptr, len, len.max(1)) };
    let answer: Value = serde_json::from_slice(&answer).map_err(|error| Error::new("E_NATIVE", format!("the host's answer is not JSON: {error}")))?;
    if let Some(error) = answer.get("error") {
        return Err(Error::new(error.get("code").and_then(Value::as_str).unwrap_or("E_NATIVE"), error.get("message").and_then(Value::as_str).unwrap_or("the host refused")));
    }
    Ok(answer.get("ok").cloned().unwrap_or(Value::Null))
}

/// What the exports `jobs!` writes delegate to.
#[doc(hidden)]
pub mod abi {
    use super::*;

    pub fn alloc(len: usize) -> *mut u8 {
        let mut bytes: Vec<u8> = Vec::with_capacity(len.max(1));
        let ptr = bytes.as_mut_ptr();
        std::mem::forget(bytes);
        ptr
    }

    /// # Safety
    /// `ptr` came from [`alloc`] with this `len`.
    pub unsafe fn free(ptr: *mut u8, len: usize) {
        // SAFETY: the caller's contract.
        unsafe { drop(Vec::from_raw_parts(ptr, 0, len.max(1))) }
    }

    /// Hand JSON to the host as `(ptr << 32) | len` of a buffer it now owns.
    pub fn answer(value: &Value) -> u64 {
        let bytes = serde_json::to_vec(value).unwrap_or_default();
        let len = bytes.len();
        let ptr = bytes.as_ptr() as usize as u64;
        std::mem::forget(bytes);
        (ptr << 32) | len as u64
    }

    /// The host's request, from memory it filled through [`alloc`].
    ///
    /// # Safety
    /// `ptr` came from [`alloc`] with capacity `len` and holds `len` bytes.
    pub unsafe fn request(ptr: *mut u8, len: usize) -> Result<Chunk> {
        // SAFETY: the caller's contract.
        let bytes = unsafe { Vec::from_raw_parts(ptr, len, len.max(1)) };
        let value: Value = serde_json::from_slice(&bytes).map_err(|error| Error::new("E_NATIVE", format!("the host's request is not JSON: {error}")))?;
        Ok(Chunk {
            job: value.get("job").and_then(Value::as_str).unwrap_or_default().to_owned(),
            args: value.get("args").cloned().unwrap_or(Value::Object(Map::new())),
            state: value.get("state").filter(|state| !state.is_null()).cloned(),
            now: value.get("now").and_then(Value::as_i64).unwrap_or(0),
        })
    }

    /// Run the named job once and say what it returned.
    pub fn run(chunk: Chunk, jobs: &[(&str, fn(&Ctx, &Chunk) -> Result<Next>)]) -> Value {
        install_panic_hook();
        let Some((_, job)) = jobs.iter().find(|(name, _)| *name == chunk.job) else {
            return json!({ "error": { "code": "E_NATIVE", "message": format!("this module implements no job {}", chunk.job) } });
        };
        match job(&Ctx { _private: () }, &chunk) {
            Ok(Next::Done) => json!({ "done": true }),
            Ok(Next::Again(state)) => json!({ "again": state }),
            Err(error) => json!({ "error": { "code": error.code, "message": error.message } }),
        }
    }

    /// A panic's text reaches the host before the abort, so a parked job
    /// says why.
    fn install_panic_hook() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            std::panic::set_hook(Box::new(|info| {
                let _ = call(&json!({ "op": "log", "message": info.to_string() }));
            }));
        });
    }
}

/// Name the jobs this module implements: `snapback4_native::jobs! { rescore,
/// digest }`. Each is a `fn(&Ctx, &Chunk) -> Result<Next>` in scope. Writes
/// the module's exports into the app's crate so the linker keeps them.
#[macro_export]
macro_rules! jobs {
    ($($name:ident),+ $(,)?) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn sb4_alloc(len: usize) -> *mut u8 {
            $crate::abi::alloc(len)
        }

        /// # Safety
        /// `ptr` came from `sb4_alloc` with this `len`.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn sb4_free(ptr: *mut u8, len: usize) {
            unsafe { $crate::abi::free(ptr, len) }
        }

        #[unsafe(no_mangle)]
        pub extern "C" fn sb4_jobs() -> u64 {
            $crate::abi::answer(&$crate::json!([$(stringify!($name)),+]))
        }

        /// # Safety
        /// `ptr` came from `sb4_alloc` with capacity `len` and holds `len` bytes.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn sb4_run(ptr: *mut u8, len: usize) -> u64 {
            let chunk = match unsafe { $crate::abi::request(ptr, len) } {
                Ok(chunk) => chunk,
                Err(error) => return $crate::abi::answer(&$crate::json!({ "error": { "code": error.code, "message": error.message } })),
            };
            let jobs: &[(&str, fn(&$crate::Ctx, &$crate::Chunk) -> $crate::Result<$crate::Next>)] = &[$((stringify!($name), $name)),+];
            $crate::abi::answer(&$crate::abi::run(chunk, jobs))
        }
    };
}
