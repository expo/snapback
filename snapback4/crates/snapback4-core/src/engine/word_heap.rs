//! Allocation ledger for uniform, meter-bounded word expansion (LLP 3000.007 §20.24).
//! This ledger prices interpreter allocations and the store's payload copies:
//! row images, keys, and registers holding resident payloads. Charges accumulate
//! allocations, not live RSS. A failed allowance precedes the priced growth,
//! with the SQLite preflight ordering exception stated below.
//! The storage engine's per-execution statement storage (VdbeCursor/BtCursor,
//! column-offset arrays, sorters and non-payload registers) and page cache are
//! shared images outside the ledger, never interpreter heap, for every store
//! scan in the engine. Statement execution storage is bounded per execution
//! and transient, freed by the same reset chain as resident-payload registers;
//! unlike those payload copies it is measured and pinned, not charged, by
//! sqlite_empty_scan_statement_storage_is_pinned_and_transient in tests/word_heap.rs.
//! Tables with non-audience `written by` fields use `scan_disclosed` instead
//! of serialized-payload preflight: fixed fetch slots, a declared-row transient
//! decode reservation and the typed Disclosed image (LLP 3000.015 §1). Raw
//! blob lengths never enter that caller ledger; the reservation precedes decode.
//! Existing general expression evaluation and rule-probe engines
//! retain their own accounting; this ledger prices the expansion's added storage.
//!
//! Notation: A(n)=0 for n=0, otherwise max(n,sizeof(usize)); S<T>(n)=A(n*sizeof(T));
//! V(v)=S<Value>(len)+owned String/Id/Bytes/Array payload recursively (Arc images 0);
//! B(b)=V(each vector bound)+owned scalar/word payload. G<T> charges S<T>(max(1,2c))
//! on replacement of capacity c; ordinary collect growth uses vec_growth<T>.
//! N<K,V>=11*sizeof(K)+11*sizeof(V)+12*sizeof(usize)+32; insertion at n entries
//! reserves N*(floor(log2(n+1))+2), one possible split per level and a new root.
//! R(prefix,bounds)=range(), including key escaping and replacement capacities.
//! J(json)=stored_row(), an allocation-free count of quoted bytes, typed map roots,
//! fields, arrays and commas; its complete formula is below, tested against allocs.
//!
//! | Site / allocation | Class | Formula | Charge point before growth |
//! |---|---|---|---|
//! | Initial field names and scope slots | retained interpreter storage | strings(fields)+S<Value>(scope arity) | discover_words, before to_vec/with_capacity |
//! | Query normalization/lowercase scratch | bounded store scratch | ASCII A(input bytes); Unicode 48*A(bytes) | tokenize_limit, before fold (also wasm UTF-16 bridge) |
//! | Query tokens and token vector | retained interpreter storage | A(token bytes)+G<String>, maximum 8 at source | tokenize_limit, before to_owned/reserve_exact |
//! | Temporary bound singleton vectors | retained interpreter storage | S<Value>(1); evaluated operands use expr accounting | word_bounds, before vec! |
//! | Cursor validation and cached input | retained interpreter storage | 256*A(token bytes)+A(token bytes), once per distinct token | validate_word_cursor, before decode/reencode/to_owned |
//! | Cursor suffix names/types/slots | retained interpreter storage | S<CursorColumn>(remaining+id)+names+recursive column payload | suffix, before with_capacity/clone |
//! | Evaluated cursor bound copies | retained interpreter storage | V(position.values) per lane | word_bounds, before clone |
//! | Read-table and dependency sets | retained interpreter storage | A(name)+insertion<String,()> only on first insertion | word_note_table, before owned name/insert; dependency traversal borrows rules |
//! | Visibility and compiled Scan/Expr trees | shared images | 0; borrowed traversal, including eight 4 KiB literals | scan_visibility and merge_lazy never clone per generated lane |
//! | Scope verdict temporary prefix row/terms | bounded store scratch | verdict(): collect slots+map nodes+names+owned terms+Arc header | discover_words, before prefix_verdict |
//! | Device retained verdict and coverage diagnostic | retained interpreter storage | 256*(192+V(scope)+A(table)+A(index)+A(site)) | discover_words, before retained_group/unknown_fact/horizon_coverage |
//! | Initial discovery bounds.word | retained interpreter storage | A(first term) | discover_words, before clone |
//! | Store encoded bounds/range endpoints | bounded store scratch | R(prefix,bounds)+copied table/index names | scan_metered, before scan_range and range lookup |
//! | SQLite native column payload scratch | bounded store scratch | 2*page_size once per read, then 2*(JSON/key byte lengths)+64 per row in the same transaction | stream preflight rows and charge before stepping again: within one execution the first row's resident copy (one page-size buffer per column, two registers) precedes its charge; every later row's copy follows the previous row's charge; across executions the reserve prepays the first execution's first copy once per read and later executions' first copies are charged immediately after, bounded by the same constant; no other priced payload is copied before its allowance; overflow payloads are not read; payload SQL uses the granted allowances; database pages, cached VM and per-execution statement storage are shared images |
//! | SQLite fetched typed row and key | bounded store scratch | J(borrowed JSON)+A(key bytes)+G<(Value,Vec<u8>)> for each fetched entry | scan_metered, before serde decode/key.to_vec/result reserve |
//! | Memory fetched key and result slots | bounded store scratch | owned value payload+A(key bytes)+G<(Value,Vec<u8>)> | memory_result, before cloning or reserving |
//! | Memory row maps; compiled schema/program; SQLite database/cache | shared images | 0 per Arc/borrow; storage engine's existing pages/cache are not interpreter heap | store borrowing; no row-body clone per lane |
//! | PostgreSQL optional adapter batch | bounded store scratch | 2*R+4096 preflight; 256*SUM(serialized row/key bytes)+vec_growth<(Value,Vec<u8>)>(limit) | scalar preflight then allowance before owning scan result, in same snapshot |
//! | Every decoded discovery/refill key component | bounded store scratch | 4*S<Value>(max(components,4))+4*A(max(key bytes,8)) | key_decode allowance before key::decode |
//! | Retained discovered words and after vector | retained interpreter storage | decoded word already paid; 2*A(word)+S<Value>(1)+G<String> | discover_words, before after clone/vector growth |
//! | Shared fields/remaining terms | retained interpreter storage | S<WordRead>(1)+2*S<usize>(1), payload moved from discovery | merge_lazy, before Rc::new; every lane clones only Rc |
//! | Lane source iterator | retained interpreter storage | S<Once<Value>>(1) | merge_lazy, before boxed source iterator; no generated scans Vec |
//! | Per-word evaluated prefix and descriptor | retained interpreter storage | S<Value>(scope+1)+owned scope payload+G<PreparedLane> | merge_lazy, before prefix allocation and descriptor push |
//! | Opening/refill prefix and bounds clones | bounded store scratch | V(prefix)+B(bounds), then B(bounds) for scan cursor | word_scan_prepared and scan_prepared, before each clone |
//! | Every opening/refill fetched batch | bounded store scratch | sum of per-entry store formula, including rejected rows/discarded keys | scan_metered, before each image/key allocation; no post-fetch buffer allowance |
//! | Optional/default fields or pending-field removal | retained interpreter storage | materialize/object_copy: nodes+owned fields+Arc header+missing-field insertion bounds | before optional materialization / stripping pending |
//! | Candidate text references | shared images | 0, borrowed iterator (no Vec) | scan_prepared; no tokenizer at all with no remaining terms |
//! | Complete candidate tokenization | bounded store scratch | same fold/token/G<String> formula, at most 512 retained tokens | tokenize, before folding/copying/growth |
//! | Filter environment slot | retained interpreter storage | A("$filter")+insertion<String,Value>(env.len) | scan_prepared, before env.insert; row image shared |
//! | last_rule_visible and returned raw keys | retained interpreter storage | A(key bytes) each; G<Vec<u8>> for result | scan_prepared, before key clone/vector growth |
//! | Visible-row and drain-page vectors | retained interpreter storage | G<Value> at each replacement | push, before reserve_exact; row image moved/shared |
//! | Vec to VecDeque buffer transfer | shared images | 0 additional allocation | transfer consumes the existing Vec, never charged twice |
//! | Merge head key and heap capacity | retained interpreter storage | S<Value>(suffix)+owned component/id payload; G<MergeHead> | charge_word_key and grow, before key construction/heap growth |
//! | Dedup IDs and B-tree splits | retained interpreter storage | A(id)+insertion<String,()>(seen.len) | merge_lazy, before to_owned/insert |
//! | Emitted position and moving winning head | retained interpreter storage | V(head.key) for copied last; moving head.key into after is 0 | merge_lazy, before last.clone |
//! | Repeated meter site strings | retained interpreter storage | A(site) each | before meter.at in admission, opening/refill and filter restoration |
//! | Shape-cursor map | retained interpreter storage | A(site)+insertion<String,String>; token moved | word_shape_cursor, before record_shape_cursor |
//! | Page record names/map/position | retained interpreter storage | insertion<String,PagePosition>+3*(A(site)+A(table)+A(index))+2*V(last) | merge_lazy, before record_page |
//! | Returned shape-position collection | retained interpreter storage | vec_growth<Vec<Value>>(rows)+sum(vec_growth<Value>(suffix)+owned key payload) | merge_lazy, before record_page; generic shaping charge is additional conservative accounting |
//! | Later returned-shape trim map | retained interpreter storage | sum(A(shape site)+max emitted key bytes+insertion<String,ShapePosition>) over possible shape sites | merge_lazy, before any later trim_shape inserts/clones a position |
//! | Output cursor construction | bounded store scratch | cursor_build(): 2 descriptors/keys plus JSON/base64 allowance, maximum emitted key (including shape rewind) | merge_lazy, before record_page/raw/final encoding |
//!
//! Ordinary range/list lanes keep their previous descriptor allowance in merge_lazy; they are outside this word ledger.
//!
//! Public-table preflights retain their existing encoding-sensitive bound.
//! Private tables use the declared bound, including the 144-byte identity gate.
//! The public-store exception is narrow: inspect borrowed stored bytes, charge,
//! then materialize; an exhausted heap never starts the typed decode/key copy. SQLite borrows
//! its JSON text instead of first allocating a String. PostgreSQL preflights byte
//! lengths in its existing repeatable-read/serializable transaction. The measured
//! heap column describes these allowances; this ledger, not observations, is the bound.
use crate::{error::RuntimeError, meter::Meter, rows::Bounds, value::Value};
use std::mem::size_of;

