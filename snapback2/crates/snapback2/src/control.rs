//! Loopback-only control-plane routes.
// @ref LLP 1002#4-the-wire — control requests require the owner secret.

use crate::project::{SharedCompiler, certify_project_value};
use crate::protocol::Refusal;
use crate::serve::Query;
use crate::writer::{Action, Identity, OwnerHandle};
use serde_json::{Value as Json, json};
use snapback2_core::MigrationPlan;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const MAX_LOG_TAIL_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct Context {
    pub handle: OwnerHandle,
    pub root: PathBuf,
    pub compiler: SharedCompiler,
}

pub fn route(
    method: &str,
    path: &str,
    query: &Query,
    mut body: Json,
    context: &Context,
) -> Option<Result<Json, (u16, Refusal)>> {
    // These purpose-specific routes are themselves the operator seat. The HTTP
    // transport has already admitted the loopback secret; no persona is created.
    if method == "POST"
        && matches!(path, "/control/run" | "/control/job")
        && body.get("as").is_none()
        && let Some(object) = body.as_object_mut()
    {
        object.insert("as".into(), json!("system"));
    }
    if let Some(result) = crate::control_run::route(method, path, &body, context) {
        return Some(result);
    }
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
        return Some(
            context
                .handle
                .call(Action::OutboxRequeue { id: id.to_owned() })
                .map_err(|error| {
                    let status = if error.code == "E_EFFECT_NOT_FOUND" {
                        404
                    } else {
                        400
                    };
                    (status, error)
                }),
        );
    }
    if let Some(rest) = path.strip_prefix("/control/job/") {
        let (id, operation) = rest.split_once('/').unwrap_or((rest, ""));
        if !id.is_empty() && !operation.contains('/') {
            return Some(match (method, operation) {
                ("GET", "") => call(Action::Job {
                    id: id.into(),
                    after: query.u64("after").unwrap_or(0),
                }),
                ("POST", "cancel" | "resume") => call(Action::JobControl {
                    id: id.into(),
                    resume: operation == "resume",
                    identity: control_identity(&body),
                }),
                _ => Err((
                    400,
                    Refusal::input(
                        "invalid job route",
                        "GET /control/job/<id> or POST /cancel or /resume",
                    ),
                )),
            });
        }
    }
    let result = match (method, path) {
        ("GET", "/control/jobs") => call(Action::Jobs),
        ("POST", "/control/job") => match crate::control_run::flag(&body, "plan") {
            Ok(plan) => call(Action::EnqueueJob {
                name: body
                    .get("name")
                    .or_else(|| body.get("op"))
                    .and_then(Json::as_str)
                    .unwrap_or_default()
                    .into(),
                args: body.get("args").cloned().unwrap_or_else(|| json!({})),
                identity: control_identity(&body),
                plan,
            }),
            Err(error) => Err((400, error)),
        },
        ("GET", "/control/status") => call(Action::Status),
        ("POST", "/control/execute") => call(Action::Execute {
            op: body
                .get("op")
                .and_then(Json::as_str)
                .unwrap_or_default()
                .to_owned(),
            args: body.get("args").cloned().unwrap_or_else(|| json!({})),
            identity: control_identity(&body),
            expected: None,
            offline: Default::default(),
            replay: None,
        }),
        ("POST", "/control/apply") => {
            let project = body.get("project").cloned().unwrap_or(Json::Null);
            match certify_project_value(project) {
                Ok(compiled) => call(Action::Apply {
                    compiled,
                    migration: None,
                    seed: None,
                    cache: None,
                }),
                Err(errors) => Err((400, first(errors))),
            }
        }
        ("POST", "/control/migrate") => {
            let project = body.get("project").cloned().unwrap_or(Json::Null);
            let plan: Result<MigrationPlan, _> =
                serde_json::from_value(body.get("plan").cloned().unwrap_or(Json::Null));
            match (certify_project_value(project), plan) {
                (Ok(compiled), Ok(plan)) => call(Action::Apply {
                    compiled,
                    migration: Some(plan),
                    seed: None,
                    cache: None,
                }),
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
                        "POST /control/fork with a safe name in the JSON body",
                    ),
                ))
            }
        }
        ("GET", "/control/logs") => {
            let since = query.u64("since").unwrap_or(0);
            let limit = query.usize("limit").unwrap_or(100).min(500);
            match (
                call(Action::Commits { since, limit }),
                log_lines(&context.root.join(".snapback/log.jsonl"), limit),
            ) {
                (Ok(commits), Ok(lines)) => Ok(json!({ "lines": lines, "commits": commits })),
                (Err(error), _) => Err(error),
                (_, Err(error)) => Err((500, error)),
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
            query_only: body
                .get("queryOnly")
                .and_then(Json::as_bool)
                .unwrap_or(false),
            identity: control_identity(&body),
        }),
        ("GET", "/control/trace") => call(Action::Trace {
            seq: query.u64("seq"),
        }),
        ("GET", "/control/subscriptions") => call(Action::Subscriptions),
        ("POST", "/control/clock") => call(Action::Clock {
            advance_ms: body.get("advanceMs").and_then(Json::as_i64).unwrap_or(0),
        }),
        ("POST", "/control/data") => {
            let limit = body.get("limit").and_then(Json::as_u64).unwrap_or(50);
            if !(1..=500).contains(&limit) {
                Err((
                    400,
                    Refusal::new(
                        "E_ARGS_LIMIT",
                        "args",
                        format!("data limit must be between 1 and 500, got {limit}"),
                        "pass --limit 1..500",
                        "args/data-limit",
                    ),
                ))
            } else {
                call(Action::Data {
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
                    after: body.get("after").filter(|value| !value.is_null()).cloned(),
                    limit: limit as u32,
                    identity: control_identity(&body),
                })
            }
        }
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
            call(Action::RuleVerdicts(table, Identity::Persona(persona)))
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

