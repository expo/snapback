//! Long references are compiled into the CLI, never installed as whole manuals.
// @ref LLP 3000.037.000#18-bounded-package-reference-and-wiring-lookups-tok6 — topic/section access replaces discoverable manual files.
pub const TOPICS: &[(&str, &str)] = &[
    (
        "server",
        include_str!("../../../../packages/snapback4/reference/SERVER.md"),
    ),
    (
        "client",
        include_str!("../../../../packages/snapback4/reference/CLIENT-AND-OPERATIONS.md"),
    ),
    (
        "following",
        include_str!("../../../../packages/snapback4/reference/FOLLOWING-ADOPTION.md"),
    ),
    (
        "offline-uploads",
        include_str!("../../../../packages/snapback4/reference/OFFLINE-UPLOADS.md"),
    ),
    (
        "changes",
        include_str!("../../../../packages/snapback4/reference/CHANGELOG.md"),
    ),
];

pub fn card(topic: &str) -> Option<String> {
    let (_, raw) = TOPICS.iter().find(|(name, _)| *name == topic)?;
    Some(super::reader_card(
        &format!("package-reference {topic}"),
        raw,
    ))
}