// A nonempty allocation pays at least one machine word, including short strings.
pub fn allocation(bytes: usize) -> u64 { if bytes == 0 { 0 } else { bytes.max(size_of::<usize>()) as u64 } }
pub fn slots<T>(len: usize) -> u64 { allocation(len.saturating_mul(size_of::<T>())) }
pub fn text(s: &str) -> u64 { allocation(s.len()) }
pub fn values(v: &[Value]) -> u64 { slots::<Value>(v.len()) + v.iter().map(value).sum::<u64>() }
fn value(v: &Value) -> u64 {
    match v {
        Value::String(s) | Value::Id(s) => text(s),
        Value::Bytes(b) => allocation(b.len()),
        Value::Array(a) => values(a),
        _ => 0, // Row/Map/asset clones share their Arc.
    }
}

// Explicit geometric growth starts at one slot, avoiding Vec's hidden minimum
// of four large descriptors. Charge the entire replacement allocation first.
pub fn grow<T>(meter: &mut Meter, len: usize, capacity: usize) -> Result<usize, RuntimeError> {
    if len < capacity { return Ok(0); }
    let next = capacity.saturating_mul(2).max(1);
    meter.heap(slots::<T>(next))?;
    Ok(next - len)
}
pub fn push<T>(meter: &mut Meter, out: &mut Vec<T>, item: T) -> Result<(), RuntimeError> {
    let additional = grow::<T>(meter, out.len(), out.capacity())?;
    if additional != 0 { out.reserve_exact(additional); }
    out.push(item);
    Ok(())
}

