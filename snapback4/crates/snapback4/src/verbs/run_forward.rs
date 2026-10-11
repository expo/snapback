//! `run` beside a live `snapback4 dev`. The store belongs to that host, so
//! the invocation goes over its loopback wire as the persona instead of
//! opening a second writer: `POST /q/<op>` or `/m/<op>` with the
//! `x-snapback-persona` header, and `POST /dev/jobs/<job>` for a job.
use serde_json::{Value as Json, json};
use snapback4_core::error::Refusal;
use snapback4_core::ir::ProgramKind;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::time::Duration;

pub(super) struct Call<'a> {
    pub op: &'a str,
    pub kind: ProgramKind,
    pub args: &'a Json,
    /// `--as` as given; `None` means the default persona, alice.
    pub r#as: Option<&'a str>,
    pub personas: &'a [String],
    pub pinned_now: bool,
    pub json: bool,
    /// The project, to name a refusing clause from the dev's evidence.
    pub project: Option<&'a crate::project::Project>,
}

/// The persona header that acts as the same principal a local `run` would use.
fn persona<'a>(call: &Call<'a>) -> Result<Option<&'a str>, String> {
    if call.kind == ProgramKind::Job { return Ok(None); }
    let valid = |name: &str| !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    match call.r#as {
        None => Ok(Some("alice")),
        Some(name) if call.personas.iter().any(|p| p == name) && valid(name) => Ok(Some(name)),
        Some(principal) => match principal.strip_prefix("dev:") {
            Some(name) if valid(name) => Ok(Some(name)),
            _ => Err(format!("--as {principal} is a principal id, and a dev host admits only persona headers (a declared `use personas` name or dev:<name>); other principals need their own bearer session")),
        },
    }
}

fn path(call: &Call) -> String {
    match call.kind {
        ProgramKind::Query => format!("/q/{}", call.op),
        ProgramKind::Job => format!("/dev/jobs/{}", call.op),
        ProgramKind::Action => format!("/a/{}", call.op),
        ProgramKind::Mutation => format!("/m/{}", call.op),
    }
}

fn body(call: &Call) -> String {
    json!({ "args": if call.args.is_object() { call.args.clone() } else { json!({}) } }).to_string()
}

/// The copy-pasteable equivalent of this invocation against a running dev.
pub(super) fn curl(base: &str, call: &Call) -> String {
    let header = match persona(call) {
        Ok(Some(name)) => format!(" -H 'x-snapback-persona: {name}'"),
        Ok(None) => String::new(),
        Err(_) => " -H 'Authorization: Bearer <that principal's session token>'".into(),
    };
    format!("curl -s -X POST {base}{}{header} -H 'Content-Type: application/json' -d '{}'", path(call), body(call).replace('\'', "'\\''"))
}

/// Forward when the busy owner is a reachable dev host. `Ok(code)` once the
/// host answered (whatever it answered); `Err(text)` when nothing was sent,
/// with the refusal and the working alternative to print instead.
pub(super) fn forward(store: &Path, busy: &str, call: &Call) -> Result<i32, String> {
    let store = store.canonicalize().unwrap_or_else(|_| store.to_owned());
    let Some(address) = crate::store_owner::inspector_address(&store) else { return Err(busy.to_owned()) };
    forward_to(address, busy, call, "the store is live under snapback4 dev at")
}

/// `run --port N`: the dev on that loopback port, whichever store it serves
/// (a `dev --fresh` keeps a temporary store no local `run` can open).
pub(super) fn forward_port(port: u16, call: &Call) -> Result<i32, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    forward_to(address, &format!("run --port {port}: nothing was run"), call, "--port: the snapback4 dev at")
}

