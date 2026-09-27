//! Publication debt and queue transactions share the device's durable metadata.
// @ref LLP 3000.019#4 — SDK collection replaces screen-mounted delivery reporting.
// @ref LLP 3000.022#3 — candidates qualify only at their publication's final image.
use super::*;
use serde_json::{Value as Json, json};
use snapback4_core::schema::DeliveryBinding;

const VIEWER: &str = "device:delivery-viewer";
const PREFIX: &str = "device:delivery:";
pub(super) const SNAPSHOT_LEFT: &str = "device:snapshot:delivery-left";
const DEFERRED_LEFT: &str = "device:deferred:delivery-left";
#[derive(Default)]
pub(super) struct Candidates {
    pub rows: BTreeSet<(String, String)>,
    pub left: BTreeSet<(String, String)>,
}
impl Candidates {
    pub fn put(&mut self, schema: &Schema, table: &str, id: &str) {
        if schema.delivery.iter().any(|b| b.table == table) { self.rows.insert((table.into(), id.into())); }
    }
    pub fn leave(&mut self, schema: &Schema, table: &str, group: &[Value]) -> Result<(), RuntimeError> {
        if schema.delivery.iter().any(|b| b.table == table) {
            self.left.insert((table.into(), encoded(&group.iter().map(wire::to_json).collect::<Vec<_>>())?));
        }
        Ok(())
    }
}
fn key(viewer: &str) -> String { format!("{PREFIX}{}", snapback4_core::value::digest(&viewer)) }
pub(super) fn clear_current(tx: &dyn crate::store::StreamTx) -> Result<(), RuntimeError> {
    if let Some(viewer) = tx.meta(VIEWER)? { tx.delete_meta(&[&key(&viewer)])?; }
    Ok(())
}
fn empty() -> Json { json!({"serial":0,"groups":{},"retired":{},"cursors":{},"bindings":[]}) }
fn serial(state: &mut Json) -> u64 {
    let n = state["serial"].as_u64().unwrap_or(0) + 1; state["serial"] = json!(n); n
}
// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — propagate codec errors without retaining RuntimeError's full IR Debug graph in wasm.
fn binding_key(binding: &DeliveryBinding) -> Result<String, RuntimeError> { encoded(&(&binding.table, &binding.mutation)) }
fn group_key(binding: &DeliveryBinding, group: &str) -> Result<String, RuntimeError> { encoded(&(&binding.table, &binding.mutation, group)) }
fn load(tx: &dyn crate::store::StreamTx, viewer: &str) -> Result<Json, RuntimeError> {
    tx.meta(&key(viewer))?.map(|v| decoded(&v)).transpose().map(|v| v.unwrap_or_else(empty))
}
fn save(tx: &dyn crate::store::StreamTx, viewer: &str, state: &Json) -> Result<(), RuntimeError> { tx.set_meta(&key(viewer), &encoded(state)?) }
// One B-tree traversal/removal instantiation for the three debt predicates.
fn retain(value: &mut Json, keep: &mut dyn FnMut(&str, &Json) -> bool) {
    value.as_object_mut().unwrap().retain(|key, value| keep(key, value));
}
fn reconcile(state: &mut Json, schema: &Schema) -> Result<(), RuntimeError> {
    let bindings: Json = decoded(&encoded(&schema.delivery)?)?;
    if state["bindings"] == bindings { return Ok(()); }
    let old = state["bindings"].take();
    for binding in old.as_array().into_iter().flatten() {
        if bindings.as_array().is_some_and(|b| b.contains(binding)) { continue; }
        let table = binding["table"].as_str().unwrap_or("");
        let mutation = binding["mutation"].as_str().unwrap_or("");
        retain(&mut state["groups"], &mut |_, group| group["binding"]["table"] != table || group["binding"]["mutation"] != mutation);
        if let Some(cursors) = state["cursors"].as_object_mut() { cursors.remove(&encoded(&(table, mutation))?); }
        retain(&mut state["retired"], &mut |key, _| {
            let parts: Vec<String> = decoded(key).unwrap_or_default();
            parts.first().is_none_or(|v| v != table) || parts.get(1).is_none_or(|v| v != mutation)
        });
    }
    state["bindings"] = bindings;
    if !state["cursors"].is_object() { state["cursors"] = json!({}); }
    Ok(())
}
fn runs(value: &Json) -> Vec<(i64, i64)> {
    value.as_array().into_iter().flatten().filter_map(|v| Some((v[0].as_i64()?, v[1].as_i64()?))).collect()
}
fn covers(value: &Json, n: i64) -> bool { runs(value).iter().any(|&(a,b)| a <= n && n <= b) }
fn add(value: &mut Json, n: i64) {
    let mut all = runs(value); all.push((n,n));
    // The same ascending tuple order and O(n log n) worst-case work, without
    // a separate introsort/smallsort family for these at-most-257 intervals.
    let all = std::collections::BinaryHeap::from(all).into_sorted_vec();
    let mut merged: Vec<(i64,i64)> = Vec::new();
    for (a,b) in all {
        if let Some(last) = merged.last_mut() && a <= last.1.saturating_add(1) { last.1 = last.1.max(b); }
        else { merged.push((a,b)); }
    }
    if merged.len() > 256 { merged.drain(..merged.len()-256); }
    // These are dynamic envelope scalars, not a typed Vec serializer. json!(merged)
    // instantiates serde's owned-tree writer for the entire interval container.
    *value = Json::Array(merged.into_iter().map(|(a,b)| Json::Array(vec![Json::from(a), Json::from(b)])).collect());
}

