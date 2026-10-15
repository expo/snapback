//! Predicted writes on the device against the server's committed outcome.
//!
//! The client admits every mutation through the device (`local.ts`,
//! `admission.ts::mutationEntry`): `admit` predicts it when the device can,
//! queues it, and refuses it outright when the prediction reaches a definite
//! refusal. That refusal is final: `local.ts` reports it as the write's failed
//! outcome and never sends the write (only `E_PREDICT`, a missing fact,
//! queues without a row). The contract therefore promises:
//!
//! - **refused**: a device admission refusal equals the server's refusal of
//!   the same write (the complete refusal envelope);
//! - **predicted**: a predicted write commits on the server, and the device's
//!   pending row image equals the committed image (the `observe` read's
//!   data; its meter is not compared, because reads over provisional rows
//!   charge their authorization to the query meter, guide `prediction`);
//! - **converge** (LLP 3000 §6 invariant 4): after the server's reply is
//!   settled and the stream page carrying the commit is applied, the device
//!   answers `observe` exactly as the server does.
//!
//! A write the client marks unpredictable (some table it touches is not
//! synced) or the device declines (`E_PREDICT`) is counted by that reason,
//! never as a pass.
//!
//! One predicted write may end refused: an insert predicts without proving
//! its supplied id or any other unique-key value absent (guide `prediction`,
//! Refusals), so a row the device does not hold with that value makes the
//! server refuse `E_RULE`. When convergence then holds, that write is the
//! named outcome [`UNHELD_UNIQUE`] ([`refused_over_unheld_unique`] states the
//! exact condition); every other predicted-then-refused write is a
//! disagreement. The stream reply mirrors `sync_wire.rs::StreamReply`;
//! `changes` (the TypeScript client's settlement summary, not a device
//! field) is omitted, and `preserved` comes from
//! `revocation::preserved_between`, as `serve_sync.rs` computes it.
// @ref LLP 3000.035#5.1 — predicted device writes against committed server outcomes.
use crate::{
    ast::{Body, Expr, Key, Stmt, Write},
    campaign::Report,
    devices::{self, Dev, Server},
    execute::Outcome,
    generate::Case,
    oracle::{Oracle, Verdict},
};
use serde_json::{Value as Json, json};
use snapback4_core::{Context, WriteState, wire};
use std::collections::BTreeMap;

pub const WRITE_ID: &str = "w1";

/// A predicted insert whose id or other unique-key value belongs to a row the
/// device does not hold; the server's refusal withdraws it (rulings of
/// 2026-10-08: the supplied id,
/// `issues/closed/20261008-snapback4-device-predicts-insert-over-an-unheld-id.md`,
/// extended to any unique key,
/// `issues/closed/20261008-snapback4-device-predicts-insert-over-a-hidden-secondary-unique-clash.md`).
pub const UNHELD_UNIQUE: &str = "predicted-then-refused-unheld-unique-key";

/// Whether `o`'s data shows the row of `target`: the row itself, or, for a
/// wide `observe` (`[items[key], items[k2]]`), that key's element.
fn holds_row(o: &Outcome, target: &Key) -> bool {
    let Some(data) = o.data() else { return false };
    fn observed_item<'a>(data: &'a Json, target: &Key) -> Option<&'a Json> {
        if let Some(items) = data.get("Array").and_then(Json::as_array) {
            return observed_item(items.get(usize::from(*target == Key::K2))?, target);
        }
        if let Some(item) = data.get("Row").and_then(|row| row.get("item")) {
            return observed_item(item, target);
        }
        Some(data)
    }
    observed_item(data, target).and_then(|d| d.get("Row")).is_some()
}

/// The inserts that can be a program's first write, as `(target, tag)`,
/// when every path's first write is a plain insert that runs before anything
/// else can refuse `E_RULE`: the program `insert` (`key`, `tag`), or a block
/// whose first statement containing a write is a top-level insert, or an
/// `if` both of whose branches begin (at their first write) with one.
/// Statements before it (lets, requires, and `if`s holding no write) cannot
/// refuse `E_RULE`: a failed `require` refuses its own code, and their point
/// reads see null for a hidden row.
pub fn first_inserts(case: &Case) -> Option<Vec<(Key, String)>> {
    fn writes(s: &Stmt) -> bool {
        let mut all = vec![];
        s.walk(&mut all);
        all.iter().any(|s| matches!(s, Stmt::Write { .. }))
    }
    fn first(stmts: &[Stmt]) -> Option<Vec<(Key, String)>> {
        match stmts.iter().find(|s| writes(s))? {
            Stmt::Write { kind: Write::Insert, target, tag, .. } => Some(vec![(target.clone(), tag.clone())]),
            Stmt::If(Expr::Bool(true), then, _) => first(then),
            Stmt::If(Expr::Bool(false), _, otherwise) => first(otherwise),
            Stmt::If(_, then, otherwise) => {
                let mut out = first(then)?;
                out.extend(first(otherwise)?);
                Some(out)
            }
            _ => None,
        }
    }
    match &case.program.body {
        Body::Write(Write::Insert, _) => Some(vec![(Key::Key, "tag".into())]),
        Body::Block(b) => first(&b.stmts),
        _ => None,
    }
}

