use super::*;

impl Parser {
    pub(super) fn parse_timeline(&mut self) -> Fallible<TimelineDecl> {
        let site = self.take("maintain")?.site;
        let name = self.binding_name()?;
        self.take(":")?;
        self.take("timeline")?;
        self.newline()?;
        self.take_kind(Kind::Indent)?;
        self.take("authors")?;
        let author_table = self.word()?.value;
        self.take("by")?;
        let principal = self.word()?.value;
        self.newline()?;
        self.take("events")?;
        let posts = self.word()?.value;
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
        self.take_kind(Kind::Dedent)?;
        Ok(TimelineDecl { name, authors: [author_table, principal], posts: [posts, author, at, removed],
            reposts: [reposts, actor, original, repost_at], edges: [edges, follower, followed], site })
    }
}
