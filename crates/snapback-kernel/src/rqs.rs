use serde_json::Value;
use crate::rqs_contract::{jcs_escape_into, jcs_into};

pub const RELATIONAL_RESULT_ENCODING_VERSION: &str = "relational-result-encoding-v1";

/// Why a row set cannot be encoded under `RelationalResultEncodingV1`.
/// Both arms are server invariants — the executor only emits projected
/// scalar members — so a refusal here is a bug, never a client class.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RelationalEncodingRefusal {
    /// A row was not an object, or carried a member outside the projection
    /// declaration. Encoding must be total over the declared shape;
    /// dropping unknown members silently would un-pin the bytes.
    RowShapeInvalid,
    /// A member value failed canonicalization (non-finite number or an
    /// integer outside the safe band) — the same values `jcs` refuses.
    NonCanonicalValue,
}

/// Encode result rows as the pinned `RelationalResultEncodingV1` bytes
/// (LLP 0080 §2): UTF-8 JSON with no insignificant whitespace, RFC 8785
/// number spelling and string escaping over LLP 0051's canonical value
/// mapping, object members in the projection declaration's order — an
/// explicit, named divergence from JCS key sorting — absent expressed by
/// omission and null by the literal. V1 projects only scalar leaves, so no
/// nested-object ordering question arises (nested values still encode
/// canonically if they ever appear).
pub fn relational_result_encoding_v1(
    field_order: &[String],
    rows: &[Value],
) -> Result<String, RelationalEncodingRefusal> {
    let mut out = String::from("[");
    for (row_index, row) in rows.iter().enumerate() {
        if row_index > 0 {
            out.push(',');
        }
        let Value::Object(members) = row else {
            return Err(RelationalEncodingRefusal::RowShapeInvalid);
        };
        if members
            .keys()
            .any(|member| !field_order.iter().any(|field| field == member))
        {
            return Err(RelationalEncodingRefusal::RowShapeInvalid);
        }
        out.push('{');
        let mut first = true;
        for field in field_order {
            let Some(value) = members.get(field) else {
                // Absent is expressed by omission (null stays the literal).
                continue;
            };
            if !first {
                out.push(',');
            }
            first = false;
            jcs_escape_into(&mut out, field);
            out.push(':');
            jcs_into(&mut out, value).map_err(|_| RelationalEncodingRefusal::NonCanonicalValue)?;
        }
        out.push('}');
    }
    out.push(']');
    Ok(out)
}
