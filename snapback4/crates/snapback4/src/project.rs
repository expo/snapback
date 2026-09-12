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
        Engine::new(store, bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone()))
    }
}

/// A development persona's principal id.
pub fn persona_principal(name: &str) -> String {
    format!("dev:{name}")
}

/// The lines `.gitignore` needs for a project.
pub const GITIGNORE: &str = "# snapback4\n.snapback4/\nsnapback/generated/\n";
