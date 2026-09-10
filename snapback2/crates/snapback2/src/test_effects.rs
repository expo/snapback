//! The `effects` derived check counts witnesses, not probes: for every
//! declared effect, one successful authored witness among the journeys that
//! ran — a real emission, executed by the real engine against a
//! journey-owned provider (at least one substituted request when grants are
//! declared), its declared `then` committed.
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
    let response = checked_control(owner, "POST", "/control/effects/epoch", body)?;
    if response["running"]
        .as_array()
        .is_some_and(|rows| !rows.is_empty())
    {
        return Err(supervisor_refusal(
            format!(
                "epoch close exceeded the effect budget + 1 s; still running: {}",
                response["running"]
            ),
            "/control/effects/epoch",
        )
        .with_detail("running", response["running"].clone()));
    }
    response[field].as_u64().ok_or_else(|| {
        supervisor_refusal(
            format!("journey epoch reply omitted {field}: {response}"),
            "/control/effects/epoch",
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
    let status = checked_control(owner, "GET", "/control/status", json!({})).and_then(|status| {
        if status["effects"]["engine"].is_string() {
            Ok(status)
        } else {
            Err(supervisor_refusal(
                format!("status omitted the effect engine: {status}"),
                "/control/status",
            ))
        }
    });
    let status = match status {
        Ok(status) => status,
        Err(error) => {
            return Some(CheckReceipt::fail(
                "effects",
                "derived",
                elapsed_ms(started),
                json!({"error":"effect engine status could not be read", "refusal":error}),
            ));
        }
    };
    let engine = status["effects"]["engine"].as_str().unwrap();
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
    let rows = match outbox_rows(owner).and_then(|rows| observe_rows(owner, rows)) {
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
    let mut not_witnessed = Map::new();
    let mut unavailable = Map::new();
    let mut missing = Vec::new();
    let mut missing_history = false;
    for (effect, decl) in effects {
        let found = &evidence[effect];
        let history = found.unavailable.values().collect::<Vec<_>>();
        if !history.is_empty() {
            unavailable.insert(effect.clone(), json!(history));
        }
        if !found.not_witnessed.is_empty() {
            not_witnessed.insert(
                effect.clone(),
                json!({"rows":found.not_witnessed,"dropped":found.dropped}),
            );
        }
        match &found.witness {
            Some(witness) => {
                witnesses.insert(effect.clone(), witness.clone());
            }
            None => {
                if history.is_empty() {
                    missing.push(json!({"effect": effect, "needs": journey_needed(effect, decl)}));
                } else {
                    missing_history = true;
                    missing.push(json!({"effect": effect, "history": history}));
                }
            }
        }
    }
    let mut detail = json!({
        "engine": engine,
        "declarations": declarations,
        "journeys": windows.iter().map(|window| &window.journey).collect::<Vec<_>>(),
        "witnesses": witnesses,
        "notWitnessed": not_witnessed,
    });
    if !unavailable.is_empty() {
        detail["history"] = json!(unavailable);
    }
    if missing.is_empty() {
        Some(CheckReceipt::pass(
            "effects",
            "derived",
            elapsed_ms(started),
            detail,
        ))
    } else {
        detail["reason"] = json!(if missing_history {
            "effects:history-unavailable"
        } else {
            "effects:no-witness"
        });
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
    let provider = decl
        .grants
        .first()
        .map(|origin| format!(", binds its provider with effects.provider({origin:?}, handler)"))
        .unwrap_or_default();
    let then = match &decl.then {
        Some(then) => format!(" and lets {then} commit"),
        None => String::new(),
    };
    format!(
        "a journey that emits {effect} through a real mutation, job, or schedule{provider}, and settles it with effects.settle({{ upTo }}){then}"
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
        let response = checked_control(owner, "GET", &path, json!({}))?;
        let page = response["rows"].as_array().ok_or_else(|| {
            supervisor_refusal(format!("outbox page omitted rows: {response}"), &path)
        })?;
        rows.extend(page.iter().cloned());
        after = response["after"].as_str().map(str::to_owned);
        if after.is_none() {
            break;
        }
    }
    Ok(rows)
}

// Read each emission's history once; several effects may share its commit.
fn observe_rows(owner: &OwnerInfo, mut rows: Vec<Json>) -> Result<Vec<Json>, Refusal> {
    let mut histories = BTreeMap::new();
    for row in &mut rows {
        let Some(seq) = row["seq"].as_u64() else {
            continue;
        };
        if let std::collections::btree_map::Entry::Vacant(entry) = histories.entry(seq) {
            let path = format!("/control/trace?seq={seq}");
            let trace = checked_control(owner, "GET", &path, json!({}))?;
            let history = &trace["outbox"]["history"];
            if !history.is_array()
                && !history["unavailable"]
                    .as_str()
                    .is_some_and(|reason| !reason.is_empty())
            {
                return Err(supervisor_refusal(
                    format!("trace returned malformed outbox history: {trace}"),
                    &path,
                ));
            }
            entry.insert(history.clone());
        }
        let history = &histories[&seq];
        if let Some(lines) = history.as_array() {
            attempt_evidence(row, lines);
        } else {
            attempt_evidence(row, &[]);
            row["history"] = history.clone();
        }
    }
    Ok(rows)
}

fn attempt_evidence(row: &mut Json, history: &[Json]) {
    // Requeue resets attempts. Scan from the last claim for this id/attempt,
    // never borrowing a prior authorized run's contact or another row's time.
    let start = history.iter().rposition(|line| {
        let line = &line["outbox"];
        line["id"] == row["id"] && line["to"] == "running" && line["attempt"] == row["attempts"]
    });
    let lines = &history[start.unwrap_or(history.len())..];
    let matches = |line: &&Json| {
        line["outbox"]["id"] == row["id"] && line["outbox"]["attempt"] == row["attempts"]
    };
    let settlement = lines
        .iter()
        .filter(matches)
        .rev()
        .find(|line| line["outbox"]["to"] == row["state"]);
    let provider = settlement.map(|line| line["outbox"]["provider"].clone());
    let ms = lines
        .iter()
        .filter(matches)
        .find(|line| {
            line["outbox"]["from"] == "running"
                && matches!(
                    line["outbox"]["to"].as_str(),
                    Some("then_pending" | "sent" | "failed" | "queued")
                )
        })
        .map(|line| line["outbox"]["ms"].clone())
        .filter(Json::is_number);
    if let Some(provider) = provider.filter(|p| !p.is_null()) {
        row["provider"] = provider;
    }
    row["ms"] = ms.unwrap_or(Json::Null);
    if row["ms"].is_null() {
        row["timing"] = json!("unavailable");
    }
}

fn supervisor_refusal(message: impl Into<String>, site: &str) -> Refusal {
    Refusal::new(
        "E_OWNER_TEST_IO",
        "owner",
        message,
        "rerun snapback2 test",
        "testing",
    )
    .with_site(site)
}

fn checked_control(
    owner: &OwnerInfo,
    method: &str,
    path: &str,
    body: Json,
) -> Result<Json, Refusal> {
    let response = client::control(owner, method, path, body)
        .map_err(|error| supervisor_refusal(format!("{}: {}", error.code, error.message), path))?;
    if response.status >= 400 {
        return Err(supervisor_refusal(
            format!("HTTP {}: {}", response.status, response.body),
            path,
        ));
    }
    Ok(response.body)
}

#[derive(Default)]
struct Evidence {
    witness: Option<Json>,
    not_witnessed: Vec<Json>,
    dropped: usize,
    unavailable: BTreeMap<u64, Json>,
}

const NOT_WITNESSED_CAP: usize = 20;

/// Per declared effect: the lowest-seq successful witness among the rows the
/// journeys emitted, and terminal rows that did not witness — including sent
/// rows without contact, caught refusals, and failed attempts.
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
        if let Some(reason) = row["history"]["unavailable"].as_str() {
            found.unavailable.insert(
                seq,
                json!({
                    "seq": seq, "journey": window.journey, "unavailable": reason,
                }),
            );
        }
        let then = match &decl.then {
            None => json!({ "declared": false }),
            Some(_) => row["then"].clone(),
        };
        let committed = decl.then.is_none() || then["state"] == "committed";
        // Zero refusals is evidence, never an absence of it: a row whose provider
        // evidence is missing (history unavailable) cannot witness, grants or not —
        // a grant-less effect that caught a denial recorded it, and losing the record
        // must not turn that refusal into a witness (review witness-r3-codex).
        let no_refusals = row["provider"]
            .get("refused")
            .is_some_and(|refusals| refusals.as_object().is_some_and(Map::is_empty));
        let provider = if decl.grants.is_empty() {
            json!({"declared":false})
        } else {
            row["provider"].clone()
        };
        let contacted =
            decl.grants.is_empty() || provider["requests"].as_u64().is_some_and(|n| n > 0);
        match row["state"].as_str() {
            Some("sent") if committed && contacted && no_refusals => {
                let mut witness = json!({
                    "journey": window.journey,
                    "id": row["id"],
                    "seq": seq,
                    "attempts": row["attempts"],
                    "state": "sent",
                    "then": then,
                    "provider": provider,
                    "ms": row["ms"],
                });
                if witness["ms"].is_null() {
                    witness["timing"] = json!("unavailable");
                }
                if found
                    .witness
                    .as_ref()
                    .is_none_or(|current| current["seq"].as_u64() > Some(seq))
                {
                    found.witness = Some(witness);
                }
            }
            Some("sent") | Some("failed") => {
                if found.not_witnessed.len() == NOT_WITNESSED_CAP {
                    found.dropped += 1;
                    continue;
                }
                found.not_witnessed.push(json!({
                    "journey": window.journey,
                    "id": row["id"],
                    "seq": seq,
                    "state": row["state"],
                    "lastError": row["lastError"],
                    "provider": row["provider"],
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
        row["provider"] = json!({"origins":["https://api.example.com"],"requests":1,"refused":{}});
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
        assert_eq!(found.not_witnessed.len(), 1);
        assert_eq!(found.not_witnessed[0]["id"], "rejected");
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
        assert_eq!(found.not_witnessed.len(), 2);
        assert!(
            found.not_witnessed[0]["lastError"]
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

    #[test]
    fn timing_and_provider_contact_match_the_outbox_id_and_latest_attempt() {
        let history = vec![
            json!({"outbox":{"id":"slow","attempt":1,"to":"running"}}),
            json!({"outbox":{"id":"slow","attempt":1,"from":"running","to":"sent","ms":900,"provider":{"requests":1}}}),
            json!({"outbox":{"id":"fast","attempt":1,"to":"running"}}),
            json!({"outbox":{"id":"fast","attempt":1,"from":"running","to":"then_pending","ms":7,"provider":{"requests":1}}}),
            json!({"outbox":{"id":"fast","attempt":1,"from":"then_pending","to":"sent","provider":{"requests":1}}}),
        ];
        let mut slow = row("slow", 3, "sent", Json::Null);
        let mut fast = row("fast", 3, "sent", Json::Null);
        attempt_evidence(&mut slow, &history);
        attempt_evidence(&mut fast, &history);
        assert_eq!(slow["ms"], 900);
        assert_eq!(fast["ms"], 7);
        // Operator requeue resets attempts. A later claim with the same number
        // must not reuse the former attempt's settlement or elapsed time.
        let mut requeued = history;
        requeued.push(json!({"outbox":{"id":"fast","attempt":1,"to":"running"}}));
        fast.as_object_mut().unwrap().remove("provider");
        attempt_evidence(&mut fast, &requeued);
        assert_eq!(fast["ms"], Json::Null);
        assert_eq!(fast["timing"], "unavailable");
        assert!(fast["provider"].is_null());
    }

    #[test]
    fn granted_success_without_contact_is_not_a_witness_and_grantless_success_is_explicit() {
        let mut sent = row("none", 3, "sent", Json::Null);
        sent["provider"] = json!({"origins":[],"requests":0,"refused":{"E_EFFECT_UNBOUND":1}});
        let windows = [window("no contact", 2, 4)];
        let effects = declared(None);
        let found = witness_evidence(&[sent.clone()], &windows, &effects);
        assert!(found["delivery.notify"].witness.is_none());
        assert_eq!(found["delivery.notify"].not_witnessed.len(), 1);
        let mut no_grants = effects;
        no_grants.get_mut("delivery.notify").unwrap().grants.clear();
        sent["provider"]["refused"] = json!({});
        let found = witness_evidence(&[sent], &windows, &no_grants);
        let witness = found["delivery.notify"].witness.as_ref().unwrap();
        assert_eq!(witness["provider"], json!({"declared":false}));
        assert_eq!(witness["then"], json!({"declared":false}));
        assert_eq!(witness["timing"], "unavailable");
    }

    #[test]
    fn caught_refusals_never_witness_even_after_contact_or_without_declared_grants() {
        for code in ["E_EFFECT_GRANT", "E_EFFECT_UNBOUND"] {
            for grants in [true, false] {
                let mut effects = declared(None);
                if !grants {
                    effects.get_mut("delivery.notify").unwrap().grants.clear();
                }
                let mut sent = row("caught", 3, "sent", Json::Null);
                sent["provider"]["refused"] = json!({code: 1});
                let found = witness_evidence(&[sent.clone()], &[window("caught", 2, 4)], &effects);
                assert!(found["delivery.notify"].witness.is_none());
                assert_eq!(
                    found["delivery.notify"].not_witnessed[0]["provider"],
                    sent["provider"]
                );
                // Missing evidence (history unavailable) is not zero refusals: no witness either,
                // for a grant-less effect too (review witness-r3-codex B1).
                let mut missing = sent.clone();
                missing.as_object_mut().unwrap().remove("provider");
                let found = witness_evidence(&[missing], &[window("caught", 2, 4)], &effects);
                assert!(found["delivery.notify"].witness.is_none(), "grants={grants}: missing evidence witnessed");
            }
        }
    }

    #[test]
    fn not_witnessed_evidence_reports_every_row_dropped_past_twenty() {
        let rows = (1..=27)
            .map(|i| row(&format!("refused-{i}"), i, "failed", Json::Null))
            .collect::<Vec<_>>();
        let found = witness_evidence(&rows, &[window("refusals", 0, 28)], &declared(None));
        assert_eq!(found["delivery.notify"].not_witnessed.len(), 20);
        assert_eq!(found["delivery.notify"].dropped, 7);
        assert!(found["delivery.notify"].witness.is_none());
    }

    fn effect_project() -> CompiledProject {
        use snapback2_core::{Auth, Ceilings, Generation, ProjectJson, Schema};
        let effects = declared(None).into_values().collect::<Vec<_>>();
        let project = ProjectJson {
            version: 1,
            schema: Schema {
                schedules: vec![],
                tables: BTreeMap::new(),
                maintains: vec![],
                channels: BTreeMap::new(),
                auth: Auth::default(),
                effects: vec!["delivery.notify".into()],
            },
            programs: vec![],
            effects,
            auth: Auth::default(),
        };
        CompiledProject {
            generation: Generation::certify(&project, Ceilings::default()).unwrap(),
            project,
            api_dts: String::new(),
            compiler_ms: 0.0,
            quarry: vec![],
            sources: BTreeMap::new(),
        }
    }

    fn test_owner(port: u16) -> OwnerInfo {
        OwnerInfo {
            pid: 0,
            port,
            url: format!("http://127.0.0.1:{port}"),
            secret: "test".into(),
            generation: String::new(),
            started_at: 0,
            mode: "dev".into(),
            project: std::env::temp_dir(),
        }
    }

    #[test]
    fn unavailable_history_retains_its_reason_instead_of_requesting_another_witness() {
        let receipt = check_with_history(json!({"unavailable":"log exceeds 4194304 bytes"}));
        assert_eq!(receipt.verdict, "blocked", "{}", receipt.detail);
        assert_eq!(receipt.detail["reason"], "effects:history-unavailable");
        assert_eq!(
            receipt.detail["missing"],
            json!([{
                "effect": "delivery.notify",
                "history": [{"seq":3,"journey":"already written","unavailable":"log exceeds 4194304 bytes"}]
            }])
        );
        assert_eq!(
            receipt.detail["history"]["delivery.notify"],
            receipt.detail["missing"][0]["history"]
        );
        assert!(!receipt.detail.to_string().contains("needs"));
    }

    #[test]
    fn malformed_trace_history_fails_instead_of_claiming_a_missing_witness() {
        for history in [
            Json::Null,
            json!({}),
            json!({"unavailable":42}),
            json!({"unavailable":""}),
            json!("broken"),
        ] {
            let receipt = check_with_history(history);
            assert_eq!(receipt.verdict, "fail", "{}", receipt.detail);
            assert_eq!(receipt.detail["refusal"]["code"], "E_OWNER_TEST_IO");
            assert_eq!(receipt.detail["refusal"]["site"], "/control/trace?seq=3");
        }
    }

    fn check_with_history(history: Json) -> CheckReceipt {
        let rows = ["one", "two"].map(|id| {
            json!({
                "id":id,"seq":3,"effect":"delivery.notify","state":"sent","attempts":1
            })
        });
        check_with_rows_and_history(json!(rows), history)
    }

    fn check_with_rows_and_history(rows: Json, history: Json) -> CheckReceipt {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let owner = test_owner(server.server_addr().to_ip().unwrap().port());
        let server = std::thread::spawn(move || {
            // Rows share one trace request, including when unavailable.
            for (path, body) in [
                (
                    "/control/status",
                    json!({"effects":{"engine":"ibex2 + vanilla hermes"}}),
                ),
                (
                    "/control/outbox?limit=200",
                    json!({"rows":rows,"after":null}),
                ),
                (
                    "/control/trace?seq=3",
                    json!({"outbox":{"history":history}}),
                ),
            ] {
                let request = server
                    .recv_timeout(std::time::Duration::from_secs(5))
                    .unwrap()
                    .unwrap();
                assert_eq!(request.url(), path);
                request
                    .respond(tiny_http::Response::from_string(body.to_string()))
                    .unwrap();
            }
        });
        let receipt = check_effects(
            &owner,
            &effect_project(),
            &[window("already written", 2, 4)],
        )
        .unwrap();
        server.join().unwrap();
        receipt
    }

    #[test]
    fn not_witnessed_receipt_names_terminal_non_witnesses_and_preserves_evidence() {
        let mut no_contact = row("no-contact", 3, "sent", Json::Null);
        no_contact["provider"] = json!({"origins":[],"requests":0,"refused":{}});
        let mut caught = row("caught", 3, "sent", Json::Null);
        caught["provider"]["refused"] = json!({"E_EFFECT_UNBOUND":1});
        let mut failed = row("failed", 3, "failed", Json::Null);
        failed["lastError"] = json!("E_EFFECT_UNBOUND: no provider");
        failed["provider"] = json!({"origins":[],"requests":0,"refused":{"E_EFFECT_UNBOUND":1}});
        let rows = [no_contact, caught, failed];
        let history = rows
            .iter()
            .flat_map(|row| {
                [
                    json!({"outbox":{"id":row["id"],"attempt":1,"to":"running"}}),
                    json!({"outbox":{
                        "id":row["id"],"attempt":1,"from":"running","to":row["state"],
                        "ms":1,"provider":row["provider"]
                    }}),
                ]
            })
            .collect::<Vec<_>>();
        let mut stored = rows.clone();
        for row in &mut stored {
            row.as_object_mut().unwrap().remove("provider");
        }
        let receipt = check_with_rows_and_history(json!(stored), json!(history));
        assert_eq!(receipt.verdict, "blocked", "{}", receipt.detail);
        assert_eq!(receipt.detail["reason"], "effects:no-witness");
        assert_eq!(receipt.detail["witnesses"], json!({}));
        assert!(
            receipt.detail.get("refused").is_none(),
            "{}",
            receipt.detail
        );
        let evidence = &receipt.detail["notWitnessed"]["delivery.notify"];
        assert_eq!(evidence["dropped"], 0);
        let retained = evidence["rows"].as_array().unwrap();
        assert_eq!(retained.len(), rows.len());
        for (actual, original) in retained.iter().zip(rows) {
            for field in ["id", "state", "lastError", "provider"] {
                assert_eq!(actual[field], original[field], "{field}: {actual}");
            }
        }
    }

    #[test]
    fn a_failing_control_client_fails_instead_of_claiming_engine_absence() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let owner = test_owner(server.server_addr().to_ip().unwrap().port());
        let server = std::thread::spawn(move || {
            let request = server
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap()
                .unwrap();
            assert_eq!(request.url(), "/control/status");
            request
                .respond(tiny_http::Response::from_string("{}").with_status_code(500))
                .unwrap();
        });
        let receipt = check_effects(&owner, &effect_project(), &[]).unwrap();
        server.join().unwrap();
        assert_eq!(receipt.verdict, "fail");
        assert!(
            !receipt
                .detail
                .to_string()
                .contains("no engine in this build")
        );
        let refusal = &receipt.detail["refusal"];
        assert_eq!(refusal["code"], "E_OWNER_TEST_IO");
        assert_eq!(refusal["site"], "/control/status");
        assert_eq!(refusal["family"], "owner");
        assert_eq!(refusal["guide"], "testing");
        assert_eq!(refusal["rewrite"], "rerun snapback2 test");
        assert!(
            refusal["message"].as_str().unwrap().contains("HTTP 500"),
            "{refusal}"
        );
    }

    #[test]
    fn epoch_close_with_a_running_row_fails_with_the_row_identity() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let owner = test_owner(listener.local_addr().unwrap().port());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            {
                use std::io::BufRead;
                let mut reader = std::io::BufReader::new(&mut socket);
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some((key, value)) = line.split_once(':') {
                        if key.eq_ignore_ascii_case("content-length") {
                            length = value.trim().parse().unwrap();
                        }
                    }
                }
                reader.read_exact(&mut vec![0; length]).unwrap();
            }
            let body = json!({"until":3,"running":[{"id":"held","attempt":1,"state":"running"}]})
                .to_string();
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        let refused = close_epoch(&owner).unwrap_err();
        server.join().unwrap();
        assert_eq!(refused.detail["running"][0]["id"], "held");
        assert!(refused.message.contains("budget + 1 s"));
    }
}
