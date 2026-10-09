//! Server against device (LLP 3000.035 §5.1, oracle 4).
//!
//! **Acquisition.** A device reaches its state the way the client reaches it,
//! never by writing rows into a device store. The backend is the `/schema`
//! reply (`Schema::public_projection` plus `emit::backend_programs`, the
//! two calls `crates/snapback4/src/serve.rs` makes), sent as JSON text and
//! decoded by the device's codec. The rows are the `/sync` snapshot pages that
//! `crates/snapback4/src/serve_sync.rs` builds:
//! `Engine::snapshot_acquisition_page_at` plus `Engine::acknowledged`,
//! encoded with the field names, omissions and event form of
//! `crates/snapback4/src/sync_wire.rs::SnapshotReply` (that type is private to
//! the binary crate, so it is mirrored here and pinned by a test). Each page
//! goes through the host's text entry `call::call_text` as
//! `{"op":"apply","page":…,"first":…}` with `stage_snapshot` set, exactly as
//! `packages/snapback4/src/local.ts` sends it; the page limit varies by seed
//! so multi-page snapshots and the staged-publication path are exercised.
//! The same principal, clock (`now` on every page and every read) and
//! generation (the engine's) are used on both sides. Both device stores run
//! every case: the native SQLite store at a file path (`Device::open`, what
//! the Expo and Exact2 hosts open) and the memory store the web build uses.
//!
//! **Reads.** The device answers through `Device::query_with_components`,
//! the same evaluation `call`'s `query` performs (components observed,
//! no search, no spent allowance), so the complete `QueryOutcome` is
//! available, including its meter. The device's answer is classified by
//! the client's own rules (`packages/snapback4/src/local-query.ts`): a
//! refusal with `unknown` false, and a non-`unavailable` outcome with
//! `unknown` false and `complete` true, are answers the client publishes
//! without asking the server. Those two classes are compared with the
//! server's outcome. Every other read is counted under a named reason and is
//! never a pass. Cursors are followed on both sides; each continuation page
//! the device reports complete is compared too.
//!
//! **Compared fields.** Everything in the outcome record compares exactly,
//! including all seven meter fields, with these argued exceptions (the raw
//! records are kept in every finding's trace):
//!
//! - `seq`: the server reports its store sequence at the read. The device
//!   interpreter always reports 0 (`engine/local.rs::observe_query`); its
//!   position is the watermark the host tracks outside the outcome, and the
//!   client takes `seq` only from server replies. Not a semantic field of a
//!   device read.
//! - `delivery`, `delivery_meter`: server-only manifests of the sqlite
//!   feature; the device interpreter never sets them. Compared to be absent
//!   on the device, and removed from the server record only when present.
//!
//! **Server budget.** The device has no ceiling input: `device.rs` runs every
//! query at `Ceilings::default()`, and so does a production server, which
//! never calls `set_ceilings`. The default phase therefore runs both at the
//! default ceilings, not the case's stored budget.
//!
//! **Low ceilings.** A device read can only receive a smaller allowance
//! through `call`'s `spent` (the prepaid ledger the search coordinator
//! resumes, `Meter::resume`). Spending `default - n` of one dimension leaves
//! exactly `n` of it: `Meter::charge` cuts when `used > ceiling`, so a charge
//! sequence cuts at the same charge as on a fresh meter with ceiling `n`. The
//! reply then reports `metered` including the spent amount, which is
//! subtracted before comparing, and its refusal messages quote the shifted
//! totals; refusals compare by code, family and site, with the message kept
//! raw. That reply publishes `cut` (meter or words) rather than `capped_at`.
//! Boundaries are discovered on the server (as the store oracle does) and
//! replayed on both device stores.
// @ref LLP 3000.035#5.1 — oracle 4: the server against a device that acquired the same rows.
use crate::{
    campaign::Report,
    execute::{self, Outcome},
    generate::Case,
    oracle::{self, Finding, Oracle, Verdict},
};
use serde_json::{Value as Json, json};
use snapback4_core::{Ceilings, Engine, Metered, Refusal, QueryOutcome};
use snapback4_device::{call, device::Device, memory::MemoryStore, store::DeviceStore};
use std::{collections::BTreeSet, path::PathBuf};

pub const STORES: [&str; 2] = ["sqlite", "memory"];

