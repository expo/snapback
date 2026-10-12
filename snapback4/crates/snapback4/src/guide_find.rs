//! Card-less find searches the whole paved guide, including literal symbols.
use snapback4_lang::guide;
pub fn find(words: &str) -> Result<String, String> {
    let mut lines = Vec::new(); let mut cards = 0;
    for name in guide::KEYWORDS {
        let Some(card) = guide::card(name) else { continue; };
        if let Ok(found) = guide::find(name, card, words) {
            cards += 1;
            if lines.len() < 80 {
                let found = crate::verbs::without_design_references(&found);
                lines.extend(found.lines().take(80 - lines.len()).map(str::to_owned));
            }
        }
    }
    if cards == 0 { return Err(format!("no line of any guide card mentions {words:?}")); }
    if lines.len() >= 80 { lines.push(format!("matches in {cards} cards; narrow with snapback4 guide <card> --find {words:?}")); }
    Ok(lines.join("\n"))
}
