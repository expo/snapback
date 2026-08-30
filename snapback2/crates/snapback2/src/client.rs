//! Minimal loopback HTTP client used by CLI verbs; no second store opener.

use crate::owner::OwnerInfo;
use crate::protocol::Refusal;
use serde_json::{Value as Json, json};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::Duration;

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
        .set_read_timeout(Some(Duration::from_secs(5)))
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
        let line_end = input[cursor..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .map(|position| cursor + position)
            .ok_or_else(|| {
                Refusal::owner(
                    "E_OWNER_PROTOCOL",
                    "invalid chunked response",
                    "restart snapback2 dev",
                )
            })?;
        let size =
            usize::from_str_radix(String::from_utf8_lossy(&input[cursor..line_end]).trim(), 16)
                .map_err(|_| {
                    Refusal::owner(
                        "E_OWNER_PROTOCOL",
                        "invalid chunk length",
                        "restart snapback2 dev",
                    )
                })?;
        cursor = line_end + 2;
        if size == 0 {
            break;
        }
        if cursor + size > input.len() {
            return Err(Refusal::owner(
                "E_OWNER_PROTOCOL",
                "truncated chunked response",
                "restart snapback2 dev",
            ));
        }
        output.extend_from_slice(&input[cursor..cursor + size]);
        cursor += size + 2;
    }
    Ok(output)
}

fn io_refusal(error: std::io::Error) -> Refusal {
    Refusal::owner(
        "E_OWNER_NOT_RUNNING",
        format!("owner connection failed: {error}"),
        "run snapback2 dev",
    )
}