fn collect(state: &mut Json, binding: &DeliveryBinding, row: &Value, scope: String) -> Result<(), RuntimeError> {
    let group = row.field(&binding.group)?.as_str()?;
    let position = row.field(&binding.position)?.as_int()?;
    // Queue arguments are JavaScript numbers: never round a fetched coordinate
    // into a different, unfetched position at the host boundary.
    if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&position) { return Ok(()); }
    let key = group_key(binding, group)?;
    if state["groups"].get(&key).is_none() {
        if state["groups"].as_object().unwrap().len() >= 4096 {
            let oldest = state["groups"].as_object().unwrap().iter().min_by_key(|(_,v)| v["collected"].as_u64().unwrap_or(0)).map(|(k,_)| k.clone()).unwrap();
            let old = state["groups"].as_object_mut().unwrap().remove(&oldest).unwrap();
            if old["saturated"] == true || !runs(&old["refused"]).is_empty() {
                state["retired"][oldest] = json!({"refused":old["refused"],"saturated":old["saturated"],"scope":old["scope"]});
            }
        }
        let incarnation = serial(state);
        let kept = &state["retired"][&key];
        let refused = kept.get("refused").cloned().unwrap_or(json!([]));
        let saturated = kept["saturated"] == true;
        state["groups"][&key] = json!({"binding":{"table":binding.table,"mutation":binding.mutation,"args":binding.args,"fingerprint":binding.fingerprint},
            "group":group,"incarnation":incarnation,"collected":incarnation,"ready":incarnation,"owed":[],"reported":[],"refused":refused,
            "parked":[],"saturated":saturated,"wake":false,"recent":[],"scope":scope});
    }
    if state["groups"][&key]["saturated"] == true { return Ok(()); }
    let version = serial(state);
    let debt = &mut state["groups"][&key];
    debt["collected"] = json!(version); debt["wake"] = json!(true); debt["scope"] = json!(scope);
    if covers(&debt["reported"], position) || covers(&debt["refused"], position)
        || debt["parked"].as_array().into_iter().flatten().any(|p| p["run"][0].as_i64().is_some_and(|a| a <= position) && p["run"][1].as_i64().is_some_and(|b| b >= position)) { return Ok(()); }
    add(&mut debt["owed"], position); add(&mut debt["recent"], position);
    while debt["owed"].as_array().unwrap().len() + debt["parked"].as_array().unwrap().len() > 256 {
        let parked = debt["parked"].as_array().unwrap().iter().enumerate().min_by_key(|(_,p)| p["run"][0].as_i64()).map(|(i,p)| (i,p["run"][0].as_i64().unwrap()));
        if let Some((i, first)) = parked && debt["owed"][0][0].as_i64().is_none_or(|n| first < n) { debt["parked"].as_array_mut().unwrap().remove(i); }
        else { debt["owed"].as_array_mut().unwrap().remove(0); }
    }
    if let Some(attempt) = debt.get("attempt") {
        let a = attempt["run"][0].as_i64().unwrap_or(0);
        let b = attempt["run"][1].as_i64().unwrap_or(0);
        if !runs(&debt["owed"]).iter().any(|&(x,y)| x <= a && b <= y) {
            debt.as_object_mut().unwrap().remove("attempt");
        }
    }
    Ok(())
}
fn eligible(schema: &Schema, groups: &history::Groups, table: &str, row: &Value, now: i64) -> Result<bool, RuntimeError> {
    Ok(row.field("pending") != Ok(&Value::Bool(true)) && !schema.tables[table].expired(row, now)
        && history::coverage_state(schema, groups, table, history::Coverage::Row(row))? == history::CoverageState::Held)
}
pub(super) fn predicted<T: DeviceTx>(tx: &T, schema: &Schema) -> Result<Candidates, RuntimeError> {
    let mut candidates = Candidates::default();
    if !schema.delivery.is_empty() {
        for (table,id,_) in tx.base_entries()? { candidates.put(schema, &table, &id); }
    }
    Ok(candidates)
}
pub(super) fn publish<T: DeviceTx>(tx: &T, schema: &Schema, candidates: &Candidates, local_now: i64) -> Result<(), RuntimeError> {
    if schema.delivery.is_empty() { return Ok(()); }
    let Some(viewer) = tx.meta(VIEWER)? else { return Ok(()); };
    let mut state = load(tx, &viewer)?; reconcile(&mut state, schema)?;
    let groups = history::load(tx, history::GROUPS)?;
    let mut left = candidates.left.clone();
    for (table, entries) in &groups { for (scope, membership) in entries { if matches!(membership, history::Membership::Left) { left.insert((table.clone(), scope.clone())); } } }
    for (table, scope) in &left {
        let removed: Vec<_> = state["groups"].as_object().unwrap().iter().filter(|(_,g)| g["binding"]["table"] == *table
            && (scope == "[]" || g["scope"] == *scope || encoded(&vec![g["group"].clone()]).ok().as_ref() == Some(scope))).map(|(k,_)| k.clone()).collect();
        for key in removed { state["groups"].as_object_mut().unwrap().remove(&key); state["retired"].as_object_mut().unwrap().remove(&key); }
        retain(&mut state["retired"], &mut |key,kept| {
            let parts: Vec<String> = decoded(key).unwrap_or_default();
            !(parts.first() == Some(table) && (scope == "[]" || kept["scope"] == *scope || parts.get(2).is_some_and(|g| encoded(&vec![g]).ok().as_ref() == Some(scope))))
        });
    }
    let now = expiry_clock::now(tx, local_now.max(tx.meta(ISSUED_FLOOR)?.and_then(|n| n.parse().ok()).unwrap_or(0)))?;
    for (table,id) in &candidates.rows {
        let Some(row) = tx.get(table,id)? else { continue; };
        if !eligible(schema, &groups, table, &row, now)? { continue; }
        for binding in schema.delivery.iter().filter(|b| b.table == *table) {
            collect(&mut state, binding, &row, history::row_key(&schema.tables[table], &row)?)?;
        }
    }
    save(tx, &viewer, &state)
}
pub(super) fn stage_left<T: DeviceTx>(tx: &T, schema: &Schema, page: &StreamPage, snapshot: bool) -> Result<(), RuntimeError> {
    if schema.delivery.is_empty() { return Ok(()); }
    let key = if snapshot { SNAPSHOT_LEFT } else { DEFERRED_LEFT };
    let mut candidates = Candidates::default();
    candidates.left = tx.meta(key)?.map(|v| decoded(&v)).transpose()?.unwrap_or_default();
    for event in &page.events { if event.kind == "scope" {
        candidates.leave(schema, &event.table, &scope_group(&schema.tables[&event.table], event)?)?;
    } }
    tx.set_meta(key, &encoded(&candidates.left)?)
}
pub(super) fn install_left<T: DeviceTx>(tx: &T, candidates: &mut Candidates, snapshot: bool) -> Result<(), RuntimeError> {
    let key = if snapshot { SNAPSHOT_LEFT } else { DEFERRED_LEFT };
    if let Some(value) = tx.meta(key)? { candidates.left.extend(decoded::<BTreeSet<(String,String)>>(&value)?); }
    tx.delete_meta(&[key])
}
impl<S: DeviceStore> Device<S> {
    /// Queue CAS and one bounded activation page. The opaque value is never a query answer.
    pub fn delivery(&mut self, request: &Json) -> Result<Json, RuntimeError> {
        let viewer = request["viewer"].as_str().ok_or_else(|| RuntimeError::Input("delivery needs viewer; pass the signed-in principal".into()))?;
        let tx = self.store.transaction()?;
        let meta = key(viewer);
        if request["action"] == "clear" {
            tx.delete_meta(&[&meta])?; tx.commit()?; return Ok(Json::Null);
        }
        store_identity::require_healthy(&tx)?;
        store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref())?;
        if request["action"] == "write" {
            let previous = tx.meta(&meta)?;
            if previous.as_deref() != request["expected"].as_str() { tx.rollback()?; return Ok(json!(false)); }
            tx.set_meta(&meta, request["value"].as_str().ok_or_else(|| RuntimeError::Input("delivery value must be encoded state".into()))?)?;
            tx.commit()?; return Ok(json!(true));
        }
        tx.set_meta(VIEWER, viewer)?;
        let mut state = load(&tx,viewer)?; reconcile(&mut state, &self.schema)?;
        let mut more = false;
        if request["action"] == "enumerate" {
            let groups = history::load(&tx, history::GROUPS)?;
            let now = expiry_clock::now(&tx, request["now"].as_i64().unwrap_or(0))?;
            for binding in &self.schema.delivery {
                let key = binding_key(binding)?;
                if state["cursors"][&key]["done"] == true { continue; }
                let table = &self.schema.tables[&binding.table];
                let index = table.indexes.iter().find(|(_,index)| index.components.len() == 2 && index.components[0].column() == Some(&binding.group) && index.components[1].column() == Some(&binding.position))
                    .ok_or_else(|| RuntimeError::Schema("delivery needs its unique group, position index".into()))?;
                let after: Option<Vec<Value>> = state["cursors"][&key].get("after").map(|v| decoded(&v.to_string())).transpose()?;
                let reading = history::Reading { tx: &tx, schema: &self.schema, groups, boundaries: boundary::Boundaries::load(&tx,false)?, retained: std::cell::Cell::new(false) };
                let rows = reading.scan(&binding.table, index.0, &[], &Bounds { after, ..Bounds::default() }, Dir::Asc, 500)?;
                for (row,_) in &rows {
                    if eligible(&self.schema, &reading.groups, &binding.table, row, now)? { collect(&mut state,binding,row,history::row_key(table,row)?)?; }
                }
                if let Some((_,key_bytes)) = rows.last() {
                    let values = snapback4_core::key::decode(key_bytes).ok_or_else(|| RuntimeError::Store("invalid delivery index cursor".into()))?;
                    state["cursors"][&key] = json!({"after": decoded::<Json>(&encoded(&values)?)?, "done": rows.len() < 500});
                } else { state["cursors"][&key] = json!({"done":true}); }
                more = true; // Another bounded turn discovers all bindings' done markers.
                break;
            }
        }
        let value = encoded(&state)?;
        tx.set_meta(&meta,&value)?;
        tx.commit()?;
        Ok(json!({"value":value,"more":more}))
    }
}

