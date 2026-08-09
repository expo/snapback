use super::*;

const DEFAULT_SERVED_GUIDE_URL: &str = "http://127.0.0.1:4287/_snapback/guide";

pub(crate) fn parse_guide_slice(value: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .ok()
        .filter(|slice| *slice > 0)
        .ok_or_else(|| "--slice must be a positive integer".to_owned())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GuideSectionMatch {
    pub(crate) path: String,
    pub(crate) heading: String,
    pub(crate) anchor: String,
}

fn markdown_heading(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let level = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&level) || trimmed.as_bytes().get(level) != Some(&b' ') {
        return None;
    }
    let heading = trimmed[level + 1..].trim();
    (!heading.is_empty()).then_some(heading)
}

fn markdown_anchor(heading: &str) -> String {
    let mut anchor = String::new();
    for character in heading.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            anchor.push(character);
        } else if character.is_whitespace() {
            anchor.push('-');
        }
    }
    if anchor.is_empty() {
        "section".to_owned()
    } else {
        anchor
    }
}

pub(crate) fn search_guide_sections_in(
    files: &[crate::guide::EmbeddedGuideFile],
    query: &str,
) -> Vec<GuideSectionMatch> {
    let query = query.to_lowercase();
    let mut matches = Vec::new();

    for file in files {
        if !file.path.ends_with(".md") || file.path == crate::guide::FLAT_PATH {
            continue;
        }
        let Ok(markdown) = std::str::from_utf8(file.bytes) else {
            continue;
        };
        let mut anchor_counts = HashMap::<String, usize>::new();
        let mut current: Option<(String, String, String)> = None;
        let mut active_fence = None;

        let finish_section = |current: Option<(String, String, String)>,
                              matches: &mut Vec<GuideSectionMatch>| {
            if let Some((heading, anchor, text)) = current
                && text.to_lowercase().contains(&query)
            {
                matches.push(GuideSectionMatch {
                    path: file.path.to_owned(),
                    heading,
                    anchor,
                });
            }
        };

        for line in markdown.lines() {
            let trimmed = line.trim_start();
            let fence = if trimmed.starts_with("```") {
                Some('`')
            } else if trimmed.starts_with("~~~") {
                Some('~')
            } else {
                None
            };
            if let Some(fence) = fence {
                match active_fence {
                    Some(active) if active == fence => active_fence = None,
                    None => active_fence = Some(fence),
                    _ => {}
                }
            }

            if active_fence.is_none()
                && let Some(heading) = markdown_heading(line)
            {
                finish_section(current.take(), &mut matches);
                let base_anchor = markdown_anchor(heading);
                let count = anchor_counts.entry(base_anchor.clone()).or_default();
                let anchor = if *count == 0 {
                    base_anchor
                } else {
                    format!("{base_anchor}-{count}")
                };
                *count += 1;
                current = Some((heading.to_owned(), anchor, format!("{heading}\n")));
            } else if let Some((_, _, text)) = &mut current {
                text.push_str(line);
                text.push('\n');
            }
        }
        finish_section(current, &mut matches);
    }

    matches
}

fn search_guide_sections(query: &str) -> Vec<GuideSectionMatch> {
    search_guide_sections_in(crate::guide::EMBEDDED_GUIDE_FILES, query)
}

pub(crate) fn render_guide_command(
    query_words: &[String],
    slice: usize,
    json_output: bool,
) -> anyhow::Result<String> {
    let query = query_words.join(" ");
    let query = query.trim();
    if query.is_empty() {
        return Ok(format!(
            "Snapback Guide documentation channels\n\
             \n\
             The URLs below use the first default dev port. If Snapback selected another port, replace the origin with the one printed by snapback dev or snapback start.\n\
             \n\
             Start with the capability index: {DEFAULT_SERVED_GUIDE_URL}/capabilities.md\n\
             Browse the Guide:             {DEFAULT_SERVED_GUIDE_URL}\n\
             API reference index:           {DEFAULT_SERVED_GUIDE_URL}/reference/index.md\n\
             API symbol registry:           {DEFAULT_SERVED_GUIDE_URL}/reference/registry.json\n\
             Flat agent projection:         {DEFAULT_SERVED_GUIDE_URL}/flat.md\n\
             Exact symbol or Guide search:  snapback guide <query> [--slice <n>]\n\
             Read through MCP:              snapback mcp\n\
             MCP entry resource:            snapback-guide://manifest\n"
        ));
    }

    // @ref LLP 0194#design — exact registry lookup precedes Markdown search;
    // a miss, rather than an independently interpreted near-match, falls back.
    if let Some(result) = crate::guide_reference::lookup(query, slice)? {
        if json_output {
            return Ok(format!("{}\n", serde_json::to_string_pretty(&result)?));
        }
        return Ok(format!(
            "{}\n",
            crate::guide_reference::format_lookup(&result)?
        ));
    }
    let matches = search_guide_sections(query);
    if matches.is_empty() {
        return Ok(format!(
            "No embedded Guide sections matched {query:?}.\nStart with the capability index: {DEFAULT_SERVED_GUIDE_URL}/capabilities.md\n"
        ));
    }

    let mut output = format!("Embedded Guide sections matching {query:?}:\n");
    for matched in &matches {
        output.push_str(&format!(
            "- {}#{} — {}\n  {DEFAULT_SERVED_GUIDE_URL}/{}#{}\n",
            matched.path, matched.anchor, matched.heading, matched.path, matched.anchor
        ));
    }
    output.push_str(&format!("{} section(s) matched.\n", matches.len()));
    Ok(output)
}

pub(crate) fn guide_command(query: &[String], slice: usize, json: bool) -> anyhow::Result<()> {
    use std::io::Write as _;

    std::io::stdout()
        .write_all(render_guide_command(query, slice, json)?.as_bytes())
        .context("failed to write Guide output")
}