/// The single row target of [`first_inserts`] (all paths insert the same id).
pub fn first_insert(case: &Case) -> Option<Key> {
    let inserts = first_inserts(case)?;
    let target = inserts[0].0.clone();
    inserts.iter().all(|(t, _)| *t == target).then_some(target)
}

/// The `items` rows as `(id, tag)`: what the clash check searches.
pub type ItemKeys = Vec<(String, String)>;

/// The seeded `items` rows (the server's rows when no prelude ran).
pub fn seeded_items(case: &Case) -> ItemKeys {
    case.rows
        .iter()
        .filter(|(t, _)| t == "items")
        .filter_map(|(_, r)| Some((r["id"].as_str()?.to_owned(), r["tag"].as_str().unwrap_or_default().to_owned())))
        .collect()
}

/// The server's physical `items` rows, read from its store (expired and
/// hidden rows included): every row carrying a `tag` field, which only
/// `items` has. Harness-only; the engine is not asked.
pub fn server_items(server: &Server) -> Result<ItemKeys, String> {
    let conn = server.engine.store().conn();
    let mut statement = conn.prepare("SELECT id, data FROM r").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, data)| {
            let value: snapback4_core::Value = serde_json::from_str(&data).ok()?;
            let tag = value.field("tag").ok()?.as_str().ok()?.to_owned();
            Some((id, tag))
        })
        .collect())
}

/// The id of the `items` row (from `rows`, the server's rows before the
/// call) that the first insert ([`first_insert`]) clashes with on a unique
/// key: the row with the inserted id, else a row holding the inserted `tag`
/// when `items` declares the unique `byTag`.
pub fn clashing_row(case: &Case, rows: &[(String, String)]) -> Option<String> {
    let target = first_insert(case)?;
    let id = case.args[target.source()].as_str()?;
    let unique_tag = case.program.tables.first().is_some_and(|t| t.keys.iter().any(|(_, cols, unique)| *unique && cols == &["tag".to_string()]));
    // Every possible first insert must clash, so whichever ran was refused
    // for its clash; the id clash is checked first, then the tag.
    let mut clash = None;
    for (_, tag) in first_inserts(case)? {
        let row = rows.iter().find(|(r, _)| r == id).or_else(|| rows.iter().find(|(_, t)| unique_tag && *t == tag))?;
        clash.get_or_insert_with(|| row.0.clone());
        if clash.as_deref() != Some(row.0.as_str()) {
            return None;
        }
    }
    clash
}

/// `observe`'s arguments reading the clashing row (both keys, for a wide one).
pub fn clash_args(case: &Case, row: &str) -> Json {
    let mut args = json!({"key": row});
    if case.program.wide() {
        args["k2"] = json!(row);
    }
    args
}

/// The exact condition of [`UNHELD_UNIQUE`], before convergence (which
/// `compare` also requires): the program's first write is a plain insert
/// ([`first_insert`]); the device admitted it as a prediction of
/// `items/<id>`; the server refused it `E_RULE` without committing; a row the
/// server held before the call (`rows`) clashes with it on the id or on the
/// unique `tag` ([`clashing_row`]);
/// and neither the server's answer to the viewer nor the device's answer
/// before admission (`server_view`, `device_view`: `observe` of that row)
/// shows the clashing row.
pub fn refused_over_unheld_unique(case: &Case, rows: &[(String, String)], admitted: &Json, committed: &Outcome, server_view: &Outcome, device_view: &Outcome) -> bool {
    let Some(target) = first_insert(case) else { return false };
    let Some(key) = case.args[target.source()].as_str() else { return false };
    let refusal = committed.value.get("why").or_else(|| committed.value.get("refusal"));
    admitted["ok"]["predictable"] == json!(true)
        && admitted["ok"]["predicted"].as_array().is_some_and(|p| p.contains(&json!(format!("items/{key}"))))
        && committed.value.get("seq").is_none_or(Json::is_null)
        && refusal.is_some_and(|r| r["code"] == "E_RULE")
        && clashing_row(case, rows).is_some()
        && !holds_row(server_view, &Key::Key)
        && !holds_row(device_view, &Key::Key)
}

