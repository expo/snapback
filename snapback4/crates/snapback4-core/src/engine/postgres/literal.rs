//! Typed literal codec for ordered serving flights, qualified by RT5.
//! @ref LLP 3000.009.001.000.001#36-how-a-flight-is-sent-is-decided-by-measurement — typed EXECUTE and text decoding qualification.
use crate::RuntimeError;
use postgres::{
    Client, SimpleQueryMessage, Statement,
    types::{Format, FromSql, IsNull, Kind, ToSql, Type},
};

/// Values at the port/driver boundary, not Quarry's JSON representation.
/// Inputs admit bool, i16/i32/i64, f32/f64, TEXT, BYTEA and their 1-D arrays.
/// NAME/BPCHAR/VARCHAR (including typmods), NUMERIC, dates and custom types
/// are not port bindings; their coercion/length semantics are not admitted.
#[derive(Debug, Clone, PartialEq)]
pub enum Datum {
    Null,
    Bool(bool),
    Int(i64),
    F32(f32),
    F64(f64),
    Text(String),
    Bytes(Vec<u8>),
    Array(Vec<Datum>),
}
fn bad(message: impl Into<String>) -> RuntimeError {
    RuntimeError::Input(message.into())
}
fn decode_error(message: impl Into<String>) -> RuntimeError {
    RuntimeError::Store(message.into())
}
fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8;16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len().saturating_mul(2));
    for b in bytes { out.push(DIGITS[(b >> 4) as usize] as char); out.push(DIGITS[(b & 15) as usize] as char); }
    out
}
fn unhex(text: &str) -> Result<Vec<u8>, RuntimeError> {
    if text.len() % 2 != 0 {
        return Err(decode_error("odd bytea hex length"));
    }
    text.as_bytes()
        .chunks_exact(2)
        .map(|p| {
            let a = (p[0] as char).to_digit(16);
            let b = (p[1] as char).to_digit(16);
            a.zip(b)
                .map(|(a, b)| (a * 16 + b) as u8)
                .ok_or_else(|| decode_error("invalid bytea hex"))
        })
        .collect()
}
pub(super) fn name(ty: &Type) -> Result<String, RuntimeError> {
    if let Kind::Array(element) = ty.kind() {
        return Ok(format!("{}[]", name(element)?));
    }
    let builtin = match *ty {
        Type::BOOL => "bool",
        Type::INT2 => "int2",
        Type::INT4 => "int4",
        Type::INT8 => "int8",
        Type::FLOAT4 => "float4",
        Type::FLOAT8 => "float8",
        Type::TEXT => "text",
        Type::BYTEA => "bytea",
        _ => return Err(bad(format!("RT5 unsupported port type {ty}"))),
    };
    Ok(format!("pg_catalog.{builtin}"))
}

