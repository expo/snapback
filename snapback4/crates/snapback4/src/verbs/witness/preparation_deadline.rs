//! @ref LLP 3000.030#15 — background preparation earns time from output, within a hard cap.
use super::*;

pub(super) const FOREGROUND: Duration = Duration::from_secs(900);
pub(super) const BACKGROUND_CAP: Duration = Duration::from_secs(3600);

pub(super) struct Deadline {
    background: bool,
    started: Instant,
    progressed: Instant,
    idle: Duration,
    hard: Duration,
    next_scan: Instant,
    high_water: BTreeMap<PathBuf, u64>,
    observations: usize,
}
impl Deadline {
    pub(super) fn new(start: Instant, background: bool) -> Self {
        Self::with_limits(start, background, FOREGROUND, if background { BACKGROUND_CAP } else { FOREGROUND })
    }
    fn with_limits(start: Instant, background: bool, idle: Duration, hard: Duration) -> Self {
        Self { background, started: start, progressed: start, idle, hard, next_scan: start, high_water: BTreeMap::new(), observations: 0 }
    }
    pub(super) fn start(&mut self, at: Instant) { self.started = at; self.progressed = at; self.next_scan = at; }
    pub(super) fn expired(&self, at: Instant) -> bool {
        at.duration_since(self.started) >= self.hard || at.duration_since(self.progressed) >= self.idle
    }
    fn observe(&mut self, at: Instant, files: impl IntoIterator<Item = (PathBuf, u64)>) -> bool {
        // A late observation cannot resurrect a deadline. Deletion, truncation,
        // unchanged output, mtime touches and polling are not progress.
        if !self.background || self.expired(at) { return false; }
        let mut grew = false;
        for (file, bytes) in files {
            let previous = self.high_water.entry(file).or_default();
            if bytes > *previous { *previous = bytes; grew = true; }
        }
        if grew { self.progressed = at; self.observations += 1; }
        grew
    }
    pub(super) fn poll(&mut self, at: Instant, dir: &Path) -> Result<()> {
        if !self.background || at < self.next_scan || self.expired(at) { return Ok(()); }
        self.next_scan = at + (self.idle / 4).min(Duration::from_secs(1));
        let mut files = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| error("E_WITNESS_ARTIFACT", e))? {
            let entry = entry.map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            // Only direct helper/tool output. Neither guardian status nor this
            // observer's own journal can renew the deadline.
            if name == "preparation-progress.jsonl" || (name.ends_with(".log") && name != "background.log") {
                let metadata = entry.metadata().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
                if metadata.is_file() { files.push((entry.path(), metadata.len())); }
            }
        }
        if self.observe(at, files) {
            let mut journal = OpenOptions::new().create(true).append(true).open(dir.join("preparation-deadline.jsonl"))
                .map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
            writeln!(journal, "{}", self.record(at)).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        }
        Ok(())
    }
    fn record(&self, at: Instant) -> Value {
        json!({ "background": self.background, "elapsedMs": at.duration_since(self.started).as_millis(),
            "idleMs": at.duration_since(self.progressed).as_millis(), "idleLimitMs": self.idle.as_millis(),
            "hardLimitMs": self.hard.as_millis(), "progressObservations": self.observations,
            "outputBytes": self.high_water.values().sum::<u64>(), "expired": self.expired(at) })
    }
    pub(super) fn finish(&self, dir: &Path, completed: Instant) -> Result<()> {
        if self.background { recovery::write(&dir.join("preparation-deadline.json"), &self.record(completed))?; }
        Ok(())
    }
    pub(super) fn problem(&self) -> String {
        if self.background { error("E_WITNESS_BUILD", "preparation exceeded its background deadline (900 seconds without progress or 3600 seconds total)") }
        else { error("E_WITNESS_BUILD", "preparation exceeded its 900-second deadline") }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn output(bytes: u64) -> [(PathBuf, u64); 1] { [(PathBuf::from("xcode-build.log"), bytes)] }
    #[test]
    fn foreground_expires_at_exactly_900_seconds_despite_output() {
        let start = Instant::now(); let mut d = Deadline::new(start, false);
        for seconds in 0..900 { assert!(!d.observe(start + Duration::from_secs(seconds), output(seconds))); }
        assert!(!d.expired(start + Duration::from_millis(899999)));
        assert!(d.expired(start + FOREGROUND));
        assert_eq!(d.problem(), "E_WITNESS_BUILD: preparation exceeded its 900-second deadline");
    }
    #[test]
    fn progress_extends_background_but_cannot_pass_hard_cap() {
        let start = Instant::now(); let mut d = Deadline::new(start, true);
        for seconds in [800, 1600, 2400, 3200] {
            assert!(d.observe(start + Duration::from_secs(seconds), output(seconds)));
            assert!(!d.expired(start + Duration::from_secs(seconds + 1)));
        }
        assert!(!d.expired(start + Duration::from_secs(3599)));
        assert!(d.expired(start + BACKGROUND_CAP));
        assert!(!d.observe(start + BACKGROUND_CAP, output(9999)));
    }
    #[test]
    fn only_new_output_or_phase_bytes_extend_a_stall() {
        let start = Instant::now(); let mut d = Deadline::new(start, true);
        assert!(d.observe(start, output(100)));
        for bytes in [100, 0, 50, 100] { assert!(!d.observe(start + Duration::from_secs(800), output(bytes))); }
        assert!(d.observe(start + Duration::from_secs(800), [(PathBuf::from("preparation-progress.jsonl"), 30)]));
        assert!(!d.expired(start + Duration::from_secs(1699)));
        assert!(d.expired(start + Duration::from_secs(1700)));
        assert!(!d.observe(start + Duration::from_secs(1701), output(200)));
    }
    #[test]
    fn live_output_passes_original_budget_and_stalled_child_is_drained() {
        super::super::preparation::deadline_fixture(false);
        super::super::preparation::deadline_fixture(true);
    }
    #[test]
    fn completion_receipt_does_not_charge_later_cleanup_to_preparation() {
        let dir = std::env::temp_dir().join(format!("sb4-deadline-receipt-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let start = Instant::now() - Duration::from_secs(10);
        let mut deadline = Deadline::with_limits(start, true, Duration::from_millis(500), Duration::from_secs(5));
        assert!(deadline.observe(start + Duration::from_millis(100), output(1)));
        // The recorded completion is before expiry; the actual clock is beyond
        // even the hard cap. No host scheduling speed is part of this assertion.
        deadline.finish(&dir, start + Duration::from_millis(300)).unwrap();
        let record = recovery::read(&dir.join("preparation-deadline.json"));
        assert_eq!(record["expired"], false);
        assert_eq!(record["elapsedMs"], 300);
        assert_eq!(record["idleMs"], 200);
        deadline.finish(&dir, start + Duration::from_millis(600)).unwrap();
        assert_eq!(recovery::read(&dir.join("preparation-deadline.json"))["expired"], true);
        fs::remove_dir_all(dir).unwrap();
    }
    pub(super) fn short(start: Instant) -> Deadline {
        Deadline::with_limits(start, true, Duration::from_millis(500), Duration::from_secs(5))
    }
}
#[cfg(test)]
pub(super) fn short(start: Instant) -> Deadline { tests::short(start) }
