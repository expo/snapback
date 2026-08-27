use super::{
    ApiError, ConnectionRegistry, LiveSocketTerminalObservation, PreparedConnectionAct, now_millis,
};
use crate::auth::admission::AdmissionLease;
use crate::ephemeral::RealtimePublicationPermit;
use crate::live_wire::LiveSocketServerFrame;
use crate::local::EphemeralApi;
use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket};
use futures_util::SinkExt;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Duration;

pub(super) struct AdmittedLiveWrite {
    pub(super) message: Message,
    pub(super) admission: AdmissionLease,
    pub(super) _publication_authority: Option<RealtimePublicationPermit>,
    pub(super) completed: oneshot::Sender<bool>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum LiveHandoffOutcome {
    Sent,
    Superseded,
    Failed,
}

pub(super) const TERMINAL_AUTH_CLOSE_CODE: u16 = 4401;
const LIVE_WRITE_HANDOFF_TIMEOUT: Duration = Duration::from_millis(5_000);

pub(super) async fn bounded_live_write<F, E>(write: F, close_by: tokio::time::Instant) -> bool
where
    F: std::future::Future<Output = Result<(), E>>,
{
    tokio::time::timeout_at(close_by, write)
        .await
        .is_ok_and(|result| result.is_ok())
}

async fn finish_terminal_live_write(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    event: crate::ephemeral::DeliveryTerminalEvent,
) {
    let frame = LiveSocketServerFrame::AuthError {
        code: event.code,
        reason: event.reason,
        authority_disposition: event.authority_disposition,
    };
    let payload = match serde_json::to_string(&frame) {
        Ok(payload) => payload,
        Err(_) => return,
    };
    let close_by = tokio::time::Instant::from_std(event.close_by);
    let _ = tokio::time::timeout_at(close_by, async {
        // Failure to send the typed frame never postpones the hard close.
        let _ = sender.send(Message::Text(payload.into())).await;
        let _ = sender
            .send(Message::Close(Some(CloseFrame {
                code: TERMINAL_AUTH_CLOSE_CODE,
                reason: Utf8Bytes::from_static("auth_error"),
            })))
            .await;
    })
    .await;
}

pub(super) async fn live_socket_writer(
    mut sender: futures_util::stream::SplitSink<WebSocket, Message>,
    mut writes: mpsc::Receiver<AdmittedLiveWrite>,
    mut terminal_writes: mpsc::Receiver<crate::ephemeral::DeliveryTerminalEvent>,
    notify: Arc<crate::ephemeral::DeliveryNotifier>,
    connection_id: String,
    generation: u64,
    terminal_observation: LiveSocketTerminalObservation,
) {
    loop {
        let write = tokio::select! {
            biased;
            Some(event) = terminal_writes.recv() => {
                terminal_observation.record(event);
                finish_terminal_live_write(&mut sender, event).await;
                break;
            }
            write = writes.recv() => write,
        };
        let Some(write) = write else {
            break;
        };
        let AdmittedLiveWrite {
            message,
            admission,
            _publication_authority: publication_authority,
            completed,
        } = write;
        if !notify.is_deliverable(&connection_id, generation) {
            let _ = completed.send(false);
            drop(publication_authority);
            drop(admission);
            if let Some(event) = notify.terminal_if_current(&connection_id, generation) {
                terminal_observation.record(event);
                finish_terminal_live_write(&mut sender, event).await;
            }
            break;
        }
        let mut terminal = None;
        let sent = tokio::select! {
            biased;
            Some(event) = terminal_writes.recv() => {
                terminal = Some(event);
                false
            },
            _ = admission.cancelled() => false,
            sent = bounded_live_write(
                sender.send(message),
                tokio::time::Instant::now() + LIVE_WRITE_HANDOFF_TIMEOUT,
            ) => sent,
        };
        let _ = completed.send(sent);
        // Quiescence depends on these guards, not on the socket close. Drop
        // them before a best-effort terminal frame or any subsequent await.
        drop(publication_authority);
        drop(admission);
        if let Some(event) = terminal {
            terminal_observation.record(event);
            finish_terminal_live_write(&mut sender, event).await;
            break;
        }
        if !sent {
            break;
        }
    }
}

pub(super) fn offer_terminal_live_write(
    terminal_writer: &mpsc::Sender<crate::ephemeral::DeliveryTerminalEvent>,
    event: crate::ephemeral::DeliveryTerminalEvent,
) {
    // This dedicated one-slot channel is never occupied by ordinary effects.
    // A failed offer means the writer has already stopped; it must not extend
    // the close deadline or resume ordinary draining.
    let _ = terminal_writer.try_send(event);
}

#[derive(Clone, Copy)]
pub(super) struct LiveHandoffCut<'a> {
    pub(super) writer: &'a mpsc::Sender<AdmittedLiveWrite>,
    pub(super) notify: &'a crate::ephemeral::DeliveryNotifier,
    pub(super) connection_id: &'a str,
    pub(super) generation: u64,
    pub(super) connections: &'a ConnectionRegistry,
    pub(super) connection_act: &'a PreparedConnectionAct,
}

