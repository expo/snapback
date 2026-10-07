//! One accepted unit advances and pins its reply before the host can observe it.
//! Errors abandon the revision; no application writes occur in this state machine.
use super::*;
use read::Live;

pub(super) fn replay(
    tx: &Tx<'_>,
    schema: &crate::schema::Schema,
    t: &Timeline,
    s: &Session,
    u: &Unit,
    mut b: Budget,
    now: i64,
) -> Result<Outcome, RuntimeError> {
    let count = u.witnesses.len() as u64;
    let cost = Metered {
        examined: count * 4,
        rule_probes: count * 2,
        steps: count * 128,
        output_bytes: (u.answer.bytes.len() as u64).saturating_sub(ENVELOPE),
        rows_written: 1,
        ..Default::default()
    };
    if !b.take(cost) {
        return simple(
            Response::Refused {
                code: "E_FOLLOWING_REQUEST_TOO_SMALL",
            },
            b,
        );
    }
    for h in &u.witnesses {
        if !matches!(read::live(tx, t, s, h)?, Live::Yes) {
            return simple(Response::Restart, b);
        }
    }
    for cards in &u.cards {
        if !b.fits(projection::reservation()) {
            return simple(
                Response::Refused {
                    code: "E_FOLLOWING_REQUEST_TOO_SMALL",
                },
                b,
            );
        }
        let (visible, used) = projection::authorized(tx, schema, s, cards, now)?;
        assert!(b.take(used));
        if !visible {
            return simple(Response::Restart, b);
        }
    }
    Ok(Outcome {
        answer: u.answer.clone(),
        metered: b.used,
        frontier_writes: 0,
    })
}

