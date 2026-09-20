//! Measured query costs for development logs and fixture output only.
use snapback4_core::{Ceilings, engine::QueryOutcome, meter::Metered};
use std::{collections::BTreeMap, time::{Duration, Instant}};

const WINDOW: Duration = Duration::from_secs(60);

struct CutWindow {
    started: Instant,
    message: String,
    emitted: u8,
    suppressed: u64,
}

#[derive(Default)]
pub(crate) struct ReadCuts(BTreeMap<(String, String), CutWindow>);

impl ReadCuts {
    // @ref LLP 3000.007#20.22.1 — measured cuts belong in dev, bounded per operation and site, not speculative check notes.
    pub(crate) fn line(&mut self, op: &str, viewer: &str, outcome: &QueryOutcome, now: Instant) -> Option<String> {
        let (kind, site) = match (&outcome.capped_at, &outcome.word_cut_at) {
            (Some((kind, site)), _) => (kind.word(), site),
            (None, Some(site)) => ("words (32 first-term words per admitted non-uniform scope)", site),
            _ => return None,
        };
        let m = outcome.metered;
        let message = format!("snapback4 dev: read {op} ({viewer}) cut by {kind} at {site}; examined={} index_entries={} rule_probes={} steps={} heap_bytes={} output_bytes={} rows_written={}; snapback4 why {op}", m.examined, m.index_entries, m.rule_probes, m.steps, m.heap_bytes, m.output_bytes, m.rows_written);
        let key = (op.to_owned(), site.clone());
        let Some(window) = self.0.get_mut(&key) else {
            self.0.insert(key, CutWindow { started: now, message: message.clone(), emitted: 1, suppressed: 0 });
            return Some(message);
        };
        if now.duration_since(window.started) < WINDOW {
            if window.message == message || window.emitted >= 2 {
                window.suppressed = window.suppressed.saturating_add(1);
                return None;
            }
        } else {
            window.started = now;
            window.emitted = 0;
        }
        window.emitted += 1;
        window.message = message.clone();
        let count = std::mem::take(&mut window.suppressed);
        Some(if count == 0 { message } else { format!("{message}; suppressed {count} repeated read cuts") })
    }
}

fn number(n: u64) -> String {
    let digits = n.to_string();
    let mut result = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 { result.push(','); }
        result.push(c);
    }
    result
}

pub(crate) fn near_ceiling(m: Metered, c: Ceilings) -> Option<String> {
    let numbers = [
        ("examined", m.examined, c.examined), ("index entries", m.index_entries, c.index_entries),
        ("rule probes", m.rule_probes, c.rule_probes), ("steps", m.steps, c.steps),
        ("heap bytes", m.heap_bytes, c.heap_bytes), ("output bytes", m.output_bytes, c.output_bytes),
        ("rows written", m.rows_written, c.rows_written),
    ].into_iter().filter(|(_, used, ceiling)| *used > ceiling / 2)
        .map(|(name, used, ceiling)| format!("{name} {} of {}", number(used), number(ceiling))).collect::<Vec<_>>();
    (!numbers.is_empty()).then(|| numbers.join("; "))
}
