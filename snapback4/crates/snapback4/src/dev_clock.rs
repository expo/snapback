//! A process-local development clock. The release host always reads wall time.
use snapback4_core::error::Refusal;
use std::time::{Duration, Instant};

const MAX_TIME: i64 = snapback4_core::value::I53_MAX;

pub fn input(message: impl Into<String>) -> Refusal { Refusal::new("E_CLOCK_INPUT", "clock", message).guide("clock") }
pub fn release() -> Refusal { Refusal::new("E_CLOCK_DEV_ONLY", "clock", "clock controls require dev; serve always uses wall time").guide("clock") }

/// Isolated time tests stay inside an assigned range, or request a free port.
pub(crate) fn isolated_command() -> String {
    isolated_range(std::env::var("PORT_LO").ok().as_deref(), std::env::var("PORT_HI").ok().as_deref())
}
fn isolated_range(lo: Option<&str>, hi: Option<&str>) -> String {
    match (lo.and_then(|n| n.parse::<u16>().ok()), hi.and_then(|n| n.parse::<u16>().ok())) {
        (Some(lo), Some(hi)) if lo > 0 && hi >= lo => format!("dev --memory --port {lo}-{hi} within the current range"),
        _ => "dev --memory --port 0".into(),
    }
}

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
    epoch: String,
    revision: u64,
    #[cfg(test)]
    frozen: bool,
}

impl Clock {
    pub fn new(dev: bool, offset: i64) -> Result<Self, Refusal> {
        if !dev && offset != 0 { return Err(release()); }
        Ok(Self { dev, base: time(snapback4_core::now_ms().checked_add(offset))?, started: Instant::now(),
            epoch: snapback4_core::ids::mint(snapback4_core::now_ms(), &mut snapback4_core::ids::Mint::default()).map_err(|e| e.refusal())?, revision: 0, #[cfg(test)] frozen: false })
    }
    #[cfg(test)]
    pub(crate) fn freeze(&mut self, now: i64) { self.base = now; self.frozen = true; }
    pub fn now(&self) -> i64 {
        #[cfg(test)] if self.frozen { return self.base; }
        if !self.dev { return snapback4_core::now_ms(); }
        self.base.saturating_add(self.started.elapsed().as_millis().min(MAX_TIME as u128) as i64).min(MAX_TIME)
    }
    /// Identifies samples taken before/after a restart or deliberate clock jump.
    pub fn revision(&self) -> String { format!("{}:{}", self.epoch, self.revision) }
    pub fn presence_now(&self) -> i64 {
        // Production grace is elapsed real time, unaffected by wall-clock corrections.
        if self.dev { self.now() } else { self.started.elapsed().as_millis().min(MAX_TIME as u128) as i64 }
    }
    /// Back to wall time: the offset `--clock-offset` and every advance added
    /// is dropped (a development reset's `{"clock":"reset"}`).
    pub fn reset(&mut self) -> Result<i64, Refusal> {
        if !self.dev { return Err(release()); }
        self.revision += 1;
        self.base = snapback4_core::now_ms();
        self.started = Instant::now();
        #[cfg(test)] { self.frozen = false; }
        Ok(self.base)
    }
    pub fn advance(&mut self, milliseconds: i64) -> Result<i64, Refusal> {
        if !self.dev { return Err(release()); }
        if milliseconds <= 0 { return Err(input("clock advance cannot move backwards; use a positive duration such as +2m")); }
        let next = time(self.now().checked_add(milliseconds))?;
        self.revision += 1;
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
            return Err(input(format!("usage: {}", crate::cli_flags::synopsis("clock"))).to_string());
        }
        duration(&options.positionals[1]).map_err(|e| e.to_string())?;
        let (address, instance) = crate::verbs::dev_address(options)?;
        let body = serde_json::json!({"duration":options.positionals[1],"eachBoundary":options.flags.contains_key("each-boundary")}).to_string();
        // The common HTTP/1.0 exchange is EOF-delimited and bounds replies at
        // 64 MiB, enough for the preflight's complete explicit window report.
        let (status, json) = crate::verbs::run_forward::exchange_dev(address, "/dev/clock/advance", instance.as_deref(), &body, Duration::from_secs(60)).map_err(|error| {
            let evidence = crate::verbs::run_forward::exchange(address, "GET", "/dev/status", None, "", Duration::from_secs(5)).ok()
                .map(|(_, status)| format!("now={}, skewMs={}", status["now"], status["skewMs"]))
                .unwrap_or_else(|| "clock status unavailable".into());
            format!("clock advance reply failed at {address}: {error}; time may already have advanced ({evidence}); inspect /dev/status and queued work before retrying; for an isolated dev pass --port N")
        })?;
        if let Some(denied) = json.get("denied") {
            let clock = json["message"].as_str().map(|message| format!("; time remains advanced: {message}")).unwrap_or_default();
            return Err(format!("{}: {}{clock}\n  guide: clock", denied["code"].as_str().unwrap_or("E_CLOCK_INPUT"), denied["message"].as_str().unwrap_or("clock advance failed")));
        }
        if status != 200 { return Err(format!("dev refused clock advance: {json}")); }
        Ok(json.to_string())
    })();
    match result { Ok(body) => { println!("{body}"); 0 }, Err(error) => { eprintln!("{error}"); 1 } }
}

#[cfg(test)]
mod isolated_tests {
    #[test]
    fn time_test_guidance_uses_only_valid_assigned_ranges_or_a_free_port() {
        assert_eq!(super::isolated_range(Some("24000"), Some("24009")), "dev --memory --port 24000-24009 within the current range");
        for (lo,hi) in [(None,None),(Some("0"),Some("3")),(Some("4"),Some("3")),(Some("bad"),Some("3"))] {
            assert_eq!(super::isolated_range(lo,hi), "dev --memory --port 0");
        }
    }
}
