// @ref LLP 3000.011.003.000.000#2 — explicit saved bytes replace only source selection, never activation or store semantics.
use super::{Options, Project};
use std::path::Path;

/// Select one complete saved backend, or the ordinary multi-file project.
/// The vector is retained for both compilation and staging: one read, no swap.
pub(super) fn sources(project: &Project, options: &Options, flag: &str) -> Result<Vec<(String, String)>, String> {
    match options.flags.get(flag) {
        None => project.sources().map_err(|e| e.to_string()),
        Some(file) => {
            let path = Path::new(file);
            if path.is_dir() {
                return crate::client_compatibility::sources(path).map_err(|e| e.to_string());
            }
            let name = path.file_name().and_then(|s| s.to_str()).ok_or("saved source needs a UTF-8 file name")?;
            if !name.ends_with(".q") { return Err("saved source must be a complete Quarry .q file".into()); }
            let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read saved source {file}: {e}"))?;
            // A saved complete backend retains the schema namespace regardless of its archive file name.
            Ok(vec![("schema.q".into(), text)])
        }
    }
}

pub(super) fn compile(sources: &[(String, String)], options: &Options, flag: &str) -> snapback4_lang::Bound {
    let mut bound = snapback4_lang::compile(sources);
    if let Some(file) = options.flags.get(flag) {
        for diagnostic in &mut bound.diagnostics { diagnostic.site.file = if Path::new(file).is_dir() { Path::new(file).join(&diagnostic.site.file).to_string_lossy().into_owned() } else { file.clone() }; }
    }
    bound
}

/// A saved file can be used outside a project. Companion code is selected
/// only from an actual current project, never from arbitrary sibling files.
pub(super) fn project(options: &Options, flag: &str) -> Result<Project, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    if let Some(project) = Project::locate(&cwd) { return Ok(project); }
    if options.flags.contains_key(flag) { return Ok(Project { root: cwd }); }
    Err("no snapback/*.q here or above; run `snapback4 init` or select a saved source file".into())
}

