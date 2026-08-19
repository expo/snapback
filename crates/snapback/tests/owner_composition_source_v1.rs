//! Source-shape checks that intentionally span owner crates belong at the
//! façade integration rank; owner unit tests must not compile upward sources.

#[test]
fn fallible_embedding_construction_core_contains_no_panic_sites() {
    let server_source = include_str!("../../snapback-server/src/admin.rs");
    let embed_source = include_str!("../../snapback-cli/src/embed.rs");
    let public_facade = &embed_source[..embed_source
        .find("#[cfg(test)]")
        .expect("embed test-module marker")];
    let construction = &server_source[server_source
        .find("pub(crate) fn try_new_with_secret_read_operator(")
        .expect("fallible constructor marker")
        ..server_source
            .find("    // FALLIBLE_CONSTRUCTION_CORE_END")
            .expect("constructor end marker")];
    let provider = &server_source[server_source
        .find("    pub fn try_with_auth_provider(")
        .expect("fallible provider marker")
        ..server_source
            .find(
                "    /// Infallible compatibility wrapper. Prefer [`Self::try_with_auth_provider`]",
            )
            .expect("provider end marker")];
    for (name, body) in [
        ("constructor", construction),
        ("provider", provider),
        ("public facade", public_facade),
    ] {
        for forbidden in [
            ".expect(",
            "assert!(",
            "panic!(",
            ".unwrap(",
            "todo!(",
            "unimplemented!(",
        ] {
            assert!(
                !body.contains(forbidden),
                "fallible embedding {name} gained caller-triggerable panic site {forbidden}",
            );
        }
    }
}