/// SQL is ASCII only: text is UTF-8 bytes decoded explicitly by the server.
/// This avoids standard_conforming_strings, encoding, locale and quote rules.
/// Counts/times are already saturated by shared policy; never clamp here.
pub fn encode(value: &Datum, ty: &Type) -> Result<String, RuntimeError> {
    if encoded_bound(value) > super::flight::ENCODED_LIMIT {
        return Err(bad("Postgres literal scratch guard"));
    }
    let cast = name(ty)?;
    let body = match (value, ty) {
        (Datum::Null, _) => "NULL".into(),
        (Datum::Bool(v), &Type::BOOL) => if *v { "TRUE" } else { "FALSE" }.into(),
        (Datum::Int(v), &Type::INT2) if i16::try_from(*v).is_ok() => v.to_string(),
        (Datum::Int(v), &Type::INT4) if i32::try_from(*v).is_ok() => v.to_string(),
        (Datum::Int(v), &Type::INT8) => format!("'{v}'"), // i64::MIN must not first become a positive bigint.
        (Datum::F32(v), &Type::FLOAT4) => format!("'{}'", float(*v as f64)),
        (Datum::F64(v), &Type::FLOAT8) => format!("'{}'", float(*v)),
        (Datum::Text(v), &Type::TEXT) => {
            if v.contains('\0') {
                return Err(bad("Postgres text parameters cannot contain U+0000"));
            }
            format!(
                "pg_catalog.convert_from(pg_catalog.decode('{}','hex'),'UTF8')",
                hex(v.as_bytes())
            )
        }
        (Datum::Bytes(v), &Type::BYTEA) => format!("pg_catalog.decode('{}','hex')", hex(v)),
        (Datum::Array(v), _) => {
            let Kind::Array(element) = ty.kind() else {
                return Err(bad("array type mismatch"));
            };
            format!(
                "ARRAY[{}]",
                v.iter()
                    .map(|v| encode(v, element))
                    .collect::<Result<Vec<_>, _>>()?
                    .join(",")
            )
        }
        _ => return Err(bad(format!("value does not fit {ty}"))),
    };
    Ok(format!("({body})::{cast}"))
}
fn encoded_bound(value: &Datum) -> usize {
    match value {
        Datum::Text(v) => v.len().saturating_mul(2).saturating_add(128),
        Datum::Bytes(v) => v.len().saturating_mul(2).saturating_add(64),
        Datum::Array(v) => v.iter().fold(64usize, |n,v| n.saturating_add(encoded_bound(v)).saturating_add(1)),
        _ => 64,
    }
}
fn float(v: f64) -> String {
    if v.is_nan() {
        "NaN".into()
    } else if v == f64::INFINITY {
        "Infinity".into()
    } else if v == f64::NEG_INFINITY {
        "-Infinity".into()
    } else {
        v.to_string()
    }
}

/// Reuse the driver's checked binary encoder so optional values and every
/// tail Vec/Vec<Option<T>> enter the same chokepoint. Fail closed on text-format
/// custom ToSql implementations rather than pretending they are binary.
pub fn parameter(value: &(dyn ToSql + Sync), ty: &Type) -> Result<String, RuntimeError> {
    if !matches!(value.encode_format(ty), Format::Binary) {
        return Err(bad("RT5 requires binary ToSql parameters"));
    }
    let mut bytes = Default::default();
    let null = value
        .to_sql_checked(ty, &mut bytes)
        .map_err(|e| bad(format!("invalid Postgres parameter: {e}")))?;
    if bytes.len() > super::flight::ENCODED_LIMIT { return Err(bad("Postgres parameter scratch guard")); }
    let value = if matches!(null, IsNull::Yes) {
        Datum::Null
    } else {
        binary(ty, bytes.as_ref())?
    };
    encode(&value, ty)
}

pub fn binary(ty: &Type, bytes: &[u8]) -> Result<Datum, RuntimeError> {
    macro_rules! read {
        ($t:ty, $variant:ident) => {
            Datum::$variant(
                <$t>::from_sql(ty, bytes)
                    .map_err(|e| bad(e.to_string()))?
                    .into(),
            )
        };
    }
    Ok(match *ty {
        Type::VOID if bytes.is_empty() => Datum::Null,
        Type::BOOL => read!(bool, Bool),
        Type::INT2 => read!(i16, Int),
        Type::INT4 => read!(i32, Int),
        Type::INT8 => read!(i64, Int),
        Type::FLOAT4 => read!(f32, F32),
        Type::FLOAT8 => read!(f64, F64),
        Type::BYTEA => read!(Vec<u8>, Bytes),
        _ if <String as FromSql>::accepts(ty) => read!(String, Text),
        _ => {
            let Kind::Array(element) = ty.kind() else {
                return Err(bad(format!("unsupported binary type {ty}")));
            };
            let mut rest = bytes;
            fn i32_at(rest: &mut &[u8]) -> Result<i32, RuntimeError> {
                let b = rest.get(..4).ok_or_else(|| bad("short binary array"))?;
                let v = i32::from_be_bytes(b.try_into().unwrap());
                *rest = &rest[4..];
                Ok(v)
            }
            let dims = i32_at(&mut rest)?;
            let _nulls = i32_at(&mut rest)?;
            let oid = i32_at(&mut rest)?;
            if oid as u32 != element.oid() {
                return Err(bad("array element OID mismatch"));
            }
            let count = match dims {
                0 => 0,
                1 => {
                    let n = i32_at(&mut rest)?;
                    if n < 0 || i32_at(&mut rest)? != 1 {
                        return Err(bad("non-unit array bounds"));
                    }
                    n as usize
                }
                _ => return Err(bad("multidimensional arrays are not port types")),
            };
            if count > super::flight::ENCODED_LIMIT / std::mem::size_of::<Datum>() { return Err(bad("Postgres array scratch guard")); }
            let mut values = Vec::new();
            for _ in 0..count {
                let len = i32_at(&mut rest)?;
                if len == -1 {
                    values.push(Datum::Null);
                    continue;
                }
                let n = usize::try_from(len).map_err(|_| bad("negative array element length"))?;
                let value = rest.get(..n).ok_or_else(|| bad("short array element"))?;
                values.push(binary(element, value)?);
                rest = &rest[n..];
            }
            if !rest.is_empty() {
                return Err(bad("trailing binary array bytes"));
            }
            Datum::Array(values)
        }
    })
}

