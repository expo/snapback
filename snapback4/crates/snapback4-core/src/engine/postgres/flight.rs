//! Ordered SimpleQuery transport. A session owns BEGIN through rollback;
//! commands retain separate READ COMMITTED snapshots inside each message.
// @ref LLP 3000.009.001.000.001#35-each-command-keeps-its-own-place — ordinary client validation precedes COMMIT; G7.3 substitutes server raising checks and widens ambiguity from dispatch.
use super::{literal, store::CallCounter};
use crate::RuntimeError;
use postgres::{ SimpleQueryMessage, Statement, row::RowIndex, types::{FromSql, Type}};

pub(super) struct Session<'a> {
    pub client: &'a mut super::pipeline::Connection,
    pub pending: String,
    pub started: bool,
    pub done: bool,
    pub settings_refused: bool,
    pub checks: Vec<(usize,u64)>,
    // A raising owner command precedes every application lock/fact in the
    // first message. Kept separate so its PL/pgSQL semicolons are not controls.
    pub owner: Option<String>,
    pub owner_budget: Option<u32>,
    pub continuity: Option<std::sync::Arc<super::early_release::Durability>>,
    pub durability: Option<std::sync::Arc<super::early_release::Durability>>,
    pub snapshot: Option<super::early_release::Snapshot>,
}
impl Drop for Session<'_> {
    fn drop(&mut self) {
        if self.started && !self.done {
            #[cfg(any(test, feature = "test-support"))]
            crate::round_trips::postgres(1);
            if self.client.batch_execute("ROLLBACK").is_err() && let Some(gate)=&self.continuity {gate.break_history();}
        }
        self.client.finish();
    }
}
impl Session<'_> {
    pub fn ensure_settings(&self) -> Result<(), RuntimeError> {
        if self.settings_refused { return Err(RuntimeError::Store("Postgres flight output settings drifted; roll back".into())); }
        Ok(())
    }
    // A server-side guard runs before any data command in each flight, in the
    // same message. Drift must stop execution, rather than be detected after
    // text rows have already been decoded or writes have run. No policy or
    // application values enter this constant control command.
    fn guarded_query(&mut self, sql: &str) -> Result<Vec<SimpleQueryMessage>, RuntimeError> {
        self.ensure_settings()?;
        const GUARD: &str = "DO $sb4_settings$ BEGIN IF pg_catalog.current_setting('client_encoding') OPERATOR(pg_catalog.<>) 'UTF8' OR pg_catalog.current_setting('extra_float_digits') OPERATOR(pg_catalog.<>) '3' OR pg_catalog.current_setting('bytea_output') OPERATOR(pg_catalog.<>) 'hex' THEN RAISE EXCEPTION 'Postgres flight output settings drifted' USING ERRCODE = 'S4001'; END IF; END $sb4_settings$;";
        let mut command = String::with_capacity(GUARD.len() + sql.len());
        let owner = self.owner.take();
        let owner_budget = self.owner_budget.take();
        // An aborted transaction accepts only rollback. These recovery flights
        // contain controls alone: restore the savepoint before checking settings,
        // which may themselves have been restored by that rollback.
        let recovery = sql.starts_with("ROLLBACK TO SAVEPOINT ");
        // BEGIN must precede the guard too: a query before BEGIN would start
        // an implicit transaction and prevent setting its isolation level.
        let opening = if sql.starts_with("BEGIN ") { sql.find(';').map_or(0, |n|n+1) } else { 0 };
        command.push_str(&sql[..opening]);
        // A logical request can reopen after a composed read or failed
        // speculation. Bind each physical snapshot to its own first head.
        // @ref LLP 3000.009.001.000.000.002#3.8 — an earlier snapshot's head cannot certify fresh fallback rows.
        if opening != 0 { self.snapshot = None; }
        let bind_head=self.durability.is_some() && self.snapshot.is_none();
        if bind_head {command.push_str(super::early_release::SNAPSHOT);command.push(';');}
        if !recovery { command.push_str(GUARD); }
        if let Some(owner) = &owner {
            if let Some(ms) = owner_budget {
                command.push_str(&format!("SET LOCAL statement_timeout={ms}; SET LOCAL lock_timeout={ms};"));
            }
            command.push_str(owner);
        }
        command.push_str(&sql[opening..]);
        if recovery { command.push(';'); command.push_str(GUARD); }
        let mut messages = self.client.simple_query(&command).map_err(|error| {
            if error.code().is_some_and(|code| code.code() == "S4001") { self.settings_refused = true; }
            if error.code().is_some_and(|code| code.code() == "S4002") {
                if let Some(gate)=&self.continuity {gate.break_history();}
                return RuntimeError::StoreOwnership("stale owner token or logical store identity".into());
            }
            if (error.as_db_error().is_none() || error.code().is_some_and(|c|matches!(c.code(),"57P01"|"57P02"|"57P03"))) && let Some(gate)=&self.continuity {gate.break_history();}
            RuntimeError::from(error)
        })?;
        // The head is the first read in this REPEATABLE READ snapshot. Remove
        // its wire messages before handing the original command results up.
        if bind_head {
            let index=usize::from(opening!=0);
            let end=messages.iter().enumerate().skip(index).find_map(|(i,m)|matches!(m,SimpleQueryMessage::CommandComplete(_)).then_some(i))
                .ok_or_else(||RuntimeError::Store("missing reader snapshot head".into()))?;
            let snapshot=messages[index..end].iter().find_map(|m|if let SimpleQueryMessage::Row(r)=m {Some(super::early_release::Snapshot::text(r))} else {None})
                .ok_or_else(||RuntimeError::Store("missing reader head row".into()))??;
            self.snapshot=Some(snapshot);
            messages.drain(index..=end);
        }
        if let (Some(gate),Some(snapshot))=(&self.durability,&self.snapshot) {
            messages=gate.bind(snapshot.clone(),messages).open()?;
        }
        let guard_index = usize::from(opening != 0);
        let guard = if recovery { messages.last() } else { messages.get(guard_index) };
        if !matches!(guard, Some(SimpleQueryMessage::CommandComplete(_))) {
            return Err(RuntimeError::Store("missing Postgres output settings guard".into()));
        }
        if recovery { messages.pop(); } else { messages.remove(guard_index); }
        if owner.is_some() {
            for _ in 0..if owner_budget.is_some() { 3 } else { 1 } {
                if !matches!(messages.get(guard_index), Some(SimpleQueryMessage::CommandComplete(_))) {
                    return Err(RuntimeError::StoreOwnership("missing raising owner fence/budget".into()));
                }
                messages.remove(guard_index);
            }
        }
        Ok(messages)
    }
    pub fn flush(&mut self, calls: &CallCounter) -> Result<(), RuntimeError> {
        if self.pending.is_empty() { return Ok(()); }
        calls.set(calls.get() + 1);
        self.started = true;
        let command = std::mem::take(&mut self.pending);
        let messages = match self.guarded_query(&command) { Ok(m)=>m,Err(e)=>{self.checks.clear();return Err(e);} };
        self.validate(&messages)
    }
    /// Bind has its own output path, but client_encoding still applies. With
    /// no deferred controls, send the guard explicitly before allowing Bind.
    pub fn before_bind(&mut self, calls: &CallCounter) -> Result<(), RuntimeError> {
        if !self.pending.is_empty() { return self.flush(calls); }
        calls.set(calls.get() + 1);
        self.guarded_query("")?;
        Ok(())
    }
    pub fn validate(&mut self, messages: &[SimpleQueryMessage]) -> Result<(),RuntimeError> {
        let counts: Vec<_> = messages.iter().filter_map(|m| if let SimpleQueryMessage::CommandComplete(n) = m {Some(*n)} else {None}).collect();
        for (n,expected) in std::mem::take(&mut self.checks) {
            if counts.get(n) != Some(&expected) { return Err(RuntimeError::Store(format!("expected one affected row, got {:?}",counts.get(n)))); }
        }
        Ok(())
    }
    pub fn simple_query(&mut self, sql: &str) -> Result<Vec<SimpleQueryMessage>, RuntimeError> {
        self.started = true;
        let mut command = std::mem::take(&mut self.pending);
        command.push_str(sql);
        #[cfg(test)]
        super::literal_tests::serving::inject(&mut command);
        let messages = match self.guarded_query(&command) { Ok(m)=>m,Err(e)=>{self.checks.clear();return Err(e);} };
        self.validate(&messages)?;
        Ok(messages)
    }
}

