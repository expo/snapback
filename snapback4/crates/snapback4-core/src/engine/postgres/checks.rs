//! Provisioned raising commands. Opening uses the inline fence to upgrade.
// @ref LLP 3000.009.001.000.000.002#3.11 — ordered checks, typed tails and head-bound evidence maintenance.
// @ref LLP 3000.009.001.000#5.1 — the volatile fence is its own command and first row lock.
use super::store::Tx;
use crate::RuntimeError;
use sha2::{Digest, Sha256};

pub(super) const GUARD_BODY: &str = "BEGIN IF pg_catalog.current_setting('client_encoding') OPERATOR(pg_catalog.<>) 'UTF8' OR pg_catalog.current_setting('extra_float_digits') OPERATOR(pg_catalog.<>) '3' OR pg_catalog.current_setting('bytea_output') OPERATOR(pg_catalog.<>) 'hex' THEN RAISE EXCEPTION 'Postgres flight output settings drifted' USING ERRCODE = 'S4001'; END IF; END";
pub(super) const INLINE_GUARD: &str = "DO $sb4_settings$ BEGIN IF pg_catalog.current_setting('array_nulls') OPERATOR(pg_catalog.<>) 'on' OR pg_catalog.current_setting('client_encoding') OPERATOR(pg_catalog.<>) 'UTF8' OR pg_catalog.current_setting('extra_float_digits') OPERATOR(pg_catalog.<>) '3' OR pg_catalog.current_setting('bytea_output') OPERATOR(pg_catalog.<>) 'hex' THEN RAISE EXCEPTION 'Postgres flight output settings drifted' USING ERRCODE = 'S4001'; END IF; END $sb4_settings$;";

