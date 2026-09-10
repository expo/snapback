//! The `effects` derived check counts witnesses, not probes: for every
//! declared effect, one successful authored witness among the journeys that
//! ran — a real emission, executed by the real engine against a
//! journey-owned provider (the test owner's transport is bound-only, so a
//! `sent` row can have reached nothing else), its declared `then` committed.
//! Missing evidence is `blocked`, naming the effect and the journey it needs.
// @ref LLP 1021#4-test-counts-witnesses — the check manufactures nothing; it aggregates what the framework recorded while the selected journeys ran.

use super::{OwnerInfo, elapsed_ms};
use crate::client;
use crate::project::CompiledProject;
use crate::protocol::Refusal;
use crate::receipt::CheckReceipt;
use serde_json::{Map, Value as Json, json};
use snapback2_core::EffectDecl;
use std::collections::BTreeMap;
use std::time::Instant;

/// The commit-seq window one journey ran in: rows with `since < seq <= until`
/// are its emissions, and the only rows its bindings could have served.
pub(super) struct JourneyWindow {
    pub(super) journey: String,
    pub(super) since: u64,
    pub(super) until: u64,
}

/// Open the journey epoch on the test owner before its runner starts; the
/// reply's `since` is the seq the journey's rows follow.
pub(super) fn open_epoch(owner: &OwnerInfo, epoch: &str) -> Result<u64, Refusal> {
    epoch_call(owner, json!({ "epoch": epoch }), "since")
}

/// Close it after the runner ended — completion, failure, timeout, or death —
/// revoking every binding the journey declared.
pub(super) fn close_epoch(owner: &OwnerInfo) -> Result<u64, Refusal> {
    epoch_call(owner, json!({ "epoch": null }), "until")
}

fn epoch_call(owner: &OwnerInfo, body: Json, field: &str) -> Result<u64, Refusal> {
    let response = client::control(owner, "POST", "/control/effects/epoch", body)?;
    if response.status >= 400 {
        return Err(
            serde_json::from_value(response.body.clone()).unwrap_or_else(|_| {
                Refusal::owner(
                    "E_OWNER_TEST_EPOCH",
                    format!(
                        "journey epoch route answered {}: {}",
                        response.status, response.body
                    ),
                    "rerun snapback2 test",
                )
            }),
        );
    }
    response.body[field].as_u64().ok_or_else(|| {
        Refusal::owner(
            "E_OWNER_TEST_EPOCH",
            format!("journey epoch reply omitted {field}: {}", response.body),
            "rerun snapback2 test",
        )
    })
}

pub(super) fn check_effects(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    windows: &[JourneyWindow],
) -> Option<CheckReceipt> {
    let started = Instant::now();
    let effects = compiled.generation.effects();
    if effects.is_empty() {
        return None;
    }
    let declarations = effects.keys().collect::<Vec<_>>();
    let status = client::control(owner, "GET", "/control/status", json!({}))
        .ok()
        .map(|response| response.body)
        .unwrap_or_else(|| json!({}));
    let engine = status["effects"]["engine"].as_str().unwrap_or("none");
    if engine == "none" {
        return Some(CheckReceipt::blocked(
            "effects",
            "derived",
            elapsed_ms(started),
            json!({
                "reason": "no engine in this build",
                "declarations": declarations,
                "build": engine_build(),
            }),
        ));
    }
    let rows = match outbox_rows(owner) {
        Ok(rows) => rows,
        Err(error) => {
            return Some(CheckReceipt::fail(
                "effects",
                "derived",
                elapsed_ms(started),
                json!({ "error": "the outbox could not be read", "refusal": error }),
            ));
        }
    };
    let evidence = witness_evidence(&rows, windows, effects);
    let mut witnesses = Map::new();
    let mut refused = Map::new();
    let mut missing = Vec::new();
    for (effect, decl) in effects {
        let found = &evidence[effect];
        if !found.refused.is_empty() {
            refused.insert(effect.clone(), Json::Array(found.refused.clone()));
        }
        match &found.witness {
            Some(witness) => {
                let mut witness = witness.clone();
                witness["ms"] = witness_ms(owner, witness["seq"].as_u64());
                witnesses.insert(effect.clone(), witness);
            }
            None => missing.push(json!({
                "effect": effect,
                "needs": journey_needed(effect, decl),
            })),
        }
    }
    let mut detail = json!({
        "engine": engine,
        "declarations": declarations,
        "journeys": windows.iter().map(|window| &window.journey).collect::<Vec<_>>(),
        "witnesses": witnesses,
        "refused": refused,
    });
    if missing.is_empty() {
        Some(CheckReceipt::pass(
            "effects",
            "derived",
            elapsed_ms(started),
            detail,
        ))
    } else {
        detail["reason"] = json!("effects:no-witness");
        detail["missing"] = Json::Array(missing);
        Some(CheckReceipt::blocked(
            "effects",
            "derived",
            elapsed_ms(started),
            detail,
        ))
    }
}

