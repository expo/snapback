use std::fs;
use std::path::PathBuf;

mod build_identity {
    include!("../snapback-types/build_identity.rs");
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../control-catalog/generated/control-catalog.v1.json");

    const AUTHORITY_MUTATIONS: &[&str] = &[
        "snapback_authority_mutation_accept_suppressing_trigger",
        "snapback_authority_mutation_allow_fk_cascade",
        "snapback_authority_mutation_allow_shared_file",
        "snapback_authority_mutation_allow_unscoped_conflicts",
        "snapback_authority_mutation_allow_virtual_table",
        "snapback_authority_mutation_casefold_schema",
        "snapback_authority_mutation_clone_writer_policy",
        "snapback_authority_mutation_discard_owned_writer_policy",
        "snapback_authority_mutation_discard_writer_policy",
        "snapback_authority_mutation_expose_initialized_limbs",
        "snapback_authority_mutation_ignore_scope_generation",
        "snapback_authority_mutation_ignore_write_count",
        "snapback_authority_mutation_retain_scope",
        "snapback_authority_mutation_schema_conflict_replace",
        "snapback_authority_mutation_share_connection_state",
        "snapback_authority_mutation_skip_resource_guard_reread",
        "snapback_authority_mutation_stale_reused_state",
        "snapback_authority_mutation_statement_cache",
        "snapback_authority_mutation_supply_selector",
        "snapback_authority_mutation_writer_raw_access",
    ];
    const AUTHORITY_MUTATION_ENV: &str = "SNAPBACK_AUTHORITY_TRANSITION_MUTATIONS";
    println!("cargo:rerun-if-env-changed={AUTHORITY_MUTATION_ENV}");
    for mutation in AUTHORITY_MUTATIONS {
        println!("cargo:rustc-check-cfg=cfg({mutation})");
    }
    if let Ok(requested) = std::env::var(AUTHORITY_MUTATION_ENV) {
        for mutation in requested.split(',').filter(|value| !value.is_empty()) {
            assert!(
                AUTHORITY_MUTATIONS.contains(&mutation),
                "unknown authority-transition mutation cfg: {mutation}"
            );
            println!("cargo:rustc-cfg={mutation}");
        }
    }

    let identity = build_identity::emit_build_identity();
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let catalog_path = manifest_dir.join("../../control-catalog/generated/control-catalog.v1.json");
    let mut catalog: serde_json::Value =
        serde_json::from_slice(&fs::read(&catalog_path).expect("read generated control catalog"))
            .expect("generated control catalog must be valid JSON");

    // @ref LLP 0041#runtime-distribution — the packaged binary's embedded
    // catalog must carry the same source stamp as the executable around it.
    catalog["buildIdentity"] = serde_json::json!({
        "sourceCommit": identity.git_commit.unwrap_or_else(|| "unknown".to_owned()),
        "dirty": identity.git_dirty.unwrap_or(true),
    });

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    fs::write(
        out_dir.join("embedded-control-catalog.v1.json"),
        serde_json::to_vec_pretty(&catalog).expect("serialize embedded control catalog"),
    )
    .expect("write embedded control catalog");
}