pub(super) fn advance(
    tx: &Tx<'_>,
    schema: &crate::schema::Schema,
    projection: Option<&projection::Plan<'_>>,
    now: i64,
    t: &Timeline,
    s: &mut Session,
    mut b: Budget,
    session_limit: u64,
    total_limit: u64,
) -> Result<Outcome, RuntimeError> {
    let mut obstructed = false;
    let mut progress = false;
    let mut ready = false;
    loop {
        // A replacement must be found before another winner is selected.
        if let Some(lane) = &s.pending {
            if !b.work(budget::unit(true), s.checkpoint() + 1) {
                break;
            }
            let lane = lane.clone();
            if !read::edge(tx, t, &s.viewer, &lane)? {
                s.pending = None;
                progress = true;
                continue;
            }
            let Some(event) = read::next_event(tx, t, &lane)? else {
                s.pending = None;
                progress = true;
                continue;
            };
            let disposition = read::birth(tx, t, &s.bound, &event)?;
            let position = event.position();
            if !matches!(disposition, Live::Yes) {
                obstructed |= matches!(disposition, Live::Later);
                s.pending.as_mut().unwrap().after = Some(position);
                progress = true;
                continue;
            }
            let head = Head {
                lane: Lane {
                    after: Some(position),
                    ..lane
                },
                event,
            };
            let extra = s.frontier.extra(&head);
            if s.bytes().saturating_add(extra) > session_limit.min(total_limit) {
                if progress {
                    break;
                }
                return simple(
                    Response::Refused {
                        code: "E_FOLLOWING_QUOTA",
                    },
                    b,
                );
            }
            let copied = s.frontier.copy_bytes(head.lane.block);
            if !b.work(
                Metered {
                    heap_bytes: extra + copied,
                    ..Default::default()
                },
                s.checkpoint() + 1,
            ) {
                break;
            }
            s.dirty.insert(head.lane.block);
            s.frontier.put(head);
            s.pending = None;
            progress = true;
            continue;
        }
        if !s.discovered {
            // In particular, do not seek a head after discovery's reservation fails.
            if !b.work(
                Metered {
                    examined: 1,
                    index_entries: 1,
                    steps: 32,
                    ..Default::default()
                },
                s.checkpoint(),
            ) {
                break;
            }
            let Some(edge) = read::next_edge(tx, t, s)? else {
                s.discovered = true;
                progress = true;
                continue;
            };
            let actor = edge.field("actorId")?.as_str()?.to_owned();
            let epoch = edge.field("epoch")?.as_str()?.to_owned();
            s.edge_after = Some(vec![Value::Id(actor.clone()), edge.field("id")?.clone()]);
            progress = true;
            // A self edge is never an eligible roster lane, regardless of birth.
            if actor == s.viewer {
                continue;
            }
            if epoch > s.bound {
                // Post-bound follow churn can obstruct the discovery range just
                // as post-bound backdated births can obstruct an event lane.
                obstructed = true;
                continue;
            }
            s.pending = Some(Lane {
                actor,
                epoch: Some(epoch),
                after: s.after.clone(),
                block: s.lanes / BLOCK_HEADS,
            });
            s.lanes += 1;
            continue;
        }
        if s.staged.len() >= s.page_size || s.frontier.peek().is_none() {
            ready = true;
            break;
        }
        let head = s.frontier.peek().unwrap();
        if !b.work(
            Metered {
                heap_bytes: head.bytes() + s.frontier.copy_bytes(head.lane.block),
                ..budget::unit(false)
            },
            s.checkpoint() + 1,
        ) {
            break;
        }
        let live = read::live(tx, t, s, head)?;
        if !matches!(live, Live::Yes) {
            let head = s.frontier.pop().unwrap();
            s.dirty.insert(head.lane.block);
            if !matches!(live, Live::LaneGone) {
                s.pending = Some(head.lane);
            }
            progress = true;
            continue;
        }
        let (mut item, mut cards) = if let Some(plan) = projection {
            if !b.fits(budget::add(projection::reservation(), b.publication)) {
                break;
            }
            let (item, cards, used) = projection::shape(tx, schema, plan, s, &head.event, now)?;
            assert!(b.take(used));
            (item, cards)
        } else {
            (Item::Event(head.event.clone()), Vec::new())
        };
        let page_output = if projection.is_some() {
            b.remaining_output().min(256 << 10)
        } else {
            b.remaining_output()
        };
        let mut bytes = serde_json::to_string(&item).unwrap().len() as u64 + 1;
        if bytes > page_output || projection.is_some() && item.retained_bytes() > (1 << 20) {
            cards.clear();
            item = Item::Omitted {
                id: head.event.id.clone(),
                at: head.event.at.to_string(),
                code: "E_FOLLOWING_ROW_TOO_LARGE",
            };
            bytes = serde_json::to_string(&item).unwrap().len() as u64 + 1;
        }
        if bytes > page_output {
            return simple(
                Response::Refused {
                    code: "E_FOLLOWING_REQUEST_TOO_SMALL",
                },
                b,
            );
        }
        if s.item_bytes + bytes > page_output {
            ready = true;
            break;
        }
        let card_bytes = cards.iter().map(projection::Witness::bytes).sum::<u64>();
        let payload = if projection.is_some() {
            item.retained_bytes() + bytes * 2
        } else {
            bytes * 8
        };
        let staged_bytes = head.bytes() + payload + 256 + card_bytes;
        // The fixed publication reservation covers two copies of at most 1 MiB
        // of staged card objects. A fitting next card begins another page.
        if projection.is_some() && !s.staged.is_empty() && s.staged_bytes + staged_bytes > (1 << 20)
        {
            ready = true;
            break;
        }
        // The existing head allocation is transferred; the projection copy is new.
        let growth = payload + 256 + card_bytes;
        if s.bytes().saturating_add(growth) > session_limit.min(total_limit) {
            if progress {
                break;
            }
            return simple(
                Response::Refused {
                    code: "E_FOLLOWING_QUOTA",
                },
                b,
            );
        }
        if !b.work(
            Metered {
                heap_bytes: growth,
                ..Default::default()
            },
            s.checkpoint() + 1,
        ) {
            break;
        }
        let head = s.frontier.pop().unwrap();
        s.dirty.insert(head.lane.block);
        s.pending = Some(head.lane.clone());
        s.item_bytes += bytes;
        s.staged_bytes += staged_bytes;
        s.staged.push(Staged {
            cards,
            head,
            item,
            bytes: staged_bytes,
            item_bytes: bytes,
        });
        progress = true;
    }

    if !ready && !progress {
        return simple(
            Response::Refused {
                code: "E_FOLLOWING_REQUEST_TOO_SMALL",
            },
            b,
        );
    }
    if ready {
        let n = s.staged.len() as u64;
        if !b.take(Metered {
            examined: n * 4,
            rule_probes: n * 2,
            steps: n * 128,
            ..Default::default()
        }) {
            return simple(Response::Refused { code: "E_FOLLOWING_REQUEST_TOO_SMALL" }, b);
        }
        for staged in &s.staged {
            if !staged.cards.is_empty() {
                if !b.fits(projection::reservation()) {
                    return simple(
                        Response::Refused {
                            code: "E_FOLLOWING_REQUEST_TOO_SMALL",
                        },
                        b,
                    );
                }
                let (visible, used) = projection::authorized(tx, schema, s, &staged.cards, now)?;
                assert!(b.take(used));
                if !visible {
                    return simple(Response::Restart, b);
                }
            }
            if !matches!(read::live(tx, t, s, &staged.head)?, Live::Yes) {
                s.abandoned = true;
                return simple(Response::Restart, b);
            }
        }
    }
    let end = ready && s.frontier.peek().is_none() && s.pending.is_none() && s.discovered;
    let next = if end { None } else { Some(token()?) };
    let retain_frontier = s.retained || !ready;
    let frontier_writes = if retain_frontier { s.dirty.len() as u64 } else { 0 };
    // Authority probes can consume the fixed publication reserve. Preflight a
    // conservative response size BEFORE cloning cards or encoding pinned bytes.
    let wire_bound = ENVELOPE + if ready { s.item_bytes } else { 0 };
    let heap_bound = if projection.is_some() {
        wire_bound * 2 + 512 + if ready {
            s.staged.iter().map(|x| x.item.retained_bytes()).sum::<u64>()
        } else { 0 }
    } else { wire_bound * 4 + 512 };
    if !b.fits(Metered {
        rows_written: frontier_writes + 5,
        heap_bytes: heap_bound,
        steps: 64,
        output_bytes: wire_bound.saturating_sub(ENVELOPE),
        ..Default::default()
    }) {
        return simple(Response::Refused { code: "E_FOLLOWING_REQUEST_TOO_SMALL" }, b);
    }
    let response = if ready {
        Response::Page {
            items: s.staged.iter().map(|x| x.item.clone()).collect(),
            next: next.clone(),
        }
    } else if obstructed {
        Response::Stalled {
            next: next.clone().unwrap(),
        }
    } else {
        Response::Preparing {
            next: next.clone().unwrap(),
        }
    };
    let answer = pinned(response);
    let response_bytes = if projection.is_some() {
        answer.bytes.len() as u64 * 2
            + 512
            + if ready { s.staged.iter().map(|x| x.item.retained_bytes()).sum::<u64>() } else { 0 }
    } else {
        answer.bytes.len() as u64 * 4 + 512
    };
    let witnesses_bytes = if ready {
        s.staged
            .iter()
            .map(|x| x.head.bytes() + x.cards.iter().map(projection::Witness::bytes).sum::<u64>())
            .sum::<u64>()
    } else {
        0
    };
    let keep_bytes = response_bytes + witnesses_bytes;
    // Two replies suffice for one consumer's lost/reordered response retry. An
    // older token restarts; it cannot advance the new pending unit.
    let released = s
        .units
        .front()
        .filter(|_| s.units.len() >= 2)
        .map_or(0, |u| u.bytes);
    let projected = s
        .bytes()
        .saturating_sub(released)
        .saturating_sub(if ready { s.staged_bytes } else { 0 })
        .saturating_sub(if !retain_frontier {
            s.frontier.bytes
        } else {
            0
        })
        .saturating_add(keep_bytes);
    if projected > session_limit.min(total_limit) {
        s.abandoned = true;
        return simple(
            Response::Refused {
                code: "E_FOLLOWING_QUOTA",
            },
            b,
        );
    }
    let cost = Metered {
        rows_written: frontier_writes + 5,
        heap_bytes: response_bytes,
        steps: 64,
        output_bytes: (answer.bytes.len() as u64).saturating_sub(ENVELOPE),
        ..Default::default()
    };
    if !b.take(cost) {
        return simple(Response::Refused { code: "E_FOLLOWING_REQUEST_TOO_SMALL" }, b);
    }
    let mut witnesses = Vec::new();
    let mut cards = Vec::new();
    if ready {
        if let Some(last) = s.staged.last() {
            s.after = Some(last.head.event.position());
        }
        for x in std::mem::take(&mut s.staged) {
            witnesses.push(x.head);
            cards.push(x.cards);
        }
        s.staged_bytes = 0;
        s.item_bytes = 0;
        if !retain_frontier {
            s.reset_scan();
        }
    }
    s.retained = retain_frontier;
    if s.units.len() >= 2 {
        s.units.pop_front();
    }
    s.units.push_back(Arc::new(Unit {
        token: s.pending_token.clone(),
        answer: answer.clone(),
        witnesses,
        cards,
        bytes: keep_bytes,
    }));
    s.pending_token = next.unwrap_or_default();
    s.dirty.clear();
    Ok(Outcome {
        answer,
        metered: b.used,
        frontier_writes,
    })
}