/// What builds an engine here: the repo's Hermes build for a checkout, the
/// engine-bearing binary itself for a package (LLP 1021: the published
/// binary carries the engine, so a packaged owner without one is the binary
/// that should be looked at, not a build to run).
fn engine_build() -> String {
    match std::env::current_exe() {
        Ok(exe) if exe.components().any(|c| c.as_os_str() == "node_modules") => {
            format!(
                "{} should carry the engine; reinstall snapback2",
                exe.display()
            )
        }
        _ => "scripts/hermes build -p snapback2".to_owned(),
    }
}

fn journey_needed(effect: &str, decl: &EffectDecl) -> String {
    let origin = decl
        .grants
        .first()
        .map(String::as_str)
        .unwrap_or("<origin>");
    let then = match &decl.then {
        Some(then) => format!(" and lets {then} commit"),
        None => String::new(),
    };
    format!(
        "a journey that emits {effect} through a real mutation, job, or schedule, binds its provider with effects.provider({origin:?}, handler), and settles it with effects.settle({{ upTo }}){then}"
    )
}

fn outbox_rows(owner: &OwnerInfo) -> Result<Vec<Json>, Refusal> {
    let mut rows = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let path = match &after {
            Some(after) => format!(
                "/control/outbox?limit=200&after={}",
                super::percent_encode(after)
            ),
            None => "/control/outbox?limit=200".to_owned(),
        };
        let response = client::control(owner, "GET", &path, json!({}))?;
        if response.status >= 400 {
            return Err(
                serde_json::from_value(response.body.clone()).unwrap_or_else(|_| {
                    Refusal::owner(
                        "E_OWNER_TEST_OUTBOX",
                        format!(
                            "outbox page answered {}: {}",
                            response.status, response.body
                        ),
                        "rerun snapback2 test",
                    )
                }),
            );
        }
        rows.extend(
            response.body["rows"]
                .as_array()
                .cloned()
                .unwrap_or_default(),
        );
        after = response.body["after"].as_str().map(str::to_owned);
        if after.is_none() {
            break;
        }
    }
    Ok(rows)
}

/// The claim-to-settlement time the runner logged on the row's
/// `running → then_pending | sent` line, read from its transition history.
fn witness_ms(owner: &OwnerInfo, seq: Option<u64>) -> Json {
    let Some(seq) = seq else { return Json::Null };
    client::control(
        owner,
        "GET",
        &format!("/control/trace?seq={seq}"),
        json!({}),
    )
    .ok()
    .and_then(|response| {
        response.body["outbox"]["history"]
            .as_array()?
            .iter()
            .map(|line| &line["outbox"])
            .find(|line| {
                line["from"] == "running"
                    && matches!(line["to"].as_str(), Some("then_pending" | "sent"))
            })
            .map(|line| line["ms"].clone())
    })
    .unwrap_or(Json::Null)
}

#[derive(Default)]
struct Evidence {
    witness: Option<Json>,
    refused: Vec<Json>,
}

const REFUSED_CAP: usize = 20;

/// Per declared effect: the lowest-seq successful witness among the rows the
/// journeys emitted, and the refusals those rows met — negative evidence a
/// journey may have asked for, which substitutes for no witness.
fn witness_evidence(
    rows: &[Json],
    windows: &[JourneyWindow],
    effects: &BTreeMap<String, EffectDecl>,
) -> BTreeMap<String, Evidence> {
    let mut evidence = effects
        .keys()
        .map(|effect| (effect.clone(), Evidence::default()))
        .collect::<BTreeMap<_, _>>();
    for row in rows {
        let Some(effect) = row["effect"].as_str() else {
            continue;
        };
        let Some(decl) = effects.get(effect) else {
            continue;
        };
        let Some(seq) = row["seq"].as_u64() else {
            continue;
        };
        let Some(window) = windows
            .iter()
            .find(|window| window.since < seq && seq <= window.until)
        else {
            continue;
        };
        let found = evidence.get_mut(effect).expect("declared effect");
        let then = match &decl.then {
            None => json!({ "declared": false }),
            Some(_) => row["then"].clone(),
        };
        let committed = decl.then.is_none() || then["state"] == "committed";
        match row["state"].as_str() {
            Some("sent") if committed => {
                let witness = json!({
                    "journey": window.journey,
                    "id": row["id"],
                    "seq": seq,
                    "attempts": row["attempts"],
                    "state": "sent",
                    "then": then,
                });
                if found
                    .witness
                    .as_ref()
                    .is_none_or(|current| current["seq"].as_u64() > Some(seq))
                {
                    found.witness = Some(witness);
                }
            }
            Some("sent") | Some("failed") if found.refused.len() < REFUSED_CAP => {
                found.refused.push(json!({
                    "journey": window.journey,
                    "id": row["id"],
                    "seq": seq,
                    "state": row["state"],
                    "lastError": row["lastError"],
                    "then": then,
                }));
            }
            _ => {}
        }
    }
    evidence
}