fn forward_to(address: SocketAddr, busy: &str, call: &Call, lead: &str) -> Result<i32, String> {
    let base = format!("http://{address}");
    let alternative = |why: &str| format!("{busy}\nrun: not forwarded to the live dev at {base}: {why}.\n  to run it now beside dev: {}{}",
        curl(&base, call), if call.kind == ProgramKind::Job { "\n  a scheduled job also fires on `snapback4 clock advance <duration>`" } else { "" });
    if call.kind == ProgramKind::Action { return Err(alternative("an action's result comes from its worker; call it over the wire")); }
    if call.pinned_now { return Err(alternative("--now pins a local clock and a running dev keeps its own; advance it with `snapback4 clock advance <duration>`, or stop dev and run with --now")); }
    let persona = persona(call).map_err(|why| alternative(&why))?;
    // Only a responsive dev host is asked: a `serve` host refuses /dev/status,
    // and a stopped or wedged one must not leave this command waiting.
    match exchange(address, "GET", "/dev/status", None, "", Duration::from_secs(3)) {
        Ok((200, _)) => {}
        Ok((status, reply)) => return Err(alternative(&format!("it is not a dev host (GET /dev/status answered {status}: {})",
            reply.get("denied").and_then(|d| d.get("message")).and_then(Json::as_str).unwrap_or("no status")))),
        Err(error) => return Err(alternative(&format!("its listener did not answer GET /dev/status ({error})"))),
    }
    let route = path(call);
    eprintln!("run: {lead} {base}; forwarding to POST {route}{} on its dev clock and its store", persona.map(|p| format!(" as x-snapback-persona: {p}")).unwrap_or_default());
    // A job runs whole before the reply; the read waits as a local run would.
    let baseline = call.project.filter(|_| call.kind != ProgramKind::Job).and_then(|project| super::run_refusal::baseline(&project.data_dir()));
    let (status, reply) = exchange(address, "POST", &route, persona, &body(call), Duration::from_secs(3600))
        .map_err(|error| alternative(&format!("its listener did not answer ({error})")))?;
    if let Some(denied) = reply.get("denied").and_then(|d| serde_json::from_value::<Refusal>(d.clone()).ok())
        && denied.code == "E_AUTH" && matches!(status, 401 | 403) {
        return Err(alternative(&format!("the host refused the development door ({denied}); a `snapback4 serve` host takes bearer tokens only")));
    }
    let code = print(call, &reply);
    let refused = reply.get("why").or_else(|| reply.get("denied")).and_then(|why| why.get("code")).and_then(Json::as_str);
    if let (Some(project), Some(refused)) = (call.project, refused) && call.kind != ProgramKind::Job {
        super::run_refusal::print(super::run_refusal::forwarded(&project.data_dir(), baseline, call.op, refused), None);
    }
    Ok(code)
}

fn print(call: &Call, reply: &Json) -> i32 {
    let show = |body: &Json| println!("{}", if call.json { body.to_string() } else { serde_json::to_string_pretty(body).unwrap() });
    let refusal = |value: &Json| serde_json::from_value::<Refusal>(value.clone()).map(|r| r.to_string()).unwrap_or_else(|_| value.to_string());
    match call.kind {
        ProgramKind::Query => {
            if let Some(denied) = reply.get("denied") {
                if call.json { println!("{}", json!({ "denied": denied, "complete": false })); } else { println!("denied {}", refusal(denied)); }
                return 1;
            }
            if reply.get("loading") == Some(&json!(true)) { show(&json!({ "loading": true, "data": null, "complete": false, "metered": reply.get("meter") })); }
            else { show(&json!({ "data": reply.get("data"), "complete": reply.get("complete"), "cut": reply.get("cut"), "next": reply.get("next"), "metered": reply.get("meter") })); }
            0
        }
        ProgramKind::Job => {
            if let Some(denied) = reply.get("denied") { eprintln!("{}: {}", call.op, refusal(denied)); return 1; }
            show(reply);
            if reply.get("state") == Some(&json!("done")) { 0 } else { 1 }
        }
        _ => match (reply.get("state").and_then(Json::as_str), reply.get("why").or_else(|| reply.get("denied"))) {
            (Some("sent"), _) => { show(&json!({ "state": "sent", "seq": reply.get("seq"), "result": reply.get("result") })); 0 }
            (_, Some(why)) => {
                if call.json { println!("{}", json!({ "state": "failed", "why": why, "current": reply.get("current") })); } else { println!("failed {}", refusal(why)); }
                1
            }
            _ => { eprintln!("run {}: unexpected reply from dev: {reply}", call.op); 2 }
        },
    }
}

