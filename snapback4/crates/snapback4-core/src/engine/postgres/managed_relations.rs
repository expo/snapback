//! Whole managed-schema interception refusal, including optional ledgers.
use super::store::Tx;
use crate::RuntimeError;

pub(super) fn verify(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    let rows = tx.query(SQL, &[&crate::managed_relations::TABLES])?;
    if let Some(row) = rows.first() {
        return Err(crate::managed_relations::refusal(row.get(0), row.get(1)));
    }
    Ok(())
}

pub(super) const SQL: &str = "SELECT c.relname::text, CASE WHEN c.relrowsecurity OR c.relforcerowsecurity THEN 'row security'
         WHEN EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) THEN 'foreign trigger'
         ELSE 'rewrite rule' END
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname=current_schema() AND c.relname::text=ANY($1)
         AND (c.relrowsecurity OR c.relforcerowsecurity
           OR EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)
           OR EXISTS(SELECT 1 FROM pg_rewrite w WHERE w.ev_class=c.oid AND NOT(w.rulename='_RETURN' AND c.relkind IN ('v','m'))))
         ORDER BY c.relname LIMIT 1";