/// A private companion build uses the selected schema's generated contracts.
/// Packaging still records the original host installation, never this scratch.
pub(super) struct Candidate { pub project: Project }
impl Drop for Candidate { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.project.root); } }
impl Candidate {
    pub(super) fn prepare(original: &Project, stage: &Path, bound: &snapback4_lang::Bound) -> Result<Self, String> {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static SERIAL: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!("snapback4-saved-source-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir(&root).map_err(|e| e.to_string())?;
        #[cfg(unix)] snapback4_core::private_fs::directory(&root).map_err(|e| e.to_string())?;
        let candidate = Self { project: Project { root } };
        // The worker snapshotter captures the actual import closure and refuses
        // symlinks. Copy those captured bytes, not an unbounded application tree.
        copy_tree(stage, &candidate.project.root).map_err(|e| e.to_string())?;
        // Discover the current dependency graph without installing selected
        // contracts in the working project. A failed typecheck still publishes
        // its graph; the copied bytes are checked with selected contracts below.
        if let Some(entry) = crate::dev_worker::source(original) {
            let _ = original.check_entry(&entry);
            crate::dev_worker::package_entry(original, &candidate.project.root)?;
        }
        candidate.project.write_generated_from(bound, original).map_err(|e| e.to_string())?;
        if !crate::native::declared(bound).is_empty() && original.native_manifest().exists() {
            copy_tree(&original.native_dir(), &candidate.project.native_dir()).map_err(|e| e.to_string())?;
            rebase_tree(&candidate.project.native_dir(), &original.native_dir()).map_err(|e| format!("saved-source native snapshot: {e}"))?;
        }
        if original.root.join("package.json").is_file() { std::fs::copy(original.root.join("package.json"), candidate.project.root.join("package.json")).map_err(|e| e.to_string())?; }
        #[cfg(unix)] {
            // Dependencies are host installation bytes, as in ordinary release
            // workers. Source and generated contracts remain private copies.
            let dependencies = original.root.ancestors().map(|root| root.join("node_modules")).find(|path| path.is_dir());
            if let Some(dependencies) = dependencies { std::os::unix::fs::symlink(dependencies, candidate.project.root.join("node_modules")).map_err(|e| e.to_string())?; }
        }
        crate::dev_worker::link_dependencies(original, &candidate.project.root)?;
        if let Some(entry) = crate::dev_worker::source(&candidate.project) { candidate.project.check_entry(&entry)?; }
        Ok(candidate)
    }
}
fn copy_tree(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        if matches!(entry.file_name().to_str(), Some("target" | "native-target" | ".git")) { continue; }
        let kind = entry.file_type()?;
        if kind.is_dir() { copy_tree(&entry.path(), &target.join(entry.file_name()))?; }
        else if kind.is_file() { std::fs::copy(entry.path(), target.join(entry.file_name()))?; }
        else { return Err(std::io::Error::other("saved-source companion snapshot permits regular source files only")); }
    }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    fn dir(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("sb4-saved-{}-{label}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root); std::fs::create_dir_all(root.join("snapback/generated")).unwrap(); root
    }
    #[test]
    fn archived_names_preserve_operations_and_diagnostics_name_the_selected_input() {
        let root = dir("archived"); let project = Project { root: root.clone() };
        let file = root.join("v1.q");
        std::fs::write(&file, "query alive():\n  return true\n").unwrap();
        let options = Options { positionals: vec![], flags: [("schema".into(), file.to_str().unwrap().into())].into(), json: false };
        let selected = sources(&project, &options, "schema").unwrap();
        assert_eq!(selected[0].0, "schema.q");
        let bound = compile(&selected, &options, "schema");
        assert!(bound.diagnostics.is_empty()); assert_eq!(bound.programs[0].program.name, "alive");
        std::fs::write(&file, "not a Quarry backend").unwrap();
        let bound = compile(&sources(&project, &options, "schema").unwrap(), &options, "schema");
        assert!(!bound.diagnostics.is_empty()); assert!(bound.diagnostics.iter().all(|d| d.site.file == file.to_str().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn missing_baseline_names_original_absolute_location() {
        let root = dir("missing-baseline"); let project = Project { root: root.clone() };
        std::fs::write(root.join("snapback/client-compatibility.json"), r#"{"baseline":"versions/v1","since_release":2}"#).unwrap();
        let bound = snapback4_lang::compile(&[("schema.q".into(), "query alive():\n  return true\n".into())]);
        let error = project.write_generated(&bound).unwrap_err().to_string();
        assert!(error.contains(root.join("versions/v1").to_str().unwrap()) && error.contains("does not exist (resolved from") && error.contains("snapback/client-compatibility.json"), "{error}");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn inherited_native_workspace_refuses_before_touching_working_generated_types() {
        let root = dir("workspace"); let stage = dir("workspace-stage");
        let original = Project { root: root.clone() };
        std::fs::create_dir_all(original.native_dir()).unwrap();
        std::fs::write(original.native_manifest(), "[package]\nname = \"fixture\"\nversion.workspace = true\n").unwrap();
        std::fs::write(original.native_types(), "working sentinel").unwrap();
        let bound = snapback4_lang::compile(&[("schema.q".into(), "job sweep(): native\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let error = Candidate::prepare(&original, &stage, &bound).err().unwrap();
        assert!(error.contains("workspace-inherited") && error.contains("standalone"), "{error}");
        assert_eq!(std::fs::read_to_string(original.native_types()).unwrap(), "working sentinel");
        std::fs::remove_dir_all(root).unwrap(); std::fs::remove_dir_all(stage).unwrap();
    }
    #[test]
    fn native_types_are_built_for_selected_source_in_private_tree() {
        let root = dir("native"); let stage = dir("stage");
        let original = Project { root: root.clone() };
        std::fs::create_dir_all(original.native_dir().join("src")).unwrap();
        std::fs::write(original.native_manifest(), "[package]\nname = \"fixture\"\nversion = \"0.0.0\"\n").unwrap();
        std::fs::write(original.native_types(), "working sentinel").unwrap();
        let source = "table notes:\n  title: text <=80\n  color: text <=20\n  public 'shared'\njob sweep(): native\n";
        let bound = snapback4_lang::compile(&[("v2.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let candidate = Candidate::prepare(&original, &stage, &bound).unwrap();
        crate::native::build(&candidate.project, &bound).err().expect("private build refuses absent native target"); // no lib target: a private build refusal, never working generated writes
        assert!(std::fs::read_to_string(candidate.project.native_types()).unwrap().contains("color"));
        assert_eq!(std::fs::read_to_string(original.native_types()).unwrap(), "working sentinel");
        let manifest = "[dependencies]\nsdk = { path = \"../sdk\" }\n";
        std::fs::create_dir_all(root.join("snapback/sdk")).unwrap();
        std::fs::write(original.native_manifest(), manifest).unwrap();
        let relocated = Candidate::prepare(&original, &stage, &bound).unwrap();
        let parsed: toml::Value = std::fs::read_to_string(relocated.project.native_manifest()).unwrap().parse().unwrap();
        assert_eq!(parsed["dependencies"]["sdk"]["path"].as_str().unwrap(), root.join("snapback/sdk").canonicalize().unwrap().to_str().unwrap());
        assert_eq!(std::fs::read_to_string(original.native_manifest()).unwrap(), manifest);
        drop(relocated);
        assert_eq!(std::fs::read_to_string(original.native_types()).unwrap(), "working sentinel");
        drop(candidate); std::fs::remove_dir_all(root).unwrap(); std::fs::remove_dir_all(stage).unwrap();
    }
}

fn rebase_native(text: &str, original: &Path, source_root: &Path, target_root: &Path, workspace: bool) -> Result<String, String> {
    let mut manifest: toml::Value = text.parse().map_err(|e| format!("saved-source native manifest: {e}"))?;
    fn inherited(value: &toml::Value) -> bool {
        let marker = |field: &toml::Value| field.get("workspace").and_then(toml::Value::as_bool) == Some(true);
        if value.get("package").and_then(toml::Value::as_table).is_some_and(|fields| fields.iter().any(|(key, field)| key != "metadata" && marker(field))) { return true; }
        for key in ["dependencies", "dev-dependencies", "build-dependencies"] {
            if value.get(key).and_then(toml::Value::as_table).is_some_and(|fields| fields.values().any(marker)) { return true; }
        }
        value.get("target").and_then(toml::Value::as_table).is_some_and(|targets| targets.values().any(inherited))
    }
    if !workspace && inherited(&manifest) { return Err("workspace-inherited native packages require a complete standalone [workspace] under snapback/native; copy its workspace package/dependency declarations before saved-source deployment".into()); }
    fn dependency_group(group: &mut toml::Value, root: &Path, source_root: &Path, target_root: &Path) -> Result<(), String> {
        if let Some(dependencies) = group.as_table_mut() {
            for (_, dependency) in dependencies.iter_mut() {
                if let Some(path) = dependency.as_table_mut().and_then(|fields| fields.get_mut("path")) {
                    let relative = path.as_str().ok_or("native dependency path must be a string")?;
                    let absolute = root.join(relative).canonicalize().map_err(|e| format!("saved-source native dependency {relative}: {e}"))?;
                    let absolute = absolute.strip_prefix(source_root).map(|relative| target_root.join(relative)).unwrap_or(absolute.clone());
                    *path = toml::Value::String(absolute.to_str().ok_or("native dependency path must be UTF-8")?.to_owned());
                }
            }
        }
        Ok(())
    }
    fn groups(table: &mut toml::Value, root: &Path, source_root: &Path, target_root: &Path) -> Result<(), String> {
        for key in ["dependencies", "dev-dependencies", "build-dependencies", "replace"] {
            if let Some(group) = table.get_mut(key) { dependency_group(group, root, source_root, target_root)?; }
        }
        Ok(())
    }
    groups(&mut manifest, original, source_root, target_root)?;
    for category in ["target", "patch"] {
        if let Some(table) = manifest.get_mut(category).and_then(toml::Value::as_table_mut) {
            for (_, item) in table.iter_mut() {
                if category == "target" { groups(item, original, source_root, target_root)?; }
                else { dependency_group(item, original, source_root, target_root)?; }
            }
        }
    }
    if let Some(workspace) = manifest.get_mut("workspace") { groups(workspace, original, source_root, target_root)?; }
    toml::to_string(&manifest).map_err(|e| format!("saved-source native manifest: {e}"))
}

fn rebase_tree(target: &Path, original: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(target.join("Cargo.toml")).map_err(|e| e.to_string())?;
    let manifest: toml::Value = text.parse().map_err(|e| format!("native manifest: {e}"))?;
    let workspace = manifest.get("workspace").is_some();
    fn walk(directory: &Path, source_root: &Path, target_root: &Path, workspace: bool) -> Result<(), String> {
        for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_dir() { walk(&entry.path(), source_root, target_root, workspace)?; }
            else if entry.file_name() == "Cargo.toml" {
                let relative = entry.path().strip_prefix(target_root).map_err(|e| e.to_string())?.to_owned();
                let source = source_root.join(relative).parent().unwrap().to_owned();
                let text = std::fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
                let rebased = rebase_native(&text, &source, source_root, target_root, workspace)?;
                std::fs::write(entry.path(), rebased).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
    let original = original.canonicalize().map_err(|e| e.to_string())?;
    walk(target, &original, target, workspace)
}