const REPLY_LIMIT: u64 = 64 << 20;

pub(crate) fn exchange(address: SocketAddr, method: &str, route: &str, persona: Option<&str>, body: &str, wait: Duration) -> std::io::Result<(u16, Json)> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))?;
    stream.set_read_timeout(Some(wait))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))?;
    let persona = persona.map(|p| format!("x-snapback-persona: {p}\r\n")).unwrap_or_default();
    // HTTP/1.0 with Connection: close keeps the reply length-delimited by EOF.
    write!(stream, "{method} {route} HTTP/1.0\r\nHost: {address}\r\n{persona}Content-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len())?;
    let mut response = Vec::new();
    stream.take(REPLY_LIMIT).read_to_end(&mut response)?;
    let text = String::from_utf8(response).map_err(std::io::Error::other)?;
    let (head, body) = text.split_once("\r\n\r\n").ok_or_else(|| std::io::Error::other("no HTTP reply"))?;
    let status = head.split_whitespace().nth(1).and_then(|s| s.parse().ok()).ok_or_else(|| std::io::Error::other("no HTTP status"))?;
    let json = serde_json::from_str(body).map_err(|e| std::io::Error::other(format!("HTTP {status} without a JSON body: {e}")))?;
    Ok((status, json))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call<'a>(kind: ProgramKind, r#as: Option<&'a str>, args: &'a Json, personas: &'a [String]) -> Call<'a> {
        Call { op: "add", kind, args, r#as, personas, pinned_now: false, json: false, project: None }
    }

    #[test]
    fn personas_map_to_the_principal_a_local_run_uses() {
        let personas = ["alice".to_owned(), "bob".to_owned()];
        let args = json!({});
        assert_eq!(persona(&call(ProgramKind::Mutation, None, &args, &personas)), Ok(Some("alice")));
        assert_eq!(persona(&call(ProgramKind::Mutation, Some("bob"), &args, &personas)), Ok(Some("bob")));
        assert_eq!(persona(&call(ProgramKind::Query, Some("dev:carol"), &args, &personas)), Ok(Some("carol")));
        assert!(persona(&call(ProgramKind::Query, Some("service:pusher"), &args, &personas)).is_err());
        // An undeclared bare name is a verbatim principal locally, never dev:<name>.
        assert!(persona(&call(ProgramKind::Query, Some("carol"), &args, &personas)).is_err());
        assert_eq!(persona(&call(ProgramKind::Job, Some("bob"), &args, &personas)), Ok(None));
    }

    #[test]
    fn the_alternative_is_a_runnable_curl() {
        let personas = ["bob".to_owned()];
        let args = json!({"body": "it's"});
        let line = curl("http://127.0.0.1:4400", &call(ProgramKind::Mutation, Some("bob"), &args, &personas));
        assert_eq!(line, r#"curl -s -X POST http://127.0.0.1:4400/m/add -H 'x-snapback-persona: bob' -H 'Content-Type: application/json' -d '{"args":{"body":"it'\''s"}}'"#);
        let job = curl("http://127.0.0.1:4400", &call(ProgramKind::Job, None, &json!(null), &personas));
        assert_eq!(job, r#"curl -s -X POST http://127.0.0.1:4400/dev/jobs/add -H 'Content-Type: application/json' -d '{"args":{}}'"#);
    }
}
