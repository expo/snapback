//! One reading path, assembled from the cards' own openings.
// @ref LLP 3000.011.000.000#8-start-here-card-structure — one source for both entry paths.
pub const START_CARDS: &[&str] = &[
    "language", "sync", "maintains", "rules", "prediction", "client", "search", "feeds",
];

pub(super) fn card() -> &'static str {
    static CARD: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    CARD.get_or_init(|| {
        let mut text = String::from("# Start here: the common application path\n\nDefault loop: check, edit with dev, then deploy staging --staging and serve staging for shared previews and probe:serve. Run `snapback4 guide staging` for real password users, operator-provisioned roles and replayable first-admin. Staging clock: `guide time` (MIG). Read these eight patterns in order; each named card continues with its complete reference. Writing rules includes writing independent privacy invariants from the spec. Start with `snapback4 guide security`: check emits an unaccepted candidate draft, audit lists uncovered role/row exposures, and test runs generated adversarial challenges. Examples identify their schema context; copy the full recipe when starting without it. Calling the backend without the JS client (curl, scripts, other languages): `snapback4 guide wire`. A browser app that writes needs `createApp`: with no synced table it needs no device (writes are journaled in localStorage, no wasm), and synced tables need `webDevice()`, about 650 KB gzip of wasm fetched when a session opens (`guide client`). A page that staff read whole and members read their own rows of is one query that branches on the grant: `if exists staff[viewer]:` returns the whole page, then `return requests where .author = viewer …` answers the rest; both are complete (`guide roles`, compiled in `guide cheatsheet`).\n\n");
        for name in START_CARDS {
            let card = super::card(name).expect("start card exists");
            let opening = card.split_once("\n## Reference").expect("start card has reference").0;
            text.push_str(opening.trim_end());
            text.push_str("\n\n");
        }
        text
    })
}