/// One device session: the store, its device and the raw pages it applied.
pub trait Dev {
    fn call_text(&mut self, request: &str) -> Json;
    fn read(&mut self, name: &str, viewer: &str, args: &Json, now: i64) -> (Result<QueryOutcome, Refusal>, bool, bool);
}
impl<S: DeviceStore> Dev for Device<S> {
    fn call_text(&mut self, request: &str) -> Json {
        call::call_text(self, request)
    }
    fn read(&mut self, name: &str, viewer: &str, args: &Json, now: i64) -> (Result<QueryOutcome, Refusal>, bool, bool) {
        let (result, unknown, retained, _) = self.query_with_components(name, viewer, args, now);
        (result, unknown, retained)
    }
}

/// `backend.ts::operationTables`, over the `/schema` reply.
pub fn operation_tables(backend: &Json, op: &str) -> std::collections::BTreeSet<String> {
    fn walk(value: &Json, out: &mut std::collections::BTreeSet<String>) {
        match value {
            Json::Object(fields) => {
                for (key, child) in fields {
                    if key == "table" && child.is_string() {
                        out.insert(child.as_str().unwrap().to_owned());
                    } else {
                        walk(child, out);
                    }
                }
            }
            Json::Array(items) => items.iter().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let mut tables = std::collections::BTreeSet::new();
    let Some(program) = backend["programs"].as_array().and_then(|p| p.iter().find(|p| p["name"] == op)) else { return tables };
    walk(&program["body"], &mut tables);
    for table in program["settlement"]["reads"].as_object().into_iter().flat_map(|o| o.keys()) {
        tables.insert(table.clone());
    }
    for table in tables.clone() {
        walk(&backend["schema"]["tables"][&table]["rules"], &mut tables);
    }
    tables
}

/// A directory for native device files, removed on drop.
pub struct Files {
    dir: PathBuf,
    next: u64,
}
impl Files {
    pub fn new() -> Result<Self, String> {
        static OPENED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = OPENED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("quarry-device-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(Self { dir, next: 0 })
    }
    fn path(&mut self) -> PathBuf {
        self.next += 1;
        let path = self.dir.join(format!("d{}.sqlite", self.next));
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
        path
    }
}
impl Drop for Files {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The server and the `/schema` reply a device adopts.
pub struct Server {
    pub engine: Engine,
    pub backend: String,
    pub store_id: String,
}
impl Server {
    /// Whether `op` touches a table the device does not hold (no `sync`).
    pub fn online(&self, op: &str) -> bool {
        let backend: Json = serde_json::from_str(&self.backend).unwrap();
        operation_tables(&backend, op).iter().any(|t| !backend["schema"]["tables"][t]["sync"].is_object())
    }
}
pub fn server(case: &Case, source: &str) -> Result<Server, String> {
    let bound = execute::compile(source).map_err(|e| format!("binder: {e}"))?;
    // The prelude runs after the device acquires (`bring_up`).
    let mut engine = execute::seeded(case, source)?;
    engine.set_ceilings(Ceilings::default());
    let backend = json!({
        "generation": engine.generation(),
        "schema": bound.schema.public_projection(),
        "programs": snapback4_lang::emit::backend_programs(&bound),
    })
    .to_string();
    let store_id = engine.store().meta("store_id").map_err(|e| e.to_string())?.ok_or("no store id")?;
    Ok(Server { engine, backend, store_id })
}

/// The `/sync` snapshot reply (`sync_wire.rs::SnapshotReply`), as JSON.
pub fn snapshot_reply(server: &mut Server, principal: &str, after: Option<&str>, limit: usize, now: i64, pending: &[String]) -> Result<Json, String> {
    let page = server.engine.snapshot_acquisition_page_at(principal, after, limit, now).map_err(|e| format!("snapshot: {e}"))?;
    let acknowledged = server.engine.acknowledged(principal, pending, page.watermark).map_err(|e| e.to_string())?;
    let next = page.next.map(|n| n.encode());
    let events: Vec<Json> = page
        .events
        .iter()
        .map(|e| json!({"data": e.data.as_ref().map(snapback4_core::wire::Plain), "id": e.id, "kind": e.kind.word(), "table": e.table}))
        .collect();
    let mut reply = json!({
        "acknowledged": acknowledged, "after": after, "events": events, "generation": server.engine.generation(),
        "held": page.held, "more": next.is_some(), "next": next, "now": now, "snapshot": true,
        "store_id": server.store_id, "watermark": page.watermark,
    });
    if !page.acquisitions.is_empty() {
        reply["acquisitions"] = serde_json::to_value(&page.acquisitions).unwrap();
    }
    // `sent` is the acknowledged map, omitted when empty.
    if !acknowledged.is_empty() {
        reply["sent"] = reply["acknowledged"].clone();
    }
    Ok(reply)
}

/// The `/sync` stream reply (`sync_wire.rs::StreamReply`) from `from`, as
/// `serve_sync.rs` builds it. `changes` is the TypeScript client's
/// settlement summary (no device field reads it) and is omitted.
pub fn stream_reply(server: &mut Server, principal: &str, from: u64, limit: usize, now: i64, pending: &[String]) -> Result<Json, String> {
    let e = &mut server.engine;
    let page = e.stream_at(principal, from, limit, now).map_err(|e| format!("stream: {e}"))?;
    let images_at = page.images_at.unwrap_or(page.watermark);
    let (acknowledged, committed_above) = e.acknowledged_at(principal, pending, page.watermark, images_at).map_err(|e| e.to_string())?;
    let preserved = snapback4_core::revocation::preserved_between(e.store().conn(), e.schema(), from, images_at);
    let sent: std::collections::BTreeMap<_, _> = acknowledged.iter().chain(committed_above.iter()).map(|(k, v)| (k.clone(), *v)).collect();
    let events: Vec<Json> = page
        .events
        .iter()
        .map(|ev| json!({"data": ev.data.as_ref().map(snapback4_core::wire::Plain), "id": ev.id, "kind": ev.kind, "seq": ev.seq, "table": ev.table}))
        .collect();
    let mut reply = json!({"acknowledged": acknowledged, "events": events, "generation": e.generation(), "joined": page.joined,
        "more": page.more, "now": now, "snapshot": false, "store_id": server.store_id, "watermark": page.watermark});
    if !page.acquisitions.is_empty() {
        reply["acquisitions"] = serde_json::to_value(&page.acquisitions).unwrap();
    }
    if !committed_above.is_empty() {
        reply["committed_above"] = json!(committed_above);
    }
    if let Some(at) = page.images_at {
        reply["images_at"] = json!(at);
    }
    if !preserved.is_empty() {
        reply["preserved"] = json!(preserved);
    }
    if !sent.is_empty() {
        reply["sent"] = json!(sent);
    }
    Ok(reply)
}

/// One sync round of `local.ts::syncRound`: capture `sync_state`, request a
/// snapshot or stream page, echo the captured fields onto it, `observe_store`,
/// then `apply`; snapshot pages continue with `after`, a finished snapshot
/// catches up by stream, and the round ends on a published final page.
/// Returns every raw page applied.
pub fn sync_round(dev: &mut dyn Dev, server: &mut Server, principal: &str, limit: usize, now: i64) -> Result<Vec<Json>, String> {
    let mut after: Option<String> = None;
    let mut catching_up = false;
    let mut outstanding = false;
    let mut pages = Vec::new();
    for _ in 0..256 {
        let captured = dev.call_text(r#"{"op":"sync_state"}"#);
        let st = captured.get("ok").ok_or_else(|| format!("sync_state refused: {captured}"))?.clone();
        let captured_watermark = st["watermark"].as_u64().unwrap_or(0);
        let snapshot_request = after.is_some();
        let watermark = if snapshot_request { 0 } else { st["transfer_watermark"].as_u64().unwrap_or(captured_watermark) };
        catching_up = !snapshot_request && st["snapshot_catchup"].as_bool().unwrap_or(catching_up);
        outstanding |= watermark > captured_watermark;
        let stream = !snapshot_request && (catching_up || (after.is_none() && outstanding));
        let pending: Vec<String> = serde_json::from_value(st["pending_ids"].clone()).unwrap_or_default();
        let mut page = if watermark == 0 && !stream {
            snapshot_reply(server, principal, after.as_deref(), limit, now, &pending)?
        } else {
            stream_reply(server, principal, watermark, limit, now, &pending)?
        };
        for field in ["send_revision", "pending_through", "pending_complete", "pending_bound"] {
            page[field] = st[field].clone();
        }
        page["requested_watermark"] = json!(watermark);
        page["captured_restore_watermark"] = st.get("restore_watermark").cloned().unwrap_or(Json::Null);
        page["captured_restore_images_at"] = st.get("restore_images_at").cloned().unwrap_or(Json::Null);
        page["captured_watermark"] = json!(captured_watermark);
        let observed = dev.call_text(&json!({"op": "observe_store", "page": page}).to_string());
        let observation = observed.get("ok").ok_or_else(|| format!("observe_store refused: {observed}"))?;
        if observation["reset"] == json!(true) {
            return Err(format!("observe_store reset a fresh store: {observed}"));
        }
        page["send_revision"] = observation["send_revision"].clone();
        page["stage_snapshot"] = json!(page["snapshot"] == json!(true));
        page["snapshot_catchup"] = json!(catching_up);
        let applied = dev.call_text(&json!({"op": "apply", "page": page, "first": !catching_up && after.is_none()}).to_string());
        let ok = applied.get("ok").ok_or_else(|| format!("apply refused: {applied}"))?;
        let published = ok["published"] != json!(false);
        outstanding = !published;
        if published {
            let read = dev.call_text(r#"{"op":"sync_state","capture":false}"#);
            if read.get("denied").is_some() {
                return Err(format!("sync_state refused: {read}"));
            }
        }
        let snapshot = page["snapshot"] == json!(true);
        let more = page["more"] == json!(true);
        let next = page["next"].as_str().map(str::to_owned);
        pages.push(page);
        if snapshot && more && next.is_some() {
            after = next;
            continue;
        }
        after = None;
        if snapshot {
            catching_up = true;
            continue;
        }
        if !more && published {
            return Ok(pages);
        }
    }
    Err("sync round did not finish in 256 pages".into())
}

/// The first sync round of a fresh device; it must end acquired.
pub fn acquire(dev: &mut dyn Dev, server: &mut Server, principal: &str, limit: usize, now: i64) -> Result<Vec<Json>, String> {
    let pages = sync_round(dev, server, principal, limit, now)?;
    let state = dev.call_text(r#"{"op":"sync_state","capture":false}"#);
    if state["ok"]["acquired"] != json!(true) {
        return Err(format!("device not acquired after the first sync round: {state}"));
    }
    Ok(pages)
}

pub fn open(kind: &str, files: &mut Files, backend: &str) -> Result<Box<dyn Dev>, String> {
    let backend = snapback4_core::json_codec::from_text(backend).map_err(|e| format!("backend decode: {e}"))?;
    Ok(match kind {
        "sqlite" => Box::new(Device::open(&files.path(), Some(backend)).map_err(|e| format!("open sqlite device: {e}"))?),
        "memory" => Box::new(Device::open_store(MemoryStore::new(), Some(backend)).map_err(|e| format!("open memory device: {e}"))?),
        _ => unreachable!(),
    })
}

/// A fresh device of `store` that acquired the seeded rows at the seed
/// clock. When the case has a prelude or its clock advances, the server then
/// runs the prelude (sweeps included) and the device catches up with one
/// more sync round at `clock`, the way a client that stayed connected does.
/// Returns the device and every page it applied.
pub fn bring_up(case: &Case, store: &str, files: &mut Files, server: &mut Server) -> Result<(Box<dyn Dev>, Vec<Json>), String> {
    let mut dev = open(store, files, &server.backend)?;
    let mut pages = acquire(dev.as_mut(), server, &case.principal, page_limit(case.seed), execute::seed_clock(case))?;
    if !case.steps.is_empty() || case.sweep || case.seeded_at.is_some() {
        execute::prelude(&mut server.engine, case);
        server.engine.set_ceilings(Ceilings::default());
        pages.extend(sync_round(dev.as_mut(), server, &case.principal, page_limit(case.seed), case.clock)?);
    }
    Ok((dev, pages))
}

/// `observe`'s arguments: `key`, and `k2` for a wide program.
pub fn observe_args(case: &Case) -> Json {
    let mut args = json!({"key": case.args["key"]});
    if case.program.wide() {
        args["k2"] = case.args["k2"].clone();
    }
    args
}

/// Snapshot page limits: one row per page, small pages and one page.
pub fn page_limit(seed: u64) -> usize {
    [1, 2, 5, 1000][(seed % 4) as usize]
}

fn server_record(o: &QueryOutcome) -> Json {
    serde_json::to_value(o).unwrap()
}

/// The device's answer, its record, and the reason it is or is not compared.
pub struct DeviceAnswer {
    pub outcome: Outcome,
    pub class: String,
}
pub fn device_answer(dev: &mut dyn Dev, case: &Case, args: &Json) -> DeviceAnswer {
    device_answer_named(dev, case, "run", args)
}
pub fn device_answer_named(dev: &mut dyn Dev, case: &Case, name: &str, args: &Json) -> DeviceAnswer {
    device_answer_online(dev, case, name, args, false)
}
/// `online`: the program touches a table with no sync clause, so the
/// device holds none of its rows; its unknown or unavailable answers are
/// named `online-only-*` (residency), not acquisition gaps.
pub fn device_answer_online(dev: &mut dyn Dev, case: &Case, name: &str, args: &Json, online: bool) -> DeviceAnswer {
    let mut answer = device_answer_raw(dev, case, name, args);
    if online && !matches!(answer.class.as_str(), "complete" | "refused") {
        answer.class = format!("online-only-{}", answer.class);
    }
    answer
}
fn device_answer_raw(dev: &mut dyn Dev, case: &Case, name: &str, args: &Json) -> DeviceAnswer {
    let (result, unknown, retained) = dev.read(name, &case.principal, args, case.clock);
    let (value, class) = match result {
        Ok(o) => {
            let class = if o.unavailable {
                "unavailable".to_owned()
            } else if unknown {
                if o.complete { "unknown-complete" } else { "unknown-incomplete" }.to_owned()
            } else if o.complete {
                "complete".to_owned()
            } else if retained {
                "retained-incomplete".to_owned()
            } else {
                format!("incomplete-{}", o.cut.as_ref().map(|c| serde_json::to_value(c).unwrap().as_str().unwrap_or("cut").to_owned()).unwrap_or_else(|| "uncut".into()))
            };
            (server_record(&o), class)
        }
        Err(r) => {
            let class = if unknown { format!("unknown-refusal-{}", r.code) } else { "refused".to_owned() };
            (json!({"refusal": r}), class)
        }
    };
    let mut value = value;
    value["unknown"] = json!(unknown);
    value["retained"] = json!(retained);
    DeviceAnswer { outcome: Outcome { kind: "query".into(), value }, class }
}

/// Apply the argued correspondence; both raw records stay in the finding.
pub fn comparable_pub(server: &Outcome, device: &Outcome) -> (Outcome, Outcome) {
    let mut s = server.clone();
    let mut d = device.clone();
    for o in [&mut s, &mut d] {
        if let Some(v) = o.value.as_object_mut() {
            v.remove("seq");
            v.remove("unknown");
            v.remove("retained");
        }
    }
    if d.value.get("delivery").is_none() && d.value.get("delivery_meter").is_none() {
        if let Some(v) = s.value.as_object_mut() {
            v.remove("delivery");
            v.remove("delivery_meter");
        }
    }
    (s, d)
}

/// Signature field: the first differing field; meter differences name their dimension.
pub fn field_pub(server: &Outcome, device: &Outcome) -> Option<String> {
    let f = oracle::field(server, device, false)?;
    if f == "metered" {
        for d in oracle::DIMENSIONS {
            if server.value["metered"][d] != device.value["metered"][d] {
                return Some(format!("metered-{d}"));
            }
        }
    }
    Some(f)
}

/// A device finding. Its signature ends in a stable class of the device's
/// side (a refusal code, `loading`, `data` or `admitted`), never in a
/// column name, so the same defect keeps one signature across schemas.
/// The server records are `left`, the device records `right`.
pub fn trace(oracle: &Oracle, f: &str, server: &[Outcome], device: &[Outcome], s: Outcome, d: Outcome) -> Verdict {
    let class = device_class(&d);
    let mut v = oracle::disagreement(oracle, f, s, d, vec![]);
    if let Verdict::Disagree(finding) = &mut v {
        finding.signature = format!("{}--{}--{class}", oracle.name(), f.replace('_', "-"));
        finding.store_trace = Some(oracle::StoreTrace { left: server.to_vec(), right: device.to_vec() });
    }
    v
}

pub fn device_class(o: &Outcome) -> String {
    let v = &o.value;
    let refusal = v.get("denied").or_else(|| v.get("refusal")).or_else(|| v.get("why"));
    if let Some(code) = refusal.and_then(|r| r["code"].as_str()) {
        return code.to_owned();
    }
    if v.get("loading") == Some(&json!(true)) || v.get("unavailable") == Some(&json!(true)) {
        return "loading".into();
    }
    if o.kind == "admission" {
        return "admitted".into();
    }
    "data".into()
}

fn server_query(engine: &mut Engine, case: &Case, args: &Json) -> Outcome {
    execute::execute(engine, case, "run", args)
}

/// The default-ceiling comparison: first page and every continuation.
pub fn compare_read(oracle: &Oracle, server: &mut Server, dev: &mut dyn Dev, case: &Case) -> (Verdict, Vec<String>) {
    let online = server.online("run");
    let mut classes = Vec::new();
    let mut s_trail = Vec::new();
    let mut d_trail = Vec::new();
    let mut args = case.args.clone();
    let mut seen = BTreeSet::new();
    loop {
        server.engine.set_ceilings(Ceilings::default());
        let s = server_query(&mut server.engine, case, &args);
        let d = device_answer_online(dev, case, "run", &args, online);
        s_trail.push(s.clone());
        d_trail.push(d.outcome.clone());
        classes.push(d.class.clone());
        if !matches!(d.class.as_str(), "complete" | "refused") {
            // A named reason is never a pass; a later page is not compared either.
            return (Verdict::Unsupported(d.class), classes);
        }
        let (a, b) = comparable_pub(&s, &d.outcome);
        let phase = if s_trail.len() > 1 { "continuation-" } else { "" };
        if let Some(f) = field_pub(&a, &b) {
            return (trace(oracle, &format!("{phase}{f}"), &s_trail, &d_trail, s, d.outcome), classes);
        }
        let Some(next) = s.next().map(str::to_owned) else { break };
        if !seen.insert(next.clone()) || seen.len() > case.rows.len() + 2 {
            return (trace(oracle, "cursor-cycle", &s_trail, &d_trail, s, d.outcome), classes);
        }
        args["c"] = json!(next);
    }
    (Verdict::Pass, classes)
}

fn spent(dimension: &str, n: u64) -> Metered {
    let defaults = serde_json::to_value(Ceilings::default()).unwrap();
    let mut m = serde_json::to_value(Metered::default()).unwrap();
    m[dimension] = json!(defaults[dimension].as_u64().unwrap() - n);
    serde_json::from_value(m).unwrap()
}
pub fn ceilings(dimension: &str, n: u64) -> Ceilings {
    let mut c = serde_json::to_value(Ceilings::default()).unwrap();
    c[dimension] = json!(n);
    serde_json::from_value(c).unwrap()
}

/// The device's `call` reply under a spent allowance, with the spent amount
/// subtracted from its meter. Raw reply kept under `raw`.
fn device_cut(dev: &mut dyn Dev, case: &Case, dimension: &str, n: u64) -> Outcome {
    let spent = spent(dimension, n);
    let request = json!({"op": "query", "name": "run", "viewer": case.principal, "args": case.args, "now": case.clock, "spent": spent});
    let raw = dev.call_text(&request.to_string());
    let mut reply = raw.get("ok").cloned().unwrap_or_else(|| json!({"call_denied": raw["denied"]}));
    if let Some(m) = reply.get_mut("metered") {
        let used = m[dimension].as_u64().unwrap_or(0);
        let paid = serde_json::to_value(spent).unwrap()[dimension].as_u64().unwrap();
        m[dimension] = json!(used.checked_sub(paid).map(Json::from).unwrap_or(json!(format!("below-spent:{used}"))));
    }
    Outcome { kind: "device-call".into(), value: json!({"reply": reply, "raw": raw}) }
}

/// Project the server's query outcome to `call`'s reply fields.
fn server_projection(s: &Outcome) -> Json {
    if let Some(r) = s.value.get("refusal") {
        return json!({"denied": refusal_core(r)});
    }
    let v = &s.value;
    let mut out = json!({"complete": v["complete"], "cut": v["cut"], "tables": v["tables"], "metered": v["metered"],
        "nextExpiry": v.get("next_expiry").cloned().unwrap_or(Json::Null)});
    if v.get("unavailable") == Some(&json!(true)) {
        out["loading"] = json!(true);
    } else {
        out["data"] = snapback4_core::wire::to_json(&serde_json::from_value::<snapback4_core::Value>(v["data"].clone()).unwrap());
        out["next"] = v.get("next").cloned().unwrap_or(Json::Null);
    }
    out
}
fn refusal_core(r: &Json) -> Json {
    json!({"code": r["code"], "family": r["family"], "site": r.get("site").cloned().unwrap_or(Json::Null)})
}
fn device_projection(reply: &Json) -> Json {
    if let Some(r) = reply.get("denied") {
        return json!({"denied": refusal_core(r), "unknown": reply["unknown"]});
    }
    let mut out = json!({"complete": reply["complete"], "cut": reply["cut"], "tables": reply["tables"], "metered": reply["metered"],
        "nextExpiry": reply.get("nextExpiry").cloned().unwrap_or(Json::Null), "unknown": reply["unknown"]});
    if reply.get("loading") == Some(&json!(true)) {
        out["loading"] = json!(true);
    } else {
        out["data"] = reply.get("data").cloned().unwrap_or(Json::Null);
        out["next"] = reply.get("next").cloned().unwrap_or(Json::Null);
    }
    out
}

/// One low-ceiling position: the server at `n` against the device at `n`.
pub fn compare_cut(oracle: &Oracle, server: &mut Server, dev: &mut dyn Dev, case: &Case, dimension: &str, n: u64) -> Verdict {
    server.engine.set_ceilings(ceilings(dimension, n));
    let s = server_query(&mut server.engine, case, &case.args);
    server.engine.set_ceilings(Ceilings::default());
    let d = device_cut(dev, case, dimension, n);
    let mut a = server_projection(&s);
    let b = device_projection(&d.value["reply"]);
    // `unknown` is the device's routing bit; a known cut is the client's answer.
    if b["unknown"] == json!(true) {
        return Verdict::Unsupported(format!("{dimension}-cut-unknown"));
    }
    a["unknown"] = json!(false);
    let left = Outcome { kind: "projection".into(), value: a };
    let right = Outcome { kind: "projection".into(), value: b };
    match field_pub(&left, &right) {
        Some(f) => trace(oracle, &format!("{dimension}-{f}"), &[s], &[d], left, right),
        None => Verdict::Pass,
    }
}

/// The server's boundary positions for one dimension, discovered as the
/// store oracle does: from the uncut ledger, jumping to each exceeded charge.
pub fn boundaries(server: &mut Server, case: &Case, dimension: &str) -> Result<Vec<u64>, String> {
    server.engine.set_ceilings(Ceilings::default());
    let uncut = server_query(&mut server.engine, case, &case.args);
    let total = uncut.meter(dimension).unwrap_or(0);
    let mut out = Vec::new();
    if total == 0 {
        return Ok(out);
    }
    let limit = serde_json::to_value(Ceilings::default()).unwrap()[dimension].as_u64().unwrap();
    let mut n = 0;
    loop {
        out.push(n);
        server.engine.set_ceilings(ceilings(dimension, n));
        let cut = server_query(&mut server.engine, case, &case.args);
        if !cut.cut() {
            break;
        }
        let next = if dimension == "output_bytes" { total } else { cut.meter(dimension).filter(|v| *v > n).unwrap_or(n + 1) };
        if next <= n || next > limit {
            return Err(format!("{dimension}-boundary-search-limit"));
        }
        n = next;
    }
    server.engine.set_ceilings(Ceilings::default());
    Ok(out)
}

pub fn store_oracle(store: &str, phase: &str, ceiling: u64) -> Oracle {
    Oracle::Device { store: store.into(), phase: phase.into(), ceiling }
}

/// One case on both device stores. Writes are compared in `writes.rs`.
pub fn check(case: &Case, report: &mut Report, files: &mut Files, mut found: impl FnMut(Finding)) -> Result<(), String> {
    report.generated += 1;
    for feature in crate::coverage::features(case) {
        *report.coverage.entry(feature).or_default() += 1;
    }
    let source = case.program.source();
    execute::compile(&source).map_err(|e| format!("binder: {e}"))?;
    report.compiled += 1;
    let write = case.program.mutation();
    for store in STORES {
        let mut server = server(case, &source)?;
        let (mut dev, pages) = bring_up(case, store, files, &mut server)?;
        *report.store_stats.entry(format!("device-{store}-snapshot-pages")).or_default() += pages.len() as u64;
        *report.store_stats.entry(format!("device-{store}-snapshot-events")).or_default() +=
            pages.iter().map(|p| p["events"].as_array().map_or(0, Vec::len) as u64).sum::<u64>();
        if write {
            for (phase, verdict) in crate::device_writes::compare(store, &mut server, dev.as_mut(), case, report)? {
                record(report, &format!("device-{store}-{phase}"), &verdict);
                if let Verdict::Disagree(f) = verdict {
                    found(f);
                }
            }
            continue;
        }
        let oracle = store_oracle(store, "read", 0);
        let (verdict, classes) = compare_read(&oracle, &mut server, dev.as_mut(), case);
        report.executed += 2 * classes.len() as u64;
        for class in &classes {
            *report.store_stats.entry(format!("device-{store}-read-{class}")).or_default() += 1;
        }
        let comparable = matches!(verdict, Verdict::Pass | Verdict::Disagree(_));
        record(report, &format!("device-{store}-read"), &verdict);
        if let Verdict::Disagree(f) = verdict {
            found(f);
        }
        if !comparable {
            continue;
        }
        // Low ceilings, only where the default read was compared.
        for dimension in oracle::DIMENSIONS {
            for n in boundaries(&mut server, case, dimension)? {
                let oracle = store_oracle(store, dimension, n);
                let verdict = compare_cut(&oracle, &mut server, dev.as_mut(), case, dimension, n);
                report.executed += 2;
                record(report, &format!("device-{store}-cut"), &verdict);
                report.meter_dimensions.entry(format!("device-{store}-{dimension}")).or_default().record(&verdict);
                if let Verdict::Disagree(f) = verdict {
                    found(f);
                }
            }
        }
    }
    Ok(())
}

fn record(report: &mut Report, name: &str, v: &Verdict) {
    report.by_oracle.entry(name.into()).or_default().record(v);
}

/// Replay one finding: a fresh server and device of the named store.
pub fn reproduce(case: &Case, source: &str, oracle: &Oracle) -> Result<Verdict, String> {
    let Oracle::Device { store, phase, ceiling } = oracle else { return Err("not a device oracle".into()) };
    let mut files = Files::new()?;
    let mut server = server(case, source)?;
    let (mut dev, _) = bring_up(case, store, &mut files, &mut server)?;
    if case.program.mutation() {
        let mut report = Report::default();
        let verdicts = crate::device_writes::compare(store, &mut server, dev.as_mut(), case, &mut report)?;
        return verdicts.into_iter().find(|(p, _)| p == phase).map(|(_, v)| v).ok_or_else(|| format!("no write phase {phase}"));
    }
    Ok(match phase.as_str() {
        "read" => compare_read(oracle, &mut server, dev.as_mut(), case).0,
        d => compare_cut(oracle, &mut server, dev.as_mut(), case, d, *ceiling),
    })
}

pub fn run_bounded(seed: u64, cases: u64, out: &std::path::Path, seconds: Option<f64>) -> Result<Report, String> {
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let started = std::time::Instant::now();
    let mut report = Report { seed, cases, ..Report::default() };
    let mut files = Files::new()?;
    let mut saved = BTreeSet::new();
    let mut failure = None;
    for i in 0..cases {
        if seconds.is_some_and(|limit| started.elapsed().as_secs_f64() >= limit) {
            report.time_limited_workers = 1;
            break;
        }
        let case_started = std::time::Instant::now();
        let case = crate::generate::generate(seed.wrapping_add(i));
        let mut findings = Vec::new();
        if let Err(error) = check(&case, &mut report, &mut files, |f| {
            if saved.insert(f.signature.clone()) {
                findings.push(f);
            }
        }) {
            let path = out.join(format!("setup-{}", case.seed));
            std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            std::fs::write(path.join("case.q"), case.program.source()).map_err(|e| e.to_string())?;
            std::fs::write(path.join("case.json"), serde_json::to_vec_pretty(&case).unwrap()).map_err(|e| e.to_string())?;
            *report.generator_errors.entry(error.clone()).or_default() += 1;
            failure = Some(error);
            break;
        }
        for f in findings {
            let a = crate::shrink::shrink(case.clone(), f);
            crate::shrink::save(&out.join(&a.finding.signature), &a)?;
        }
        let elapsed = case_started.elapsed().as_secs_f64();
        if elapsed > report.slowest_case_seconds {
            report.slowest_case_seconds = elapsed;
            report.slowest_case_seed = Some(case.seed);
        }
        if (i + 1) % 1000 == 0 {
            eprintln!("{} cases in {:.1}s", i + 1, started.elapsed().as_secs_f64());
        }
    }
    report.seconds = started.elapsed().as_secs_f64();
    std::fs::write(out.join("report.json"), serde_json::to_vec_pretty(&report).unwrap()).map_err(|e| e.to_string())?;
    if let Some(error) = failure {
        return Err(error);
    }
    Ok(report)
}
