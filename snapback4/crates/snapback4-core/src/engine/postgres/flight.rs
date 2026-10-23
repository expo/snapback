//! Ordered SimpleQuery transport. A session owns BEGIN through rollback;
//! commands retain separate READ COMMITTED snapshots inside each message.
// @ref LLP 3000.009.001.000.001#35-each-command-keeps-its-own-place — client validation always precedes the separate COMMIT flight.
use super::{literal, store::CallCounter};
use crate::RuntimeError;
use postgres::{Client, SimpleQueryMessage, Statement, row::RowIndex, types::{FromSql, Type}};

pub(super) struct Session<'a> {
    pub client: &'a mut Client,
    pub pending: String,
    pub started: bool,
    pub done: bool,
}
impl Drop for Session<'_> {
    fn drop(&mut self) {
        if self.started && !self.done {
            #[cfg(any(test, feature = "test-support"))]
            crate::round_trips::postgres(1);
            let _ = self.client.batch_execute("ROLLBACK");
        }
    }
}
impl Session<'_> {
    pub fn flush(&mut self, calls: &CallCounter) -> Result<(), RuntimeError> {
        if self.pending.is_empty() { return Ok(()); }
        calls.set(calls.get() + 1);
        self.started = true;
        self.client.batch_execute(&std::mem::take(&mut self.pending))?;
        Ok(())
    }
    pub fn simple_query(&mut self, sql: &str) -> Result<Vec<SimpleQueryMessage>, postgres::Error> {
        self.started = true;
        let mut command = std::mem::take(&mut self.pending);
        command.push_str(sql);
        self.client.simple_query(&command)
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
            let value = literal::text(c.type_(), row.get(n))?;
            binary(c.type_(), &value)
        }).collect::<Result<_,_>>()?;
        Ok(Self::Text { statement: statement.clone(), fields })
    }
}
fn binary(ty: &Type, value: &literal::Datum) -> Result<Option<Vec<u8>>, RuntimeError> {
    use literal::Datum::*;
    Ok(Some(match value {
        Null => return Ok(None),
        Bool(v) => vec![u8::from(*v)],
        Int(v) => match *ty { Type::INT2 => (*v as i16).to_be_bytes().to_vec(), Type::INT4 => (*v as i32).to_be_bytes().to_vec(), _ => v.to_be_bytes().to_vec() },
        F32(v) => v.to_bits().to_be_bytes().to_vec(),
        F64(v) => v.to_bits().to_be_bytes().to_vec(),
        Text(v) => v.as_bytes().to_vec(),
        Bytes(v) => v.clone(),
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
/// Input hex, command framing and typed decode must fit the existing 256 MiB
/// adapter scratch envelope. Each command is checked before adding it.
pub(super) const SCRATCH_LIMIT: usize = 256 << 20;
pub(super) const ENCODED_LIMIT: usize = SCRATCH_LIMIT / 8;
pub(super) fn text_type(t: &Type) -> bool {
    matches!(*t, Type::VOID | Type::BOOL | Type::INT2 | Type::INT4 | Type::INT8 | Type::FLOAT4 | Type::FLOAT8 | Type::TEXT | Type::BYTEA | Type::NAME | Type::VARCHAR | Type::BPCHAR)
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