pub fn strings(v: &[String]) -> u64 { slots::<String>(v.len()) + v.iter().map(|s| text(s)).sum::<u64>() }
pub fn bounds(b: &Bounds) -> u64 {
    [&b.after, &b.at_or_after, &b.before].into_iter().flatten().map(|v| values(v)).sum::<u64>()
        + [&b.gt, &b.gte, &b.lt, &b.lte].into_iter().flatten().map(value).sum::<u64>()
        + b.word.as_ref().map_or(0, |s| text(s))
}

fn column(kind: &crate::schema::ColumnType) -> u64 {
    use crate::schema::ColumnType::*;
    match kind {
        Enum { variants } => strings(variants), Money { currency, .. } => text(currency), Ref { table } => text(table),
        Optional(inner) | List { of: inner, .. } => slots::<crate::schema::ColumnType>(1) + column(inner), _ => 0,
    }
}

pub fn suffix(meter: &mut Meter, table: &crate::schema::Table, index: &crate::schema::Index, prefix: usize, merge: bool) -> Result<Vec<crate::cursor::CursorColumn>, RuntimeError> {
    use crate::{cursor::CursorColumn, schema::IndexComponent};
    // Exact descriptor capacity, copied names and recursive column-type bodies.
    // Reserve the possible appended id up front, so collect/push has no hidden growth.
    let capacity = index.components.len().saturating_sub(prefix) + usize::from(merge);
    let bodies = index.components.iter().skip(prefix).filter_map(|c| c.key_name().map(|name| {
        text(name) + if matches!(c, IndexComponent::Calendar(_)) { 0 } else { table.columns.get(name).map_or(0, column) }
    })).sum::<u64>();
    meter.heap(slots::<CursorColumn>(capacity) + bodies + if merge { text("id") + column(&table.columns["id"]) } else { 0 })?;
    let mut out = Vec::with_capacity(capacity);
    for c in index.components.iter().skip(prefix) {
        if let (Some(name), Some(kind)) = (c.key_name(), c.key_type(table)) { out.push(CursorColumn { name: name.clone(), kind }); }
    }
    if merge && out.last().is_none_or(|c| c.name != "id") { out.push(CursorColumn { name: "id".into(), kind: table.columns["id"].clone() }); }
    Ok(out)
}

