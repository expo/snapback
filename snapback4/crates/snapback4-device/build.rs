// @ref LLP 3000.001.000#build-stamp — every producer gets the engine's identity from the crate.
fn main() {
    let stamp =
        serde_json::to_vec(&snapback4_core::device_protocol::DeviceEngine::current()).unwrap();
    let source = format!(
        "#[used]\n#[unsafe(link_section = \"snapback4.engine\")]\nstatic ENGINE_STAMP: [u8; {}] = {:?};\n",
        stamp.len(),
        stamp
    );
    std::fs::write(
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("engine_stamp.rs"),
        source,
    )
    .unwrap();
}
