//! Loopback-only control-plane routes.
// @ref LLP 1002#4-the-wire — control requests require the owner secret.

use crate::project::certify_project_value;
use crate::protocol::Refusal;
use crate::serve::Query;
use crate::writer::{Action, Identity, OwnerHandle};
use serde_json::{Value as Json, json};
use snapback2_core::MigrationPlan;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct Context {
    pub handle: OwnerHandle,
    pub root: PathBuf,
}

pub fn route(
    method: &str,
    path: &str,
    query: &Query,
    body: Json,
    context: &Context,
) -> Option<Result<Json, (u16, Refusal)>> {
    let call = |action| context.handle.call(action).map_err(|error| (400, error));
    if method == "POST"
        && let Some(id) = path.strip_prefix("/control/outbox/")
        && let Some(id) = id.strip_suffix("/requeue")
    {
        if id.is_empty() || id.contains('/') {
            return Some(Err((
                400,
                Refusal::input(
                    "outbox requeue requires one row id",
                    "POST /control/outbox/<id>/requeue",
                ),
            )));
        }
        return Some(call(Action::OutboxRequeue { id: id.to_owned() }));
    }
    let result = match (method, path) {
        ("GET", "/control/status") => call(Action::Status),
        ("POST", "/control/apply") => {
            let project = body.get("project").cloned().unwrap_or(Json::Null);
            match certify_project_value(project) {
                Ok(compiled) => {
                    let generation = compiled.generation.hash.clone();
                    let result = call(Action::Apply {
                        compiled,
                        migration: None,
                        seed: None,
                    });
                    if result.is_ok() {
                        crate::watch::update_owner_generation(&context.root, &generation);
                    }
                    result
                }
                Err(errors) => Err((400, first(errors))),
            }
        }
        ("POST", "/control/migrate") => {
            let project = body.get("project").cloned().unwrap_or(Json::Null);
            let plan: Result<MigrationPlan, _> =
                serde_json::from_value(body.get("plan").cloned().unwrap_or(Json::Null));
            match (certify_project_value(project), plan) {
                (Ok(compiled), Ok(plan)) => {
                    let generation = compiled.generation.hash.clone();
                    let result = call(Action::Apply {
                        compiled,
                        migration: Some(plan),
                        seed: None,
                    });
                    if result.is_ok() {
                        crate::watch::update_owner_generation(&context.root, &generation);
                    }
                    result
                }
                (Err(errors), _) => Err((400, first(errors))),
                (_, Err(error)) => Err((
                    400,
                    Refusal::input(
                        format!("invalid migration plan: {error}"),
                        "pass the plan from .snapback/migration-<generation>.json",
                    ),
                )),
            }
        }
        ("POST", "/control/reset") => call(Action::Reset),
        ("POST", "/control/fork") => {
            let name = body.get("name").and_then(Json::as_str).unwrap_or_default();
            if valid_name(name) {
                call(Action::Fork {
                    path: context
                        .root
                        .join(".snapback/forks")
                        .join(format!("{name}.sqlite")),
                })
            } else {
                Err((
                    400,
                    Refusal::input(
                        "fork name must contain only letters, numbers, dash, and underscore",
                        "pass snapback2 fork <safe-name>",
                    ),
                ))
            }
        }
        ("GET", "/control/logs") => {
            let since = query.u64("since").unwrap_or(0);
            let limit = query.usize("limit").unwrap_or(100).min(500);
            match call(Action::Commits { since, limit }) {
                Ok(commits) => Ok(json!({
                    "lines": log_lines(&context.root.join(".snapback/log.jsonl"), limit),
                    "commits": commits,
                })),
                Err(error) => Err(error),
            }
        }
        ("GET", "/control/personas") => call(Action::Personas),
        ("POST", "/control/persona") => call(Action::Persona {
            name: body
                .get("name")
                .and_then(Json::as_str)
                .unwrap_or_default()
                .to_owned(),
        }),
        ("POST", "/control/why") => call(Action::Why {
            op: body
                .get("op")
                .and_then(Json::as_str)
                .unwrap_or_default()
                .to_owned(),
            args: body.get("args").cloned().unwrap_or_else(|| json!({})),
            identity: Identity::Persona(
                body.get("as")
                    .and_then(Json::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            ),
        }),
        ("GET", "/control/trace") => call(Action::Trace {
            seq: query.u64("seq"),
        }),
        ("GET", "/control/subscriptions") => call(Action::Subscriptions),
        ("POST", "/control/clock") => call(Action::Clock {
            advance_ms: body.get("advanceMs").and_then(Json::as_i64).unwrap_or(0),
        }),
        ("POST", "/control/data") => call(Action::Data {
            table: body
                .get("table")
                .and_then(Json::as_str)
                .unwrap_or_default()
                .to_owned(),
            index: body
                .get("index")
                .and_then(Json::as_str)
                .unwrap_or("byId")
                .to_owned(),
            prefix: body.get("prefix").cloned().unwrap_or_else(|| json!([])),
            limit: body.get("limit").and_then(Json::as_u64).unwrap_or(50) as u32,
            identity: Identity::Persona(
                body.get("as")
                    .and_then(Json::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            ),
        }),
        ("POST", "/control/verdicts") => {
            let table = body
                .get("table")
                .and_then(Json::as_str)
                .unwrap_or_default()
                .to_owned();
            let persona = body
                .get("as")
                .and_then(Json::as_str)
                .unwrap_or_default()
                .to_owned();
            call(Action::RuleVerdicts(
                table,
                Identity::Persona(persona.clone()),
            ))
        }
        ("POST", "/control/stop") => call(Action::Stop {
            cause: body
                .get("cause")
                .and_then(Json::as_str)
                .unwrap_or("requested")
                .to_owned(),
        }),
        _ => return None,
    };
    Some(result)
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn log_lines(path: &Path, limit: usize) -> Vec<Json> {
    let text = fs::read_to_string(path).unwrap_or_default();
    let mut lines: Vec<_> = text
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    if lines.len() > limit {
        lines.drain(..lines.len() - limit);
    }
    lines
}

fn first(errors: Vec<Refusal>) -> Refusal {
    Refusal::from_refusals(
        errors,
        Refusal::owner(
            "E_OWNER_COMPILER_PROTOCOL",
            "project certification failed without a refusal",
            "rerun snapback2 check",
        ),
    )
}
