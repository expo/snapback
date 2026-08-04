fn main() {
    #[cfg(target_os = "macos")]
    println!(
        "cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../../../../vendor/ibex/ios/Frameworks"
    );
}
