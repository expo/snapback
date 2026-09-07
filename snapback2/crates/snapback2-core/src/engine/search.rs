//! Evaluated source descriptors and execution-local prepared meanings.
use super::runner::Runner;
use super::*;
use crate::ir::{IndexKeyExpr, Scan};
use crate::search_key::{IndexAtom, LogicalIndexAtom, NormalizedWordPrefix, WordPrefix};
use crate::unicode::SearchNormalizer;

impl Runner<'_> {
    pub(super) fn derive_charge(
        &mut self,
        work: search_index::Derivation,
    ) -> Result<(), RuntimeError> {
        self.trace.derived_steps = self.trace.derived_steps.saturating_add(work.steps);
        self.derived_temporary_peak = self.derived_temporary_peak.max(work.scratch);
        self.trace.derived_scratch_bytes = self
            .trace
            .derived_scratch_bytes
            .max(work.scratch.saturating_add(self.derived_live_bytes));
        if let Some(cert) = self.certificate {
            if self.trace.derived_steps > cert.derived_steps
                || self.trace.derived_scratch_bytes > cert.derived_scratch_bytes
            {
                return Err(RuntimeError::TraceSubset(format!(
                    "derived work {}/{} scratch {}/{}",
                    self.trace.derived_steps,
                    cert.derived_steps,
                    self.trace.derived_scratch_bytes,
                    cert.derived_scratch_bytes
                )));
            }
        }
        Ok(())
    }
    pub(super) fn search_prefix(
        &mut self,
        scan: &Scan,
    ) -> Result<(Vec<IndexAtom>, Vec<LogicalIndexAtom>, Vec<Value>, bool), RuntimeError> {
        let mut atoms = Vec::new();
        let mut logical = Vec::new();
        let mut physical = Vec::new();
        let mut empty = false;
        for key in &scan.prefix {
            let value = self.expr(key.expression())?;
            let (atom, meaning) = match key {
                IndexKeyExpr::Scalar(_) => (
                    IndexAtom::Scalar(value.clone()),
                    LogicalIndexAtom::Scalar(value.clone()),
                ),
                IndexKeyExpr::WordPrefix {
                    source_max,
                    contract,
                    ..
                } => {
                    let source = value.as_str()?.to_owned();
                    let cache_key = (source.clone(), *source_max);
                    let atom = IndexAtom::WordPrefix(WordPrefix {
                        contract: *contract,
                        source: source.clone(),
                    });
                    let meaning = if let Some(found) = self.search_terms.get(&cache_key) {
                        found.clone()
                    } else {
                        let (term, steps, scratch) =
                            NormalizedWordPrefix::prepare(&source, *source_max)
                                .map_err(|e| RuntimeError::Input(e.to_string()))?;
                        let meaning = LogicalIndexAtom::WordPrefix(term);
                        self.derive_charge(search_index::Derivation {
                            steps: steps as u64,
                            scratch: scratch as u64,
                        })?;
                        self.derived_hold(
                            (source.capacity() + meaning_token_bytes(&meaning) + 128) as u64,
                        );
                        self.search_terms.insert(cache_key, meaning.clone());
                        meaning
                    };
                    // Two retained wire descriptors; shared normalized terms and fixed-size
                    // stream hash buckets. Cache/output capacity is reserved separately.
                    self.derived_hold((source.capacity() * 2 + 256) as u64);
                    (atom, meaning)
                }
            };
            match &meaning {
                LogicalIndexAtom::Scalar(value) => physical.push(value.clone()),
                LogicalIndexAtom::WordPrefix(term) => {
                    let node = if let Some(token) = term.token() {
                        let cache_key = (scan.table.clone(), scan.index.clone(), token.to_owned());
                        if let Some(node) = self.search_nodes.get(&cache_key) {
                            *node
                        } else {
                            let node = search_index::resolve(
                                self.tx,
                                &scan.table,
                                &scan.index,
                                Some(token),
                            )?;
                            self.derive_charge(search_index::Derivation {
                                steps: token.chars().count() as u64,
                                scratch: 0,
                            })?;
                            self.search_nodes.insert(cache_key, node);
                            node
                        }
                    } else {
                        None
                    };
                    empty |= node.is_none();
                    // The physical slot is never stored in a receipt, cursor, or application row.
                    physical.push(Value::Int(node.unwrap_or(0)));
                }
            }
            atoms.push(atom);
            logical.push(meaning);
        }
        Ok((atoms, logical, physical, empty))
    }
}

impl Runner<'_> {
    pub(super) fn unicode_words(&mut self, value: Value) -> Result<Value, RuntimeError> {
        if value == Value::Null {
            return Ok(Value::Array(Vec::new()));
        }
        let source = value.as_str()?;
        let n = source.chars().count();
        crate::unicode::validate_search_source(source, n)
            .map_err(|e| RuntimeError::Input(e.to_string()))?;
        let (text, stats) = SearchNormalizer::default()
            .normalize(source, n)
            .map_err(|e| RuntimeError::Input(e.to_string()))?;
        let mut seen = std::collections::HashSet::new();
        let mut output = Vec::new();
        let mut occurrences = 0;
        for word in text
            .split(crate::unicode::is_search_boundary)
            .filter(|w| !w.is_empty())
        {
            occurrences += 1;
            if seen.insert(word) {
                output.push(Value::String(word.to_owned()));
            }
        }
        let u = text.chars().count();
        let step = crate::unicode::normalization_steps(&stats) + 2 * n + 3 * u + occurrences;
        let output_bytes = output
            .iter()
            .map(|v| v.as_str().unwrap().len())
            .sum::<usize>();
        let scratch = stats.scratch_bytes
            + source.len()
            + text.capacity()
            + output_bytes
            + output.capacity() * std::mem::size_of::<Value>()
            + seen.capacity() * 24;
        self.derive_charge(search_index::Derivation {
            steps: step as u64,
            scratch: scratch as u64,
        })?;
        Ok(Value::Array(output))
    }
}

fn meaning_token_bytes(m: &LogicalIndexAtom) -> usize {
    match m {
        LogicalIndexAtom::WordPrefix(p) => p.token().map_or(0, str::len),
        _ => 0,
    }
}
impl Runner<'_> {
    pub(super) fn derived_hold(&mut self, bytes: u64) {
        self.derived_live_bytes = self.derived_live_bytes.saturating_add(bytes);
        self.trace.derived_scratch_bytes = self.trace.derived_scratch_bytes.max(
            self.derived_live_bytes
                .saturating_add(self.derived_temporary_peak),
        );
    }
}