#[cfg(test)]
#[test]
fn interval_union_matches_round_zero_for_order_gaps_bounds_and_extremes() {
    fn before(value: &Json, n: i64) -> Json {
        let mut all = runs(value); all.push((n,n)); all.sort_unstable();
        let mut merged: Vec<(i64,i64)> = Vec::new();
        for (a,b) in all {
            if let Some(last) = merged.last_mut() && a <= last.1.saturating_add(1) { last.1 = last.1.max(b); }
            else { merged.push((a,b)); }
        }
        if merged.len() > 256 { merged.drain(..merged.len()-256); }
        json!(merged)
    }
    let mut inputs = vec![json!([]), json!([[1,2],[4,5]]), json!([[i64::MIN,i64::MIN],[i64::MAX,i64::MAX]]),
        json!([[8,9],[1,3],[2,4],[8,9],null,[0],"ignored"]),
        json!((0..300).rev().map(|n| (n*3,n*3)).collect::<Vec<_>>())];
    let mut seed = 0x4d59_5df4_d0f3_3173u64;
    for _ in 0..64 {
        let mut intervals = Vec::new();
        for _ in 0..300 {
            seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17;
            let a = (seed % 4000) as i64 - 2000;
            intervals.push((a, a + (seed % 5) as i64));
        }
        inputs.push(json!(intervals));
    }
    for input in inputs {
        for n in [i64::MIN,-2001,-1,0,3,8,899,2001,i64::MAX] {
            let mut actual = input.clone(); add(&mut actual,n);
            assert_eq!(actual, before(&input,n));
        }
    }
}
