//! Project discovery, compiler-worker custody, certification, and the build cache.
// @ref LLP 1002#1-decisions — the binary owns compilation through one worker.

use crate::protocol::Refusal;
use serde_json::{Map, Value as Json, json};
use snapback2_core::{Auth, Ceilings, Generation, ProjectJson, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

#[derive(Clone)]
pub struct CompiledProject {
    pub project: ProjectJson,
    pub generation: Generation,
    pub api_dts: String,
    pub compiler_ms: f64,
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

pub struct CompilerWorker {
    child: Child,
    input: BufWriter<ChildStdin>,
    output: BufReader<ChildStdout>,
    next_id: u64,
    pub path: PathBuf,
}

impl CompilerWorker {
    pub fn spawn() -> Result<Self, Refusal> {
        let path = compiler_path()?;
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
        Ok(Self {
            child,
            input: BufWriter::new(input),
            output: BufReader::new(output),
            next_id: 0,
            path,
        })
    }

    pub fn compile(&mut self, root: &Path) -> Result<CompiledProject, Vec<Refusal>> {
        let response = self.request("compile", root)?;
        if !response.get("ok").and_then(Json::as_bool).unwrap_or(false) {
            return Err(response_refusals(&response));
        }
        let mut project_value = response.get("project").cloned().ok_or_else(|| {
            vec![Refusal::owner(
                "E_OWNER_COMPILER_PROTOCOL",
                "compiler response omitted project",
                "reinstall snapback2 so the binary and compiler bundle match",
            )]
        })?;
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
        let sources: BTreeMap<String, SourceSite> = serde_json::from_value(
            response
                .get("sources")
                .cloned()
                .unwrap_or_else(|| Json::Object(Map::new())),
        )
        .unwrap_or_default();
        let generation = Generation::certify(&project, Ceilings::default()).map_err(|errors| {
            errors
                .into_iter()
                .map(|(program, error)| {
                    let family = if error.code.starts_with("E_BOUND")
                        || error.code.starts_with("E_UNBOUND")
                        || error.code == "E_STRUCTURAL_COUNT"
                    {
                        "bound"
                    } else if error.code.starts_with("E_SCHEMA") {
                        "schema"
                    } else if error.code.starts_with("E_EFFECT") {
                        "effect"
                    } else {
                        "op"
                    };
                    let mut refusal = Refusal::new(
                        error.code,
                        family,
                        error.message,
                        error.rewrite,
                        format!("{family}/certify"),
                    );
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
            api_dts: response
                .get("apiDts")
                .and_then(Json::as_str)
                .unwrap_or_default()
                .to_owned(),
            compiler_ms: response
                .get("ms")
                .and_then(Json::as_f64)
                .unwrap_or_default(),
        })
    }

    /// Doctor's liveness probe checks the lightweight, versioned worker shell.
    /// The shell also verifies custody of its compiler chunk and TypeScript;
    /// full lowering remains lazy until a compile, seed, or journeys request.
    pub fn answers(&mut self, root: &Path) -> Result<(), Vec<Refusal>> {
        let response = self.request("probe", root)?;
        let expected_id = self.next_id;
        if response.get("ok").and_then(Json::as_bool) == Some(true)
            && response.get("id").and_then(Json::as_u64) == Some(expected_id)
            && response.get("protocol").and_then(Json::as_str)
                == Some("snapback2/compiler-worker/v1")
        {
            Ok(())
        } else {
            Err(vec![Refusal::owner(
                "E_OWNER_COMPILER_PROTOCOL",
                "compiler liveness probe returned an incompatible response",
                "reinstall snapback2 so the binary and compiler bundle match",
            )])
        }
    }

    pub fn seed(&mut self, root: &Path) -> Result<SeedData, Vec<Refusal>> {
        let response = self.request("seed", root)?;
        if !response.get("ok").and_then(Json::as_bool).unwrap_or(false) {
            return Err(response_refusals(&response));
        }
        let seed = response.get("seed").cloned().unwrap_or_else(|| json!({}));
        Ok(SeedData {
            personas: seed
                .get("personas")
                .and_then(Json::as_array)
                .into_iter()
                .flatten()
                .filter_map(Json::as_str)
                .map(ToOwned::to_owned)
                .collect(),
            rows: serde_json::from_value(
                seed.get("rows")
                    .cloned()
                    .unwrap_or_else(|| Json::Object(Map::new())),
            )
            .unwrap_or_default(),
        })
    }

    pub fn journeys(&mut self, root: &Path) -> Result<Vec<PathBuf>, Vec<Refusal>> {
        let response = self.request("journeys", root)?;
        if !response.get("ok").and_then(Json::as_bool).unwrap_or(false) {
            return Err(response_refusals(&response));
        }
        Ok(response
            .get("files")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
            .filter_map(Json::as_str)
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
        let mut line = String::new();
        match self.output.read_line(&mut line) {
            Ok(0) => Err(vec![Refusal::owner(
                "E_OWNER_COMPILER_EXITED",
                "compiler worker exited without answering",
                "inspect .snapback/log.jsonl, fix the compiler failure, and rerun snapback2 dev",
            )]),
            Ok(_) => serde_json::from_str(&line).map_err(|error| {
                vec![Refusal::owner(
                    "E_OWNER_COMPILER_PROTOCOL",
                    format!("compiler worker returned invalid JSON: {error}"),
                    "reinstall snapback2 so the binary and compiler bundle match",
                )]
            }),
            Err(error) => Err(vec![Refusal::owner(
                "E_OWNER_COMPILER_EXITED",
                format!("cannot read compiler worker response: {error}"),
                "rerun snapback2 dev to start a fresh compiler worker",
            )]),
        }
    }
}

impl Drop for CompilerWorker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
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
    let build = root.join(".snapback/build");
    fs::create_dir_all(&build).map_err(|error| cache_error(&build, error))?;
    write_json(&build.join("project.json"), &compiled.project)?;
    let certificates: BTreeMap<_, _> = compiled
        .generation
        .programs()
        .iter()
        .map(|(name, (_, certificate))| (name, certificate))
        .collect();
    write_json(&build.join("certificates.json"), &certificates)?;
    fs::write(build.join("api.d.ts"), &compiled.api_dts)
        .map_err(|error| cache_error(&build, error))?;
    Ok(())
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
