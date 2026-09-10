//! Minimal loopback HTTP client used by CLI verbs; no second store opener.

use crate::owner::OwnerInfo;
use crate::protocol::Refusal;
use serde_json::{Value as Json, json};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::Duration;

#[derive(Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Json,
}

pub fn control(
    owner: &OwnerInfo,
    method: &str,
    path: &str,
    body: Json,
) -> Result<HttpResponse, Refusal> {
    request(
        owner.port,
        method,
        path,
        &[("X-Snapback-Control", owner.secret.as_str())],
        body,
    )
}

pub fn api(
    owner: &OwnerInfo,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Json,
) -> Result<HttpResponse, Refusal> {
    request(owner.port, method, path, headers, body)
}

fn request(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Json,
) -> Result<HttpResponse, Refusal> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|error| {
        Refusal::owner(
            "E_OWNER_NOT_RUNNING",
            format!("cannot connect to owner on port {port}: {error}"),
            "run snapback2 dev",
        )
    })?;
    stream
        .set_read_timeout(read_timeout(path, &body))
        .map_err(io_refusal)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(io_refusal)?;
    let bytes = if method == "GET" && body == json!({}) {
        Vec::new()
    } else {
        serde_json::to_vec(&body).map_err(|error| {
            Refusal::input(
                format!("cannot serialize request: {error}"),
                "pass JSON arguments",
            )
        })?
    };
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
        bytes.len()
    )
    .map_err(io_refusal)?;
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n").map_err(io_refusal)?;
    }
    stream.write_all(b"\r\n").map_err(io_refusal)?;
    stream.write_all(&bytes).map_err(io_refusal)?;
    stream.flush().map_err(io_refusal)?;
    let _ = stream.shutdown(Shutdown::Write);
    let mut response = Vec::new();
    stream.read_to_end(&mut response).map_err(io_refusal)?;
    parse_response(&response)
}

/// Read bounds by what the body asks for, decided by the owner's own predicate so the
/// client waits exactly as long as the owner may work: a rehearsal runs the entire job
/// before it answers, so it alone has no bound; ad hoc `plan` and `run` compile with the
/// owner's worker first, so `/control/run` waits out the compiler's own timeout plus a
/// margin. Epoch close gets the effect budget + 2 s to receive the owner's
/// budget + 1 s drain result; other requests keep the five-second task bound. A body the owner will
/// refuse (a disagreeing flag) is answered at once and keeps the short bound.
fn read_timeout(path: &str, body: &Json) -> Option<Duration> {
    use crate::control_run::{Mode, requested_mode};
    if path == "/control/effects/epoch" {
        return Some(snapback2_effects::DEFAULT_BUDGET + Duration::from_secs(2));
    }
    match requested_mode(body) {
        Ok(Mode::DryRun) => None,
        Ok(Mode::Plan | Mode::Run) if path == "/control/run" => {
            Some(crate::project::COMPILER_REQUEST_TIMEOUT + Duration::from_secs(5))
        }
        _ => Some(Duration::from_secs(5)),
    }
}

fn parse_response(response: &[u8]) -> Result<HttpResponse, Refusal> {
    let boundary = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| {
            Refusal::owner(
                "E_OWNER_PROTOCOL",
                "owner returned no HTTP headers",
                "restart snapback2 dev",
            )
        })?;
    let head = String::from_utf8_lossy(&response[..boundary]);
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| {
            Refusal::owner(
                "E_OWNER_PROTOCOL",
                "owner returned an invalid HTTP status",
                "restart snapback2 dev",
            )
        })?;
    let mut body = response[boundary + 4..].to_vec();
    if head
        .lines()
        .any(|line| line.eq_ignore_ascii_case("Transfer-Encoding: chunked"))
    {
        body = decode_chunked(&body)?;
    }
    let body = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body).map_err(|error| {
            Refusal::owner(
                "E_OWNER_PROTOCOL",
                format!("owner returned invalid JSON: {error}"),
                "restart snapback2 dev",
            )
        })?
    };
    Ok(HttpResponse { status, body })
}

fn decode_chunked(input: &[u8]) -> Result<Vec<u8>, Refusal> {
    let mut output = Vec::new();
    let mut cursor = 0;
    loop {
        let remaining = input.get(cursor..).ok_or_else(chunk_protocol_refusal)?;
        let line_end = remaining
            .windows(2)
            .position(|window| window == b"\r\n")
            .and_then(|position| cursor.checked_add(position))
            .ok_or_else(chunk_protocol_refusal)?;
        let length = input[cursor..line_end]
            .split(|byte| *byte == b';')
            .next()
            .unwrap_or_default();
        let length = std::str::from_utf8(length).map_err(|_| chunk_length_refusal())?;
        let size = usize::from_str_radix(length.trim(), 16).map_err(|_| chunk_length_refusal())?;
        cursor = line_end.checked_add(2).ok_or_else(chunk_protocol_refusal)?;
        if size == 0 {
            let trailer = input.get(cursor..).ok_or_else(chunk_protocol_refusal)?;
            if trailer == b"\r\n" {
                return Ok(output);
            }
            if trailer.len() < 4 || !trailer.ends_with(b"\r\n\r\n") {
                return Err(chunk_protocol_refusal());
            }
            let fields = &trailer[..trailer.len() - 4];
            if !valid_trailer_fields(fields) {
                return Err(chunk_protocol_refusal());
            }
            return Ok(output);
        }
        let data_end = cursor
            .checked_add(size)
            .ok_or_else(chunk_protocol_refusal)?;
        let next = data_end.checked_add(2).ok_or_else(chunk_protocol_refusal)?;
        if input.get(data_end..next) != Some(b"\r\n") {
            return Err(Refusal::owner(
                "E_OWNER_PROTOCOL",
                "truncated chunked response",
                "restart snapback2 dev",
            ));
        }
        output.extend_from_slice(
            input
                .get(cursor..data_end)
                .ok_or_else(chunk_protocol_refusal)?,
        );
        cursor = next;
    }
}