fn ids() -> Vec<String> {
    (0..8).map(|i| format!("minted-{i}")).collect()
}

fn mutate(server: &mut Server, case: &Case) -> (Outcome, Option<u64>) {
    let program = server.engine.programs().find(|p| p.name == "run").unwrap().clone();
    let args: BTreeMap<_, _> = program
        .args
        .iter()
        .map(|(n, t)| (n.clone(), wire::from_json(t, case.args.get(n).unwrap_or(&Json::Null)).unwrap()))
        .collect();
    let context = Context::new(&case.principal, args).at(case.clock).with_ids(ids()).with_wire_args(case.args.clone());
    match server.engine.mutate("run", Some(WRITE_ID), context) {
        Ok(v) => {
            let seq = match &v.state {
                WriteState::Sent { seq, .. } => Some(*seq),
                WriteState::Failed { .. } => None,
            };
            let receipt_only = v.receipt_only;
            let mut value = serde_json::to_value(v).unwrap();
            value["receipt_only"] = json!(receipt_only);
            (Outcome { kind: "mutation".into(), value }, seq)
        }
        Err(e) => (Outcome { kind: "mutation".into(), value: json!({"refusal": snapback4_core::Refusal::from(e)}) }, None),
    }
}

fn observe(server: &mut Server, dev: &mut dyn Dev, case: &Case) -> (Outcome, devices::DeviceAnswer) {
    let args = devices::observe_args(case);
    server.engine.set_ceilings(snapback4_core::Ceilings::default());
    let s = crate::execute::execute(&mut server.engine, case, "observe", &args);
    let program = "observe";
    let online = server.online(program);
    let d = devices::device_answer_online(dev, case, program, &args, online);
    (s, d)
}

fn finding(store: &str, phase: &str, f: &str, s: Outcome, d: Outcome, trail: &(Vec<Outcome>, Vec<Outcome>)) -> Verdict {
    let oracle = Oracle::Device { store: store.into(), phase: phase.into(), ceiling: 0 };
    devices::trace(&oracle, &format!("{phase}-{f}"), &trail.0, &trail.1, s, d)
}

