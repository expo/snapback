//! The inbox predicate extended to live owned events; narrow internal birth probes.
use super::*;

pub(super) enum Live {
    Yes,
    EventGone,
    LaneGone,
    Later,
}

fn owned(t: &Timeline, suffix: &str, key: &[Value]) -> String {
    crate::schema::timeline::owned_id(&t.name, suffix, key)
}

pub(super) fn edge(
    tx: &Tx<'_>,
    t: &Timeline,
    viewer: &str,
    lane: &Lane,
) -> Result<bool, RuntimeError> {
    let Some(epoch) = &lane.epoch else {
        return Ok(lane.actor == viewer);
    };
    let id = owned(
        t,
        "Edges",
        &[Value::Id(viewer.into()), Value::Id(lane.actor.clone())],
    );
    Ok(tx
        .history_point(&t.table("Edges"), &id)?
        .is_some_and(|r| r.field("epoch").ok().and_then(|v| v.as_str().ok()) == Some(epoch)))
}

/// Fixed reservations precede all these probes, whether a witness is present,
/// parked, done, missing, or carries a different private queue cursor/error.
pub(super) fn live(tx: &Tx<'_>, t: &Timeline, s: &Session, h: &Head) -> Result<Live, RuntimeError> {
    if !edge(tx, t, &s.viewer, &h.lane)? {
        return Ok(Live::LaneGone);
    }
    let Some(row) = tx.history_point(&t.table("Posts"), &h.event.id)? else {
        return Ok(Live::EventGone);
    };
    if Event::row(row)? != h.event {
        return Ok(Live::EventGone);
    }
    birth(tx, t, &s.bound, &h.event)
}

pub(super) fn birth(
    tx: &Tx<'_>,
    t: &Timeline,
    bound: &str,
    event: &Event,
) -> Result<Live, RuntimeError> {
    let removed = owned(t, "RemovedEvents", &[Value::Id(event.id.clone())]);
    if tx
        .history_point(&t.table("RemovedEvents"), &removed)?
        .is_some()
    {
        return Ok(Live::EventGone);
    }
    let work = owned(
        t,
        "Work",
        &[
            Value::String("delivery".into()),
            Value::Id(event.actor.clone()),
            Value::Null,
            Value::Id(event.id.clone()),
            Value::Null,
        ],
    );
    let Some(row) = tx.history_point(&t.table("Work"), &work)? else {
        return Ok(Live::EventGone);
    };
    let admitted = row.field("admitted")?.as_str()?;
    if admitted.len() != 32 || !admitted.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(RuntimeError::Store(
            "invalid Following birth witness".into(),
        ));
    }
    Ok(if admitted <= bound {
        Live::Yes
    } else {
        Live::Later
    })
}

pub(super) fn next_edge(
    tx: &Tx<'_>,
    t: &Timeline,
    s: &Session,
) -> Result<Option<Value>, RuntimeError> {
    tx.history_head(
        &t.table("Edges"),
        "byPair",
        &[Value::Id(s.viewer.clone())],
        s.edge_after.clone(),
    )
}
pub(super) fn next_event(
    tx: &Tx<'_>,
    t: &Timeline,
    lane: &Lane,
) -> Result<Option<Event>, RuntimeError> {
    tx.history_head(
        &t.table("Posts"),
        "byActorTime",
        &[Value::Id(lane.actor.clone())],
        lane.after.as_ref().map(Position::suffix),
    )?
    .map(Event::row)
    .transpose()
}
