//! Coalesced mailbox/completion notifications; generation closes the lost-wake race.
use std::sync::{Condvar, Mutex};
#[derive(Default)]
pub(super) struct Notice { version: Mutex<u64>, changed: Condvar }
impl Notice {
    pub(super) fn version(&self) -> u64 { *self.version.lock().unwrap_or_else(|p|p.into_inner()) }
    pub(super) fn notify(&self) {
        let mut v=self.version.lock().unwrap_or_else(|p|p.into_inner());
        *v=v.wrapping_add(1);
        self.changed.notify_one();
    }
    pub(super) fn wait(&self, observed:u64) {
        // Test-only restoration of the old completed-result timer. This is
        // absent from product builds and used only by the negative witness.
        #[cfg(test)]
        if std::env::var("SNAPBACK4_WF_LEGACY_POLL").as_deref()==Ok("1") {
            std::thread::sleep(std::time::Duration::from_micros(100));
            return;
        }
        let v=self.version.lock().unwrap_or_else(|p|p.into_inner());
        drop(self.changed.wait_while(v,|v|*v==observed).unwrap_or_else(|p|p.into_inner()));
    }
}
