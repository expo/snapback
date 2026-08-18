//! LLP 0048 §Single-sourced runtime flags: the twin's workerd config and
//! LLP 0040's deploy config are generated from one compat source, and a
//! `nodejs_compat*` flag is refused fail-closed on every generator.

use snapback::workerd_exec::{CompatConfig, compat_config, refuse_node_compat};

#[test]
fn compat_config_is_present_and_node_free() {
    let compat = compat_config().expect("packages/snapback-harness/compat.json must be valid");
    assert!(
        !compat.compatibility_date.is_empty(),
        "the single-sourced compat date must be set"
    );
    assert!(
        compat
            .compatibility_flags
            .iter()
            .all(|flag| !flag.starts_with("nodejs_compat")),
        "the shipped compat config must not carry any nodejs_compat flag"
    );
}

#[test]
fn nodejs_compat_flag_is_refused() {
    let config = CompatConfig {
        compatibility_date: "2026-07-01".to_owned(),
        compatibility_flags: vec!["nodejs_compat".to_owned()],
    };
    let error = refuse_node_compat(&config)
        .expect_err("a nodejs_compat flag must be refused, not silently accepted");
    assert_eq!(error.diagnostic.code, "SNAPBACK_V8_COMPAT_FLAG_REFUSED");
}

#[test]
fn nodejs_compat_v2_flag_is_also_refused() {
    let config = CompatConfig {
        compatibility_date: "2026-07-01".to_owned(),
        compatibility_flags: vec!["nodejs_compat_v2".to_owned()],
    };
    assert!(
        refuse_node_compat(&config).is_err(),
        "nodejs_compat_v2 must be refused as well"
    );
}