pub(super) async fn send_live_with_admission(
    cut: LiveHandoffCut<'_>,
    message: Message,
    admission: &AdmissionLease,
    publication_authority: Option<RealtimePublicationPermit>,
    outbox_lease: Option<crate::ephemeral::OutboxDrainLease>,
    projection_outbox: Option<&EphemeralApi>,
) -> LiveHandoffOutcome {
    let LiveHandoffCut {
        writer,
        notify,
        connection_id,
        generation,
        connections,
        connection_act,
    } = cut;
    let _publication_handoff = match publication_authority.as_ref() {
        Some(authority) => match authority.begin_handoff() {
            Ok(handoff) => Some(handoff),
            Err(_) => return LiveHandoffOutcome::Failed,
        },
        None => None,
    };
    let (completed, completion) = oneshot::channel();
    // The complete frame crosses into the bounded writer queue under the same
    // mutex that retires an epoch. Socket I/O may await afterward, but no frame
    // can begin its writer handoff after the retirement cut.
    let write = AdmittedLiveWrite {
        message,
        admission: admission.clone(),
        _publication_authority: publication_authority,
        completed,
    };
    let handed_off = {
        connection_act
            .try_act(connections, now_millis(), Instant::now(), move || {
                let _publication = admission
                    .effect_guard("WebSocket writer handoff")
                    .map_err(ApiError::from)?;
                Ok(match (outbox_lease, projection_outbox) {
                    (Some(outbox_lease), _) => {
                        let outcome = outbox_lease.try_commit_if_current(
                            notify,
                            connection_id,
                            generation,
                            write,
                            writer,
                        );
                        // `act_if_current` released the notifier lock. Waking
                        // here preserves registry -> notifier -> outbox order.
                        outbox_lease.wake();
                        match outcome {
                            Some(crate::ephemeral::OutboxLeaseCommit::Committed) => {
                                LiveHandoffOutcome::Sent
                            }
                            Some(crate::ephemeral::OutboxLeaseCommit::Superseded(write)) => {
                                drop(write);
                                LiveHandoffOutcome::Superseded
                            }
                            Some(crate::ephemeral::OutboxLeaseCommit::OfferFailed(write)) => {
                                drop(write);
                                LiveHandoffOutcome::Failed
                            }
                            None => LiveHandoffOutcome::Failed,
                        }
                    }
                    (None, Some(ephemeral)) => {
                        let outcome = ephemeral.try_offer_projection_if_current(
                            connection_id,
                            generation,
                            &connection_act.effect_fence(),
                            write,
                            writer,
                        );
                        match outcome {
                            Some(crate::ephemeral::OutboxLeaseCommit::Committed) => {
                                LiveHandoffOutcome::Sent
                            }
                            Some(crate::ephemeral::OutboxLeaseCommit::Superseded(write)) => {
                                drop(write);
                                LiveHandoffOutcome::Superseded
                            }
                            Some(crate::ephemeral::OutboxLeaseCommit::OfferFailed(write)) => {
                                drop(write);
                                LiveHandoffOutcome::Failed
                            }
                            None => LiveHandoffOutcome::Failed,
                        }
                    }
                    (None, None) => {
                        if writer.try_send(write).is_ok() {
                            LiveHandoffOutcome::Sent
                        } else {
                            LiveHandoffOutcome::Failed
                        }
                    }
                })
            })
            .unwrap_or(LiveHandoffOutcome::Failed)
    };
    if handed_off != LiveHandoffOutcome::Sent {
        return handed_off;
    }
    if tokio::select! {
        biased;
        _ = admission.cancelled() => false,
        result = completion => result.unwrap_or(false),
    } {
        LiveHandoffOutcome::Sent
    } else {
        LiveHandoffOutcome::Failed
    }
}
