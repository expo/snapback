//! A project on disk: `snapback/*.q` is the backend, `snapback/generated/`
//! is built, `.snapback4/` is the data directory. Nothing here is committed
//! except the `.q` files.

use snapback4_core::{Engine, RuntimeError, Store};
use snapback4_lang::{Bound, compile};
use std::path::{Path, PathBuf};

pub struct Project {
    pub root: PathBuf,
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

    pub fn generated_dir(&self) -> PathBuf {
        self.schema_dir().join("generated")
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

    /// The newest modification time among the sources, for the watcher.
    pub fn sources_stamp(&self) -> u128 {
        std::fs::read_dir(self.schema_dir())
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|e| e.file_name().to_string_lossy().ends_with(".q"))
                    .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
                    .filter_map(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_nanos())
                    .max()
                    .unwrap_or(0)
            })
            .unwrap_or(0)
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
        if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            std::fs::write(&path, text)?;
        }
        Ok(path)
    }

    /// Open (or create) the project's store and install the compiled schema.
    pub fn open_engine(&self, bound: &Bound) -> Result<Engine, RuntimeError> {
        std::fs::create_dir_all(self.data_dir()).map_err(|e| RuntimeError::Store(e.to_string()))?;
        let store = Store::open(&self.store_path())?;
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

/// A development persona's principal id.
pub fn persona_principal(name: &str) -> String {
    format!("dev:{name}")
}

/// The lines `.gitignore` needs for a project.
pub const GITIGNORE: &str = "# snapback4\n.snapback4/\nsnapback/generated/\n";
