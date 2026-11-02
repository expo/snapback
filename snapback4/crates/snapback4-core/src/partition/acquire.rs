//! Current-image units on the ordinary partition delivery rails.
use super::*;

/// Plain wire group values, exactly as in `acquisitions` and `joined`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcquisitionGroup {
    pub table: String,
    pub group: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AcquisitionUnit {
    pub tier: usize,
    pub table: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<Vec<serde_json::Value>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AcquisitionProgress {
    /// Only a null-cursor request from zero pins the cold stream at images_at.
    /// Later units leave the applied watermark at the request's `from`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    pub unit: Option<AcquisitionUnit>,
    pub cursor: Option<String>,
    pub exhausted: bool,
    pub whole_tables: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hint_ignored: bool,
    /// A cursor's group was left, or the caller already acquired it out of order.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub skipped: Vec<AcquisitionGroup>,
}

pub struct AcquisitionPage {
    pub page: StreamPage,
    pub acquire: AcquisitionProgress,
}

fn named(table: &str, group: &[Value]) -> AcquisitionGroup {
    AcquisitionGroup { table: table.into(), group: group.iter().map(crate::wire::to_json).collect() }
}

/// Unsupported coverage shapes still use the legacy row walk. Completion of
/// their row transfer is not a new coverage certificate.
// @ref LLP 3000.001.001#9-scope-compatibility-and-costs — unions, inherited families, timelines and owner keys retain their coverage rules.
fn whole_eligible(schema: &Schema, name: &str) -> bool {
    let table = &schema.tables[name];
    table.through.is_none()
        && !table.sync.as_ref().is_some_and(Sync::is_union)
        && schema.maintain_for(name).is_none()
        && !schema.timelines.iter().any(|timeline| timeline.owns(name))
}

/// Find the next currently held, unskipped group. The cursor keeps a group
/// key, not a membership offset, including across a leave between pages.
fn resume(tx: &dyn PartitionRows, schema: &Schema, principal: &str,
    at: &mut SnapshotCursor, skip: &[AcquisitionGroup], now: i64,
    skipped: &mut Vec<AcquisitionGroup>,
) -> Result<bool, RuntimeError> {
    let tables: Vec<_> = schema.synced().filter(|(_, _, sync)| sync.horizon.is_some()).collect();
    while let Some((name, _, sync)) = tables.get(at.table) {
        let groups = snapshot_groups(tx, schema, name, sync, principal, now)?;
        if let Some(current) = &at.group {
            if !groups.contains(current) { skipped.push(named(name, current)); }
        }
        for group in groups {
            if at.group.as_ref().is_some_and(|current| canonical_json(&group) < canonical_json(current)) { continue; }
            let key = named(name, &group);
            if skip.contains(&key) { skipped.push(key); continue; }
            at.group = Some(group);
            return Ok(true);
        }
        at.table += 1;
        at.group = None;
    }
    Ok(false)
}

// @ref LLP 3000.001.001#61-the-acquisition-page — the cold first unit pins the stream; later units reuse its position and the existing join selection/budget.
pub(crate) fn page(tx: &dyn PartitionRows, schema: &Schema, principal: &str,
    cursor: Option<SnapshotCursor>, hint: Option<&AcquisitionGroup>, skip: &[AcquisitionGroup],
    from: u64, limit: usize, now: i64,
) -> Result<AcquisitionPage, RuntimeError> {
    if skip.len() > 32 { return Err(RuntimeError::Input("acquisition accepts at most 32 skipped groups".into())); }
    let head = tx.next_seq()? - 1;
    if from > head { return Err(RuntimeError::Input("acquisition watermark is ahead of the server head".into())); }
    let pinned = cursor.is_none() && from == 0;
    let watermark = if pinned { head } else { from };
    let mut at = cursor.unwrap_or(SnapshotCursor { tier: 1, ..Default::default() });
    if !matches!(at.tier, 1 | 2) || at.watermark != 0
        || at.tier == 2 && (at.arm != 0 || at.after.is_some() || at.taken != 0) {
        return Err(RuntimeError::Input("the acquisition cursor is not one this server minted".into()));
    }
    let mut out = AcquisitionPage {
        page: StreamPage { images_at: Some(head), acquisitions: vec![], events: vec![],
            joined: Default::default(), watermark, more: watermark < head },
        acquire: AcquisitionProgress { pinned, unit: None, cursor: None, exhausted: false,
            whole_tables: vec![], hint_ignored: false, skipped: vec![] },
    };
    if at.tier == 1 {
        let tables: Vec<_> = schema.synced().filter(|(_, _, sync)| sync.horizon.is_none()).collect();
        if at.table > tables.len() { return Err(RuntimeError::Input("acquisition table cursor is outside the schema".into())); }
        if let Some((name, _, _)) = tables.get(at.table) {
            out.acquire.unit = Some(AcquisitionUnit { tier: 1, table: (*name).into(), group: None });
            out.acquire.hint_ignored = hint.is_some();
            let (page, whole) = snapshot::walk(tx, schema, principal, Some(at), limit, now, true)?;
            out.page.acquisitions = page.acquisitions;
            let mut budget = delivery::Budget::new();
            for event in page.events {
                budget.push(&mut out.page.events, LogEvent { seq: from, ord: 0, table: event.table,
                    kind: event.kind.word().into(), id: event.id, data: event.data }, 0)?;
            }
            if let Some(name) = whole.filter(|name| whole_eligible(schema, name)) { out.acquire.whole_tables.push(name); }
            at = match page.next {
                Some(next) => next,
                None => SnapshotCursor { tier: 2, ..Default::default() },
            };
        } else { at = SnapshotCursor { tier: 2, ..Default::default() }; }
        if at.tier == 1 {
            out.acquire.cursor = Some(at.encode());
            return Ok(out);
        }
    }
    let tables: Vec<_> = schema.synced().filter(|(_, _, sync)| sync.horizon.is_some()).collect();
    if at.table > tables.len() { return Err(RuntimeError::Input("acquisition table cursor is outside the schema".into())); }
    let remains = resume(tx, schema, principal, &mut at, skip, now, &mut out.acquire.skipped)?;
    // A tier-1 table page remains the sole unit, even on its terminal page.
    if out.acquire.unit.is_some() || !remains {
        out.acquire.hint_ignored |= hint.is_some() && !remains;
        out.acquire.exhausted = !remains;
        out.acquire.cursor = remains.then(|| at.encode());
        return Ok(out);
    }
    let mut selected = (at.table, at.group.clone().expect("resume found a group"));
    if let Some(hint) = hint {
        let candidate = if at.priority_used || skip.contains(hint) { None } else {
            tables.iter().enumerate().find(|(_, (name, _, _))| *name == hint.table)
                .map(|(i, (name, _, sync))| {
                    Ok::<_, RuntimeError>(snapshot_groups(tx, schema, name, sync, principal, now)?
                        .into_iter().find(|group| named(name, group) == *hint).map(|group| (i, group)))
                }).transpose()?.flatten()
        };
        if let Some(candidate) = candidate { selected = candidate; }
        else { out.acquire.hint_ignored = true; }
    }
    let (name, table, sync) = tables[selected.0];
    let group = &selected.1;
    let source = LogEvent { seq: from, ord: 0, table: name.into(), kind: "join".into(),
        id: canonical_json(group), data: None };
    let horizon = sync.horizon.as_ref().expect("tier 2");
    out.page.acquisitions.push(acquisition(name, &horizon.by, group, 0, None));
    let (rows, last_key) = delivery::expand_group(tx, schema, principal, &source, table, sync,
        group, now, &mut delivery::Budget::new(), &mut out.page.events)?;
    let floor = if rows < horizon.last as usize { "whole".into() }
        else { crate::value::encode_bytes_hex(last_key.as_ref().expect("selected horizon has a last key")) };
    out.page.acquisitions.push(acquisition(name, &horizon.by, group, out.page.events.len(), Some(floor)));
    if table.leave == crate::schema::LeavePolicy::DeliveredHistory {
        out.page.joined.insert(name.into(), vec![named(name, group).group]);
    }
    out.acquire.unit = Some(AcquisitionUnit { tier: 2, table: name.into(), group: Some(named(name, group).group) });
    if selected.0 == at.table && at.group.as_ref() == Some(group) {
        at.priority_used = false;
        let groups = snapshot_groups(tx, schema, name, sync, principal, now)?;
        at.group = groups.into_iter().find(|next| canonical_json(next) > canonical_json(group));
        if at.group.is_none() { at.table += 1; }
    } else {
        // @ref LLP 3000.001.001#62-the-walk-its-cursor-and-completion — even changing hints cannot starve the durable walk.
        at.priority_used = true;
    }
    let remains = resume(tx, schema, principal, &mut at, skip, now, &mut out.acquire.skipped)?;
    out.acquire.cursor = remains.then(|| at.encode());
    out.acquire.exhausted = !remains;
    Ok(out)
}
