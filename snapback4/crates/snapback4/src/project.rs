//! A project on disk: `snapback/*.q` is the backend, `snapback/generated/`
//! is built, `.snapback4/` is the data directory. Nothing here is committed
//! except the `.q` files.

use snapback4_core::{Engine, RuntimeError, Store};
use snapback4_lang::{Bound, compile};
use std::path::{Path, PathBuf};

pub struct Project {
    pub root: PathBuf,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct SourceStamp { sources: u128, dependencies: u128 }
type ServerDependency = (String, Option<(String, String)>);

fn stamp(value: impl std::fmt::Debug) -> u128 {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(format!("{value:?}"));
    u128::from_be_bytes(hash[..16].try_into().expect("sixteen hash bytes"))
}

impl Project {
    /// Walk up from `start` to the directory holding `snapback/schema.q`.
    pub fn locate(start: &Path) -> Option<Self> {
        let mut dir = Some(start.to_path_buf());
        while let Some(current) = dir {
            if current.join("snapback").join("schema.q").is_file() {
                return Some(Self { root: current });
            }
            dir = current.parent().map(Path::to_path_buf);
        }
        None
    }

    pub fn schema_dir(&self) -> PathBuf {
        self.root.join("snapback")
    }

    pub fn server_source(&self) -> Option<PathBuf> {
        ["snapback/server.ts", "snapback/server.mts", "snapback/server.mjs"].into_iter().map(|p| self.root.join(p)).find(|p| p.is_file())
    }

    pub fn generated_dir(&self) -> PathBuf {
        self.schema_dir().join("generated")
    }

    /// The app's native crate (LLP 3000.005), when it has one.
    pub fn native_dir(&self) -> PathBuf {
        self.schema_dir().join("native")
    }

    pub fn native_manifest(&self) -> PathBuf {
        self.native_dir().join("Cargo.toml")
    }

    /// The built module, beside the generated types.
    pub fn native_module(&self) -> PathBuf {
        self.generated_dir().join("native.wasm")
    }

    /// The schema's Rust types for the native crate to include.
    pub fn native_types(&self) -> PathBuf {
        self.generated_dir().join("native.rs")
    }

    pub fn data_dir(&self) -> PathBuf {
        self.root.join(".snapback4")
    }

    pub fn store_path(&self) -> PathBuf {
        self.data_dir().join("store.sqlite")
    }

