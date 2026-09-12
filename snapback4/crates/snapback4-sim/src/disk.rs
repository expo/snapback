//! A host's disk. Writes land in a volatile buffer; `fsync` makes them
//! durable, or fails and loses the buffer; a crash loses the buffer too.
//! A process reads its own unsynced writes, as an operating system's page
//! cache would show them.

use std::collections::BTreeMap;

use crate::rng::Rng;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FsyncFailed;

#[derive(Debug, Clone, Default)]
pub struct Disk {
    durable: BTreeMap<String, Vec<u8>>,
    pending: BTreeMap<String, Vec<u8>>,
    /// Probability that an `fsync` fails and loses every pending write.
    pub fsync_fail: f64,
    pub fsyncs: u64,
    pub failed_fsyncs: u64,
    pub crashes: u64,
}

impl Disk {
    /// A disk whose `fsync` fails with probability `fsync_fail`.
    pub fn with_fsync_fail(fsync_fail: f64) -> Self {
        Disk { fsync_fail, ..Disk::default() }
    }

    pub fn write(&mut self, key: &str, bytes: Vec<u8>) {
        self.pending.insert(key.to_string(), bytes);
    }

    pub fn fsync(&mut self, rng: &mut Rng) -> Result<(), FsyncFailed> {
        self.fsyncs += 1;
        if rng.chance(self.fsync_fail) {
            self.failed_fsyncs += 1;
            self.pending.clear();
            return Err(FsyncFailed);
        }
        self.durable.append(&mut self.pending);
        Ok(())
    }

    pub fn read(&self, key: &str) -> Option<&[u8]> {
        self.pending
            .get(key)
            .or_else(|| self.durable.get(key))
            .map(Vec::as_slice)
    }

    /// Power loss: every unsynced write is gone.
    pub fn crash(&mut self) {
        self.crashes += 1;
        self.pending.clear();
    }

    pub fn durable_len(&self) -> usize {
        self.durable.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsynced_writes_die_with_the_process() {
        let mut d = Disk::default();
        let mut r = Rng::seed(3);
        d.write("a", b"1".to_vec());
        assert_eq!(d.read("a"), Some(&b"1"[..]));
        d.crash();
        assert_eq!(d.read("a"), None);
        d.write("a", b"2".to_vec());
        d.fsync(&mut r).unwrap();
        d.crash();
        assert_eq!(d.read("a"), Some(&b"2"[..]));
    }

    #[test]
    fn a_failed_fsync_loses_the_buffer_and_says_so() {
        let mut d = Disk { fsync_fail: 1.0, ..Disk::default() };
        let mut r = Rng::seed(3);
        d.write("a", b"1".to_vec());
        assert_eq!(d.fsync(&mut r), Err(FsyncFailed));
        assert_eq!(d.read("a"), None);
        assert_eq!(d.failed_fsyncs, 1);
    }
}
