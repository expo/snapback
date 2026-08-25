use std::path::PathBuf;

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../..")
        .join("vendor/ibex/ios/Frameworks");
    println!("cargo:rustc-link-arg=-Xlinker");
    println!("cargo:rustc-link-arg=-rpath");
    println!("cargo:rustc-link-arg=-Xlinker");
    println!("cargo:rustc-link-arg={}", root.display());
}
