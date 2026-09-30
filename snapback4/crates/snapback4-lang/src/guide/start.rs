//! One reading path, assembled from the cards' own openings.
// @ref LLP 3000.011.000.000#8-start-here-card-structure — one source for both entry paths.
pub const START_CARDS: &[&str] = &[
    "language", "sync", "maintains", "rules", "prediction", "client", "search", "feeds",
];

pub(super) fn card() -> &'static str {
    static CARD: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    CARD.get_or_init(|| {
        let mut text = String::from("# Start here: the common application path\n\nRead these eight patterns in order; each named card continues with its complete reference. Examples identify their schema context; copy the full recipe when starting without it.\n\n");
        for name in START_CARDS {
            let card = super::card(name).expect("start card exists");
            let opening = card.split_once("\n## Reference").expect("start card has reference").0;
            text.push_str(opening.trim_end());
            text.push_str("\n\n");
        }
        text
    })
}
