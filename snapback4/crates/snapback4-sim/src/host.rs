//! The server as a simulated host: the real engine over an in-memory store,
//! answering the same three requests the wire carries (query, mutation,
//! sync) as JSON messages under the virtual clock. Durability is the
//! store's; a kill loses only what was in flight.

use crate::world::{Ctx, Event, Host};
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, WriteState, wire};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

pub struct ServerHost {
    engine: Rc<RefCell<Engine>>,
    served: u64,
}

impl ServerHost {
    pub fn factory(engine: Rc<RefCell<Engine>>) -> crate::world::HostFactory {
        Box::new(move || Box::new(ServerHost { engine: engine.clone(), served: 0 }))
    }
}

fn args_of(engine: &Engine, op: &str, json: &Json) -> Result<BTreeMap<String, snapback4_core::Value>, String> {
    let program = engine.program(op).ok_or_else(|| format!("unknown op {op}"))?;
    let mut args = BTreeMap::new();
    if let Json::Object(fields) = json {
        for (name, value) in fields {
            let kind = program.args.get(name).ok_or_else(|| format!("{op} takes no {name}"))?;
            args.insert(name.clone(), wire::from_json(kind, value)?);
        }
    }
    Ok(args)
}

impl Host for ServerHost {
    fn start(&mut self, ctx: &mut Ctx<'_>) {
        let seq = self.engine.borrow().seq().unwrap_or(0);
        ctx.log(format!("server up at seq {seq}"));
    }

    fn on(&mut self, ctx: &mut Ctx<'_>, event: Event) {
        let Event::Deliver { from, payload } = event else { return };
        let Ok(message) = serde_json::from_slice::<Json>(&payload) else { return };
        self.served += 1;
        let rid = message.get("rid").cloned().unwrap_or(Json::Null);
        let viewer = message.get("viewer").and_then(Json::as_str).unwrap_or("").to_owned();
        let now = ctx.now as i64;
        let reply = match message.get("t").and_then(Json::as_str) {
            Some("q") => {
                let op = message.get("op").and_then(Json::as_str).unwrap_or("").to_owned();
                let mut engine = self.engine.borrow_mut();
                match args_of(&engine, &op, message.get("args").unwrap_or(&Json::Null)) {
                    Ok(args) => match engine.query(&op, Context::new(viewer, args).at(now)) {
                        Ok(outcome) => {
                            json!({ "t": "read", "rid": rid, "data": wire::to_json(&outcome.data), "complete": outcome.complete, "seq": outcome.seq, "next": outcome.next })
                        }
                        Err(refusal) => json!({ "t": "read", "rid": rid, "denied": refusal }),
                    },
                    Err(why) => {
                        json!({ "t": "read", "rid": rid, "denied": { "code": "E_INPUT", "family": "input", "message": why } })
                    }
                }
            }
            Some("m") => {
                let op = message.get("op").and_then(Json::as_str).unwrap_or("").to_owned();
                let id = message.get("id").and_then(Json::as_str).map(str::to_owned);
                let new_ids: Vec<String> = message.get("newIds").and_then(Json::as_array).map(|a| a.iter().filter_map(Json::as_str).map(str::to_owned).collect()).unwrap_or_default();
                let mut engine = self.engine.borrow_mut();
                // A resend of an applied write is answered before the current
                // generation gets to judge its shape.
                let replayed = id.as_deref().and_then(|id| engine.replay(&viewer, id).ok().flatten());
                if let Some(outcome) = replayed
                    && let WriteState::Sent { seq, result } = outcome.state
                {
                    json!({ "t": "write", "rid": rid, "id": id, "state": "sent", "seq": seq, "result": wire::to_json(&result), "replayed": true, "generation": engine.generation() })
                } else {
                    match args_of(&engine, &op, message.get("args").unwrap_or(&Json::Null)) {
                        Ok(args) => match engine.mutate(&op, id.as_deref(), Context::new(viewer, args).at(now).with_ids(new_ids)) {
                            Ok(outcome) => match outcome.state {
                                WriteState::Sent { seq, result } => {
                                    json!({ "t": "write", "rid": rid, "id": id, "state": "sent", "seq": seq, "result": wire::to_json(&result), "replayed": outcome.replayed, "generation": engine.generation() })
                                }
                                WriteState::Failed { why, .. } => {
                                    json!({ "t": "write", "rid": rid, "id": id, "state": "failed", "why": why, "generation": engine.generation() })
                                }
                            },
                            Err(error) => {
                                json!({ "t": "write", "rid": rid, "id": id, "state": "failed", "why": error.refusal() })
                            }
                        },
                        // A write authored under an older generation that no longer fits is
                        // judged, typed, never silently dropped.
                        Err(why) if engine.program(&op).is_none() => {
                            json!({ "t": "write", "rid": rid, "id": id, "state": "failed", "why": { "code": "E_GENERATION", "family": "generation", "message": format!("{op} is not an operation of generation {}; {why}", engine.generation()) }, "generation": engine.generation() })
                        }
                        Err(why) => {
                            json!({ "t": "write", "rid": rid, "id": id, "state": "failed", "why": { "code": "E_INPUT", "family": "input", "message": why }, "generation": engine.generation() })
                        }
                    }
                }
            }
            Some("sync") => {
                let from_seq = message.get("from").and_then(Json::as_u64).unwrap_or(0);
                let mut engine = self.engine.borrow_mut();
                if from_seq == 0 {
                    match engine.snapshot_at(&viewer, ctx.now as i64) {
                        Ok((events, watermark)) => {
                            let events: Vec<Json> = events.iter().map(|e| json!({ "table": e.table, "kind": e.kind.word(), "id": e.id, "data": e.data.as_ref().map(wire::to_json), "seq": watermark })).collect();
                            json!({ "t": "sync", "rid": rid, "snapshot": true, "events": events, "watermark": watermark, "more": false, "generation": engine.generation() })
                        }
                        Err(error) => json!({ "t": "sync", "rid": rid, "denied": error.refusal() }),
                    }
                } else {
                    match engine.stream_at(&viewer, from_seq, 200, ctx.now as i64) {
                        Ok(page) => {
                            let events: Vec<Json> = page.events.iter().map(|e| json!({ "table": e.table, "kind": e.kind, "id": e.id, "data": e.data.as_ref().map(wire::to_json), "seq": e.seq })).collect();
                            json!({ "t": "sync", "rid": rid, "snapshot": false, "events": events, "watermark": page.watermark, "more": page.more, "generation": engine.generation() })
                        }
                        Err(error) => json!({ "t": "sync", "rid": rid, "denied": error.refusal() }),
                    }
                }
            }
            _ => return,
        };
        ctx.send(from, reply.to_string());
    }

    fn state(&self) -> String {
        let engine = self.engine.borrow();
        let seq = engine.seq().unwrap_or(0);
        let counts: BTreeMap<String, u64> = engine.schema().tables.keys().map(|t| (t.clone(), engine.store().count(t).unwrap_or(0))).collect();
        let applied = engine.store().applied_ops().unwrap_or(0);
        json!({ "role": "server", "seq": seq, "served": self.served, "rows": counts, "applied": applied }).to_string()
    }
}
