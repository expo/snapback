//! Attach-only installation and shape checks for the asset ledger.
// @ref LLP 3000.009.001.000#9.1 — no DDL in writers; incompatible existing storage refuses by name.
use super::store::Tx;
use crate::RuntimeError;

// name, type, NOT NULL, C collation. SQLite's nullable rowid TEXT primary
// key on _assets is never written NULL by the typed port; Postgres keys aren't nullable.
type Column = (&'static str, &'static str, bool, bool);
const TABLES: &[(&str, &[Column], &[&str])] = &[
    (
        "_assets",
        &[
            ("id", "text", true, true),
            ("owner", "text", true, true),
            ("kind", "text", true, false),
            ("content_type", "text", true, false),
            ("bytes", "bigint", true, false),
            ("width", "bigint", false, false),
            ("height", "bigint", false, false),
            ("duration", "bigint", false, false),
            ("created_at", "bigint", true, false),
            ("home_table", "text", false, true),
            ("home_id", "text", false, true),
            ("home_column", "text", false, true),
            ("released_at", "bigint", false, false),
            ("name", "text", false, false),
        ],
        &["id"],
    ),
    (
        "_asset_intents",
        &[
            ("owner", "text", true, true),
            ("intent", "text", true, true),
            ("fingerprint", "text", false, false),
            ("asset", "text", false, true),
            ("facts", "text", false, false),
            ("placement", "text", false, false),
            ("state", "text", true, false),
        ],
        &["owner", "intent"],
    ),
    (
        "_asset_views",
        &[
            ("asset", "text", true, true),
            ("principal", "text", true, true),
            ("at", "bigint", true, false),
        ],
        &["asset", "principal"],
    ),
    ("_asset_gc", &[("asset", "text", true, true)], &["asset"]),
];
const DDL: &str = r#"
CREATE TABLE IF NOT EXISTS _assets (
    id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL,
    kind TEXT NOT NULL, content_type TEXT NOT NULL, bytes BIGINT NOT NULL,
    width BIGINT, height BIGINT, duration BIGINT, created_at BIGINT NOT NULL,
    home_table TEXT COLLATE "C", home_id TEXT COLLATE "C", home_column TEXT COLLATE "C",
    released_at BIGINT, name TEXT
);
CREATE TABLE IF NOT EXISTS _asset_intents (
    owner TEXT COLLATE "C" NOT NULL, intent TEXT COLLATE "C" NOT NULL,
    fingerprint TEXT, asset TEXT COLLATE "C", facts TEXT, placement TEXT, state TEXT NOT NULL,
    PRIMARY KEY(owner,intent)
);
CREATE TABLE IF NOT EXISTS _asset_views (
    asset TEXT COLLATE "C" NOT NULL, principal TEXT COLLATE "C" NOT NULL, at BIGINT NOT NULL,
    PRIMARY KEY(asset,principal)
);
CREATE TABLE IF NOT EXISTS _asset_gc (asset TEXT COLLATE "C" PRIMARY KEY);
"#;

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    for &(table, columns, primary) in TABLES {
        super::shape::verify(tx, table, columns, primary, "SNAPBACK_ASSET_SCHEMA")?;
    }
    tx.batch(DDL)
}