/// Keep the ordinary typed row interface for adapters. Text output is decoded
/// using the prepared OIDs, then represented in the driver's binary formats.
/// Both paths therefore use the same FromSql implementation at each callsite.
#[derive(Debug)]
pub(crate) enum Row {
    Bind(postgres::Row),
    Text { statement: Statement, fields: Vec<Option<Vec<u8>>> },
}
impl Row {
    pub fn get<'a, I: RowIndex + std::fmt::Display, T: FromSql<'a>>(&'a self, index: I) -> T {
        self.try_get(index).unwrap()
    }
    pub fn try_get<'a, I: RowIndex + std::fmt::Display, T: FromSql<'a>>(&'a self, index: I) -> Result<T, RuntimeError> {
        match self {
            Self::Bind(row) => Ok(row.try_get(index)?),
            Self::Text { statement, fields } => {
                let columns = statement.columns();
                let n = index.__idx(columns).ok_or_else(|| RuntimeError::Store("flight column index".into()))?;
                let ty = columns[n].type_();
                if !T::accepts(ty) { return Err(RuntimeError::Store(format!("flight FromSql type mismatch: {ty}"))); }
                T::from_sql_nullable(ty, fields[n].as_deref()).map_err(|e| RuntimeError::Store(e.to_string()))
            }
        }
    }
    pub fn text(statement: &Statement, row: &postgres::SimpleQueryRow) -> Result<Self, RuntimeError> {
        let fields = statement.columns().iter().enumerate().map(|(n,c)| {
            if c.type_() == &Type::VOID && row.get(n).is_some() { return Ok(Some(Vec::new())); }
            let value = literal::text(c.type_(), row.get(n))?;
            binary(c.type_(), value)
        }).collect::<Result<_,_>>()?;
        Ok(Self::Text { statement: statement.clone(), fields })
    }
}
fn binary(ty: &Type, value: literal::Datum) -> Result<Option<Vec<u8>>, RuntimeError> {
    use literal::Datum::*;
    Ok(Some(match value {
        Null => return Ok(None),
        Bool(v) => vec![u8::from(v)],
        Int(v) => match *ty { Type::INT2 => (v as i16).to_be_bytes().to_vec(), Type::INT4 => (v as i32).to_be_bytes().to_vec(), _ => v.to_be_bytes().to_vec() },
        F32(v) => v.to_bits().to_be_bytes().to_vec(),
        F64(v) => v.to_bits().to_be_bytes().to_vec(),
        Text(v) => v.into_bytes(),
        Bytes(v) => v,
        Array(values) => {
            let postgres::types::Kind::Array(element) = ty.kind() else { return Err(RuntimeError::Store("array output type".into())); };
            let mut bytes = Vec::new();
            bytes.extend_from_slice(&1i32.to_be_bytes());
            bytes.extend_from_slice(&i32::from(values.iter().any(|v| matches!(v, Null))).to_be_bytes());
            bytes.extend_from_slice(&element.oid().to_be_bytes());
            bytes.extend_from_slice(&(values.len() as i32).to_be_bytes());
            bytes.extend_from_slice(&1i32.to_be_bytes());
            for value in values {
                match binary(element, value)? {
                    None => bytes.extend_from_slice(&(-1i32).to_be_bytes()),
                    Some(value) => { bytes.extend_from_slice(&(value.len() as i32).to_be_bytes()); bytes.extend(value); }
                }
            }
            bytes
        }
    }))
}



