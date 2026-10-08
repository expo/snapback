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
//! One predicted write may end refused: an insert whose row id the caller
//! supplies predicts without proving that id absent (guide `prediction`,
//! Refusals), so a row the device does not hold with that id makes the
//! server refuse `E_RULE`. When convergence then holds, that write is the
//! named outcome [`UNHELD_ID`] ([`refused_over_unheld_id`] states the exact
//! condition); every other predicted-then-refused write is a disagreement. The stream reply mirrors `sync_wire.rs::StreamReply`;
//! `changes` (the TypeScript client's settlement summary, not a device
//! field) is omitted, and `preserved` comes from
//! `revocation::preserved_between`, as `serve_sync.rs` computes it.
// @ref LLP 3000.035#5.1 — predicted device writes against committed server outcomes.
use crate::{
    ast::{Body, Write},
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

/// A predicted insert over a caller-supplied id that a row the device does
/// not hold already has; the server's refusal withdraws it (ruling of
/// 2026-10-08, `issues/closed/20261008-snapback4-device-predicts-insert-over-an-unheld-id.md`).
pub const UNHELD_ID: &str = "predicted-then-refused-unheld-id";

fn holds_row(o: &Outcome) -> bool {
    o.data().and_then(|d| d.get("Row")).is_some()
}

/// The exact condition of [`UNHELD_ID`], before convergence (which
/// `compare` also requires): the program is an insert (the generator's
/// inserts take their row id from the `key` argument), the device admitted
/// it as a prediction of `items/<key>`, the server refused it `E_RULE`, the
/// server held an `items` row with that id before the call, and neither the
/// server's answer to the viewer nor the device's answer before admission
/// shows that row.
pub fn refused_over_unheld_id(case: &Case, admitted: &Json, committed: &Outcome, server_view: &Outcome, device_before: &Outcome) -> bool {
    let Some(key) = case.args["key"].as_str() else { return false };
    let refusal = committed.value.get("why").or_else(|| committed.value.get("refusal"));
    matches!(case.program.body, Body::Write(Write::Insert, _))
        && admitted["ok"]["predictable"] == json!(true)
        && admitted["ok"]["predicted"].as_array().is_some_and(|p| p.contains(&json!(format!("items/{key}"))))
        && committed.value.get("seq").is_none_or(Json::is_null)
        && refusal.is_some_and(|r| r["code"] == "E_RULE")
        && case.rows.iter().any(|(t, row)| t == "items" && row["id"] == json!(key))
        && !holds_row(server_view)
        && !holds_row(device_before)
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
    let args = json!({"key": case.args["key"]});
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
    let observed = json!({"key": case.args["key"]});
    let device_before = devices::device_answer_online(dev, case, "observe", &observed, server.online("observe")).outcome;
    report.executed += 1;
    let admitted = dev.call_text(&json!({"op": "admit", "entry": entry}).to_string());
    let (_, pending_device) = observe(server, dev, case);
    let (committed, seq) = mutate(server, case);
    report.executed += 2;
    let (after_server, _) = {
        let args = json!({"key": case.args["key"]});
        (crate::execute::execute(&mut server.engine, case, "observe", &args), ())
    };
    let admission = Outcome { kind: "admission".into(), value: admitted.clone() };
    // Server records left, device records right.
    let trail = (vec![committed.clone(), after_server.clone()], vec![admission.clone(), pending_device.outcome.clone()]);
    let kind = match &case.program.body {
        crate::ast::Body::Write(w, _) => format!("{w:?}").to_lowercase(),
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
            unheld = refused_over_unheld_id(case, &admitted, &committed, &after_server, &device_before);
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
    let prediction = if unheld && matches!(converge, Verdict::Pass) { Verdict::Named(UNHELD_ID.into()) } else { prediction };
    Ok([("write".into(), prediction), ("converge".into(), converge)])
}

/// The device-only `pending: true` field a predicted row image carries
/// (guide `prediction`). Only that field, only with that value, is removed.
fn strip_pending(data: Option<&Json>) -> Option<Json> {
    let mut data = data?.clone();
    if let Some(row) = data.get_mut("Row").and_then(Json::as_object_mut) {
        if row.get("pending") == Some(&json!({"Bool": true})) {
            row.remove("pending");
        }
    }
    Some(data)
}
