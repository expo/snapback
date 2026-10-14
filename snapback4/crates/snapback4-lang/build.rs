#[path = "src/release_changes.rs"]
mod release_changes;
fn main() {
    println!("cargo:rerun-if-changed=../../packages/snapback4/CHANGELOG.md");
    println!("cargo:rerun-if-changed=src/release_changes.rs");
    let version = std::env::var("CARGO_PKG_VERSION").unwrap();
    let card = format!("# Changes in {version}\n\nEach release records behavior changes, including client runtime semantics. Upgrade prints entries since your previous version and compares compiler notes, types and refusals when a check snapshot exists.\n\n```sh\nsnapback4 upgrade\n```\n\n{}\nHistory begins at 0.4.26; older changes are not recorded. Without a compiler snapshot, lockfile or generated package metadata supplies the previous version. Native Expo adapters need a rebuild. Exact apps: `bun exact.mjs snapback --rebuild`. Run your acceptance and visible-form proof; `guide testing` has the commands.\n", release_changes::between(release_changes::CHANGELOG, None, &version));
    std::fs::write(std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("changes.md"), card).unwrap();
}
