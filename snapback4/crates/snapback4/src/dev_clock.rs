//! A process-local development clock. The release host always reads wall time.
use snapback4_core::error::Refusal;
use std::{io::{Read, Write}, net::{Ipv4Addr, TcpStream}, time::{Duration, Instant}};

const MAX_TIME: i64 = snapback4_core::value::I53_MAX;

pub fn input(message: impl Into<String>) -> Refusal { Refusal::new("E_CLOCK_INPUT", "clock", message).guide("clock") }
pub fn release() -> Refusal { Refusal::new("E_CLOCK_DEV_ONLY", "clock", "clock controls require dev; serve always uses wall time").guide("clock") }

pub fn duration(text: &str) -> Result<i64, Refusal> {
    if text.starts_with('-') { return Err(input("clock advance cannot move backwards; use a positive duration such as +2m")); }
    let text = text.strip_prefix('+').unwrap_or(text);
    let split = text.bytes().position(|b| !b.is_ascii_digit()).unwrap_or(text.len());
    let (number, unit) = text.split_at(split);
    let multiplier = match unit { "ms" => 1, "s" => 1_000, "m" => 60_000, "h" => 3_600_000, "d" => 86_400_000, "w" => 604_800_000, _ => 0 };
    number.parse::<i64>().ok().and_then(|n| n.checked_mul(multiplier)).filter(|n| *n > 0 && *n <= MAX_TIME)
        .ok_or_else(|| input("expected a positive whole duration with ms, s, m, h, d or w, such as +25h"))
}

pub fn offset(text: &str) -> Result<i64, Refusal> {
    if let Some(rest) = text.strip_prefix('-') { duration(rest).map(|n| -n) } else { duration(text) }
}

fn time(value: Option<i64>) -> Result<i64, Refusal> {
    value.filter(|n| (0..=MAX_TIME).contains(n)).ok_or_else(|| input("time must be Unix milliseconds in 0..9007199254740991; choose a smaller time or duration"))
}

pub fn run_now(text: Option<&String>) -> Result<i64, Refusal> {
    let now = snapback4_core::now_ms();
    match text {
        None => Ok(now),
        Some(text) if text.starts_with('+') => time(now.checked_add(duration(text)?)),
        Some(text) => time(text.parse().ok()),
    }
}

#[derive(Clone, Debug)]
pub struct Clock {
    dev: bool,
    base: i64,
    started: Instant,
}

impl Clock {
    pub fn new(dev: bool, offset: i64) -> Result<Self, Refusal> {
        if !dev && offset != 0 { return Err(release()); }
        Ok(Self { dev, base: time(snapback4_core::now_ms().checked_add(offset))?, started: Instant::now() })
    }
    pub fn now(&self) -> i64 {
        if !self.dev { return snapback4_core::now_ms(); }
        self.base.saturating_add(self.started.elapsed().as_millis().min(MAX_TIME as u128) as i64).min(MAX_TIME)
    }
    pub fn presence_now(&self) -> i64 {
        // Production grace is elapsed real time, unaffected by wall-clock corrections.
        if self.dev { self.now() } else { self.started.elapsed().as_millis().min(MAX_TIME as u128) as i64 }
    }
    pub fn advance(&mut self, milliseconds: i64) -> Result<i64, Refusal> {
        if !self.dev { return Err(release()); }
        if milliseconds <= 0 { return Err(input("clock advance cannot move backwards; use a positive duration such as +2m")); }
        let next = time(self.now().checked_add(milliseconds))?;
        self.base = next;
        self.started = Instant::now();
        Ok(next)
    }
}

/// The control CLI only talks to a loopback dev host. It does not open its store.
pub fn command(options: &crate::verbs::Options) -> i32 {
    let result = (|| -> Result<String, String> {
        if options.flags.contains_key("release") { return Err(release().to_string()); }
        if options.positionals.len() != 2 || options.positionals[0] != "advance" {
            return Err(input("usage: snapback4 clock advance <duration> [--port N]").to_string());
        }
        duration(&options.positionals[1]).map_err(|e| e.to_string())?;
        let port = match options.flags.get("port") {
            None => 4400,
            Some(text) => text.parse::<u16>().ok().filter(|n| *n > 0).ok_or_else(|| input("--port must be an integer in 1..65535").to_string())?,
        };
        let mut stream = TcpStream::connect_timeout(&(Ipv4Addr::LOCALHOST, port).into(), Duration::from_secs(5)).map_err(|e| format!("cannot reach dev on port {port}: {e}"))?;
        stream.set_read_timeout(Some(Duration::from_secs(60))).map_err(|e| e.to_string())?;
        stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
        let body = serde_json::json!({"duration":options.positionals[1]}).to_string();
        write!(stream, "POST /dev/clock/advance HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).map_err(|e| e.to_string())?;
        let mut answer = String::new();
        stream.take(65_536).read_to_string(&mut answer).map_err(|e| e.to_string())?;
        let (headers, body) = answer.split_once("\r\n\r\n").ok_or("dev returned an incomplete HTTP response")?;
        let json: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("dev returned invalid JSON: {e}"))?;
        if let Some(denied) = json.get("denied") { return Err(format!("{}: {}\n  guide: clock", denied["code"].as_str().unwrap_or("E_CLOCK_INPUT"), denied["message"].as_str().unwrap_or("clock advance failed"))); }
        if !headers.starts_with("HTTP/1.1 200 ") { return Err(format!("dev refused clock advance: {body}")); }
        Ok(json.to_string())
    })();
    match result { Ok(body) => { println!("{body}"); 0 }, Err(error) => { eprintln!("{error}"); 1 } }
}
