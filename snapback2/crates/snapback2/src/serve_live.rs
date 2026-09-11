//! One SSE connection carries independently authorized live queries and channels.
// @ref LLP 1002#4-the-wire — multiplexing changes framing, not query/session authority.
use super::*;
use crate::writer::SseSender;
use std::sync::mpsc::{self, SyncSender};
const MAX_SUBSCRIPTIONS: usize = 256;
#[derive(Clone, Default)]
pub(super) struct Streams(Arc<Mutex<BTreeMap<String, Connection>>>);
#[derive(Clone)]
struct Connection {
    identity: Identity,
    commands: SyncSender<Command>,
    wake: SyncSender<()>,
}
struct Command {
    body: Json,
    reply: SyncSender<Result<Json, Refusal>>,
}
struct Child {
    receiver: SseReceiver,
    drop_action: Option<DropAction>,
}

// A transport counts once even when it has no children or many children.
pub(super) struct ConnectedStream {
    handle: OwnerHandle,
    id: Option<u64>,
}
impl ConnectedStream {
    pub(super) fn open(
        handle: &OwnerHandle,
        identity: &Identity,
        events: SseSender,
    ) -> Result<Self, Refusal> {
        let id = handle
            .call(Action::ConnectedOpen {
                identity: identity.clone(),
                events,
            })?
            .as_u64();
        Ok(Self {
            handle: handle.clone(),
            id,
        })
    }
}
impl Drop for ConnectedStream {
    fn drop(&mut self) {
        if let Some(id) = self.id {
            let _ = self.handle.call(Action::ConnectedClose { id });
        }
    }
}
fn invalid(message: &str) -> Refusal {
    Refusal::input(message, "use the installed client's live transport")
}
pub(super) fn handle(
    request: Request,
    context: &Context,
    streams: Streams,
    identity: Identity,
    body: Json,
    control: bool,
    worker: &mut HttpWorker,
) {
    if control {
        let connection = streams
            .0
            .lock()
            .expect("live streams lock")
            .get(
                body.get("session")
                    .and_then(Json::as_str)
                    .unwrap_or_default(),
            )
            .cloned();
        let result = match connection.filter(|entry| entry.identity == identity) {
            Some(connection) => {
                let (reply, answer) = mpsc::sync_channel(1);
                match connection.commands.try_send(Command { body, reply }) {
                    Ok(()) => {
                        let _ = connection.wake.try_send(());
                        answer
                            .recv_timeout(Duration::from_secs(10))
                            .unwrap_or_else(|_| {
                                Err(Refusal::owner(
                                    "E_OWNER_BUSY",
                                    "live control did not settle",
                                    "reconnect the live stream",
                                ))
                            })
                    }
                    Err(_) => Err(Refusal::owner(
                        "E_OWNER_BUSY",
                        "live control queue is full or closed",
                        "reconnect the live stream",
                    )),
                }
            }
            None => Err(invalid(
                "live session is closed or belongs to another authority",
            )),
        };
        match result {
            Ok(value) => respond_json(request, 200, value, &context.mode),
            Err(error) => respond_refusal(request, refusal_status(&error), error, &context.mode),
        }
        return;
    }
    let mut bytes = [0_u8; 32];
    if getrandom::fill(&mut bytes).is_err() {
        respond_refusal(
            request,
            500,
            Refusal::owner(
                "E_OWNER_SECRET",
                "live session randomness unavailable",
                "restore the platform random source",
            ),
            &context.mode,
        );
        return;
    }
    let session = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let (commands, incoming) = mpsc::sync_channel::<Command>(32);
    let (wake, ready) = mpsc::sync_channel(1);
    let (events, revoked) = sse_queue();
    revoked.notify_on(wake.clone());
    let _connected = match ConnectedStream::open(&context.handle, &identity, events) {
        Ok(connected) => connected,
        Err(error) => {
            respond_refusal(request, refusal_status(&error), error, &context.mode);
            return;
        }
    };
    streams.0.lock().expect("live streams lock").insert(
        session.clone(),
        Connection {
            identity: identity.clone(),
            commands,
            wake: wake.clone(),
        },
    );
    let mut children = BTreeMap::<String, Child>::new();
    let mut writer = request.into_writer();
    let cors = if context.mode == "dev" {
        "Access-Control-Allow-Origin: *\r\n"
    } else {
        ""
    };
    let mut release_reply = None;
    let run = (|| -> std::io::Result<()> {
        write!(
            writer,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nX-Accel-Buffering: no\r\nTransfer-Encoding: chunked\r\n{cors}\r\n"
        )?;
        frame(&mut writer, &json!({ "session": session }))?;
        while !context.stop.load(Ordering::SeqCst) {
            let waited = ready.recv_timeout(Duration::from_secs(15));
            if let Ok(event) = revoked.recv_timeout(Duration::ZERO) {
                frame(
                    &mut writer,
                    &json!({ "data": event.data, "terminal": true }),
                )?;
                return Ok(());
            }
            for command in incoming.try_iter() {
                let close = command.body.get("close") == Some(&Json::Bool(true));
                let result = update(
                    &command.body,
                    &mut children,
                    &context.handle,
                    &identity,
                    &wake,
                );
                if close {
                    release_reply = Some((command.reply, result));
                    return Ok(());
                }
                let _ = command.reply.send(result);
            }
            let mut removed = Vec::new();
            for (id, child) in &children {
                match child.receiver.recv_timeout(Duration::ZERO) {
                    Ok(event) => {
                        frame(
                            &mut writer,
                            &json!({ "id": id, "seq": event.seq, "data": event.data, "terminal": event.terminal }),
                        )?;
                        if event.terminal {
                            removed.push(id.clone());
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        frame(&mut writer, &json!({ "id": id, "closed": true }))?;
                        removed.push(id.clone());
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                }
            }
            for id in removed {
                remove(&mut children, &id, &context.handle);
            }
            if waited == Err(RecvTimeoutError::Timeout) {
                chunk(&mut writer, ": heartbeat\n\n")?;
            }
        }
        Ok(())
    })();
    streams
        .0
        .lock()
        .expect("live streams lock")
        .remove(&session);
    for (_, child) in children {
        unsubscribe(child, &context.handle);
    }
    if run.is_ok() {
        let _ = writer.write_all(b"0\r\n\r\n");
        let _ = writer.flush();
    }
    if let Some((reply, result)) = release_reply {
        // @ref LLP 1002#4-the-wire — a close acknowledgement is also the
        // bounded-worker release boundary, so a successor transport may open
        // immediately without racing the retired physical connection.
        worker.reply_after_release(reply, result);
    }
}
fn chunk(writer: &mut impl Write, payload: &str) -> std::io::Result<()> {
    write!(writer, "{:x}\r\n{payload}\r\n", payload.len())?;
    writer.flush()
}
fn frame(writer: &mut impl Write, value: &Json) -> std::io::Result<()> {
    chunk(writer, &format!("data: {value}\n\n"))
}
fn update(
    body: &Json,
    children: &mut BTreeMap<String, Child>,
    handle: &OwnerHandle,
    identity: &Identity,
    wake: &SyncSender<()>,
) -> Result<Json, Refusal> {
    if body.get("close") == Some(&Json::Bool(true)) {
        return Ok(json!({ "ok": true }));
    }
    let empty = Vec::new();
    let adds = body
        .get("add")
        .map(Json::as_array)
        .unwrap_or(Some(&empty))
        .ok_or_else(|| invalid("add must be an array"))?;
    let removes = body
        .get("remove")
        .map(Json::as_array)
        .unwrap_or(Some(&empty))
        .ok_or_else(|| invalid("remove must be an array"))?;
    for id in removes {
        let id = id
            .as_str()
            .ok_or_else(|| invalid("remove ids must be strings"))?;
        remove(children, id, handle);
    }
    if adds.len() + children.len() > MAX_SUBSCRIPTIONS {
        return Err(Refusal::owner(
            "E_OWNER_BUSY",
            "a live connection supports at most 256 subscriptions",
            "close unused subscriptions",
        ));
    }
    let mut ids = std::collections::BTreeSet::new();
    for entry in adds {
        let id = entry
            .get("id")
            .and_then(Json::as_str)
            .ok_or_else(|| invalid("a subscription needs an id"))?;
        if id.is_empty() || id.len() > 64 || children.contains_key(id) || !ids.insert(id) {
            return Err(invalid("subscription ids must be unique and 1..64 bytes"));
        }
        if !entry.get("path").is_some_and(Json::is_string) {
            return Err(invalid("a subscription needs a path"));
        }
    }
    for entry in adds {
        let id = entry["id"].as_str().unwrap().to_owned();
        let (path, query) = split_url(entry["path"].as_str().unwrap());
        let (sender, receiver) = sse_queue();
        receiver.notify_on(wake.clone());
        let result = (|| {
            let args = parse_query_json(query.get("args").unwrap_or("{}"))?;
            if path == "/api/subscribe" {
                handle
                    .subscribe(
                        query.get("op").unwrap_or_default().to_owned(),
                        args,
                        identity.clone(),
                        offline_options(&Json::Null, &query),
                        sender.clone(),
                    )
                    .map(|meta| DropAction::Live(meta["id"].as_u64().unwrap()))
            } else if let Some(name) = channel_name(&path, "/subscribe") {
                handle
                    .call(Action::ChannelSubscribe {
                        name,
                        args,
                        identity: identity.clone(),
                        events: sender.clone(),
                    })
                    .map(|meta| DropAction::Channel(meta["id"].as_u64().unwrap()))
            } else {
                Err(invalid(
                    "live children must be query or channel subscriptions",
                ))
            }
        })();
        let drop_action = match result {
            Ok(action) => Some(action),
            Err(error) => {
                let mut data = refusal_json(&error);
                data["state"] = json!("refused");
                let _ = sender.send_latest(SseEvent {
                    seq: None,
                    data,
                    terminal: true,
                });
                None
            }
        };
        children.insert(
            id,
            Child {
                receiver,
                drop_action,
            },
        );
    }
    Ok(json!({ "ok": true }))
}
fn remove(children: &mut BTreeMap<String, Child>, id: &str, handle: &OwnerHandle) {
    if let Some(child) = children.remove(id) {
        unsubscribe(child, handle);
    }
}
fn unsubscribe(child: Child, handle: &OwnerHandle) {
    match child.drop_action {
        Some(DropAction::Live(id)) => handle.unsubscribe(id),
        Some(DropAction::Channel(id)) => {
            let _ = handle.call(Action::ChannelUnsubscribe { id });
        }
        None => {}
    }
}