// @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — token admission is a later lane; the local dev transport is the only seat today.
pub(crate) fn operator_transport(local: bool, mode: &str) -> Result<(), Refusal> {
    if local && mode == "dev" {
        Ok(())
    } else {
        Err(Refusal::operator_required())
    }
}

pub(crate) fn control_identity(body: &Json) -> Identity {
    let name = body.get("as").and_then(Json::as_str).unwrap_or_default();
    if name == "system" {
        Identity::Operator {
            by: match body.get("by") {
                Some(value) => value.as_str().unwrap_or_default().to_owned(),
                None => default_operator_by(&std::env::var("USER").unwrap_or_default()),
            },
        }
    } else {
        Identity::Persona(name.to_owned())
    }
}

fn default_operator_by(user: &str) -> String {
    let by: String = user
        .chars()
        .take(80)
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect();
    if by.is_empty() || by == "system" {
        "operator".to_owned()
    } else {
        by
    }
}

pub(crate) fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn log_lines(path: &Path, limit: usize) -> Result<Vec<Json>, Refusal> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(log_error(path, error.to_string())),
    };
    let length = file
        .metadata()
        .map_err(|error| log_error(path, error.to_string()))?
        .len();
    let start = length.saturating_sub(MAX_LOG_TAIL_BYTES);
    file.seek(SeekFrom::Start(start))
        .map_err(|error| log_error(path, error.to_string()))?;
    let mut bytes = Vec::with_capacity((length - start) as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| log_error(path, error.to_string()))?;
    if start > 0 {
        let Some(boundary) = bytes.iter().position(|byte| *byte == b'\n') else {
            return Err(log_error(
                path,
                format!("the trailing log record exceeds the {MAX_LOG_TAIL_BYTES}-byte read bound"),
            ));
        };
        bytes.drain(..=boundary);
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|error| log_error(path, format!("log tail is not UTF-8: {error}")))?;
    let candidates = text.lines().rev().take(limit).collect::<Vec<_>>();
    if start > 0 && candidates.len() < limit {
        return Err(Refusal::owner(
            "E_OWNER_LOG_TRUNCATED",
            format!(
                "the requested {limit} log records do not fit in the {MAX_LOG_TAIL_BYTES}-byte read bound"
            ),
            format!(
                "retry snapback2 logs --limit {} or rotate .snapback/log.jsonl",
                candidates.len()
            ),
        ));
    }
    let mut lines = Vec::with_capacity(candidates.len());
    for line in candidates.into_iter().rev() {
        lines.push(
            serde_json::from_str(line)
                .map_err(|error| log_error(path, format!("malformed JSON log record: {error}")))?,
        );
    }
    Ok(lines)
}

