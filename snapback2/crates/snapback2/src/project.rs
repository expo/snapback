//! Project discovery, compiler-worker custody, certification, and the build cache.
// @ref LLP 1002#1-decisions — the binary owns compilation through one worker.

use crate::protocol::{Refusal, certification_family_guide};
use serde_json::{Value as Json, json};
use snapback2_core::{Auth, Ceilings, Generation, ProjectJson, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

const COMPILER_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
static NEXT_CACHE_STAGE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct CompiledProject {
    pub project: ProjectJson,
    pub generation: Generation,
    pub api_dts: String,
    pub compiler_ms: f64,
}

pub struct StagedBuildCache {
    files: Vec<(Option<PathBuf>, PathBuf)>,
}

impl StagedBuildCache {
    pub fn publish(mut self) -> Result<(), Refusal> {
        for (staged, target) in &mut self.files {
            let path = staged.take().expect("unpublished staged cache file");
            if let Err(error) = fs::rename(&path, &*target) {
                *staged = Some(path);
                return Err(cache_error(target, error));
            }
        }
        Ok(())
    }
}

impl Drop for StagedBuildCache {
    fn drop(&mut self) {
        for (staged, _) in &self.files {
            if let Some(path) = staged {
                let _ = fs::remove_file(path);
            }
        }
    }
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSite {
    pub file: String,
    pub line: u32,
    pub col: u32,
}

#[derive(Clone, Default)]
pub struct SeedData {
    pub personas: Vec<String>,
    pub rows: BTreeMap<String, Vec<Json>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompileSuccess {
    id: u64,
    ok: bool,
    project: Json,
    sources: BTreeMap<String, SourceSite>,
    api_dts: String,
    ms: f64,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SeedSuccess {
    id: u64,
    ok: bool,
    seed: SeedDataWire,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SeedDataWire {
    personas: Vec<String>,
    rows: BTreeMap<String, Vec<Json>>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct JourneysSuccess {
    id: u64,
    ok: bool,
    files: Vec<String>,
}

#[derive(serde::Deserialize)]
struct ResponseHeader {
    id: u64,
    ok: bool,
}

pub struct CompilerWorker {
    child: Option<Child>,
    input: BufWriter<ChildStdin>,
    output: Receiver<Result<String, std::io::Error>>,
    output_thread: Option<thread::JoinHandle<()>>,
    cancel: Option<Arc<AtomicBool>>,
    next_id: u64,
    pub path: PathBuf,
}

impl CompilerWorker {
    pub fn spawn() -> Result<Self, Refusal> {
        let path = compiler_path()?;
        Self::spawn_path(path)
    }

    fn spawn_path(path: PathBuf) -> Result<Self, Refusal> {
        let mut child = Command::new("node")
            .arg(&path)
            .arg("--worker")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| {
                Refusal::owner(
                    "E_OWNER_NO_COMPILER",
                    format!(
                        "cannot start compiler worker at {}: {error}",
                        path.display()
                    ),
                    "set SNAPBACK2_COMPILER to the absolute bundled dist/compiler.mjs path",
                )
            })?;
        let input = child.stdin.take().ok_or_else(|| {
            Refusal::owner(
                "E_OWNER_NO_COMPILER",
                "compiler worker has no stdin",
                "set SNAPBACK2_COMPILER to a working bundled compiler.mjs",
            )
        })?;
        let output = child.stdout.take().ok_or_else(|| {
            Refusal::owner(
                "E_OWNER_NO_COMPILER",
                "compiler worker has no stdout",
                "set SNAPBACK2_COMPILER to a working bundled compiler.mjs",
            )
        })?;
        let (output_tx, output_rx) = mpsc::channel();
        let output_thread = match thread::Builder::new()
            .name("snapback2-compiler-output".to_owned())
            .spawn(move || read_worker_output(output, output_tx))
        {
            Ok(output_thread) => output_thread,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Refusal::owner(
                    "E_OWNER_NO_COMPILER",
                    format!("cannot supervise compiler worker output: {error}"),
                    "free process resources and rerun snapback2",
                ));
            }
        };
        Ok(Self {
            child: Some(child),
            input: BufWriter::new(input),
            output: output_rx,
            output_thread: Some(output_thread),
            cancel: None,
            next_id: 0,
            path,
        })
    }

    pub fn cancel_on(&mut self, stop: Arc<AtomicBool>) {
        self.cancel = Some(stop);
    }

    pub fn compile(&mut self, root: &Path) -> Result<CompiledProject, Vec<Refusal>> {
        let response = self.request("compile", root)?;
        if !response.get("ok").and_then(Json::as_bool).unwrap_or(false) {
            return Err(response_refusals(&response));
        }
        let success: CompileSuccess = success_response(response, "compile")?;
        debug_assert!(success.ok);
        debug_assert_eq!(success.id, self.next_id);
        let mut project_value = success.project;
        normalize_project_json(&mut project_value);
        let project: ProjectJson = serde_json::from_value(project_value).map_err(|error| {
            vec![Refusal::new(
                "E_OWNER_COMPILER_PROTOCOL",
                "owner",
                format!("compiler project does not match the landed engine API: {error}"),
                "rebuild the bundled compiler against this snapback2-core",
                "owner/compiler",
            )]
        })?;
        let sources = success.sources;
        let generation = Generation::certify(&project, Ceilings::default()).map_err(|errors| {
            errors
                .into_iter()
                .map(|(program, error)| {
                    let (family, guide) = certification_family_guide(&error.code);
                    let mut refusal =
                        Refusal::new(error.code, family, error.message, error.rewrite, guide);
                    refusal.site = Some(
                        sources
                            .get(&program)
                            .map(|site| format!("{}:{}:{}", site.file, site.line, site.col))
                            .unwrap_or_else(|| format!("<project>:{program}")),
                    );
                    refusal
                })
                .collect::<Vec<_>>()
        })?;
        Ok(CompiledProject {
            project,
            generation,
            api_dts: success.api_dts,
            compiler_ms: success.ms,
        })
    }

    /// Doctor's liveness probe checks the lightweight, versioned worker shell.
    /// The shell also verifies custody of its compiler chunk and TypeScript;
    /// full lowering remains lazy until a compile, seed, or journeys request.
    pub fn answers(&mut self, root: &Path) -> Result<(), Vec<Refusal>> {
        let response = self.request("probe", root)?;
        let expected_id = self.next_id;
        let compatible = response.get("id").and_then(Json::as_u64) == Some(expected_id)
            && response.get("protocol").and_then(Json::as_str)
                == Some("snapback2/compiler-worker/v1")
            && response.get("operations") == Some(&json!(["compile", "seed", "journeys"]));
        if compatible && response.get("ok").and_then(Json::as_bool) == Some(true) {
            Ok(())
        } else if compatible
            && response.get("ok").and_then(Json::as_bool) == Some(false)
            && matches!(
                response.get("dependency").and_then(Json::as_str),
                Some("compiler-core.mjs" | "typescript")
            )
        {
            let dependency = response.get("dependency").and_then(Json::as_str).unwrap();
            Err(vec![Refusal::owner(
                "E_OWNER_NO_COMPILER",
                format!("compiler worker dependency {dependency} is unavailable"),
                "reinstall snapback2 so compiler.mjs, compiler-core.mjs, and TypeScript come from one package",
            )])
        } else {
            Err(vec![Refusal::owner(
                "E_OWNER_COMPILER_PROTOCOL",
                "compiler liveness probe returned an incompatible id, protocol, or operation set",
                "reinstall snapback2 so the binary and compiler bundle match",
            )])
        }
    }

    pub fn seed(&mut self, root: &Path) -> Result<SeedData, Vec<Refusal>> {
        let response = self.request("seed", root)?;
        if !response.get("ok").and_then(Json::as_bool).unwrap_or(false) {
            return Err(response_refusals(&response));
        }
        let success: SeedSuccess = success_response(response, "seed")?;
        debug_assert!(success.ok);
        debug_assert_eq!(success.id, self.next_id);
        Ok(SeedData {
            personas: success.seed.personas,
            rows: success.seed.rows,
        })
    }

    pub fn journeys(&mut self, root: &Path) -> Result<Vec<PathBuf>, Vec<Refusal>> {
        let response = self.request("journeys", root)?;
        if !response.get("ok").and_then(Json::as_bool).unwrap_or(false) {
            return Err(response_refusals(&response));
        }
        let success: JourneysSuccess = success_response(response, "journeys")?;
        debug_assert!(success.ok);
        debug_assert_eq!(success.id, self.next_id);
        Ok(success
            .files
            .into_iter()
            .map(|path| root.join(path))
            .collect())
    }

    fn request(&mut self, op: &str, root: &Path) -> Result<Json, Vec<Refusal>> {
        if !root.is_absolute() {
            return Err(vec![Refusal::owner(
                "E_OWNER_PROJECT_ROOT",
                "compiler worker requires an absolute project root",
                "pass --project with an absolute path or a directory that can be canonicalized",
            )]);
        }
        self.next_id += 1;
        let request = json!({ "id": self.next_id, "op": op, "root": root });
        if let Err(error) = writeln!(self.input, "{request}").and_then(|_| self.input.flush()) {
            return Err(vec![Refusal::owner(
                "E_OWNER_COMPILER_EXITED",
                format!("cannot write to compiler worker: {error}"),
                "rerun snapback2 dev to start a fresh compiler worker",
            )]);
        }
        let started = Instant::now();
        loop {
            match self.output.recv_timeout(Duration::from_millis(25)) {
                Ok(Ok(line)) => {
                    let response: Json = serde_json::from_str(&line).map_err(|error| {
                        vec![Refusal::owner(
                            "E_OWNER_COMPILER_PROTOCOL",
                            format!("compiler worker returned invalid JSON: {error}"),
                            "reinstall snapback2 so the binary and compiler bundle match",
                        )]
                    })?;
                    let header: ResponseHeader =
                        serde_json::from_value(response.clone()).map_err(|error| {
                            vec![Refusal::owner(
                                "E_OWNER_COMPILER_PROTOCOL",
                                format!(
                                    "compiler {op} response omitted a valid id or ok field: {error}"
                                ),
                                "reinstall snapback2 so the binary and compiler bundle match",
                            )]
                        })?;
                    if header.id != self.next_id {
                        return Err(vec![Refusal::owner(
                            "E_OWNER_COMPILER_PROTOCOL",
                            format!(
                                "compiler {op} response id {} did not match request id {}",
                                header.id, self.next_id
                            ),
                            "reinstall snapback2 so the binary and compiler bundle match",
                        )]);
                    }
                    let _ = header.ok;
                    return Ok(response);
                }
                Ok(Err(error)) => {
                    return Err(vec![Refusal::owner(
                        "E_OWNER_COMPILER_EXITED",
                        format!("cannot read compiler worker response: {error}"),
                        "rerun snapback2 dev to start a fresh compiler worker",
                    )]);
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(vec![Refusal::owner(
                        "E_OWNER_COMPILER_EXITED",
                        "compiler worker exited without answering",
                        "inspect .snapback/log.jsonl, fix the compiler failure, and rerun snapback2 dev",
                    )]);
                }
                Err(RecvTimeoutError::Timeout)
                    if self
                        .cancel
                        .as_ref()
                        .is_some_and(|cancel| cancel.load(Ordering::SeqCst)) =>
                {
                    self.terminate();
                    return Err(vec![Refusal::owner(
                        "E_OWNER_COMPILER_EXITED",
                        format!("compiler {op} request was cancelled during owner shutdown"),
                        "rerun snapback2 dev to start a fresh compiler worker",
                    )]);
                }
                Err(RecvTimeoutError::Timeout) if started.elapsed() >= COMPILER_REQUEST_TIMEOUT => {
                    self.terminate();
                    return Err(vec![Refusal::owner(
                        "E_OWNER_COMPILER_EXITED",
                        format!("compiler {op} request exceeded 30 seconds"),
                        "inspect the compiler worker and rerun snapback2 dev",
                    )]);
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    }

    fn terminate(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(output_thread) = self.output_thread.take() {
            let _ = output_thread.join();
        }
    }
}

fn read_worker_output(output: ChildStdout, sender: mpsc::Sender<Result<String, std::io::Error>>) {
    let mut output = BufReader::new(output);
    loop {
        let mut line = String::new();
        match output.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                if sender.send(Ok(line)).is_err() {
                    break;
                }
            }
            Err(error) => {
                let _ = sender.send(Err(error));
                break;
            }
        }
    }
}

fn success_response<T: serde::de::DeserializeOwned>(
    response: Json,
    op: &str,
) -> Result<T, Vec<Refusal>> {
    serde_json::from_value(response).map_err(|error| {
        vec![Refusal::owner(
            "E_OWNER_COMPILER_PROTOCOL",
            format!("compiler {op} success response has the wrong shape: {error}"),
            "reinstall snapback2 so the binary and compiler bundle match",
        )]
    })
}

impl Drop for CompilerWorker {
    fn drop(&mut self) {
        self.terminate();
    }
}

pub fn locate_root(explicit: Option<&Path>) -> Result<PathBuf, Refusal> {
    let start = match explicit {
        Some(path) => path.to_path_buf(),
        None => std::env::current_dir().map_err(|error| {
            Refusal::owner(
                "E_OWNER_PROJECT_ROOT",
                format!("cannot read current directory: {error}"),
                "run snapback2 inside a project or pass --project <dir>",
            )
        })?,
    };
    let mut current = start.canonicalize().map_err(|error| {
        Refusal::owner(
            "E_OWNER_PROJECT_ROOT",
            format!("cannot resolve project path {}: {error}", start.display()),
            "pass an existing project directory",
        )
    })?;
    if current.is_file() {
        current.pop();
    }
    loop {
        if current.join("snapback/schema.ts").is_file() {
            return Ok(current);
        }
        if !current.pop() {
            break;
        }
    }
    Err(Refusal::owner(
        "E_OWNER_PROJECT_ROOT",
        format!(
            "no snapback/schema.ts found from {} upward",
            start.display()
        ),
        "run snapback2 init or pass --project <dir> containing snapback/schema.ts",
    ))
}

pub fn compiler_path() -> Result<PathBuf, Refusal> {
    let candidate = if let Some(path) = std::env::var_os("SNAPBACK2_COMPILER") {
        PathBuf::from(path)
    } else {
        std::env::current_exe()
            .map_err(|error| {
                Refusal::owner(
                    "E_OWNER_NO_COMPILER",
                    format!("cannot locate the snapback2 binary: {error}"),
                    "set SNAPBACK2_COMPILER to the absolute bundled dist/compiler.mjs path",
                )
            })?
            .with_file_name("compiler.mjs")
    };
    let candidate = candidate.canonicalize().map_err(|_| {
        Refusal::owner(
            "E_OWNER_NO_COMPILER",
            format!("compiler worker not found at {}", candidate.display()),
            "set SNAPBACK2_COMPILER to the absolute bundled dist/compiler.mjs path",
        )
    })?;
    if !candidate.is_file() {
        return Err(Refusal::owner(
            "E_OWNER_NO_COMPILER",
            format!(
                "compiler worker path is not a file: {}",
                candidate.display()
            ),
            "set SNAPBACK2_COMPILER to the absolute bundled dist/compiler.mjs path",
        ));
    }
    Ok(candidate)
}

pub fn write_build_cache(root: &Path, compiled: &CompiledProject) -> Result<(), Refusal> {
    stage_build_cache(root, compiled)?.publish()
}

// @ref LLP 1002#5-the-owner — a watched successor stages artifacts before runtime admission.
pub fn stage_build_cache(
    root: &Path,
    compiled: &CompiledProject,
) -> Result<StagedBuildCache, Refusal> {
    let build = root.join(".snapback/build");
    fs::create_dir_all(&build).map_err(|error| cache_error(&build, error))?;
    let stage = format!(
        ".cache-{}-{}",
        std::process::id(),
        NEXT_CACHE_STAGE.fetch_add(1, Ordering::Relaxed)
    );
    let project = build.join(format!("{stage}-project.json"));
    let certificates_path = build.join(format!("{stage}-certificates.json"));
    let api = build.join(format!("{stage}-api.d.ts"));
    let mut staged = StagedBuildCache { files: Vec::new() };
    staged
        .files
        .push((Some(project.clone()), build.join("project.json")));
    write_json(&project, &compiled.project)?;
    let certificates: BTreeMap<_, _> = compiled
        .generation
        .programs()
        .iter()
        .map(|(name, (_, certificate))| (name, certificate))
        .collect();
    staged.files.push((
        Some(certificates_path.clone()),
        build.join("certificates.json"),
    ));
    write_json(&certificates_path, &certificates)?;
    staged
        .files
        .push((Some(api.clone()), build.join("api.d.ts")));
    fs::write(&api, &compiled.api_dts).map_err(|error| cache_error(&build, error))?;
    Ok(staged)
}

pub fn compile_once(root: &Path) -> Result<CompiledProject, Vec<Refusal>> {
    let mut worker = CompilerWorker::spawn().map_err(|error| vec![error])?;
    let compiled = worker.compile(root)?;
    let _ = worker.journeys(root)?;
    write_build_cache(root, &compiled).map_err(|error| vec![error])?;
    Ok(compiled)
}

pub fn certify_project_value(mut value: Json) -> Result<CompiledProject, Vec<Refusal>> {
    normalize_project_json(&mut value);
    let project: ProjectJson = serde_json::from_value(value).map_err(|error| {
        vec![Refusal::new(
            "E_OWNER_COMPILER_PROTOCOL",
            "owner",
            format!("control project does not match the engine API: {error}"),
            "send the project object emitted by this snapback2 compiler",
            "owner/compiler",
        )]
    })?;
    let generation = Generation::certify(&project, Ceilings::default()).map_err(|errors| {
        errors
            .into_iter()
            .map(|(program, error)| {
                Refusal::new(
                    error.code,
                    "successor",
                    error.message,
                    error.rewrite,
                    "successor/certify",
                )
                .with_site(format!("<project>:{program}"))
            })
            .collect::<Vec<_>>()
    })?;
    Ok(CompiledProject {
        project,
        generation,
        api_dts: String::new(),
        compiler_ms: 0.0,
    })
}

pub fn seed_rows(
    seed: &SeedData,
    compiled: &CompiledProject,
) -> Result<Vec<(String, Value)>, Refusal> {
    let mut output = Vec::new();
    for (table_name, rows) in &seed.rows {
        let table = compiled
            .generation
            .schema()
            .tables
            .get(table_name)
            .ok_or_else(|| {
                Refusal::input(
                    format!("seed names unknown table {table_name}"),
                    "fix snapback/seed.ts and rerun snapback2 check",
                )
            })?;
        for row in rows {
            let object = row.as_object().ok_or_else(|| {
                Refusal::input(
                    format!("seed row for {table_name} is not an object"),
                    "write seed rows as object literals",
                )
            })?;
            let mut converted = BTreeMap::new();
            for (field, value) in object {
                let kind = table.columns.get(field).ok_or_else(|| {
                    Refusal::input(
                        format!("seed row for {table_name} has unknown field {field}"),
                        "remove the field or declare it in snapback/schema.ts",
                    )
                })?;
                converted.insert(field.clone(), json_for_column(value, kind)?);
            }
            output.push((table_name.clone(), Value::Row(converted)));
        }
    }
    Ok(output)
}

fn json_for_column(value: &Json, kind: &snapback2_core::ColumnType) -> Result<Value, Refusal> {
    use snapback2_core::ColumnType;
    if let ColumnType::Optional(inner) = kind {
        if value.is_null() {
            return Ok(Value::Null);
        }
        return json_for_column(value, inner);
    }
    match kind {
        ColumnType::Principal => value
            .as_str()
            .map(|value| Value::Id(value.to_owned()))
            .ok_or_else(|| {
                Refusal::input(
                    "principal seed values must be strings",
                    "use a principal id",
                )
            }),
        ColumnType::Id | ColumnType::Ref { .. } => value
            .as_str()
            .map(|value| Value::Id(value.to_owned()))
            .ok_or_else(|| {
                Refusal::input("id and ref seed values must be strings", "use a string id")
            }),
        ColumnType::Text { .. } | ColumnType::Enum { .. } => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| {
                Refusal::input(
                    "text and enum seed values must be strings",
                    "use a string value",
                )
            }),
        ColumnType::Bytes { .. } => value
            .as_object()
            .filter(|object| object.len() == 1)
            .and_then(|object| object.get("Bytes"))
            .and_then(serde_json::Value::as_str)
            .and_then(snapback2_core::decode_bytes_hex)
            .map(Value::Bytes)
            .ok_or_else(|| {
                Refusal::input(
                    "bytes seed values must use {\"Bytes\":\"lowercase-base16\"}",
                    "use canonical lowercase even-length base16",
                )
            }),
        ColumnType::Int
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => value.as_i64().map(Value::Int).ok_or_else(|| {
            Refusal::input(
                "numeric seed values must be integers",
                "use integer minor units for decimal and money",
            )
        }),
        ColumnType::Bool => value.as_bool().map(Value::Bool).ok_or_else(|| {
            Refusal::input("boolean seed values must be true or false", "use a boolean")
        }),
        ColumnType::List { of, .. } => value
            .as_array()
            .ok_or_else(|| Refusal::input("list seed values must be arrays", "use an array"))?
            .iter()
            .map(|value| json_for_column(value, of))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        ColumnType::Json { .. } => crate::protocol::json_to_value(value),
        ColumnType::Optional(_) => unreachable!(),
    }
}

fn normalize_project_json(value: &mut Json) {
    let Some(project) = value.as_object_mut() else {
        return;
    };
    project.entry("version").or_insert(Json::Number(1.into()));
    if !project.contains_key("auth") {
        let auth = project
            .get("schema")
            .and_then(Json::as_object)
            .and_then(|schema| schema.get("auth"))
            .cloned()
            .unwrap_or_else(|| serde_json::to_value(Auth::default()).unwrap_or(json!({})));
        project.insert("auth".to_owned(), auth);
    }
}

fn response_refusals(response: &Json) -> Vec<Refusal> {
    let diagnostics = response
        .get("diagnostics")
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    let refusals: Vec<_> = diagnostics
        .into_iter()
        .filter_map(|value| serde_json::from_value(value).ok())
        .collect();
    if refusals.is_empty() {
        vec![Refusal::owner(
            "E_OWNER_COMPILER_PROTOCOL",
            "compiler refused without diagnostics",
            "reinstall snapback2 so the binary and compiler bundle match",
        )]
    } else {
        refusals
    }
}

fn write_json(path: &Path, value: &impl serde::Serialize) -> Result<(), Refusal> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| {
        Refusal::owner(
            "E_OWNER_BUILD_CACHE",
            format!("cannot serialize {}: {error}", path.display()),
            "fix the compiler output and rerun snapback2 check",
        )
    })?;
    fs::write(path, bytes).map_err(|error| cache_error(path, error))
}

fn cache_error(path: &Path, error: std::io::Error) -> Refusal {
    Refusal::owner(
        "E_OWNER_BUILD_CACHE",
        format!("cannot write {}: {error}", path.display()),
        "make .snapback writable and rerun snapback2 check",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn worker(expression: &str) -> (CompilerWorker, PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "snapback2-protocol-{}-{}.mjs",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::write(
            &path,
            format!(
                r#"import {{ createInterface }} from "node:readline";
for await (const line of createInterface({{ input: process.stdin }})) {{
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({expression}) + "\n");
}}
"#
            ),
        )
        .unwrap();
        (CompilerWorker::spawn_path(path.clone()).unwrap(), path)
    }

    #[test]
    fn compiler_success_protocol_rejects_malformed_wrong_id_and_wrong_operation() {
        let root = std::env::current_dir().unwrap().canonicalize().unwrap();
        let cases = [
            (
                "seed",
                "({ id: request.id, ok: true, seed: { personas: ['alice'], rows: 5 } })",
            ),
            ("journeys", "({ id: request.id, ok: true })"),
            (
                "wrong-id",
                "({ id: request.id + 1, ok: true, seed: { personas: [], rows: {} } })",
            ),
            (
                "wrong-operation",
                "({ id: request.id, ok: true, seed: { personas: [], rows: {} } })",
            ),
        ];
        for (case, response) in cases {
            let (mut worker, path) = worker(response);
            let result = match case {
                "seed" | "wrong-id" => worker.seed(&root).map(|_| ()),
                _ => worker.journeys(&root).map(|_| ()),
            };
            let errors = result.expect_err(case);
            assert_eq!(errors[0].code, "E_OWNER_COMPILER_PROTOCOL", "{case}");
            drop(worker);
            fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn cancelling_a_blocked_request_kills_and_reaps_the_worker() {
        let (mut worker, path) = worker("await new Promise(() => {})");
        let pid = worker.child.as_ref().unwrap().id();
        let cancel = Arc::new(AtomicBool::new(false));
        worker.cancel_on(cancel.clone());
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            cancel.store(true, Ordering::SeqCst);
        });

        let errors = match worker.seed(&std::env::current_dir().unwrap().canonicalize().unwrap()) {
            Ok(_) => panic!("blocked request should be cancelled"),
            Err(errors) => errors,
        };

        assert_eq!(errors[0].code, "E_OWNER_COMPILER_EXITED");
        assert!(worker.child.is_none());
        #[cfg(unix)]
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
        drop(worker);
        fs::remove_file(path).unwrap();
    }
}