impl Reader {
    /// At most the admitted number of records is reclaimed. Physical custody,
    /// rather than a cancellation/expiry flag, releases the accounted quota.
    pub fn reclaim(&mut self, now: i64, ceilings: Ceilings) -> Metered {
        let mut b = Budget::new(ceilings, 0);
        while let Some((deadline, key)) = self.expiry.first() {
            if *deadline > now {
                break;
            }
            if !b.take(Metered {
                examined: 1,
                steps: 2048,
                heap_bytes: LIFECYCLE_SCRATCH,
                rows_written: 1,
                ..Default::default()
            }) {
                break;
            }
            let (deadline, key) = (*deadline, key.clone());
            self.expiry.remove(&(deadline, key.clone()));
            if let Some(o) = self.openings.remove(&key) {
                self.bytes -= SESSION_BASE;
                let view = (key.0, o.declaration);
                let n = self.counts.get_mut(&view).unwrap();
                *n -= 1;
                if *n == 0 {
                    self.counts.remove(&view);
                }
                continue;
            }
            let s = self.sessions.get_mut(&key).unwrap();
            let old = s.bytes();
            s.abandoned = true;
            if let Some(staged) = s.staged.pop() {
                s.staged_bytes -= staged.bytes;
                s.item_bytes -= staged.item_bytes;
            } else if !s.frontier.reclaim_block() {
                if s.units.pop_front().is_none() {
                    let view = (s.viewer.clone(), s.declaration.clone());
                    self.sessions.remove(&key);
                    self.bytes -= old;
                    let n = self.counts.get_mut(&view).unwrap();
                    *n -= 1;
                    if *n == 0 {
                        self.counts.remove(&view);
                    }
                    continue;
                }
            }
            self.bytes = self.bytes - old + s.bytes();
            self.expiry.insert((i64::MIN, key));
        }
        b.used
    }
}
