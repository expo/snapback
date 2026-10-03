use super::*;

impl Parser {
    pub(super) fn parse_timeline(&mut self) -> Fallible<TimelineDecl> {
        let site = self.take("maintain")?.site;
        let name = self.binding_name()?;
        self.take(":")?;
        self.take("timeline")?;
        // @ref LLP 3000.016.000#2-opt-in-contract — no existing spelling selects full history.
        let experimental_history_all = if self.at("experimental") {
            self.take("experimental")?; self.take("history")?; self.take("all")?; true
        } else { false };
        self.newline()?;
        self.take_kind(Kind::Indent)?;
        let mut authors = [String::new(), String::new()];
        if self.at("authors") {
            self.take("authors")?;
            authors[0] = self.word()?.value;
            self.take("by")?;
            authors[1] = self.word()?.value;
            self.newline()?;
        }
        self.take("events")?;
        let posts = self.word()?.value;
        let filter = if self.at("where") { self.take("where")?; Some(self.filtered_predicate(&posts, &[], true)?) } else { None };
        self.take("by")?;
        let author = self.word()?.value;
        self.take(",")?;
        let at = self.word()?.value;
        self.take("removed")?;
        self.take("by")?;
        let removed = self.word()?.value;
        self.newline()?;
        self.take("reposts")?;
        let reposts = self.word()?.value;
        self.take("by")?;
        let actor = self.word()?.value;
        self.take(",")?;
        let original = self.word()?.value;
        self.take(",")?;
        let repost_at = self.word()?.value;
        self.newline()?;
        self.take("edges")?;
        let edges = self.word()?.value;
        self.take("by")?;
        let follower = self.word()?.value;
        self.take(",")?;
        let followed = self.word()?.value;
        self.newline()?;
        let size = self.timeline_size()?;
        self.take_kind(Kind::Dedent)?;
        Ok(TimelineDecl { experimental_history_all, name, authors, posts: [posts, author, at, removed],
            reposts: [reposts, actor, original, repost_at], edges: [edges, follower, followed], size, filter, site })
    }

    fn timeline_size(&mut self) -> Fallible<Option<crate::recipe::FollowingCaps>> {
        let site = self.peek().site.clone();
        let refusal = |message| Diagnostic::new(&site, "E_TIMELINE_SIZE", message,
            "use size authors 1008, edges 5921; either key may be omitted (defaults: authors 1000, edges 100000); keep the recipe's sizing bounds from guide feeds").guide("feeds");
        if !self.at("size") { return Ok(None); }
        let mut authors = None;
        let mut edges = None;
        if self.at("size") {
            self.take("size")?;
            loop {
                let key = self.word().map_err(|_| refusal("expected authors or edges after size".into()))?;
                let value = match key.value.as_str() {
                    "authors" => &mut authors,
                    "edges" => &mut edges,
                    _ => return Err(refusal(format!("unknown timeline size key {}", key.value))),
                };
                if value.is_some() { return Err(refusal(format!("duplicate timeline size key {}", key.value))); }
                *value = Some(self.take_kind(Kind::Number).map_err(|_| refusal(format!("{} needs a positive 32-bit integer", key.value)))?.value);
                if !self.at(",") { break; }
                self.take(",")?;
            }
            self.newline().map_err(|_| refusal("separate size keys with a comma and end the sizing line".into()))?;
        }
        crate::recipe::FollowingCaps::parse(authors.as_deref(), edges.as_deref()).map(Some)
            .map_err(|message| refusal(message.replace("--authors", "size authors").replace("--edges", "size edges")))
    }
}
