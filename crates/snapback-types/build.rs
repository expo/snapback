// `binary_identity()` and `build_distribution()` are compiled in this crate,
// so their `option_env!` stamps must be emitted by this package's own build
// script. Cargo does not propagate `cargo:rustc-env` to dependencies.
//
// @ref LLP 0031#server-binary-identity-on-health — the public build identity
// remains fail-closed when commit/dirty provenance cannot be established.

mod build_identity {
    include!("build_identity.rs");
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    // binary_identity() moved into this package, so its compile-time facts
    // must move with it: Cargo build-script environment is package-local.
    // @ref LLP 0283#f-5--named-exceptions-with-burn-down-tickets — preserve
    // provenance contracts in the package that owns the moved consumer.
    build_identity::emit_build_identity();
}
