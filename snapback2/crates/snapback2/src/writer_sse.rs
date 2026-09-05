//! Bounded single-slot SSE handoff with live coalescing and channel overflow refusal.

use super::SseEvent;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

struct Queue {
    event: Option<SseEvent>,
    senders: usize,
    receiver_alive: bool,
    wake: Option<std::sync::mpsc::SyncSender<()>>,
}

struct Shared {
    queue: Mutex<Queue>,
    ready: Condvar,
}

pub struct SseSender {
    shared: Arc<Shared>,
}

pub struct SseReceiver {
    shared: Arc<Shared>,
}

pub enum SendError {
    Full,
    Disconnected,
}

pub fn queue() -> (SseSender, SseReceiver) {
    let shared = Arc::new(Shared {
        queue: Mutex::new(Queue {
            event: None,
            senders: 1,
            receiver_alive: true,
            wake: None,
        }),
        ready: Condvar::new(),
    });
    (
        SseSender {
            shared: shared.clone(),
        },
        SseReceiver { shared },
    )
}

impl SseSender {
    pub fn send_latest(&self, event: SseEvent) -> Result<(), SendError> {
        let mut queue = self.shared.queue.lock().expect("SSE queue lock");
        if !queue.receiver_alive {
            return Err(SendError::Disconnected);
        }
        queue.event = Some(event);
        self.shared.ready.notify_one();
        if let Some(wake) = &queue.wake {
            let _ = wake.try_send(());
        }
        Ok(())
    }

    pub fn try_send(&self, event: SseEvent) -> Result<(), SendError> {
        let mut queue = self.shared.queue.lock().expect("SSE queue lock");
        if !queue.receiver_alive {
            return Err(SendError::Disconnected);
        }
        if queue.event.is_some() {
            return Err(SendError::Full);
        }
        queue.event = Some(event);
        self.shared.ready.notify_one();
        if let Some(wake) = &queue.wake {
            let _ = wake.try_send(());
        }
        Ok(())
    }
}

impl Clone for SseSender {
    fn clone(&self) -> Self {
        self.shared.queue.lock().expect("SSE queue lock").senders += 1;
        Self {
            shared: self.shared.clone(),
        }
    }
}

impl Drop for SseSender {
    fn drop(&mut self) {
        let mut queue = self.shared.queue.lock().expect("SSE queue lock");
        queue.senders = queue.senders.saturating_sub(1);
        self.shared.ready.notify_one();
        if let Some(wake) = &queue.wake {
            let _ = wake.try_send(());
        }
    }
}

impl SseReceiver {
    pub fn notify_on(&self, wake: std::sync::mpsc::SyncSender<()>) {
        let mut queue = self.shared.queue.lock().expect("SSE queue lock");
        let _ = wake.try_send(());
        queue.wake = Some(wake);
    }

    pub fn recv_timeout(&self, timeout: Duration) -> Result<SseEvent, RecvTimeoutError> {
        let deadline = Instant::now() + timeout;
        let mut queue = self.shared.queue.lock().expect("SSE queue lock");
        loop {
            if let Some(event) = queue.event.take() {
                return Ok(event);
            }
            if queue.senders == 0 {
                return Err(RecvTimeoutError::Disconnected);
            }
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return Err(RecvTimeoutError::Timeout);
            };
            let (next, waited) = self
                .shared
                .ready
                .wait_timeout(queue, remaining)
                .expect("SSE queue wait");
            queue = next;
            if waited.timed_out() && queue.event.is_none() {
                return Err(RecvTimeoutError::Timeout);
            }
        }
    }
}

impl Drop for SseReceiver {
    fn drop(&mut self) {
        let mut queue = self.shared.queue.lock().expect("SSE queue lock");
        queue.receiver_alive = false;
        queue.event = None;
        self.shared.ready.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event(value: usize) -> SseEvent {
        SseEvent {
            seq: Some(value as u64),
            data: json!({ "value": value, "padding": "x".repeat(1_000_000) }),
            terminal: false,
        }
    }

    #[test]
    fn shared_stream_wakes_for_coalesced_events_and_disconnection() {
        let (sender, receiver) = queue();
        let (wake, ready) = std::sync::mpsc::sync_channel(1);
        receiver.notify_on(wake);
        ready.try_recv().unwrap();
        sender.send_latest(event(1)).ok().unwrap();
        sender.send_latest(event(2)).ok().unwrap();
        ready.try_recv().unwrap();
        assert!(ready.try_recv().is_err());
        assert_eq!(receiver.recv_timeout(Duration::ZERO).unwrap().seq, Some(2));
        drop(sender);
        ready.try_recv().unwrap();
        assert!(matches!(
            receiver.recv_timeout(Duration::ZERO),
            Err(RecvTimeoutError::Disconnected)
        ));
    }

    #[test]
    fn a_non_reading_client_has_one_bounded_slot() {
        let (sender, receiver) = queue();
        assert!(sender.try_send(event(1)).is_ok());
        for value in 2..100 {
            assert!(matches!(
                sender.try_send(event(value)),
                Err(SendError::Full)
            ));
        }
        assert_eq!(receiver.recv_timeout(Duration::ZERO).unwrap().seq, Some(1));
    }

    #[test]
    fn live_updates_coalesce_to_the_latest_frame() {
        let (sender, receiver) = queue();
        assert!(sender.send_latest(event(1)).is_ok());
        assert!(sender.send_latest(event(2)).is_ok());
        assert_eq!(receiver.recv_timeout(Duration::ZERO).unwrap().seq, Some(2));
    }
}