#[derive(Clone)]
pub(super) struct Checks {
    pub guard: String,
    fence: String,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Function {
    name: String,
    args: String,
    body: String,
}
fn definitions(namespace: &str, legacy: bool) -> Result<[Function; 2], RuntimeError> {
    let quoted = super::store::namespace(namespace)?;
    let fence = format!(
        "DECLARE current_store pg_catalog.text; current_token pg_catalog.int8; BEGIN SELECT store_id,token INTO current_store,current_token FROM {quoted}._owner WHERE singleton FOR KEY SHARE; IF NOT FOUND OR current_token IS NULL OR current_token OPERATOR(pg_catalog.<>) $1 OR ($2 IS NOT NULL AND (current_store IS NULL OR current_store OPERATOR(pg_catalog.<>) $2)) THEN RAISE EXCEPTION 'stale owner token or logical store identity' USING ERRCODE='S4002'; END IF; END"
    );
    // current_schemas is evaluated in the caller, before the function's SET
    // search_path=pg_catalog takes effect. Bind the entire effective path;
    // Only this session's temporary schema may follow the store and catalog.
    // Connect pins pg_temp last so scratch tables cannot shadow durable data.
    let guard = if legacy {
        GUARD_BODY.to_string()
    } else {
        GUARD_BODY.replacen("BEGIN IF ", &format!("BEGIN IF ($1 IS DISTINCT FROM ARRAY['{namespace}','pg_catalog']::pg_catalog.text[] AND $1 IS DISTINCT FROM ARRAY['{namespace}','pg_catalog',pg_catalog.pg_my_temp_schema()::pg_catalog.regnamespace::pg_catalog.text]::pg_catalog.text[]) OR pg_catalog.current_setting('array_nulls') OPERATOR(pg_catalog.<>) 'on' OR "), 1)
    };
    Ok([
        (
            "guard",
            if legacy { "" } else { "pg_catalog.text[]" },
            guard,
        ),
        ("fence", "pg_catalog.int8,pg_catalog.text", fence),
    ]
    .map(|(kind, args, body)| {
        #[cfg(test)]
        let body = if kind == "guard" && !legacy && NEXT_REVISION.with(|v| v.get()) {
            format!("{body} /* next binary */")
        } else {
            body
        };
        Function::new(kind, args, body)
    }))
}
fn functions(namespace: &str) -> Result<[Function; 2], RuntimeError> {
    definitions(namespace, false)
}
impl Function {
    fn new(kind: &str, args: &str, body: String) -> Self {
        let digest = format!(
            "{:x}",
            Sha256::digest(format!(
                "{args}|plpgsql|invoker|volatile|unsafe|search_path=pg_catalog|{body}"
            ))
        );
        Self {
            name: format!("_sb4_{kind}_{}", &digest[..24]),
            args: args.into(),
            body,
        }
    }
    fn signature(&self, quoted: &str) -> String {
        format!("{quoted}.{}({})", self.name, self.args)
    }
    fn key(&self) -> String {
        format!("flight_check:{}", self.name)
    }
}
#[cfg(test)]
thread_local! { static NEXT_REVISION: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
#[cfg(test)]
pub(crate) fn next_revision<T>(run: impl FnOnce() -> T) -> T {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            NEXT_REVISION.with(|v| v.set(false));
        }
    }
    NEXT_REVISION.with(|v| v.set(true));
    let _reset = Reset;
    run()
}
const CATALOG: &str = "SELECT p.prosrc, p.proowner OPERATOR(pg_catalog.=) n.nspowner, l.lanname::pg_catalog.text, p.prosecdef, p.provolatile::pg_catalog.text, p.proparallel::pg_catalog.text, p.proisstrict, p.proretset, p.prokind::pg_catalog.text, p.proconfig, p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.void'::pg_catalog.regtype, p.proargmodes IS NULL, p.proargnames IS NULL, p.provariadic OPERATOR(pg_catalog.=) 0::pg_catalog.oid, p.pronargdefaults OPERATOR(pg_catalog.=) 0::pg_catalog.int2 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) p.pronamespace JOIN pg_catalog.pg_language l ON l.oid OPERATOR(pg_catalog.=) p.prolang WHERE p.oid OPERATOR(pg_catalog.=) pg_catalog.to_regprocedure($1)";
fn valid(row: &super::flight::Row, f: &Function) -> bool {
    row.get::<_, String>(0) == f.body
        && row.get::<_, bool>(1)
        && row.get::<_, String>(2) == "plpgsql"
        && !row.get::<_, bool>(3)
        && row.get::<_, String>(4) == "v"
        && row.get::<_, String>(5) == "u"
        && !row.get::<_, bool>(6)
        && !row.get::<_, bool>(7)
        && row.get::<_, String>(8) == "f"
        && row.get::<_, Option<Vec<String>>>(9) == Some(vec!["search_path=pg_catalog".into()])
        && (10..=14).all(|i| row.get::<_, bool>(i))
}
impl Checks {
    fn for_namespace(namespace: &str) -> Result<Self, RuntimeError> {
        let q = super::store::namespace(namespace)?;
        let [guard, fence] = functions(namespace)?;
        Ok(Self {
            guard: format!(
                "SELECT {q}.{}(pg_catalog.current_schemas(true)::pg_catalog.text[]);",
                guard.name
            ),
            fence: format!("{q}.{}", fence.name),
        })
    }
    // Binary one-statement reads have no SimpleQuery prefix. Referencing the
    // check in their statement makes a missing helper fail at Parse, before
    // any facts execute, while retaining their single Sync and snapshot.
    pub fn binary_read(&self, sql: &str) -> String {
        let call = self
            .guard
            .strip_prefix("SELECT ")
            .unwrap()
            .strip_suffix(';')
            .unwrap();
        format!("SELECT facts.*,{call} FROM ({sql}) AS facts")
    }
    pub fn fence(&self, fence: Option<&super::ownership::Fence>) -> Result<String, RuntimeError> {
        let (token, id) = if let Some(f) = fence {
            f.tag()?;
            (
                f.token,
                super::literal::encode(
                    &super::literal::Datum::Text(f.store_id.clone()),
                    &postgres::types::Type::TEXT,
                )?,
            )
        } else {
            (0, "NULL::pg_catalog.text".into())
        };
        Ok(format!(
            "SELECT {}({token}::pg_catalog.int8,{id});",
            self.fence
        ))
    }
}