/// Returns the prediction verdict and the convergence verdict.
pub fn compare(store: &str, server: &mut Server, dev: &mut dyn Dev, case: &Case, report: &mut Report) -> Result<[(String, Verdict); 2], String> {
    let backend: Json = serde_json::from_str(&server.backend).unwrap();
    let synced = |t: &String| backend["schema"]["tables"][t]["sync"].is_object();
    let predictable = devices::operation_tables(&backend, "run").iter().all(synced);
    let entry = json!({"id": WRITE_ID, "seq": 1, "op": "run", "args": case.args, "viewer": case.principal, "now": case.clock,
        "new_ids": ids(), "predictable": predictable, "predicted": [], "replay_candidate": false});
    let observed = devices::observe_args(case);
    let device_before = devices::device_answer_online(dev, case, "observe", &observed, server.online("observe")).outcome;
    report.executed += 1;
    // The row a first insert would clash with, as the viewer sees it on the
    // device before admission (and on the server after the call).
    let rows = server_items(server)?;
    let clash = clashing_row(case, &rows);
    let device_clash = clash.as_ref().map(|row| devices::device_answer_online(dev, case, "observe", &clash_args(case, row), server.online("observe")).outcome);
    let admitted = dev.call_text(&json!({"op": "admit", "entry": entry}).to_string());
    let (_, pending_device) = observe(server, dev, case);
    let (committed, seq) = mutate(server, case);
    report.executed += 2;
    let (after_server, _) = {
        let args = devices::observe_args(case);
        (crate::execute::execute(&mut server.engine, case, "observe", &args), ())
    };
    let admission = Outcome { kind: "admission".into(), value: admitted.clone() };
    // Server records left, device records right.
    let trail = (vec![committed.clone(), after_server.clone()], vec![admission.clone(), pending_device.outcome.clone()]);
    let kind = match &case.program.body {
        crate::ast::Body::Write(w, _) => format!("{w:?}").to_lowercase(),
        crate::ast::Body::Block(_) => "block".into(),
        _ => unreachable!(),
    };
    let mut unheld = false;
    let (class, prediction) = if let Some(denied) = admitted.get("denied") {
        // Definite device refusal: final for the client. The server must refuse identically.
        let server_refusal = committed.value.get("why").or_else(|| committed.value.get("refusal")).cloned();
        let v = if server_refusal.as_ref() != Some(denied) {
            finding(store, "write", "refused", committed.clone(), admission.clone(), &trail)
        } else {
            Verdict::Pass
        };
        (format!("refused-{}", denied["code"].as_str().unwrap_or("?")), v)
    } else if admitted["ok"]["predictable"] == json!(true) {
        let v = if seq.is_none() {
            if let (Some(row), Some(device_view)) = (&clash, &device_clash) {
                server.engine.set_ceilings(snapback4_core::Ceilings::default());
                let server_view = crate::execute::execute(&mut server.engine, case, "observe", &clash_args(case, row));
                unheld = refused_over_unheld_unique(case, &rows, &admitted, &committed, &server_view, device_view);
            }
            finding(store, "write", "predicted-refused", committed.clone(), admission.clone(), &trail)
        } else if !matches!(pending_device.class.as_str(), "complete" | "refused") {
            Verdict::Unsupported(format!("pending-observe-{}", pending_device.class))
        } else {
            // The pending answer is the client's published answer: its data
            // (less the pending marker) or its refusal equals the committed one.
            let pending = strip_pending(pending_device.outcome.data());
            if after_server.data() != pending.as_ref() {
                finding(store, "write", "pending-data", after_server.clone(), pending_device.outcome.clone(), &trail)
            } else if after_server.refusal() != pending_device.outcome.refusal() {
                finding(store, "write", "pending-refusal", after_server.clone(), pending_device.outcome.clone(), &trail)
            } else {
                Verdict::Pass
            }
        };
        ("predicted".to_owned(), v)
    } else if !predictable {
        ("unpredictable-unsynced-table".to_owned(), Verdict::Unsupported("unpredictable-unsynced-table".into()))
    } else {
        ("prediction-declined".to_owned(), Verdict::Unsupported("prediction-declined".into()))
    };
    *report.store_stats.entry(format!("device-{store}-write-{kind}-{class}")).or_default() += 1;
    // Settle and apply the stream page, as the client does after the /m reply.
    let mut convergence_trail = trail.clone();
    if admitted.get("ok").is_some() {
        let mut settle = json!({"op": "settle", "id": WRITE_ID, "store_id": server.store_id});
        if let Some(seq) = seq {
            settle["seq"] = json!(seq);
        }
        let settled = dev.call_text(&settle.to_string());
        if settled.get("denied").is_some() {
            return Err(format!("settle refused: {settled}"));
        }
    }
    let pages = devices::sync_round(dev, server, &case.principal, devices::page_limit(case.seed), case.clock)?;
    let (s, d) = observe(server, dev, case);
    report.executed += 2;
    convergence_trail.1.extend(pages.into_iter().map(|value| Outcome { kind: "sync-page".into(), value }));
    convergence_trail.0.push(s.clone());
    convergence_trail.1.push(d.outcome.clone());
    *report.store_stats.entry(format!("device-{store}-converge-{}", d.class)).or_default() += 1;
    let converge = if matches!(d.class.as_str(), "complete" | "refused") {
        let (a, b) = devices::comparable_pub(&s, &d.outcome);
        match devices::field_pub(&a, &b) {
            Some(f) => finding(store, "converge", &f, s, d.outcome, &convergence_trail),
            None => Verdict::Pass,
        }
    } else {
        Verdict::Unsupported(format!("converge-observe-{}", d.class))
    };
    // The named exception holds only when the withdrawn prediction converged.
    let prediction = if unheld && matches!(converge, Verdict::Pass) { Verdict::Named(UNHELD_UNIQUE.into()) } else { prediction };
    Ok([("write".into(), prediction), ("converge".into(), converge)])
}

/// The device-only `pending: true` field a predicted row image carries
/// (guide `prediction`), in a row or in each row of an array. Only that
/// field, only with that value, is removed.
fn strip_pending(data: Option<&Json>) -> Option<Json> {
    fn strip(data: &mut Json) {
        if let Some(row) = data.get_mut("Row").and_then(Json::as_object_mut) {
            if row.get("pending") == Some(&json!({"Bool": true})) {
                row.remove("pending");
            }
            // A referential `observe` returns `{ item, kids }` (LLP 3000.039 §9).
            if row.contains_key("item") && row.contains_key("kids") { row.values_mut().for_each(strip); }
        }
        // A wide `observe` returns `[items[key], items[k2]]`.
        if let Some(items) = data.get_mut("Array").and_then(Json::as_array_mut) {
            items.iter_mut().for_each(strip);
        }
    }
    let mut data = data?.clone();
    strip(&mut data);
    Some(data)
}
