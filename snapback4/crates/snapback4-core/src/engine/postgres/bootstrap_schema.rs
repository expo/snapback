//! Exact committed bootstrap shape. Recovery never runs an attach installer.
// @ref LLP 3000.009.001.000#initial-http-profile-and-public-release-bootstrap — missing or different state is refused without repair.
use super::store::Tx;
use crate::RuntimeError;

// Name, type, NOT NULL, C collation, default expression, identity mode.
type Column = (
    &'static str,
    &'static str,
    bool,
    bool,
    Option<&'static str>,
    &'static str,
);
struct Table {
    name: &'static str,
    columns: &'static [Column],
    constraints: &'static [&'static str],
}
const TABLES: &[Table] = &[
    Table {
        name: "_backend",
        columns: &[
            ("singleton", "boolean", true, false, None, ""),
            ("version", "text", true, false, None, ""),
            ("schema", "text", true, false, None, ""),
            ("programs", "text", true, false, None, ""),
            ("generation", "bigint", true, false, Some("1"), ""),
            (
                "through_shortened",
                "text",
                true,
                false,
                Some("'{}'::text"),
                "",
            ),
            (
                "maintained_identity_version",
                "text",
                false,
                false,
                None,
                "",
            ),
        ],
        constraints: &["PRIMARY KEY (singleton)", "CHECK (singleton)"],
    },
    Table {
        name: "_head",
        columns: &[
            ("singleton", "boolean", true, false, None, ""),
            ("seq", "bigint", true, false, None, ""),
            ("revision", "bigint", true, false, Some("0"), ""),
            ("attempt", "text", true, true, Some("'0:0'::text"), ""),
        ],
        constraints: &[
            "PRIMARY KEY (singleton)",
            "CHECK (singleton)",
            "CHECK ((seq >= 0))",
            "CHECK ((revision >= 0))",
        ],
    },
    Table {
        name: "r",
        columns: &[
            ("t", "text", true, true, None, ""),
            ("id", "text", true, true, None, ""),
            ("data", "text", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (t, id)"],
    },
    Table {
        name: "i",
        columns: &[
            ("t", "text", true, true, None, ""),
            ("ix", "text", true, true, None, ""),
            ("k", "bytea", true, false, None, ""),
            ("id", "text", true, true, None, ""),
        ],
        constraints: &["PRIMARY KEY (t, ix, k)"],
    },
    Table {
        name: "_commits",
        columns: &[
            ("seq", "bigint", true, false, None, ""),
            ("at", "bigint", true, false, None, ""),
            ("program", "text", true, false, None, ""),
            ("principal", "text", true, false, None, ""),
            ("kind", "text", true, false, None, ""),
            ("touched", "text", true, false, None, ""),
            ("writes", "bigint", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (seq)"],
    },
    Table {
        name: "_log",
        columns: &[
            ("partition", "text", true, true, None, ""),
            ("seq", "bigint", true, false, None, ""),
            ("ord", "bigint", true, false, None, ""),
            ("t", "text", true, false, None, ""),
            ("kind", "text", true, false, None, ""),
            ("id", "text", true, false, None, ""),
            ("data", "text", false, false, None, ""),
        ],
        constraints: &[
            "PRIMARY KEY (partition, seq, ord)",
        ],
    },
    Table {
        name: "_ops",
        columns: &[
            ("principal", "text", true, true, None, ""),
            ("id", "text", true, true, None, ""),
            ("seq", "bigint", true, false, None, ""),
            ("outcome", "text", true, false, None, ""),
            ("name", "text", false, false, None, ""),
            ("args_digest", "text", false, false, None, ""),
            ("at", "bigint", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (principal, id)"],
    },
    Table {
        name: "_sequences",
        columns: &[
            ("parent", "text", true, false, None, ""),
            ("id", "text", true, false, None, ""),
            ("value", "bigint", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (parent, id)"],
    },
    Table {
        name: "_effect_keys",
        columns: &[
            ("effect", "text", true, false, None, ""),
            ("key", "text", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (effect, key)"],
    },
    Table {
        name: "_principal_generations",
        columns: &[
            ("principal", "text", true, true, None, ""),
            ("generation", "bigint", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (principal)"],
    },
    Table {
        name: "_sessions",
        columns: &[
            ("token_digest", "text", true, true, None, ""),
            ("principal", "text", true, true, None, ""),
            ("kind", "text", true, false, None, ""),
            ("created_at", "bigint", true, false, None, ""),
            ("expires_at", "bigint", true, false, None, ""),
            ("family", "text", false, true, None, ""),
        ],
        constraints: &["PRIMARY KEY (token_digest)"],
    },
    Table {
        name: "_requests",
        columns: &[
            ("id", "text", true, true, None, ""),
            ("name", "text", true, true, None, ""),
            ("args", "text", true, false, None, ""),
            ("principal", "text", true, true, None, ""),
            ("at", "bigint", true, false, None, ""),
            ("state", "text", true, false, None, ""),
            ("attempts", "bigint", true, false, Some("0"), ""),
            ("next_at", "bigint", false, false, None, ""),
            ("lease_until", "bigint", false, false, None, ""),
            ("claimed_by", "text", false, true, None, ""),
            ("session_digest", "text", false, true, None, ""),
            ("result", "text", false, false, None, ""),
            ("error", "text", false, false, None, ""),
            ("family", "text", false, true, None, ""),
            ("principal_generation", "bigint", false, false, None, ""),
            ("admitted_expires_at", "bigint", false, false, None, ""),
            ("args_digest", "text", false, false, None, ""),
            ("error_code", "text", false, false, None, ""),
            ("settled_at", "bigint", false, false, None, ""),
            ("spec", "text", false, false, None, ""),
            ("contract", "text", false, false, None, ""),
            ("deadline", "bigint", false, false, None, ""),
            ("release", "text", false, false, None, ""),
            ("service_generation", "bigint", false, false, None, ""),
            ("cancelled", "boolean", true, false, Some("false"), ""),
        ],
        constraints: &["PRIMARY KEY (id)"],
    },
    Table {
        name: "_read_sessions",
        columns: &[
            ("token_digest", "text", true, true, None, ""),
            ("principal", "text", true, true, None, ""),
            ("kind", "text", true, false, None, ""),
            ("family", "text", true, true, None, ""),
            ("created_at", "bigint", true, false, None, ""),
            ("expires_at", "bigint", true, false, None, ""),
            ("cap_expires_at", "bigint", true, false, None, ""),
            ("principal_generation", "bigint", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (token_digest)"],
    },
    Table {
        name: "_principals",
        columns: &[
            ("id", "text", true, true, None, ""),
            ("kind", "text", true, false, None, ""),
            ("name", "text", false, false, None, ""),
            ("created_at", "bigint", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (id)"],
    },
    Table {
        name: "_credentials",
        columns: &[
            ("principal", "text", true, true, None, ""),
            ("email", "text", true, true, None, ""),
            ("hash", "text", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (principal)", "UNIQUE (email)"],
    },
    Table {
        name: "_session_mint_bindings",
        columns: &[
            ("invocation", "text", true, true, None, ""),
            ("intent", "text", true, true, None, ""),
            ("input_digest", "text", true, false, None, ""),
            ("principal", "text", true, true, None, ""),
            ("kind", "text", true, false, None, ""),
            ("days", "bigint", true, false, None, ""),
            ("expires_at", "bigint", true, false, None, ""),
            ("family", "text", true, true, None, ""),
            ("principal_generation", "bigint", true, false, None, ""),
            ("scope", "text", true, false, Some("'full'::text"), ""),
        ],
        constraints: &["PRIMARY KEY (invocation, intent)"],
    },
    Table {
        name: "_meta",
        columns: &[
            ("key", "text", true, true, None, ""),
            ("value", "text", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (key)"],
    },
    Table {
        name: "_outbox",
        columns: &[
            ("id", "text", true, true, None, ""),
            ("seq", "bigint", true, false, None, ""),
            ("effect", "text", true, true, None, ""),
            ("payload", "text", true, false, None, ""),
            ("state", "text", true, false, None, ""),
            ("attempts", "bigint", true, false, None, ""),
            ("at", "bigint", true, false, None, ""),
            ("lease_until", "bigint", false, false, None, ""),
            ("claimed_by", "text", false, true, None, ""),
            ("next_at", "bigint", false, false, None, ""),
            ("result", "text", false, false, None, ""),
            ("error", "text", false, false, None, ""),
            ("settled_at", "bigint", false, false, None, ""),
            ("work_spec", "text", false, false, None, ""),
            ("deadline", "bigint", false, false, None, ""),
            ("release", "text", false, false, None, ""),
            ("error_code", "text", false, false, None, ""),
            ("lease_digest", "text", false, false, None, ""),
            ("cancelled", "boolean", true, false, Some("false"), ""),
            ("contract", "text", false, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (id)"],
    },
    Table {
        name: "_effect_presence",
        columns: &[
            ("principal", "text", true, true, None, ""),
            ("id", "text", true, true, None, ""),
            ("deadline", "bigint", true, false, None, ""),
            ("reconnected", "boolean", true, false, Some("false"), ""),
        ],
        constraints: &["PRIMARY KEY (principal, id)"],
    },
    Table {
        name: "_assets",
        columns: &[
            ("id", "text", true, true, None, ""),
            ("owner", "text", true, true, None, ""),
            ("kind", "text", true, false, None, ""),
            ("content_type", "text", true, false, None, ""),
            ("bytes", "bigint", true, false, None, ""),
            ("width", "bigint", false, false, None, ""),
            ("height", "bigint", false, false, None, ""),
            ("duration", "bigint", false, false, None, ""),
            ("created_at", "bigint", true, false, None, ""),
            ("home_table", "text", false, true, None, ""),
            ("home_id", "text", false, true, None, ""),
            ("home_column", "text", false, true, None, ""),
            ("released_at", "bigint", false, false, None, ""),
            ("name", "text", false, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (id)"],
    },
    Table {
        name: "_asset_intents",
        columns: &[
            ("owner", "text", true, true, None, ""),
            ("intent", "text", true, true, None, ""),
            ("fingerprint", "text", false, false, None, ""),
            ("asset", "text", false, true, None, ""),
            ("facts", "text", false, false, None, ""),
            ("placement", "text", false, false, None, ""),
            ("state", "text", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (owner, intent)"],
    },
    Table {
        name: "_asset_views",
        columns: &[
            ("asset", "text", true, true, None, ""),
            ("principal", "text", true, true, None, ""),
            ("at", "bigint", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (asset, principal)"],
    },
    Table {
        name: "_asset_gc",
        columns: &[("asset", "text", true, true, None, "")],
        constraints: &["PRIMARY KEY (asset)"],
    },
    Table {
        name: "_cap_counts",
        columns: &[
            ("t", "text", true, true, None, ""),
            ("k", "bytea", true, false, None, ""),
            ("n", "bigint", true, false, None, ""),
        ],
        constraints: &["CHECK ((n >= 0))", "PRIMARY KEY (t, k)"],
    },
    Table {
        name: "_generations",
        columns: &[
            ("generation", "bigint", true, false, None, ""),
            ("schema", "text", true, false, None, ""),
            ("programs", "text", true, false, None, ""),
            ("at", "bigint", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (generation)"],
    },
    Table {
        name: "_catalog",
        columns: &[
            ("name", "text", true, true, None, ""),
            ("num", "bigint", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (name)", "UNIQUE (num)"],
    },
    Table {
        name: "_release_events",
        columns: &[
            ("id", "bigint", true, false, None, ""),
            ("at", "bigint", true, false, None, ""),
            ("operation", "text", true, false, None, ""),
            ("release", "bigint", false, false, None, ""),
            ("previous", "bigint", false, false, None, ""),
            ("generation", "bigint", true, false, None, ""),
            ("revision", "bigint", true, false, None, ""),
            ("summary", "text", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (id)"],
    },
    Table {
        name: "_release_event_items",
        columns: &[
            ("event", "bigint", true, false, None, ""),
            ("path", "text", true, true, None, ""),
            ("detail", "text", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (event, path)"],
    },
    Table {
        name: "_jobs",
        columns: &[
            ("id", "text", true, true, None, ""),
            ("name", "text", true, false, None, ""),
            ("args", "text", true, false, None, ""),
            ("program_hash", "text", true, false, None, ""),
            ("state", "text", true, false, None, ""),
            ("sweep", "bigint", true, false, None, ""),
            ("cursor", "bytea", false, false, None, ""),
            ("upper", "bytea", false, false, None, ""),
            ("chunks", "bigint", true, false, None, ""),
            ("rows_written", "bigint", true, false, None, ""),
            ("created_at", "bigint", true, false, None, ""),
            ("updated_at", "bigint", true, false, None, ""),
            ("error", "bytea", false, false, None, ""),
            ("chunk_size", "bigint", true, false, Some("0"), ""),
            ("retries", "bigint", true, false, Some("0"), ""),
            ("heap_peak", "bigint", true, false, Some("0"), ""),
            ("domain", "text", false, false, None, ""),
            ("insertion_order", "bigint", true, false, None, "a"),
        ],
        constraints: &["PRIMARY KEY (id)"],
    },
    Table {
        name: "_owner",
        columns: &[
            ("singleton", "boolean", true, false, None, ""),
            ("store_id", "text", true, true, None, ""),
            ("holder", "text", true, true, None, ""),
            ("token", "bigint", true, false, None, ""),
            (
                "lease_until",
                "timestamp with time zone",
                true,
                false,
                None,
                "",
            ),
        ],
        constraints: &["PRIMARY KEY (singleton)"],
    },
    Table {
        name: "_change_evidence",
        columns: &[
            ("seq", "bigint", true, false, None, ""),
            ("footprint", "text", true, false, None, ""),
        ],
        constraints: &["PRIMARY KEY (seq)"],
    },
    Table { name: "_dormant_tables", columns: &[ ("table_name", "text", true, true, None, ""), ("definition", "text", true, false, None, "") ], constraints: &["PRIMARY KEY (table_name)"] },
    Table { name: "_dormant_columns", columns: &[ ("table_name", "text", true, true, None, ""), ("column_name", "text", true, true, None, ""), ("definition", "text", true, false, None, "") ], constraints: &["PRIMARY KEY (table_name, column_name)"] },
    Table { name: "_dormant_indexes", columns: &[ ("table_name", "text", true, true, None, ""), ("index_name", "text", true, true, None, ""), ("definition", "text", true, false, None, "") ], constraints: &["PRIMARY KEY (table_name, index_name)"] },
    Table { name: "_dormant_rows", columns: &[ ("t", "text", true, true, None, ""), ("id", "text", true, true, None, ""), ("data", "text", true, false, None, "") ], constraints: &["PRIMARY KEY (t, id)"] },
    Table { name: "_dormant_narrow_rows", columns: &[ ("t", "text", true, true, None, ""), ("id", "text", true, true, None, ""), ("data", "text", true, false, None, ""), ("definition", "text", true, false, None, ""), ("reason", "text", true, false, None, "") ], constraints: &["PRIMARY KEY (t, id)"] },
    Table { name: "_dormant_values", columns: &[ ("t", "text", true, true, None, ""), ("id", "text", true, true, None, ""), ("column_name", "text", true, true, None, ""), ("data", "text", true, false, None, "") ], constraints: &["PRIMARY KEY (t, id, column_name)"] },
    Table { name: "_dormant_refs", columns: &[ ("t", "text", true, true, None, ""), ("id", "text", true, true, None, ""), ("column_name", "text", true, true, None, ""), ("parent_t", "text", true, true, None, ""), ("parent_id", "text", true, true, None, ""), ("invalid", "bigint", true, false, None, "") ], constraints: &["PRIMARY KEY (t, id, column_name, parent_t, parent_id)"] },
];

const INDEXES: &[(&str, &str, &[&str])] = &[
    ("_dormant_refs", "_dormant_parent", &["parent_t", "parent_id"]),
    ("_sessions", "_sessions_expiry", &["expires_at"]),
    (
        "_sessions",
        "_sessions_family",
        &["principal", "family", "expires_at"],
    ),
    ("_requests", "_requests_due", &["state", "name", "at", "id"]),
    ("_requests", "_requests_session", &["session_digest"]),
    (
        "_read_sessions",
        "_read_sessions_family",
        &["principal", "family", "expires_at"],
    ),
    ("_outbox", "_outbox_due", &["state", "effect", "seq"]),
    ("_effect_presence", "_effect_presence_id", &["id"]),
];

fn incompatible(table: &str, detail: &str) -> RuntimeError {
    super::bootstrap::incomplete(&format!("SNAPBACK_BOOTSTRAP_SCHEMA: {table}: {detail}"))
}

pub(super) fn verify(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    // Hold access-share locks through validation so catalog checks and reads
    // describe the same relations. No row locks, installers or writes occur.
    for table in TABLES {
        if !super::ledger_schema::verify_relation(tx, table.name, incompatible)? {
            return Err(super::bootstrap::incomplete(&format!(
                "missing {}",
                table.name
            )));
        }
        tx.batch(&format!("LOCK TABLE {} IN ACCESS SHARE MODE", table.name))?;
    }
    let relations = tx.query("SELECT relname::text FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind NOT IN ('i','S')", &[])?;
    if relations.len() != TABLES.len() {
        return Err(incompatible("namespace", "unexpected relation set"));
    }
    for table in TABLES {
        verify_table(tx, table)?;
    }
    Ok(())
}

fn verify_table(tx: &Tx<'_>, table: &Table) -> Result<(), RuntimeError> {
    let actual = tx.query(
        "SELECT a.attname::text,format_type(a.atttypid,a.atttypmod),a.attnotnull,
         a.attcollation='pg_catalog.\"C\"'::regcollation,a.attcollation=t.typcollation,
         pg_get_expr(d.adbin,d.adrelid),a.attidentity::text,a.attgenerated::text
         FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
         LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
         WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped",
        &[&table.name],
    )?;
    // @ref LLP 3000.009.001.000.000.002#8.1 — read-only bootstrap recovery admits the complete old head; only fenced attach installs attempt.
    let legacy_head = table.name == "_head" && !actual.iter().any(|r| r.get::<_, &str>(0)=="attempt");
    for &(name, kind, required, byte_exact, default, identity) in table.columns {
        if legacy_head && name=="attempt" { continue; }
        let Some(column) = actual.iter().find(|r| r.get::<_, &str>(0) == name) else {
            return Err(incompatible(table.name, &format!("missing column {name}")));
        };
        if column.get::<_, &str>(1) != kind
            || column.get::<_, bool>(2) != required
            || !column.get::<_, bool>(if byte_exact { 3 } else { 4 })
            || column.get::<_, Option<&str>>(5) != default
            || column.get::<_, &str>(6) != identity
            || !column.get::<_, &str>(7).is_empty()
        {
            return Err(incompatible(
                table.name,
                &format!("incompatible column {name}"),
            ));
        }
    }
    if actual.len() != table.columns.len() - usize::from(legacy_head) {
        return Err(incompatible(table.name, "unexpected column set"));
    }
    // Names do not affect constraint semantics. Deparsing is stable on the
    // admitted server majors (16 and 17); validation/immediacy are mandatory.
    // Read-only recovery also admits a complete pre-upgrade bootstrap.
    let legacy = if table.name == "_log" { super::log_schema::legacy_keys(tx)? } else { Vec::new() };
    if legacy.len() > 1 || legacy.iter().any(|r| !r.get::<_, bool>(1)) {
        return Err(incompatible(table.name, "unexpected legacy foreign key"));
    }
    let constraints = tx.query("SELECT pg_get_constraintdef(oid),convalidated AND NOT condeferrable AND NOT condeferred FROM pg_constraint WHERE conrelid=to_regclass($1) AND contype<>'n'", &[&table.name])?;
    let mut definitions: Vec<&str> = constraints.iter().map(|r| r.get(0)).collect();
    if !legacy.is_empty() { definitions.retain(|d| *d != "FOREIGN KEY (seq) REFERENCES _commits(seq)"); }
    definitions.sort_unstable();
    let mut expected = table.constraints.to_vec();
    expected.sort_unstable();
    if definitions != expected || constraints.iter().any(|r| !r.get::<_, bool>(1)) {
        return Err(incompatible(table.name, "incompatible constraints"));
    }
    let indexes = tx.query(
        "SELECT c.relname::text,i.indisunique,i.indisprimary,
         i.indisvalid AND i.indisready AND i.indislive AND NOT i.indnullsnotdistinct,
         i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts=i.indnkeyatts,
         am.amname::text,
         ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnkeyatts) k),
         NOT EXISTS(SELECT 1 FROM unnest(i.indkey,i.indcollation,i.indoption,i.indclass) k(num,coll,opts,opc)
           JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num
           JOIN pg_opclass o ON o.oid=k.opc WHERE k.coll<>a.attcollation OR k.opts<>0 OR NOT o.opcdefault),
         EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conindid=i.indexrelid AND k.conrelid=i.indrelid AND k.contype IN ('p','u'))
         FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid=to_regclass($1)",
        &[&table.name],
    )?;
    let nonunique: Vec<_> = INDEXES.iter().filter(|i| i.0 == table.name).collect();
    let unique = table
        .constraints
        .iter()
        .filter(|c| c.starts_with("PRIMARY KEY") || c.starts_with("UNIQUE"))
        .count();
    if indexes.len() != unique + nonunique.len()
        || indexes.iter().any(|r| {
            !r.get::<_, bool>(3)
                || !r.get::<_, bool>(4)
                || r.get::<_, &str>(5) != "btree"
                || !r.get::<_, bool>(7)
                || (r.get::<_, bool>(1) && !r.get::<_, bool>(8))
        })
        || nonunique.iter().any(|(_, name, columns)| {
            !indexes.iter().any(|r| {
                r.get::<_, &str>(0) == *name
                    && !r.get::<_, bool>(1)
                    && !r.get::<_, bool>(2)
                    && r.get::<_, Vec<String>>(6) == *columns
            })
        })
    {
        return Err(incompatible(table.name, "incompatible indexes"));
    }
    Ok(())
}
