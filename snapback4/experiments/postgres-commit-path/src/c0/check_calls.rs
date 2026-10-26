// Extracted from Stage P checks.rs; see stage-p-source.json.
pub const GUARD: &str = r#"SELECT "sb4_eval_g70"._sb4_guard_269f0c08459892ce6c7e5f8e();"#;
pub const FENCE: &str = r#"SELECT "sb4_eval_g70"._sb4_fence_782bfaadebb1dde2d48f643f(1::pg_catalog.int8,(pg_catalog.convert_from(pg_catalog.decode('3030303030303030303030303030303030303030303030303030303030303030','hex'),'UTF8'))::pg_catalog.text);"#;
