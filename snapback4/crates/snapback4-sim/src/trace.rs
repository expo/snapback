//! The append-only trace of a run and its digest. Two runs of one seed must
//! produce equal digests; that equality is the determinism test.

#[derive(Debug, Clone)]
pub struct Trace {
    lines: Vec<String>,
    digest: u64,
}

impl Default for Trace {
    fn default() -> Self {
        Self::new()
    }
}

impl Trace {
    pub fn new() -> Self {
        Trace { lines: Vec::new(), digest: 0xCBF2_9CE4_8422_2325 }
    }

    pub fn record(&mut self, at: u64, line: impl AsRef<str>) {
        let line = format!("{at:>8} {}", line.as_ref());
        for b in line.bytes() {
            self.digest ^= u64::from(b);
            self.digest = self.digest.wrapping_mul(0x0000_0100_0000_01B3);
        }
        self.lines.push(line);
    }

    pub fn digest(&self) -> u64 {
        self.digest
    }

    pub fn len(&self) -> usize {
        self.lines.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }

    pub fn lines(&self) -> &[String] {
        &self.lines
    }

    /// The last `n` lines, for a failing test's message.
    pub fn tail(&self, n: usize) -> String {
        let start = self.lines.len().saturating_sub(n);
        self.lines[start..].join("\n")
    }
}
