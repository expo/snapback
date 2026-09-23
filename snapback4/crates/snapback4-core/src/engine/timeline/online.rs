//! Online-only slot accounting and promotion. Shared event transitions stay in the parent.
use super::*;

impl Runner<'_> {
    fn timeline_pull(&mut self, t: &Timeline, reader: &str, author: &str, caller: &str) -> Result<bool, RuntimeError> {
        if reader == caller && self.timeline_get(&t.table("Pulls"), "byReaderAuthor", vec![Value::Id(reader.into()), Value::Id(author.into())])?.is_some() { return Ok(true); }
        let slots = self.timeline_get(&t.table("PullCounts"), "byReader", vec![Value::Id(reader.into())])?;
        let used = slots.as_ref().map(|row| row.field("used").and_then(Value::as_int)).transpose()?.unwrap_or(0);
        if used == 32 { return Ok(false); }
        // The ordinary source path deliberately executes Pulls -> PullTotals.
        // It is never an Origin::Maintained write that silently skips this edge.
        self.timeline_insert(t, "Pulls", &[Value::Id(reader.into()), Value::Id(author.into())], object([("readerId", Value::Id(reader.into())), ("authorId", Value::Id(author.into()))]))?;
        if let Some(slots) = slots {
            self.update(&t.table("PullCounts"), &field(&slots, "id")?, object([("used", Value::Int(used + 1))]))?;
        } else {
            self.timeline_insert(t, "PullCounts", &[Value::Id(reader.into())], object([("readerId", Value::Id(reader.into())), ("used", Value::Int(used + 1))]))?;
        }
        Ok(true)
    }

    pub(super) fn timeline_follow(&mut self, t: &Timeline, row: &Value) -> Result<(), RuntimeError> {
        let reader = text(row, &t.edges[1])?;
        let author = text(row, &t.edges[2])?;
        require(reader != author, "FEED_CANNOT_FOLLOW_SELF")?;
        self.timeline_profile(t, &author)?;
        self.timeline_profile(t, &reader)?;
        let mode = self.timeline_mode(t, &author)?;
        if field(&mode, "shared")? == Value::Bool(true) {
            require(self.timeline_pull(t, &reader, &author, &reader)?, "FEED_PULL_CAP")?;
        } else if self.timeline_scan(&t.edges[0], &t.followed_index, vec![Value::Id(author.clone())], 51, false)?.len() > 50 {
            require(self.timeline_pull(t, &reader, &author, &reader)?, "FEED_PULL_CAP")?;
            self.update(&t.table("Authors"), &field(&mode, "id")?, object([("shared", Value::Bool(true))]))?;
            self.timeline_pull(t, &author, &author, &reader)?;
            for follower in self.timeline_scan(&t.edges[0], &t.followed_index, vec![Value::Id(author.clone())], 1000, false)? {
                require(self.timeline_pull(t, &text(&follower, &t.edges[1])?, &author, &reader)?, "FEED_PROMOTION_PULL_CAP")?;
            }
        }
        // Membership is the newest 865 source events, not the newest pushed ones.
        for event in self.timeline_scan(&t.table("Posts"), "byActorTime", vec![Value::Id(author)], 1000, true)?.into_iter().take(865) {
            if field(&event, "shared")? == Value::Bool(false) { self.timeline_copy(t, &event, &reader, false)?; }
        }
        Ok(())
    }

    pub(super) fn timeline_unfollow(&mut self, t: &Timeline, row: &Value) -> Result<(), RuntimeError> {
        let reader = field(row, &t.edges[1])?;
        let author = field(row, &t.edges[2])?;
        for copy in self.timeline_scan(&t.table("Feed"), "byReaderActor", vec![reader.clone(), author.clone()], 1000, false)? {
            self.delete(&t.table("Feed"), &text(&copy, "id")?)?;
        }
        if let Some(route) = self.timeline_get(&t.table("Pulls"), "byReaderAuthor", vec![reader.clone(), author])? {
            self.delete(&t.table("Pulls"), &text(&route, "id")?)?;
            let slots = self.timeline_get(&t.table("PullCounts"), "byReader", vec![reader])?;
            let slots = required(slots, "FEED_PULL_COUNT_MISSING")?;
            let used = slots.field("used")?.as_int()?;
            if used == 1 { self.delete(&t.table("PullCounts"), &text(&slots, "id")?)?; }
            else { self.update(&t.table("PullCounts"), &field(&slots, "id")?, object([("used", Value::Int(used - 1))]))?; }
        }
        Ok(())
    }

}