#[cfg(test)]
mod tests {
    use super::*;

    fn declared(then: Option<&str>) -> BTreeMap<String, EffectDecl> {
        BTreeMap::from([(
            "delivery.notify".to_owned(),
            EffectDecl {
                name: "delivery.notify".to_owned(),
                grants: vec!["https://api.example.com".to_owned()],
                source: "async () => null".to_owned(),
                then: then.map(str::to_owned),
            },
        )])
    }

    fn window(journey: &str, since: u64, until: u64) -> JourneyWindow {
        JourneyWindow {
            journey: journey.to_owned(),
            since,
            until,
        }
    }

    fn row(id: &str, seq: u64, state: &str, then: Json) -> Json {
        let mut row = json!({ "id": id, "seq": seq, "effect": "delivery.notify", "state": state, "attempts": 1, "lastError": null });
        if !then.is_null() {
            row["then"] = then;
        }
        row
    }

    #[test]
    fn the_witness_is_the_lowest_sent_row_inside_a_journey_window_with_its_then_committed() {
        let effects = declared(Some("notifications.recordNotified"));
        let committed =
            json!({ "op": "notifications.recordNotified", "state": "committed", "seq": 9 });
        let rows = vec![
            // A derived check's row: outside every window, never a witness.
            row("derived", 1, "sent", committed.clone()),
            row(
                "rejected",
                4,
                "sent",
                json!({ "op": "notifications.recordNotified", "state": "rejected", "code": "E_RULE" }),
            ),
            row("late", 7, "sent", committed.clone()),
            row("first", 5, "sent", committed.clone()),
            row("pending", 6, "then_pending", Json::Null),
        ];
        let windows = [window("a", 2, 3), window("b", 3, 8)];
        let evidence = witness_evidence(&rows, &windows, &effects);
        let found = &evidence["delivery.notify"];
        let witness = found.witness.as_ref().unwrap();
        assert_eq!(witness["id"], "first");
        assert_eq!(witness["journey"], "b");
        assert_eq!(witness["then"], committed);
        assert_eq!(found.refused.len(), 1);
        assert_eq!(found.refused[0]["id"], "rejected");
    }

    #[test]
    fn refusals_are_negative_evidence_only_and_an_effect_without_then_records_it() {
        let with_then = declared(Some("notifications.recordNotified"));
        let rows = vec![
            json!({ "id": "unbound", "seq": 3, "effect": "delivery.notify", "state": "failed", "attempts": 1,
                "lastError": "Error: E_EFFECT_UNBOUND: no journey provider is bound for https://api.example.com" }),
            json!({ "id": "denied", "seq": 4, "effect": "delivery.notify", "state": "failed", "attempts": 1,
                "lastError": "denied: net.fetch https://other.example.com; declare https://other.example.com" }),
        ];
        let windows = [window("refusals", 2, 5)];
        let evidence = witness_evidence(&rows, &windows, &with_then);
        let found = &evidence["delivery.notify"];
        assert!(found.witness.is_none());
        assert_eq!(found.refused.len(), 2);
        assert!(
            found.refused[0]["lastError"]
                .as_str()
                .unwrap()
                .contains("E_EFFECT_UNBOUND")
        );

        let without_then = declared(None);
        let rows = vec![row("plain", 3, "sent", Json::Null)];
        let evidence = witness_evidence(&rows, &windows, &without_then);
        let witness = evidence["delivery.notify"].witness.as_ref().unwrap();
        assert_eq!(witness["then"], json!({ "declared": false }));

        let needs = journey_needed("delivery.notify", &with_then["delivery.notify"]);
        assert!(
            needs.contains("effects.provider(\"https://api.example.com\", handler)"),
            "{needs}"
        );
        assert!(
            needs.contains("lets notifications.recordNotified commit"),
            "{needs}"
        );
    }
}