fn valid_trailer_fields(mut fields: &[u8]) -> bool {
    loop {
        let (line, rest) = match fields.windows(2).position(|bytes| bytes == b"\r\n") {
            Some(end) => (&fields[..end], Some(&fields[end + 2..])),
            None => (fields, None),
        };
        if line.is_empty()
            || line.contains(&b'\r')
            || line.contains(&b'\n')
            || !line.contains(&b':')
        {
            return false;
        }
        let Some(rest) = rest else {
            return true;
        };
        fields = rest;
    }
}

fn chunk_protocol_refusal() -> Refusal {
    Refusal::owner(
        "E_OWNER_PROTOCOL",
        "invalid chunked response",
        "restart snapback2 dev",
    )
}

fn chunk_length_refusal() -> Refusal {
    Refusal::owner(
        "E_OWNER_PROTOCOL",
        "invalid chunk length",
        "restart snapback2 dev",
    )
}

fn io_refusal(error: std::io::Error) -> Refusal {
    Refusal::owner(
        "E_OWNER_NOT_RUNNING",
        format!("owner connection failed: {error}"),
        "run snapback2 dev",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(body: &[u8]) -> Vec<u8> {
        let mut response = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
        response.extend_from_slice(body);
        response
    }

    #[test]
    fn malformed_chunked_responses_are_typed_protocol_refusals() {
        for body in [
            b"1\r\na".as_slice(),
            b"ffffffffffffffffffffffffffffffff\r\n".as_slice(),
            b"1\r\na0\r\n\r\n".as_slice(),
            b"0\r\nnot-a-trailer\r\n\r\n".as_slice(),
            b"7\r\n{\"x\":1}\r\n0\r\nA: b\nB: c\r\n\r\n".as_slice(),
        ] {
            let refusal = parse_response(&response(body)).unwrap_err();
            assert_eq!(refusal.code, "E_OWNER_PROTOCOL");
        }
    }

    #[test]
    fn read_timeouts_follow_the_owners_mode_predicate() {
        assert_eq!(
            read_timeout("/control/effects/epoch", &json!({"epoch":null})),
            Some(snapback2_effects::DEFAULT_BUDGET + Duration::from_secs(2))
        );
        let task = Some(Duration::from_secs(5));
        let compile = Some(crate::project::COMPILER_REQUEST_TIMEOUT + Duration::from_secs(5));
        // A rehearsal has no bound, however it is spelled.
        for body in [
            json!({ "mode": "dry-run", "source": "x" }),
            json!({ "dryRun": true, "name": "fill" }),
            json!({ "dryRun": true, "mode": "dry-run", "source": "x" }),
        ] {
            assert_eq!(read_timeout("/control/run", &body), None, "{body}");
            assert_eq!(read_timeout("/control/job", &body), None, "{body}");
        }
        // Ad hoc plan and run wait for the owner's compiler.
        assert_eq!(
            read_timeout("/control/run", &json!({ "mode": "plan", "source": "x" })),
            compile
        );
        assert_eq!(
            read_timeout("/control/run", &json!({ "mode": "run", "source": "x" })),
            compile
        );
        assert_eq!(
            read_timeout("/control/run", &json!({ "plan": true, "source": "x" })),
            compile
        );
        // Declared programs never compile; every other request keeps the task bound.
        assert_eq!(
            read_timeout("/control/job", &json!({ "plan": true, "name": "fill" })),
            task
        );
        assert_eq!(
            read_timeout("/control/job", &json!({ "dryRun": false, "name": "fill" })),
            task
        );
        assert_eq!(
            read_timeout("/api/mutation", &json!({ "op": "send" })),
            task
        );
        assert_eq!(read_timeout("/control/status", &json!({})), task);
        // A body the owner refuses at once keeps the task bound rather than waiting unbounded.
        for body in [
            json!({ "mode": "run", "dryRun": true, "source": "x" }),
            json!({ "mode": "dry-run", "dryRun": false, "source": "x" }),
            json!({ "dryRun": "true", "name": "fill" }),
            json!({ "dryRun": true, "plan": true, "source": "x" }),
        ] {
            assert_eq!(read_timeout("/control/run", &body), task, "{body}");
        }
    }

    #[test]
    fn chunked_response_accepts_data_extensions_and_trailers() {
        let parsed = parse_response(&response(
            b"7;example=yes\r\n{\"x\":1}\r\n0\r\nDigest: okay\r\n\r\n",
        ))
        .unwrap();
        assert_eq!(parsed.body, json!({ "x": 1 }));
    }
}
