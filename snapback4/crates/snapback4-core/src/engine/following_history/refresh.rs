//! Refresh only already published identities and the existing live inbox. It
//! never advances a history token or uses source floors on the device.
use super::*;
use crate::{
    engine::runner::Runner,
    ir::Expr,
    meter::{Cut, Meter},
};

#[derive(serde::Deserialize)]
pub struct Mounted {
    pub id: String,
    #[serde(default)]
    pub live: bool,
    #[serde(default)]
    pub authority: Vec<projection::Witness>,
}
#[derive(Debug, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub enum Refresh {
    Page {
        live: Vec<Item>,
        visible: Vec<String>,
    },
    Preparing {
        live: Vec<Item>,
        visible: Vec<String>,
        checked: Option<String>,
    },
    Restart,
    Refused {
        code: &'static str,
    },
}

impl Reader {
    pub fn refresh(
        &mut self,
        engine: &mut Engine,
        opening: &str,
        operation: &str,
        context: Context,
        mounted: &[Mounted],
    ) -> Result<Refresh, RuntimeError> {
        self.refresh_metered(engine, opening, operation, context, mounted)
            .map(|(response, _)| response)
    }
    /// Operator evidence only. The HTTP protocol serializes just the response.
    pub fn refresh_metered(
        &mut self,
        engine: &mut Engine,
        opening: &str,
        operation: &str,
        context: Context,
        mounted: &[Mounted],
    ) -> Result<(Refresh, Metered), RuntimeError> {
        self.refresh_slice_metered(engine, opening, operation, context, mounted, &[])
    }
    /// Continue using only public input identities: the unprocessed mounted
    /// suffix and live ids already returned in this refresh cycle. No private
    /// scan position or candidate count leaves the engine.
    pub fn refresh_slice_metered(
        &mut self,
        engine: &mut Engine,
        opening: &str,
        operation: &str,
        context: Context,
        mounted: &[Mounted],
        seen: &[String],
    ) -> Result<(Refresh, Metered), RuntimeError> {
        let mut b = Budget::new(engine.ceilings, 0);
        b.publication.heap_bytes = 4 << 20;
        let response =
            self.refresh_inner(engine, opening, operation, context, mounted, seen, &mut b)?;
        // Refusals still report every successful reservation/read. Refused
        // reservations themselves leave this ledger unchanged.
        Ok((response, b.used))
    }
    fn refresh_inner(
        &mut self,
        engine: &mut Engine,
        opening: &str,
        operation: &str,
        mut context: Context,
        mounted: &[Mounted],
        seen: &[String],
        b: &mut Budget,
    ) -> Result<Refresh, RuntimeError> {
        let refused = || Refresh::Refused {
            code: "E_FOLLOWING_REQUEST_TOO_SMALL",
        };
        if seen.len() > 100
            || seen.iter().any(|id| !crate::value::identity_fits(id))
            || mounted.len() > 100
            || mounted.iter().any(|m| {
                !crate::value::identity_fits(&m.id)
                    || m.authority.len() > 64
                    || m.authority.iter().any(|w| w.fields.len() > 128)
            })
        {
            return Ok(Refresh::Refused {
                code: "E_FOLLOWING_INPUT",
            });
        }
        let now = context.now.unwrap_or_else(crate::now_ms);
        let key = (context.viewer.clone(), opening.to_owned());
        let Some(s) = self.sessions.get(&key) else {
            return Ok(Refresh::Restart);
        };
        let Some(program) = engine.programs.get(operation) else {
            return Ok(Refresh::Restart);
        };
        super::super::validate::validate_inputs(&engine.schema, program, &mut context.args)?;
        let Some(plan) = projection::plan(&engine.schema, program) else {
            return Ok(Refresh::Restart);
        };
        let tx = engine.store.read_transaction()?;
        let head = tx.next_seq()?.saturating_sub(1);
        if s.abandoned
            || now.saturating_sub(s.touched) >= IDLE_MS
            || s.projection.as_deref() != Some(operation)
            || s.arguments != context.args
            || s.store != tx.meta("store_id")?.unwrap_or_default()
            || s.generation != engine.generation
            || head < s.head
        {
            return Ok(Refresh::Restart);
        }
        let t = engine
            .schema
            .timelines
            .iter()
            .find(|t| t.name == s.declaration)
            .unwrap();
        if !b.take(Metered {
            heap_bytes: SCRATCH,
            rows_written: 3,
            output_bytes: ENVELOPE,
            ..Default::default()
        }) {
            return Ok(refused());
        }
        let mut visible = Vec::new();
        let mut checked = None;
        let mut more = false;
        let mut wire_reserve = 128;
        for m in mounted {
            let mut encoded = Count(0);
            serde_json::to_writer(&mut encoded, &m.id)
                .map_err(|e| RuntimeError::Store(e.to_string()))?;
            // Reserve the possible visible id plus the echoed checked id before
            // probing. Even an all-visible batch must fit its current output.
            let publication = Metered {
                output_bytes: wire_reserve + 2 * (encoded.0 + 1),
                ..b.publication
            };
            let probe = Metered {
                examined: 4 + u64::from(m.live),
                ..budget::unit(false)
            };
            if !b.fits(budget::add(
                budget::add(probe, projection::reservation()),
                publication,
            )) {
                if checked.is_none() {
                    return Ok(refused());
                }
                more = true;
                break;
            }
            assert!(b.take(probe));
            if current(&tx, t, s, &m.id, m.live)?.is_some_and(|(_, old)| old || m.live) {
                // These are public row/field identities previously disclosed in
                // the card. Untrusted witnesses can only ask ordinary authorized
                // point reads; private owned tables are refused by Runner::get.
                let (allowed, used) =
                    projection::authorized(&tx, &engine.schema, s, &m.authority, now)?;
                assert!(b.take(used));
                if allowed {
                    visible.push(m.id.clone());
                }
            }
            checked = Some(m.id.clone());
            wire_reserve += encoded.0 + 1;
        }
        let mut live = Vec::new();
        // Authorization and live shaping use separate request slices.
        if mounted.is_empty() {
            // Reserve the ordinary inbox evaluation separately; it only drives the
            // live layer. Failure cannot claim an empty live layer or withdraw history.
            let live_limit = Ceilings {
                examined: 1024,
                index_entries: 2048,
                rule_probes: 2048,
                steps: 65536,
                heap_bytes: 2 << 20,
                output_bytes: 256 << 10,
                rows_written: 0,
            };
            let cost = Metered {
                examined: 1024 + 4 * 100,
                index_entries: 2048,
                rule_probes: 2048 + 2 * 100,
                steps: 65536 + 128 * 100,
                heap_bytes: 2 << 20,
                ..Default::default()
            };
            if !b.work(cost, 1) {
                return Ok(refused());
            }
            let mut runner = Runner::new(
                &tx,
                &engine.schema,
                context,
                Meter::new(live_limit, Cut::Abort),
                head,
            );
            let copies = runner.expr(&Expr::Scan(plan.scan.clone()))?;
            for copy in copies.as_array()? {
                // The ordinary scan has a fixed reservation, independent of hidden
                // copies. Shaping cuts only at a currently visible event.
                // Charge the fixed reservation before occupancy, just as traversal.
                let id = copy.field("eventId")?.as_str()?;
                if seen.iter().any(|seen| seen == id) {
                    continue;
                }
                if let Some((event, false)) = current(&tx, t, s, id, false)? {
                    if !b.fits(budget::add(projection::reservation(), b.publication)) {
                        if live.is_empty() {
                            return Ok(refused());
                        }
                        more = true;
                        break;
                    }
                    let (item, _, used) =
                        projection::shape(&tx, &engine.schema, &plan, s, &event, now)?;
                    assert!(b.take(used));
                    // A fitting card starts a fresh slice when this one's encoded
                    // reply is full. Its work remains metered even on this cut.
                    let mut count = Count(0);
                    serde_json::to_writer(&mut count, &item)
                        .map_err(|e| RuntimeError::Store(e.to_string()))?;
                    let held = live.iter().map(|i: &Item| i.retained_bytes()).sum::<u64>();
                    if !b.fits(Metered {
                        output_bytes: held + count.0 + ENVELOPE,
                        heap_bytes: (held + count.0 + ENVELOPE) * 4,
                        ..Default::default()
                    }) {
                        if live.is_empty() {
                            return Ok(refused());
                        }
                        more = true;
                        break;
                    }
                    live.push(item);
                }
            }
        }
        let response = if more {
            Refresh::Preparing {
                live,
                visible,
                checked,
            }
        } else {
            Refresh::Page { live, visible }
        };
        let mut count = Count(0);
        serde_json::to_writer(&mut count, &response)
            .map_err(|e| RuntimeError::Store(e.to_string()))?;
        if !b.take(Metered {
            output_bytes: count.0,
            heap_bytes: count.0 * 4,
            ..Default::default()
        }) {
            return Ok(refused());
        }
        drop(tx);
        let s = self.sessions.get_mut(&key).unwrap();
        self.expiry
            .remove(&(s.touched.saturating_add(IDLE_MS), key.clone()));
        s.touched = now.max(s.touched);
        s.head = head;
        self.expiry.insert((s.touched.saturating_add(IDLE_MS), key));
        Ok(response)
    }
}

