//! Local security fix for the Expo configuration merger; no registry waiver.
// @ref LLP 3000.011.003.000#10 — patch actual dependencies without weakening starter audits.
const FILES: [(&str, &str); 5] = [
    ("toolchain/deepmerge/package.json", include_str!("toolchain/deepmerge/package.json")),
    ("toolchain/deepmerge/index.cjs", include_str!("toolchain/deepmerge/index.cjs")),
    ("toolchain/deepmerge/index.d.ts", include_str!("toolchain/deepmerge/index.d.ts")),
    ("toolchain/deepmerge/LICENSE", include_str!("toolchain/deepmerge/LICENSE")),
    ("toolchain/deepmerge/README.md", include_str!("toolchain/deepmerge/README.md")),
];
pub(super) fn files() -> Vec<(&'static str, String)> { FILES.into_iter().map(|(name, text)| (name, text.to_owned())).collect() }
pub(super) fn contains(path: &str) -> bool { FILES.iter().any(|(name, _)| *name == path) }

/// Do not inspect or populate leaves through a symlinked local dependency.
pub(super) fn parents(dir: &std::path::Path) -> Result<(), String> {
    for name in ["toolchain", "toolchain/deepmerge"] {
        let path = dir.join(name);
        match path.symlink_metadata() {
            Ok(meta) if meta.is_symlink() || !meta.is_dir() => return Err(format!("{}: patched Expo toolchain needs real directories, not symlinks", path.display())),
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(format!("{}: {error}", path.display())),
        }
    }
    Ok(())
}
/// An existing nested/version-scoped rule can override the root replacement.
pub(super) fn conflicting_override(value: &serde_json::Value) -> bool {
    value.as_object().is_some_and(|map| map.iter().any(|(key, value)| {
        if key == "deepmerge" || key.starts_with("deepmerge@") { value.as_str() != Some("file:./toolchain/deepmerge") }
        else { conflicting_override(value) }
    }))
}
