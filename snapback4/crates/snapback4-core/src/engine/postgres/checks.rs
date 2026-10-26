//! Provisioned raising commands. Opening uses the inline fence to upgrade.
// @ref LLP 3000.009.001.000.000.002#3.11 — ordered checks, typed tails and head-bound evidence maintenance.
// @ref LLP 3000.009.001.000#5.1 — the volatile fence is its own command and first row lock.
use super::store::Tx;
use crate::RuntimeError;
use sha2::{Digest, Sha256};

pub(super) const GUARD_BODY: &str = "BEGIN IF pg_catalog.current_setting('client_encoding') OPERATOR(pg_catalog.<>) 'UTF8' OR pg_catalog.current_setting('extra_float_digits') OPERATOR(pg_catalog.<>) '3' OR pg_catalog.current_setting('bytea_output') OPERATOR(pg_catalog.<>) 'hex' THEN RAISE EXCEPTION 'Postgres flight output settings drifted' USING ERRCODE = 'S4001'; END IF; END";
pub(super) const INLINE_GUARD: &str = "DO $sb4_settings$ BEGIN IF pg_catalog.current_setting('client_encoding') OPERATOR(pg_catalog.<>) 'UTF8' OR pg_catalog.current_setting('extra_float_digits') OPERATOR(pg_catalog.<>) '3' OR pg_catalog.current_setting('bytea_output') OPERATOR(pg_catalog.<>) 'hex' THEN RAISE EXCEPTION 'Postgres flight output settings drifted' USING ERRCODE = 'S4001'; END IF; END $sb4_settings$;";

#[derive(Clone)]
pub(super) struct Checks {
    pub guard: String,
    fence: String,
}
struct Function {
    name: String,
    args: &'static str,
    body: String,
}
fn functions(namespace: &str) -> Result<[Function; 2], RuntimeError> {
    let quoted = super::store::namespace(namespace)?;
    let fence = format!(
        "DECLARE current_store pg_catalog.text; current_token pg_catalog.int8; BEGIN SELECT store_id,token INTO current_store,current_token FROM {quoted}._owner WHERE singleton FOR KEY SHARE; IF NOT FOUND OR current_token IS NULL OR current_token OPERATOR(pg_catalog.<>) $1 OR ($2 IS NOT NULL AND (current_store IS NULL OR current_store OPERATOR(pg_catalog.<>) $2)) THEN RAISE EXCEPTION 'stale owner token or logical store identity' USING ERRCODE='S4002'; END IF; END"
    );
    Ok([
        ("guard", "", GUARD_BODY.to_string()),
        ("fence", "pg_catalog.int8,pg_catalog.text", fence),
    ]
    .map(|(kind, args, body)| {
        let digest = format!(
            "{:x}",
            Sha256::digest(format!(
                "{args}|plpgsql|invoker|volatile|unsafe|search_path=pg_catalog|{body}"
            ))
        );
        Function {
            name: format!("_sb4_{kind}_{}", &digest[..24]),
            args,
            body,
        }
    }))
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
            guard: format!("SELECT {q}.{}();", guard.name),
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

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    tx.require_serialized_head_fence("install flight checks")?;
    let namespace =
        tx.query("SELECT pg_catalog.current_schema()::text", &[])?[0].get::<_, String>(0);
    let quoted = super::store::namespace(&namespace)?;
    let installed = tx.meta("flight_checks_v1")?.is_some();
    for f in functions(&namespace)? {
        let signature = format!("{quoted}.{}({})", f.name, f.args);
        let mut rows = tx.query(CATALOG, &[&signature])?;
        if rows.is_empty() && installed {
            return Err(RuntimeError::StoreOwnership(
                "provisioned flight check disappeared".into(),
            ));
        }
        if rows.is_empty() {
            // Never replace a present implementation, even if it was tampered.
            tx.batch(&format!("CREATE FUNCTION {signature} RETURNS pg_catalog.void LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY INVOKER SET search_path=pg_catalog AS $sb4_check${}$sb4_check$",f.body))?;
            rows = tx.query(CATALOG, &[&signature])?;
        }
        if rows.len() != 1 || !valid(&rows[0], &f) {
            return Err(RuntimeError::StoreOwnership(format!(
                "incompatible provisioned flight check {}",
                f.name
            )));
        }
    }
    tx.set_meta("flight_checks_v1", "1")?;
    // A rolled-back upgrade can only deny a subsequent flight, never run it
    // using an uninstalled check. Opening again retries under the inline fence.
    *tx.check_functions.borrow_mut() = Some(Checks::for_namespace(&namespace)?);
    tx.clear_prepared_checks();
    Ok(())
}

pub(super) fn load(store: &mut super::store::Store) -> Result<(), RuntimeError> {
    let tx = store.begin(None, true)?;
    if tx.meta("flight_checks_v1")?.as_deref() != Some("1") {
        tx.rollback()?;
        return Ok(());
    }
    let namespace =
        tx.query("SELECT pg_catalog.current_schema()::text", &[])?[0].get::<_, String>(0);
    let quoted = super::store::namespace(&namespace)?;
    for f in functions(&namespace)? {
        let rows = tx.query(CATALOG, &[&format!("{quoted}.{}({})", f.name, f.args)])?;
        if rows.len() != 1 || !valid(&rows[0], &f) {
            return Err(RuntimeError::StoreOwnership(format!(
                "missing or incompatible provisioned flight check {}",
                f.name
            )));
        }
    }
    tx.rollback()?;
    *store.check_functions.borrow_mut() = Some(Checks::for_namespace(&namespace)?);
    Ok(())
}