fn log_error(path: &Path, message: String) -> Refusal {
    Refusal::owner(
        "E_OWNER_LOG",
        format!("cannot read {}: {message}", path.display()),
        "repair or rotate .snapback/log.jsonl and retry snapback2 logs",
    )
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn default_operator_by_sanitizes_truncates_and_avoids_reserved_names() {
        for (user, expected) in [
            ("alice.smith", "alice-smith"),
            ("é mac/user", "--mac-user"),
            ("Alice_42-ok", "Alice_42-ok"),
            ("", "operator"),
            ("system", "operator"),
        ] {
            let by = default_operator_by(user);
            assert_eq!(by, expected);
            assert!(valid_name(&by));
        }
        assert_eq!(default_operator_by(&"é".repeat(100)), "-".repeat(80));
        assert_eq!(default_operator_by(&"a".repeat(81)), "a".repeat(80));
        for by in ["alice.smith", "", "system", "é"] {
            let Identity::Operator { by: explicit } =
                control_identity(&json!({ "as": "system", "by": by }))
            else {
                panic!("expected operator identity")
            };
            assert_eq!(explicit, by, "explicit attribution must remain untouched");
        }
    }

    #[test]
    fn operator_transport_refuses_remote_and_serve_with_complete_envelope() {
        assert!(operator_transport(true, "dev").is_ok());
        for (local, mode) in [(false, "dev"), (true, "serve"), (false, "serve")] {
            let refusal = operator_transport(local, mode).unwrap_err();
            assert_eq!(refusal.code, "E_OPERATOR_REQUIRED");
            assert_eq!(refusal.family, "operator");
            assert_eq!(refusal.guide, "operator/seat");
            assert_eq!(refusal.site.as_deref(), Some("--as system"));
            assert!(refusal.rewrite.unwrap().contains("admin"));
        }
    }

    #[test]
    fn log_limit_tails_a_sparse_large_file_without_reading_the_hole() {
        let path = std::env::temp_dir().join(format!(
            "snapback2-sparse-log-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let mut file = fs::File::create(&path).unwrap();
        file.set_len(MAX_LOG_TAIL_BYTES * 2).unwrap();
        file.seek(SeekFrom::End(-32)).unwrap();
        file.write_all(b"\n{\"last\":true}\n").unwrap();
        let end = file.stream_position().unwrap();
        file.set_len(end).unwrap();

        assert_eq!(log_lines(&path, 1).unwrap(), vec![json!({ "last": true })]);

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn malformed_log_tail_is_reported() {
        let path = std::env::temp_dir().join(format!(
            "snapback2-malformed-log-{}.jsonl",
            std::process::id()
        ));
        fs::write(&path, b"not json\n").unwrap();
        assert_eq!(log_lines(&path, 1).unwrap_err().code, "E_OWNER_LOG");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn log_limit_refuses_when_the_bounded_tail_cannot_supply_every_requested_record() {
        let path = std::env::temp_dir().join(format!(
            "snapback2-bounded-log-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let mut file = fs::File::create(&path).unwrap();
        let payload = "x".repeat(10_000);
        for index in 0..501 {
            writeln!(file, "{}", json!({ "index": index, "payload": payload })).unwrap();
        }

        let refusal = log_lines(&path, 500).unwrap_err();
        assert_eq!(refusal.code, "E_OWNER_LOG_TRUNCATED");

        fs::remove_file(path).unwrap();
    }
}