// Tokenize directly into one metered vector, avoiding the old per-column
// vector plus row-union vector. ASCII NFC is identity, so its sole folded
// String costs A(len); non-ASCII reserves 48*len for NFC/lowercase scratch
// and the wasm UTF-16 bridge before folding. Retained tokens allocate exact
// UTF-8 length, and vector replacement capacity is charged before growth.
// Duplicate/truncated tokens are compared as borrowed slices before copying.
pub fn tokenize<'a>(meter: &mut Meter, texts: impl IntoIterator<Item = &'a str>) -> Result<Vec<String>, RuntimeError> {
    tokenize_limit(meter, texts, crate::words::MAX_TOKENS_PER_ROW)
}

pub fn tokenize_limit<'a>(meter: &mut Meter, texts: impl IntoIterator<Item = &'a str>, limit: usize) -> Result<Vec<String>, RuntimeError> {
    let mut out = Vec::<String>::new();
    for text in texts {
        meter.heap(if text.is_ascii() { allocation(text.len()) } else { 48 * allocation(text.len()) })?;
        let folded = if text.is_ascii() { text.to_ascii_lowercase() } else { crate::words::fold(text) };
        for word in folded.split(|c: char| !c.is_alphanumeric()).filter(|s| !s.is_empty()) {
            let end = word.char_indices().nth(crate::words::MAX_TOKEN_CHARS).map_or(word.len(), |(i, _)| i);
            let token = &word[..end];
            if out.iter().any(|s| s == token) { continue; }
            meter.heap(self::text(token))?;
            let additional = grow::<String>(meter, out.len(), out.capacity())?;
            if additional != 0 { out.reserve_exact(additional); }
            out.push(token.to_owned());
            if out.len() == limit { return Ok(out); }
        }
    }
    Ok(out)
}