/// Physical transport guard, independent of public interpreter allowances.
/// At most 32 MiB of encoded SQL leaves room in the existing 256 MiB
/// adapter envelope for binary input, Datum arrays and construction copies.
/// Read planning separately reuses the existing 4 MiB prefetch allowance.
pub(super) const SCRATCH_LIMIT: usize = 256 << 20;
pub(super) const ENCODED_LIMIT: usize = SCRATCH_LIMIT / 8;
pub(super) fn text_type(t: &Type) -> bool {
    matches!(*t, Type::VOID | Type::BOOL | Type::INT2 | Type::INT4 | Type::INT8 | Type::FLOAT4 | Type::FLOAT8 | Type::TEXT | Type::BYTEA)
        || matches!(t.kind(), postgres::types::Kind::Array(element) if text_type(element))
}
pub(super) struct ResultSet { pub rows: Vec<Row>, pub count: u64 }
pub(super) fn results(statements: &[Statement], controls: usize, messages: Vec<SimpleQueryMessage>) -> Result<Vec<ResultSet>, RuntimeError> {
    let mut n = 0;
    let mut rows = Vec::new();
    let mut out = Vec::new();
    for message in messages {
        match message {
            SimpleQueryMessage::Row(row) if n >= controls && n < controls + statements.len() => rows.push(Row::text(&statements[n-controls], &row)?),
            SimpleQueryMessage::CommandComplete(count) => {
                if n >= controls && n < controls + statements.len() { out.push(ResultSet { rows: std::mem::take(&mut rows), count }); }
                n += 1;
            }
            _ => {}
        }
    }
    if out.len() != statements.len() { return Err(RuntimeError::Store("incomplete Postgres flight".into())); }
    Ok(out)
}