/// Pin and verify the settings required by the text-output contract. Inputs use
/// catalog-qualified casts/functions and UTF8 hex. Neither input encoding nor
/// output qualification resolves any name through the application search_path.
/// Text float output canonicalizes every NaN to positive quiet NaN (f32
/// 0x7fc00000, f64 0x7ff8000000000000); NaN payload/sign are not port facts.
/// Applied at every physical ownership connection and before a Store first begins.
pub fn configure(client: &mut Client) -> Result<(), RuntimeError> {
    client.batch_execute(
        "SET client_encoding='UTF8'; SET extra_float_digits=3; SET bytea_output='hex'",
    )?;
    let r = client.query_one("SELECT pg_catalog.current_setting('client_encoding'),pg_catalog.current_setting('extra_float_digits'),pg_catalog.current_setting('bytea_output')", &[])?;
    if r.get::<_, &str>(0) != "UTF8" || r.get::<_, &str>(1) != "3" || r.get::<_, &str>(2) != "hex" {
        return Err(decode_error("RT5 output settings were not pinned"));
    }
    Ok(())
}

pub fn text(ty: &Type, value: Option<&str>) -> Result<Datum, RuntimeError> {
    let Some(v) = value else {
        return Ok(Datum::Null);
    };
    macro_rules! parse {
        ($t:ty, $variant:ident) => {
            Datum::$variant(
                v.parse::<$t>()
                    .map_err(|e| decode_error(e.to_string()))?
                    .into(),
            )
        };
    }
    Ok(match *ty {
        Type::VOID if v.is_empty() => Datum::Null,
        Type::BOOL => Datum::Bool(match v {
            "t" => true,
            "f" => false,
            _ => return Err(decode_error("invalid bool")),
        }),
        Type::INT2 => parse!(i16, Int),
        Type::INT4 => parse!(i32, Int),
        Type::INT8 => parse!(i64, Int),
        // PostgreSQL emits exactly "NaN", even for negative/payload NaNs.
        // Construct the specified bits rather than depending on Rust's NaN parse.
        Type::FLOAT4 if v == "NaN" => Datum::F32(f32::from_bits(0x7fc00000)),
        Type::FLOAT8 if v == "NaN" => Datum::F64(f64::from_bits(0x7ff8000000000000)),
        Type::FLOAT4 => parse!(f32, F32),
        Type::FLOAT8 => parse!(f64, F64),
        Type::BYTEA => Datum::Bytes(unhex(
            v.strip_prefix("\\x")
                .ok_or_else(|| decode_error("bytea_output must be hex"))?,
        )?),
        _ if <String as FromSql>::accepts(ty) => Datum::Text(v.into()),
        _ => {
            let Kind::Array(element) = ty.kind() else {
                return Err(decode_error(format!("unsupported text type {ty}")));
            };
            Datum::Array(
                array(v)?
                    .iter()
                    .map(|s| text(element, s.as_deref()))
                    .collect::<Result<_, _>>()?,
            )
        }
    })
}