// One full internal B-tree node. At most one node splits per level plus a
// new root; tree height is bounded by log2(entries+1), looser than fanout 6.
// word_heap test: 4,096 native String inserts measured at most 1,408 B per
// insert; this formula allows 5,488 B at insert 4,095 (payload prepaid).
pub fn node<K, V>() -> u64 { (11 * size_of::<K>() + 11 * size_of::<V>() + 12 * size_of::<usize>() + 32) as u64 }
pub fn insertion<K, V>(entries: usize) -> u64 { node::<K, V>() * (usize::BITS - entries.saturating_add(1).leading_zeros() + 1) as u64 }

pub fn key_decode(components: usize, bytes: usize) -> u64 {
    // Vec<Value> and each unescaped byte Vec grow from a minimum of 4 and 8;
    // the sum of geometric capacities is less than four times final size.
    4 * slots::<Value>(components.max(4)) + 4 * allocation(bytes.max(8))
}

fn encoded(v: &Value) -> usize {
    match v {
        Value::Null | Value::Bool(_) => 1, Value::Int(_) => 9,
        Value::String(s) | Value::Id(s) => 3 + s.len() + s.bytes().filter(|b| *b == 0).count(),
        Value::Bytes(s) => 3 + s.len() + s.iter().filter(|b| **b == 0).count(),
        _ => usize::MAX / 128, // not a legal index value: refuse allocation before the store
    }
}
pub fn range(prefix: &[Value], b: &Bounds) -> u64 {
    let base = prefix.iter().map(encoded).sum::<usize>();
    let mut bytes = 4 * allocation(base.max(prefix.len() * 12)) + 4 * allocation(base + 1);
    if let Some(word) = &b.word { bytes += 8 * allocation(base + 2 * word.len() + 2); }
    for v in [&b.gt, &b.gte, &b.lt, &b.lte].into_iter().flatten() {
        bytes += 2 * values(prefix) + 2 * slots::<Value>(prefix.len() + 1) + value(v) + 8 * allocation(base + encoded(v) + 1);
    }
    for vs in [&b.after, &b.at_or_after, &b.before].into_iter().flatten() {
        bytes += 2 * values(prefix) + 2 * values(vs) + 8 * allocation(base + vs.iter().map(encoded).sum::<usize>() + 1);
    }
    bytes
}

/// Bound SQLite's typed row decoder without allocating a JSON tree. Quoted
/// bytes cannot be structural tokens. Charge all string buffers (input is
/// borrowed, unescape scratch and retained strings pay 4x raw bytes), every
/// possible B-tree root and split (minimum non-root occupancy 5), and array
/// growth at 4x slots with a four-slot minimum. Enum tags are borrowed by
/// serde; only Row/Map tags introduce B-tree roots. After removing enum-tag
/// colons, actual map fields bound splits. This is a bound, not RSS.
pub fn stored_row(json: &str) -> u64 {
    let (mut quoted, mut escaped) = (false, false);
    let (mut objects, mut tags, mut arrays, mut fields, mut commas) = (0, 0, 0, 0, 0);
    for (i, b) in json.bytes().enumerate() {
        if quoted {
            if escaped { escaped = false; } else if b == b'\\' { escaped = true; } else if b == b'"' { quoted = false; }
        } else { match b { b'"' => quoted = true, b'{' => { tags += 1; if json[i..].starts_with("{\"Row\":") || json[i..].starts_with("{\"Map\":") { objects += 1; } }, b'[' => arrays += 1, b':' => fields += 1, b',' => commas += 1, _ => {} } }
    }
    // Each non-map object is a Value tag, not a B-tree field. At <=11 total
    // actual fields every map fits one root; above that, two nodes per five
    // fields also cover internal splits and minimum non-root occupancy.
    let fields = fields - (tags - objects);
    4 * allocation(json.len()) + (objects + if fields > 11 { 2 * (fields / 5) } else { 0 }) * node::<String, Value>()
        + if arrays == 0 { 0 } else { 4 * slots::<Value>((arrays * 4 + commas) as usize) } + objects * 2 * slots::<usize>(1)
}