// Read and validate every admitted version, including names unknown to this
// binary. Persisting the expected contract lets an older binary/doctor verify
// a newer digest without replacing it or guessing what its body should be.
fn admitted(
    namespace: &str,
    mut query: impl FnMut(
        &'static str,
        &[&(dyn postgres::types::ToSql + Sync)],
    ) -> Result<Vec<super::flight::Row>, RuntimeError>,
) -> Result<Vec<Function>, RuntimeError> {
    let marker = query("SELECT value FROM _meta WHERE key='flight_checks_v1'", &[])?;
    let records = query(
        "SELECT key,value FROM _meta WHERE pg_catalog.starts_with(key,'flight_check:') ORDER BY key",
        &[],
    )?;
    let expected = match marker.first().map(|r| r.get::<_, &str>(0)) {
        None if records.is_empty() => Vec::new(),
        Some("1") if records.is_empty() => definitions(namespace, true)?.to_vec(),
        Some("digests" | "1") if !records.is_empty() => records
            .iter()
            .map(|r| {
                let f: Function = serde_json::from_str(r.get(1))
                    .map_err(|_| refusal("invalid flight check contract"))?;
                let kind = if f.name.starts_with("_sb4_guard_") {
                    "guard"
                } else if f.name.starts_with("_sb4_fence_") {
                    "fence"
                } else {
                    return Err(refusal("invalid flight check name"));
                };
                if r.get::<_, &str>(0) != f.key()
                    || Function::new(kind, &f.args, f.body.clone()).name != f.name
                {
                    return Err(refusal("flight check contract digest mismatch"));
                }
                Ok(f)
            })
            .collect::<Result<Vec<_>, RuntimeError>>()?,
        _ => return Err(refusal("invalid flight check installation state")),
    };
    let quoted = super::store::namespace(namespace)?;
    for f in &expected {
        let rows = query(CATALOG, &[&f.signature(&quoted)])?;
        if rows.len() != 1 || !valid(&rows[0], f) {
            return Err(refusal(&format!(
                "missing or incompatible provisioned flight check {}",
                f.name
            )));
        }
    }
    Ok(expected)
}
fn refusal(message: &str) -> RuntimeError {
    RuntimeError::StoreOwnership(message.into())
}

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    tx.require_serialized_head_fence("install flight checks")?;
    let namespace =
        tx.query("SELECT pg_catalog.current_schema()::text", &[])?[0].get::<_, String>(0);
    let quoted = super::store::namespace(&namespace)?;
    let previous = admitted(&namespace, |sql, params| tx.query(sql, params))?;
    // Import the old boolean marker only after checking its exact v1 functions.
    // It must never turn a deleted legacy/admitted helper into an install request.
    for f in previous {
        tx.set_meta(&f.key(), &serde_json::to_string(&f).unwrap())?;
    }
    for f in functions(&namespace)? {
        let signature = f.signature(&quoted);
        let mut rows = tx.query(CATALOG, &[&signature])?;
        if rows.is_empty() {
            tx.batch(&format!("CREATE FUNCTION {signature} RETURNS pg_catalog.void LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY INVOKER SET search_path=pg_catalog AS $sb4_check${}$sb4_check$", f.body))?;
            rows = tx.query(CATALOG, &[&signature])?;
        }
        if rows.len() != 1 || !valid(&rows[0], &f) {
            return Err(refusal(&format!(
                "incompatible provisioned flight check {}",
                f.name
            )));
        }
        tx.set_meta(&f.key(), &serde_json::to_string(&f).unwrap())?;
    }
    tx.set_meta("flight_checks_v1", "digests")?;
    // A rolled-back upgrade can only deny a subsequent flight, never run it
    // using an uninstalled check. Opening again retries under the inline fence.
    *tx.check_functions.borrow_mut() = Some(Checks::for_namespace(&namespace)?);
    tx.clear_prepared_checks();
    Ok(())
}

pub(super) fn diagnose(
    tx: &mut postgres::Transaction<'_>,
    namespace: &str,
) -> Result<(), RuntimeError> {
    admitted(namespace, |sql, params| {
        Ok(tx
            .query(sql, params)?
            .into_iter()
            .map(super::flight::Row::Bind)
            .collect())
    })?;
    Ok(())
}

pub(super) fn load(store: &mut super::store::Store) -> Result<(), RuntimeError> {
    // Reconnect admission reads only catalog/upgrade identity. It must not
    // wait on the broken D epoch that the fenced writer is about to rebuild.
    // Ordinary application reads retain their snapshot quarantine afterward.
    let gate = store.early_release.take();
    let result = load_catalog(store);
    if result.is_err()
        && let Some(gate) = &gate
    {
        gate.break_history();
    }
    store.early_release = gate;
    result
}
fn load_catalog(store: &mut super::store::Store) -> Result<(), RuntimeError> {
    let tx = store.begin(None, true)?;
    let namespace =
        tx.query("SELECT pg_catalog.current_schema()::text", &[])?[0].get::<_, String>(0);
    let installed = admitted(&namespace, |sql, params| tx.query(sql, params))?;
    let ready = functions(&namespace)?
        .iter()
        .all(|f| installed.iter().any(|old| old.name == f.name));
    tx.rollback()?;
    // An unrecorded new digest needs the inline, fenced schema-ensure upgrade.
    // All admitted versions were validated above before allowing this fallback.
    *store.check_functions.borrow_mut() = if ready {
        Some(Checks::for_namespace(&namespace)?)
    } else {
        None
    };
    Ok(())
}