    /// Every `.q` file under `snapback/`, `schema.q` first, as `(name, text)`.
    pub fn sources(&self) -> std::io::Result<Vec<(String, String)>> {
        let mut names: Vec<String> = std::fs::read_dir(self.schema_dir())?
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                (name.ends_with(".q") && entry.path().is_file()).then_some(name)
            })
            .collect();
        names.sort();
        if let Some(position) = names.iter().position(|n| n == "schema.q") {
            let schema = names.remove(position);
            names.insert(0, schema);
        }
        names.into_iter().map(|name| Ok((name.clone(), std::fs::read_to_string(self.schema_dir().join(&name))?))).collect()
    }

    /// The newest modification time among the sources — the `.q` files and
    /// the native crate's manifest and `src/` — for the watcher.
    pub fn sources_stamp(&self) -> SourceStamp {
        fn newest(dir: &Path, keep: &dyn Fn(&Path) -> bool, depth: u8) -> u128 {
            std::fs::read_dir(dir)
                .map(|entries| {
                    entries
                        .flatten()
                        .map(|e| e.path())
                        .map(|path| {
                            if path.is_dir() && depth > 0 {
                                newest(&path, keep, depth - 1)
                            } else if keep(&path) {
                                path.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0)
                            } else {
                                0
                            }
                        })
                        .max()
                        .unwrap_or(0)
                })
                .unwrap_or(0)
        }
        let quarry = newest(&self.schema_dir(), &|path| path.extension().is_some_and(|x| x == "q"), 0);
        let native = newest(&self.native_dir(), &|path| path.extension().is_some_and(|x| x == "rs" || x == "toml"), 6);
        // Include server source names as well as mtimes, so deletion of a
        // non-newest imported module still triggers validation and restart.
        fn server_files(dir: &Path, files: &mut Vec<(String, u128, u64)>, depth: u8) {
            if depth == 0 { return; }
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let Ok(meta) = entry.metadata() else { continue; };
                    if entry.file_type().is_ok_and(|kind| kind.is_symlink()) { continue; }
                    if meta.is_dir() {
                        if !matches!(entry.file_name().to_str(), Some("generated" | "native" | "node_modules" | "target")) { server_files(&path, files, depth - 1); }
                    } else if path.extension().is_some_and(|ext| matches!(ext.to_str(), Some("ts" | "mts" | "mjs" | "js" | "json"))) {
                        files.push((path.to_string_lossy().into(), meta.modified().ok().and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok()).map(|at| at.as_nanos()).unwrap_or(0), meta.len()));
                    }
                }
            }
        }
        let mut files = Vec::new(); server_files(&self.schema_dir(), &mut files, 12); files.sort();
        // The TypeScript checker records imports/configs outside snapback/ as
        // well as failed resolution candidates. Stat that bounded graph, not
        // unrelated UI sources, and retain absence so deletion/refill wakes us.
        let dependencies: Vec<ServerDependency> = self.checked_dependencies().into_iter().map(|(path, _)| {
            let state = std::fs::metadata(&path).ok().map(|meta| (
                meta.modified().ok().and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok()).map(|at| at.as_nanos()).unwrap_or(0).to_string(),
                meta.len().to_string(),
            ));
            (path, state)
        }).collect();
        SourceStamp { sources: stamp((quarry, native, files)), dependencies: stamp(dependencies) }
    }

    fn checked_dependencies(&self) -> Vec<ServerDependency> {
        std::fs::read(self.generated_dir().join("server-watch.json"))
            .ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
    }

    // A newly discovered graph is checker output, not an application edit.
    // Acknowledge the states actually observed before its file reads, never
    // a fresh post-check stat that could swallow an edit made during checking.
    pub fn check_server_at(&self, baseline: &mut SourceStamp) -> Result<(), String> {
        let before = self.checked_dependencies();
        let checked = self.check_server();
        let observed = self.checked_dependencies();
        if observed != before { baseline.dependencies = stamp(observed); }
        checked
    }

    pub fn compile(&self) -> std::io::Result<Bound> {
        Ok(compile(&self.sources()?))
    }

    /// Write `snapback/generated/api.ts` from a clean compile.
    pub fn write_generated(&self, bound: &Bound) -> std::io::Result<PathBuf> {
        let dir = self.generated_dir();
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("api.ts");
        let text = snapback4_lang::emit::typescript(bound);
        // @ref LLP 3000.007#20.2 — the generated API's ESM boundary is rebuilt with its artifacts, not imposed on existing scripts.
        let package = dir.join("package.json");
        if std::fs::read_to_string(&package).ok().as_deref() != Some(GENERATED_PACKAGE) {
            std::fs::write(package, GENERATED_PACKAGE)?;
        }
        if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            std::fs::write(&path, text)?;
        }
        let server = dir.join("server.ts");
        let text = snapback4_lang::emit::server_typescript(bound);
        if std::fs::read_to_string(&server).ok().as_deref() != Some(text.as_str()) {
            std::fs::write(server, text)?;
        }
        Ok(path)
    }

    /// A generated handler is checked by TypeScript, not merely emitted as a
    /// promise that the application's separate build might eventually check.
    // @ref LLP 3000.009#10.2 — A2 type errors are reported at check.
    pub fn check_server(&self) -> Result<(), String> {
        let Some(entry) = self.server_source() else { return Ok(()); };
        let mut child = std::process::Command::new(node())
            .arg("--max-old-space-size=256").arg("--input-type=module").arg("-e")
            .arg(include_str!("server_check.mjs")).arg(&self.root).arg(entry)
            .current_dir(&self.root).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
            .spawn().map_err(|e| format!("E_SERVER_TOOLCHAIN: cannot start Node 24 to check server handlers: {e}"))?;
        // Drain concurrently so a diagnostic-filled pipe cannot deadlock the
        // compiler. Keep only bounded diagnostics, never its complete output.
        fn drain(mut reader: impl std::io::Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
            std::thread::spawn(move || {
                let mut bytes = Vec::new(); let mut buffer = [0; 4096];
                while let Ok(count) = reader.read(&mut buffer) {
                    if count == 0 { break; }
                    let keep = count.min(64_000usize.saturating_sub(bytes.len())); bytes.extend_from_slice(&buffer[..keep]);
                }
                bytes
            })
        }
        let stdout = drain(child.stdout.take().expect("piped stdout"));
        let stderr = drain(child.stderr.take().expect("piped stderr"));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(20)),
                _ => { let _ = child.kill(); let _ = child.wait(); break None; }
            }
        };
        let stdout = stdout.join().unwrap_or_default(); let stderr = stderr.join().unwrap_or_default();
        if status.is_some_and(|status| status.success()) { return Ok(()); }
        if status.is_none() { return Err("E_SERVER_TYPECHECK: server handler checking exceeded 30 seconds; check the handler's import graph".into()); }
        let message = [String::from_utf8_lossy(&stdout), String::from_utf8_lossy(&stderr)].join("\n");
        Err(if message.trim().is_empty() { "E_SERVER_TYPECHECK: the TypeScript checker failed".into() } else { message.trim().into() })
    }

    /// Open (or create) the project's store and install the compiled schema.
    pub fn open_engine(&self, bound: &Bound) -> Result<Engine, RuntimeError> {
        self.open_engine_with_busy_timeout(bound, std::time::Duration::from_secs(5))
    }

    pub fn open_engine_with_busy_timeout(&self, bound: &Bound, timeout: std::time::Duration) -> Result<Engine, RuntimeError> {
        snapback4_core::private_fs::directory(&self.data_dir()).map_err(|e| RuntimeError::Store(e.to_string()))?;
        let store = Store::open_with_busy_timeout(&self.store_path(), timeout)?;
        if store.meta("release")?.is_some() {
            return Err(RuntimeError::Generation("this store belongs to a deployment; use `deploy` to activate source and `serve` to run it".into()));
        }
        Engine::new(store, bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone()))
    }

    /// Inspection attaches to existing data and never installs the working
    /// directory's source or creates a store as a side effect.
    pub fn open_store(&self) -> Result<Store, RuntimeError> {
        let path = self.store_path();
        if !path.is_file() {
            return Err(RuntimeError::Store(format!("no store at {}; run `snapback4 dev` first", path.display())));
        }
        snapback4_core::private_fs::directory(&self.data_dir()).map_err(|e| RuntimeError::Store(e.to_string()))?;
        Store::open(&path)
    }

    /// The release's compiled authoring metadata must describe the persisted
    /// programs we attach to. Neither stale selection nor edited release
    /// source is permission to activate another backend during startup.
    // @ref LLP 3000.000#the-atomic-object-to-define — startup attaches to the persisted activation
    pub fn open_release_engine(&self, bound: &Bound, release: u64) -> Result<Engine, RuntimeError> {
        let store = self.open_store()?;
        if store.meta("release")?.is_none() {
            return Err(RuntimeError::Generation("this deployment predates stored release activations; deploy its source once before serving".into()));
        }
        let engine = Engine::attach_release(store, release)?;
        let same_programs = bound.programs.len() == engine.programs().count()
            && bound.programs.iter().all(|bound| engine.program(&bound.program.name) == Some(&bound.program));
        if engine.schema() != &bound.schema || !same_programs {
            return Err(RuntimeError::Generation("release source differs from its activated backend; deploy the source as a new release".into()));
        }
        Ok(engine)
    }
}

pub(crate) fn node() -> PathBuf {
    let pinned = std::env::var_os("HOME").map(PathBuf::from).map(|p| p.join(".volta/tools/image/node/24.18.0/bin/node"));
    std::env::var_os("SNAPBACK_NODE").map(PathBuf::from).or_else(|| pinned.filter(|p| p.is_file())).unwrap_or_else(|| PathBuf::from("node"))
}

/// A development persona's principal id.
pub fn persona_principal(name: &str) -> String {
    format!("dev:{name}")
}

/// The lines `.gitignore` needs for a project.
pub const GENERATED_PACKAGE: &str = "{\"type\":\"module\"}\n";
pub const GITIGNORE: &str = "# snapback4\n.snapback4/\nsnapback/generated/\n";
