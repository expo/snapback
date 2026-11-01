//! Bounded reading sections; the compiled corpus retains complete examples.
// @ref LLP 3000.037.000#8 — preserve one heading per explicit section within the reference bound.
use super::{FULL_BYTES, REFERENCE_BYTES, reading_blocks};

/// Flatten nested reference headings and split at complete paragraphs/fences.
/// Long runnable references stay in the package, behind a file pointer.
pub fn reader_card(name: &str, card: &str) -> String {
    if card.len() <= FULL_BYTES { return card.into(); }
    let title = card.lines().next().unwrap_or("# Guide");
    // Package manuals keep TOK6's existing bounded pagination contract.
    let limit = if name.starts_with("package-reference ") { FULL_BYTES } else { REFERENCE_BYTES };
    let room = limit.saturating_sub(title.len() + 350);
    let mut out = format!("{title}\n\nRead one section for your change. `guide {name} --sections` lists sections.\n\n");
    let mut heading = "Opening".to_owned();
    let mut page = String::new();
    let mut part = 1;
    let flush = |out: &mut String, page: &mut String, heading: &str, part: usize| {
        if page.is_empty() { return; }
        out.push_str(&format!("## {heading}{}\n\n{}\n", if part == 1 { String::new() } else { format!(" (continued {part})") }, page));
        page.clear();
    };
    let mut fenced = false;
    // Isolate headings even where source prose has no preceding blank line.
    let mut prepared = String::new();
    for line in card.lines().skip(1) {
        if line.starts_with("```") {
            if !fenced { prepared.push('\n'); }
            fenced = !fenced;
        }
        if !fenced && (line.starts_with("## ") || line.starts_with("### ")) { prepared.push('\n'); }
        prepared.push_str(line); prepared.push('\n');
        if !fenced && (line.starts_with("## ") || line.starts_with("### ") || line.starts_with("```")) { prepared.push('\n'); }
    }
    for block in reading_blocks(&prepared) {
        if block.starts_with("## ") || block.starts_with("### ") {
            flush(&mut out, &mut page, &heading, part);
            heading = block.trim().trim_start_matches('#').trim().to_owned(); part = 1;
            continue;
        }
        let block = if block.len() > room && block.starts_with("```") {
            // These complete sources are packed by pack-recipes.mjs.
            let reference=match name {
                "testing" if block.contains("day2-accounts")=>"day2-accounts.mjs",
                "social" if block.contains("// src/Conversation.tsx")=>"social/Conversation.tsx",
                "social" if block.contains("// src/useJumpToMessage.ts")=>"social/useJumpToMessage.ts",
                _=>panic!("oversized guide fence needs its own packed reference: {name}"),
            };
            format!("Complete reference: node_modules/snapback4/dist/recipes/{reference}. Read only this file when adapting that example.\n")
        } else { block };
        // Dense prose can exceed a section; split only prose at word boundaries.
        let chunks = if block.len() > room {
            let mut chunks = Vec::new(); let mut chunk = String::new();
            for word in block.split_inclusive(char::is_whitespace) {
                if chunk.len() + word.len() > room && !chunk.is_empty() { chunks.push(std::mem::take(&mut chunk)); }
                chunk.push_str(word);
            }
            if !chunk.is_empty() { chunks.push(chunk); } chunks
        } else { vec![block] };
        for chunk in chunks {
            if page.len() + chunk.len() + 1 > room { flush(&mut out, &mut page, &heading, part); part += 1; }
            page.push_str(&chunk); page.push('\n');
        }
    }
    flush(&mut out, &mut page, &heading, part);
    out
}