fn current(
    tx: &Tx<'_>,
    t: &Timeline,
    s: &Session,
    id: &str,
    require_copy: bool,
) -> Result<Option<(Event, bool)>, RuntimeError> {
    let Some(row) = tx.history_point(&t.table("Posts"), id)? else {
        return Ok(None);
    };
    let event = Event::row(row)?;
    let epoch = if event.actor == s.viewer {
        Value::Null
    } else {
        let id = crate::schema::timeline::owned_id(
            &t.name,
            "Edges",
            &[Value::Id(s.viewer.clone()), Value::Id(event.actor.clone())],
        );
        let Some(edge) = tx.history_point(&t.table("Edges"), &id)? else {
            return Ok(None);
        };
        edge.field("epoch")?.clone()
    };
    if require_copy {
        // Mounted live previews retain the inbox predicate, including the copy's
        // current edge epoch. A refollow must not authorize an old copy outside
        // its new delivery window merely because the actor is followed again.
        let id = crate::schema::timeline::owned_id(
            &t.name,
            "Feed",
            &[
                Value::Id(s.viewer.clone()),
                Value::Id(event.id.clone()),
                epoch.clone(),
            ],
        );
        if tx.history_point(&t.table("Feed"), &id)?.is_none() {
            return Ok(None);
        }
    }
    let old_edge = epoch == Value::Null || epoch.as_str()? <= s.bound.as_str();
    Ok(match read::birth(tx, t, &s.bound, &event)? {
        read::Live::Yes => Some((event, old_edge)),
        read::Live::Later => Some((event, false)),
        _ => None,
    })
}

struct Count(u64);
impl std::io::Write for Count {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0 = self.0.saturating_add(bytes.len() as u64);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