// PostgreSQL array output: quotes and backslashes escape one byte. Parse those
// layers before decoding the typed element (notably bytea's own hex prefix).
fn array(v: &str) -> Result<Vec<Option<String>>, RuntimeError> {
    let v = v
        .strip_prefix('{')
        .and_then(|s| s.strip_suffix('}'))
        .ok_or_else(|| decode_error("not a unit-bound one-dimensional array"))?;
    if v.is_empty() {
        return Ok(Vec::new());
    }
    let mut values = Vec::new();
    let mut bytes = Vec::new();
    let mut quoted = false;
    let mut was_quoted = false;
    let mut escape = false;
    for b in v.bytes().chain(std::iter::once(b',')) {
        if escape {
            bytes.push(b);
            escape = false;
            continue;
        }
        match b {
            b'\\' => escape = true,
            b'"' => {
                quoted = !quoted;
                was_quoted = true;
            }
            b',' if !quoted => {
                let s = String::from_utf8(std::mem::take(&mut bytes))
                    .map_err(|e| decode_error(e.to_string()))?;
                values.push(if !was_quoted && s == "NULL" {
                    None
                } else {
                    Some(s)
                });
                was_quoted = false;
            }
            b'{' | b'}' if !quoted => {
                return Err(decode_error("multidimensional array not admitted"));
            }
            _ => bytes.push(b),
        }
    }
    if quoted || escape {
        return Err(decode_error("unterminated array element"));
    }
    Ok(values)
}

pub(super) fn serving_name() -> String {
    // A physical Client may be moved through several Store wrappers during
    // attach/evaluation. SQL PREPARE survives their Rust caches and rollback.
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    format!("sb4_rt6_{:x}_{}", std::process::id(), NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed))
}
pub struct Prepared {
    pub bind: Statement,
    name: String,
}
impl Prepared {
    /// SQL text and names are trusted adapter constants; all values go through
    /// parameter(). SQL PREPARE's types match the driver's inferred types.
    pub fn new(client: &mut Client, name: &str, sql: &str) -> Result<Self, RuntimeError> {
        if name.is_empty()
            || !name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        {
            return Err(bad("invalid prepared name"));
        }
        let bind = client.prepare(sql)?;
        Self::from_bind(client, name, sql, bind)
    }
    pub(super) fn from_bind(client: &mut Client, name: &str, sql: &str, bind: Statement) -> Result<Self, RuntimeError> {
        let types = bind
            .params()
            .iter()
            .map(name_of)
            .collect::<Result<Vec<_>, _>>()?;
        let args = if types.is_empty() {
            String::new()
        } else {
            format!("({})", types.join(","))
        };
        client.batch_execute(&format!("PREPARE {name}{args} AS {sql}"))?;
        Ok(Self {
            bind,
            name: name.into(),
        })
    }
    pub fn command(&self, params: &[&(dyn ToSql + Sync)]) -> Result<String, RuntimeError> {
        if params.len() != self.bind.params().len() {
            return Err(bad("parameter count mismatch"));
        }
        let mut args = Vec::new();
        let mut size = 64usize;
        for (p,t) in params.iter().zip(self.bind.params()) {
            let value = parameter(*p,t)?;
            size = size.saturating_add(value.len()).saturating_add(1);
            if size > super::flight::ENCODED_LIMIT { return Err(bad("Postgres command scratch guard")); }
            args.push(value);
        }
        Ok(if args.is_empty() {
            format!("EXECUTE {}", self.name)
        } else {
            format!("EXECUTE {}({})", self.name, args.join(","))
        })
    }
    pub fn rows(&self, messages: &[SimpleQueryMessage]) -> Result<Vec<Vec<Datum>>, RuntimeError> {
        messages
            .iter()
            .filter_map(|m| {
                if let SimpleQueryMessage::Row(r) = m {
                    Some(r)
                } else {
                    None
                }
            })
            .map(|r| {
                if r.len() != self.bind.columns().len() {
                    return Err(decode_error("flight result column count mismatch"));
                }
                self.bind
                    .columns()
                    .iter()
                    .enumerate()
                    .map(|(i, c)| text(c.type_(), r.get(i)))
                    .collect()
            })
            .collect()
    }
}
fn name_of(ty: &Type) -> Result<String, RuntimeError> {
    name(ty)
}
