//! The existing native fixture, shared by native-read and adoption tests.
use std::path::PathBuf;
use std::sync::OnceLock;
const SCHEMA: &str = include_str!("../../../../native-fixtures/rescore/schema.q");

/// The fixture module, built once for wasm (see `snapback4-sim/tests/native.rs`).
pub fn module() -> &'static [u8] {
    static MODULE: OnceLock<Vec<u8>> = OnceLock::new();
    MODULE.get_or_init(|| {
        // Targeted device checks can use a already-built fixture
        // when a concurrent lane prohibits launching another wasm build.
        if let Some(path) = std::env::var_os("SNAPBACK4_TEST_NATIVE_FIXTURE") {
            return std::fs::read(path).expect("read the supplied native fixture");
        }
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("the snapback4 directory");
        let fixture = root.join("native-fixtures/rescore");
        let bound = snapback4_lang::compile(&[("schema.q".to_owned(), SCHEMA.to_owned())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        std::fs::write(fixture.join("src/schema.rs"), snapback4_lang::emit::rust(&bound)).expect("write the fixture's schema.rs");
        let target = root.join("target/native-fixture");
        let output = std::process::Command::new("cargo")
            .args(["build", "--release", "--quiet", "--target", "wasm32-unknown-unknown", "--manifest-path"])
            .arg(fixture.join("Cargo.toml"))
            .arg("--target-dir")
            .arg(&target)
            .env_remove("CARGO_TARGET_DIR")
            .output()
            .expect("cargo on PATH");
        assert!(output.status.success(), "the fixture did not build; is the target installed? `rustup target add wasm32-unknown-unknown`\n{}", String::from_utf8_lossy(&output.stderr));
        std::fs::read(target.join("wasm32-unknown-unknown/release/sb4_fixture_rescore.wasm")).expect("the built module")
    })
}