/// Copy a memory-store row handle/key into a precharged result vector. Row/Map
/// images share their Arc; payloads of a non-row Value are priced recursively.
pub fn memory_result(meter: &mut Meter, out: &mut Vec<(Value, Vec<u8>)>, row: &Value, key: &[u8]) -> Result<(), RuntimeError> {
    meter.heap(value(row) + allocation(key.len()))?;
    let additional = grow::<(Value, Vec<u8>)>(meter, out.len(), out.capacity())?;
    if additional != 0 { out.reserve_exact(additional); }
    out.push((row.clone(), key.to_vec()));
    Ok(())
}

pub fn cursor_decode(token: &str) -> u64 {
    // JSON DOM + typed decode + canonical re-encode, bounded before any parse.
    // Each input byte can account for at most one Value/B-tree field; 256 also
    // covers tag/name/type strings, minimum capacities and both base64 buffers.
    256 * allocation(token.len())
}

/// Optional/default materialisation may copy a shared map once and insert
/// missing fields. The original row image is already paid by the store (or
/// shared from the device); only the copy and inserted values are new here.
pub fn materialize(row: &crate::value::Disclosed<'_>, _table: &crate::schema::Table) -> u64 {
    row.materialization_heap()
}

/// Scalar/key copies never traverse a Row/Map image. Whole rows require Disclosed.
pub fn scalar(v: &Value) -> u64 { value(v) }

pub fn object_copy(row: &crate::value::Disclosed<'_>) -> u64 { row.copy_heap() }

pub fn cursor_build(table: &crate::schema::Table, index: &crate::schema::Index, prefix: usize, key_bytes: u64, names: u64) -> u64 {
    if key_bytes == 0 { return 0; }
    // Typed descriptor names/types, escaped/tagged JSON (8x body + per-column
    // fixed tags), JSON Vec geometric replacements and base64 result, for two
    // raw/final encodes. Cloned position values and suffix are prepaid too.
    let descriptor = index.components.iter().skip(prefix).filter_map(|c| c.key_name()).map(|name| text(name) + table.columns.get(name).map_or(0, column)).sum::<u64>();
    2 * (slots::<crate::cursor::CursorColumn>(index.components.len() + 1) + descriptor + key_bytes
        + 8 * (256 + 8 * (names + descriptor + key_bytes)))
}

pub fn verdict(index: &crate::schema::Index, prefix: &[Value], viewer: &str, rule: &crate::schema::RuleExpr) -> u64 {
    // The prefix row's collect buffer, map, Arc, viewer and probe term clones.
    let fields = index.components.iter().zip(prefix).filter_map(|(c,v)| c.column().map(|name| (name, v)));
    let row = fields.map(|(name,v)| node::<String, Value>() + text(name) + value(v)).sum::<u64>();
    vec_growth::<(String, Value)>(prefix.len()) + row + slots::<usize>(2) + text(viewer) + rule_values(rule, prefix, viewer)
}
fn rule_values(rule: &crate::schema::RuleExpr, prefix: &[Value], viewer: &str) -> u64 {
    use crate::schema::{RuleExpr::*, RuleTerm};
    let term = |t: &RuleTerm| match t {
        RuleTerm::Viewer => text(viewer), RuleTerm::Literal(v) => value(v),
        RuleTerm::Field(_) | RuleTerm::OldField(_) | RuleTerm::NextField(_) => prefix.iter().map(value).sum(),
    };
    match rule {
        Eq(a,b) | Ne(a,b) => term(a) + term(b),
        And(rs) | Or(rs) => rs.iter().map(|r| rule_values(r, prefix, viewer)).sum(), Not(r) => rule_values(r, prefix, viewer),
        Exists { table, key, equalities, .. } | Created { table, key, equalities, .. } => text(table)
            + vec_growth::<Value>(key.len()) + key.iter().map(term).sum::<u64>()
            + vec_growth::<(String, Value)>(equalities.len()) + equalities.iter().map(|(name,v)| text(name)+term(v)).sum::<u64>(),
        _ => 0,
    }
}

pub fn vec_growth<T>(n: usize) -> u64 {
    if n == 0 { 0 } else { slots::<T>(if n <= 4 { 4 } else { 2 * n.next_power_of_two() - 4 }) }
}
