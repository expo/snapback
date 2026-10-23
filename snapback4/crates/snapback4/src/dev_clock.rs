//! A process-local clock for development and explicitly classified staging stores.
use snapback4_core::error::Refusal;
use std::time::{Duration, Instant};

// @ref LLP 3000.000.000.001#8-wave-18-developer-loop-amendment-dx4 — preserve expiry tests and tell callers how to recover.
pub(crate) const SESSION_NOTICE: &str = "Time travel also advances session expiry and unplaced-upload collection: seven-day password sessions may now be expired. Sign in again after the jump and upload unplaced bytes after it; never replay an ambiguous clock advance.";

pub(crate) const PRESERVED_SESSION_NOTICE: &str = "Authenticated development and staging sessions keep their remaining lifetime across this jump; sessions:expire explicitly tests credential expiry. Unplaced uploads still age. Never replay an ambiguous advance.";

const MAX_TIME: i64 = snapback4_core::value::I53_MAX;

pub fn input(message: impl Into<String>) -> Refusal { Refusal::new("E_CLOCK_INPUT", "clock", message).guide("clock") }
pub fn release() -> Refusal { Refusal::new("E_CLOCK_DEV_ONLY", "clock", "clock controls require dev or a deploy --staging store; production always uses wall time").guide("clock") }

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
    offset: i64,
    started: Instant,
    epoch: String,
    revision: u64,
    #[cfg(test)]
    frozen: bool,
}

impl Clock {
    pub fn new(dev: bool, offset: i64) -> Result<Self, Refusal> {
        if !dev && offset != 0 { return Err(release()); }
        Ok(Self { dev, offset, base: time(snapback4_core::now_ms().checked_add(offset))?, started: Instant::now(),
            epoch: snapback4_core::ids::mint(snapback4_core::now_ms(), &mut snapback4_core::ids::Mint::default()).map_err(|e| e.refusal())?, revision: 0, #[cfg(test)] frozen: false })
    }
    pub fn staging(offset: i64, floor: i64) -> Result<Self, Refusal> {
        let mut clock = Self::new(true, offset)?;
        let delta = floor.saturating_sub(clock.now()).max(0);
        if delta > 0 { clock.advance(delta)?; }
        Ok(clock)
    }
    #[cfg(test)]
    pub(crate) fn freeze(&mut self, now: i64) { self.base = now; self.frozen = true; }
    pub fn now(&self) -> i64 {
        #[cfg(test)] if self.frozen { return self.base; }
        if !self.dev { return snapback4_core::now_ms(); }
        self.base.saturating_add(self.started.elapsed().as_millis().min(MAX_TIME as u128) as i64).min(MAX_TIME)
    }
    /// Identifies samples taken before/after a restart or deliberate clock jump.
    pub fn offset(&self) -> i64 { self.offset }
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
        self.offset = 0;
        self.base = snapback4_core::now_ms();
        self.started = Instant::now();
        #[cfg(test)] { self.frozen = false; }
        Ok(self.base)
    }
    pub fn advance(&mut self, milliseconds: i64) -> Result<i64, Refusal> {
        if !self.dev { return Err(release()); }
        if milliseconds <= 0 { return Err(input("clock advance cannot move backwards; use a positive duration such as +2m")); }
        let next = time(self.now().checked_add(milliseconds))?;
        let offset = self.offset.checked_add(milliseconds).ok_or_else(|| input("cumulative clock offset overflow"))?;
        self.revision += 1;
        self.offset = offset;
        self.base = next;
        self.started = Instant::now();
        Ok(next)
    }
}

/// The control CLI only talks to a loopback dev host. It does not open its store.
pub fn command(options: &crate::verbs::Options) -> i32 {
    let result = (|| -> Result<String, String> {
        let draining = options.positionals == ["drain"];
        if !draining && (options.positionals.len() != 2 || options.positionals[0] != "advance") {
            return Err(input(format!("usage: {}", crate::cli_flags::synopsis("clock"))).to_string());
        }
        let duration_text = if draining { "0ms" } else { options.positionals[1].as_str() };
        if !draining { duration(duration_text).map_err(|e| e.to_string())?; }
        let release_path = options.flags.get("release").map(|dir| std::path::PathBuf::from(dir).join("store.sqlite"));
        if release_path.is_some() && options.flags.contains_key("port") { return Err("clock --release does not accept --port".into()); }
        let (address, instance, token) = if let Some(path) = &release_path {
            let store = snapback4_core::store_port::AnyStore::open_read_only(path).map_err(|e|e.to_string())?;
            if store.deployment_environment().map_err(|e|e.to_string())?.as_deref() != Some("staging") { return Err(release().to_string()); }
            let address = crate::store_owner::inspector_address(path).ok_or("staging clock requires a running serve")?;
            let session = crate::serve::token::mint_live(path, "clock", 1).map_err(|(_,error)|error)?;
            (address,None,Some(session.token))
        } else {
            let (address,instance)=crate::verbs::dev_address(options)?;
            let token=crate::verbs::mint_for_dev(address,"operator",1)?;
            (address,instance,Some(token))
        };
        let mut body = serde_json::json!({"duration":duration_text,"eachBoundary":options.flags.contains_key("each-boundary"), "drain":!options.flags.contains_key("no-drain"), "allowHeld":options.flags.contains_key("allow-held")});
        if options.flags.contains_key("expire-sessions") { body["sessions"] = "expire".into(); }
        if draining && options.flags.contains_key("no-drain") { return Err(input("clock drain does not accept --no-drain").to_string()); }
        let body = body.to_string();
        // The common HTTP/1.0 exchange is EOF-delimited and bounds replies at
        // 64 MiB, enough for the preflight's complete explicit window report.
        let response = if release_path.is_some() {
            crate::verbs::run_forward::exchange_authorized(address,"POST","/dev/clock/advance",None,token.as_deref(),&body,Duration::from_secs(60))
        } else {
            crate::verbs::run_forward::exchange_dev_authorized(address,"/dev/clock/advance",instance.as_deref(),token.as_deref().unwrap(),&body,Duration::from_secs(60))
        };
        let (status, json) = response.map_err(|error| {
            let evidence = crate::verbs::run_forward::exchange(address, "GET", "/dev/status", None, "", Duration::from_secs(5)).ok()
                .map(|(_, status)| format!("now={}, skewMs={}", status["now"], status["skewMs"]))
                .unwrap_or_else(|| "clock status unavailable".into());
            format!("clock advance reply failed at {address}: {error}; time may already have advanced ({evidence}); inspect /dev/status and queued work before retrying; for an isolated dev pass --port N")
        })?;
        if let Some(notice) = json["sessionNotice"].as_str() { eprintln!("clock: {notice}"); }
        if let Some(held) = json["held"].as_array() {
            for schedule in held.iter().filter(|s| s["holdCode"] == "saved-boundary") {
                eprintln!("clock: schedule {}: {}", schedule["name"].as_str().unwrap_or("?"), schedule["reason"].as_str().unwrap_or("held"));
            }
        }
        if let Some(denied) = json.get("denied") {
            if json.get("now").is_some() {
                eprintln!("clock: incomplete advance report (time already moved): {}", serde_json::json!({"now":json["now"],"fired":json["fired"],"held":json["held"]}));
            }
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
